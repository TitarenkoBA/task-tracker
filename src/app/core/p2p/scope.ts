import {
  BaseEntity,
  COLLECTIONS,
  CollectionName,
  EntityId,
  PROJECT_COLORS,
} from '../models/entities';
import { parseHlc } from '../sync/hlc';
import { EntityChange } from '../sync/merge';
import { isEntityId, isRecord } from './protocol';

/**
 * Что из данных относится к общему проекту и можно ли доверять изменению от другого участника.
 *
 * Совместная работа идёт над ОДНИМ проектом: остальные проекты на устройстве никуда
 * не отправляются, и никто из комнаты не может их изменить.
 */

/** Доступ к данным, включая удалённые записи (надгробия тоже синхронизируются). */
export interface ScopeLookup {
  get(collection: CollectionName, id: EntityId): BaseEntity | undefined;
  all(collection: CollectionName): Iterable<BaseEntity>;
}

// ---------------------------------------------------------------------------
// Проверка полей
// ---------------------------------------------------------------------------

type Validator = (value: unknown) => boolean;

const str =
  (max: number): Validator =>
  (v) =>
    typeof v === 'string' && v.length <= max;
const oneOf =
  (values: readonly string[]): Validator =>
  (v) =>
    typeof v === 'string' && values.includes(v);
const nullable =
  (inner: Validator): Validator =>
  (v) =>
    v === null || inner(v);
const id: Validator = isEntityId;
const int: Validator = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const finite: Validator = (v) => typeof v === 'number' && Number.isFinite(v);
const bool: Validator = (v) => typeof v === 'boolean';
const isoDate: Validator = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const stringList =
  (maxItems: number, maxLength: number): Validator =>
  (v) =>
    Array.isArray(v) && v.length <= maxItems && v.every((item) => str(maxLength)(item));
const statuses: Validator = (v) =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 30 &&
  v.every(
    (s) =>
      isRecord(s) &&
      str(64)(s['id']) &&
      str(100)(s['name']) &&
      oneOf(['todo', 'in_progress', 'done'])(s['category']),
  );

const BASE: Record<string, Validator> = { createdAt: finite, updatedAt: finite, deleted: bool };

/** Допустимые поля каждой коллекции. Неизвестное поле — изменение отклоняется целиком. */
const SCHEMAS: Record<CollectionName, Record<string, Validator>> = {
  projects: {
    ...BASE,
    key: (v) => typeof v === 'string' && /^[A-Z][A-Z0-9]{1,9}$/.test(v),
    name: str(200),
    description: str(20_000),
    color: oneOf(PROJECT_COLORS),
    statuses,
    issueCounter: int,
  },
  issues: {
    ...BASE,
    projectId: id,
    number: (v) => int(v) && (v as number) > 0,
    type: oneOf(['epic', 'story', 'task', 'bug', 'subtask']),
    title: (v) => str(500)(v) && (v as string).trim().length > 0,
    description: str(100_000),
    statusId: str(64),
    priority: oneOf(['highest', 'high', 'medium', 'low', 'lowest']),
    assigneeId: nullable(id),
    reporterId: nullable(id),
    labels: stringList(50, 50),
    storyPoints: nullable((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0),
    dueDate: nullable(isoDate),
    parentId: nullable(id),
    sprintId: nullable(id),
    order: finite,
  },
  sprints: {
    ...BASE,
    projectId: id,
    name: str(200),
    goal: str(5000),
    state: oneOf(['planned', 'active', 'closed']),
    startDate: nullable(isoDate),
    endDate: nullable(isoDate),
  },
  people: { ...BASE, name: str(100), email: str(200), color: oneOf(PROJECT_COLORS) },
  comments: { ...BASE, issueId: id, authorId: nullable(id), body: str(50_000) },
  activity: {
    ...BASE,
    issueId: id,
    actorId: nullable(id),
    kind: oneOf(['created', 'changed', 'commented']),
    field: nullable(str(50)),
    from: nullable(str(1000)),
    to: nullable(str(1000)),
  },
  messages: {
    ...BASE,
    projectId: id,
    authorId: nullable(id),
    text: (v) => str(4000)(v) && (v as string).trim().length > 0,
  },
};

/** Насколько метка времени от другого участника может опережать наши часы. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Проверить изменение от другого участника. Возвращает очищенное изменение
 * (только поля, у которых есть метка времени) или `null`, если ему нельзя доверять.
 */
export function validateChange(change: EntityChange, now = Date.now()): EntityChange | null {
  if (!COLLECTIONS.includes(change.collection)) return null;
  const schema = SCHEMAS[change.collection];
  const fields: Record<string, unknown> = {};
  const clock: Record<string, string> = {};
  for (const [field, value] of Object.entries(change.fields)) {
    const validate = schema[field];
    const hlc = change.clock[field];
    if (!validate || !validate(value) || typeof hlc !== 'string') return null;
    const parsed = parseHlc(hlc);
    // Метка «из будущего» навсегда перебила бы все наши правки этого поля.
    if (!parsed || parsed.time > now + MAX_CLOCK_SKEW_MS) return null;
    fields[field] = value;
    clock[field] = hlc;
  }
  return Object.keys(fields).length
    ? { collection: change.collection, id: change.id, fields, clock }
    : null;
}

// ---------------------------------------------------------------------------
// Принадлежность проекту
// ---------------------------------------------------------------------------

/** Порядок обработки: родители раньше детей, люди — в конце (их проверка смотрит на остальных). */
const ORDER: CollectionName[] = [
  'projects',
  'sprints',
  'issues',
  'comments',
  'activity',
  'messages',
  'people',
];

const PERSON_REFERENCES: Partial<Record<CollectionName, string[]>> = {
  issues: ['assigneeId', 'reporterId'],
  comments: ['authorId'],
  activity: ['actorId'],
  messages: ['authorId'],
};

/** ID людей, на которых ссылаются данные (сущности или изменения). */
export function referencedPeople(
  items: Iterable<{ collection: CollectionName; fields: Record<string, unknown> }>,
): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const item of items) {
    for (const field of PERSON_REFERENCES[item.collection] ?? []) {
      const value = item.fields[field];
      if (typeof value === 'string') ids.add(value);
    }
  }
  return ids;
}

function field(entity: BaseEntity | undefined, name: string): unknown {
  return entity ? (entity as unknown as Record<string, unknown>)[name] : undefined;
}

/** ID задач проекта (включая удалённые). */
function projectIssues(lookup: ScopeLookup, projectId: EntityId): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const issue of lookup.all('issues')) {
    if (field(issue, 'projectId') === projectId) ids.add(issue.id);
  }
  return ids;
}

/** Все сущности общего проекта — то, что отправляется при подключении. */
export function projectSnapshot(
  lookup: ScopeLookup,
  projectId: EntityId,
  extraPeople: Iterable<EntityId> = [],
): { collection: CollectionName; entity: BaseEntity }[] {
  const issues = projectIssues(lookup, projectId);
  const result: { collection: CollectionName; entity: BaseEntity }[] = [];
  const belongs: Record<Exclude<CollectionName, 'people'>, (e: BaseEntity) => boolean> = {
    projects: (e) => e.id === projectId,
    sprints: (e) => field(e, 'projectId') === projectId,
    issues: (e) => issues.has(e.id),
    comments: (e) => issues.has(field(e, 'issueId') as string),
    activity: (e) => issues.has(field(e, 'issueId') as string),
    messages: (e) => field(e, 'projectId') === projectId,
  };
  for (const collection of ORDER) {
    if (collection === 'people') continue;
    for (const entity of lookup.all(collection)) {
      if (belongs[collection](entity)) result.push({ collection, entity });
    }
  }
  const people = referencedPeople(
    result.map(({ collection, entity }) => ({
      collection,
      fields: entity as unknown as Record<string, unknown>,
    })),
  );
  for (const personId of extraPeople) people.add(personId);
  for (const personId of people) {
    const person = lookup.get('people', personId);
    if (person) result.push({ collection: 'people', entity: person });
  }
  return result;
}

/**
 * Относится ли изменение к общему проекту. Для изменений от других участников
 * `batch` — ID задач, которые принимаются в этом же пакете (комментарий может прийти
 * вместе с новой задачей).
 */
function belongsToProject(
  change: EntityChange,
  lookup: ScopeLookup,
  projectId: EntityId,
  issues: Set<EntityId>,
): boolean {
  const existing = lookup.get(change.collection, change.id);
  // Поле-владелец нельзя «переписать», уведя запись из проекта или в чужой проект.
  const owner = (name: string): unknown => {
    const incoming = change.fields[name];
    const current = field(existing, name);
    if (existing && incoming !== undefined && incoming !== current) return undefined;
    return existing ? current : incoming;
  };
  switch (change.collection) {
    case 'projects':
      return change.id === projectId;
    case 'sprints':
    case 'issues':
    case 'messages':
      return owner('projectId') === projectId;
    case 'comments':
    case 'activity':
      return issues.has(owner('issueId') as string);
    case 'people':
      return false; // решается отдельно
  }
}

/** Люди, на которых ссылаются данные проекта. */
function sharedPeople(lookup: ScopeLookup, projectId: EntityId): Set<EntityId> {
  return referencedPeople(
    projectSnapshot(lookup, projectId).map(({ collection, entity }) => ({
      collection,
      fields: entity as unknown as Record<string, unknown>,
    })),
  );
}

/**
 * Отобрать из пакета изменений от другого участника только допустимые и относящиеся
 * к общему проекту. `participants` — ID людей, которые сейчас в комнате.
 */
export function filterIncoming(
  changes: EntityChange[],
  lookup: ScopeLookup,
  projectId: EntityId,
  participants: Iterable<EntityId> = [],
  now = Date.now(),
): EntityChange[] {
  const issues = projectIssues(lookup, projectId);
  const accepted: EntityChange[] = [];
  const valid = changes
    .map((change) => validateChange(change, now))
    .filter((c): c is EntityChange => c !== null)
    .sort((a, b) => ORDER.indexOf(a.collection) - ORDER.indexOf(b.collection));

  const people: EntityChange[] = [];
  for (const change of valid) {
    if (change.collection === 'people') {
      people.push(change);
      continue;
    }
    if (!belongsToProject(change, lookup, projectId, issues)) continue;
    if (change.collection === 'issues') issues.add(change.id);
    accepted.push(change);
  }

  // Людей принимаем, если это участник комнаты, на него ссылается проект (или этот пакет),
  // или такого человека у нас ещё нет. Чужие контакты из других проектов так не перепишешь.
  const known = new Set<EntityId>(participants);
  for (const personId of referencedPeople(accepted)) known.add(personId);
  const projectPeople = people.length ? sharedPeople(lookup, projectId) : new Set<EntityId>();
  for (const change of people) {
    if (!lookup.get('people', change.id) || known.has(change.id) || projectPeople.has(change.id)) {
      accepted.push(change);
    }
  }
  return accepted;
}

/**
 * Отобрать из локальных изменений то, что нужно отправить в комнату.
 * К изменениям, которые ссылаются на людей, прикладываются сами эти люди —
 * иначе у других вместо исполнителя было бы «неизвестно кто».
 */
export function filterOutgoing(
  changes: EntityChange[],
  lookup: ScopeLookup,
  projectId: EntityId,
  participants: Iterable<EntityId> = [],
): EntityChange[] {
  const issues = projectIssues(lookup, projectId);
  const result = changes.filter(
    (change) =>
      change.collection !== 'people' && belongsToProject(change, lookup, projectId, issues),
  );
  const peopleChanges = changes.filter((c) => c.collection === 'people');
  if (peopleChanges.length) {
    const shared = sharedPeople(lookup, projectId);
    for (const personId of participants) shared.add(personId);
    for (const change of peopleChanges) {
      if (shared.has(change.id)) result.push(change);
    }
  }
  // Люди, впервые упомянутые в этих изменениях, — целиком.
  const sending = new Set(result.filter((c) => c.collection === 'people').map((c) => c.id));
  for (const personId of referencedPeople(result)) {
    const person = lookup.get('people', personId);
    if (person && !sending.has(personId)) {
      const { id: _id, clock, ...fields } = person;
      result.push({ collection: 'people', id: personId, fields, clock });
    }
  }
  return result;
}
