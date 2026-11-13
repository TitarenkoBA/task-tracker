/**
 * Доменные сущности приложения.
 *
 * Все сущности наследуются от {@link BaseEntity}. Служебные поля
 * (`clock`, `deleted`) нужны для слияния данных: сейчас — при импорте,
 * в будущем — при P2P-синхронизации между устройствами.
 * Подробности: docs/architecture.md и docs/p2p-sync.md.
 */

/** Уникальный идентификатор сущности (UUID v4). */
export type EntityId = string;

/**
 * Метка гибридных логических часов (Hybrid Logical Clock).
 * Строка, которую можно сравнивать обычным `<` / `>`:
 * чем «больше» строка, тем позже произошло изменение.
 */
export type Hlc = string;

export interface BaseEntity {
  id: EntityId;
  /** Время создания, мс с 1970 года. */
  createdAt: number;
  /** Время последнего изменения, мс с 1970 года. */
  updatedAt: number;
  /**
   * Мягкое удаление («надгробие»). Удалённые записи не стираются физически,
   * чтобы другие устройства узнали об удалении при синхронизации.
   */
  deleted: boolean;
  /** Для каждого поля — HLC его последнего изменения. Основа слияния (LWW). */
  clock: Record<string, Hlc>;
}

/** Служебные поля, которые проставляет хранилище, а не вызывающий код. */
export type SystemField = keyof BaseEntity;

/** Данные для создания сущности: всё, кроме служебных полей. */
export type NewEntity<T extends BaseEntity> = Omit<T, SystemField>;

/** Частичное изменение сущности. */
export type EntityPatch<T extends BaseEntity> = Partial<Omit<T, SystemField>>;

// ---------------------------------------------------------------------------
// Проекты и рабочий процесс
// ---------------------------------------------------------------------------

/** Категория статуса: определяет цвет и считается ли задача завершённой. */
export type StatusCategory = 'todo' | 'in_progress' | 'done';

/** Колонка рабочего процесса (и доски). */
export interface WorkflowStatus {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface Project extends BaseEntity {
  /** Короткий ключ проекта, например `WEB`. Из него строятся ключи задач: `WEB-12`. */
  key: string;
  name: string;
  description: string;
  /** Цвет проекта (имя из {@link PROJECT_COLORS}). */
  color: ProjectColor;
  /** Упорядоченный список статусов = колонки доски. */
  statuses: WorkflowStatus[];
  /** Счётчик для нумерации задач. */
  issueCounter: number;
}

export const PROJECT_COLORS = [
  'indigo',
  'sky',
  'emerald',
  'amber',
  'rose',
  'violet',
  'teal',
  'orange',
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

// ---------------------------------------------------------------------------
// Задачи
// ---------------------------------------------------------------------------

export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'subtask';
export type IssuePriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export interface Issue extends BaseEntity {
  projectId: EntityId;
  /** Порядковый номер в проекте. Ключ задачи = `${project.key}-${number}`. */
  number: number;
  type: IssueType;
  title: string;
  description: string;
  statusId: string;
  priority: IssuePriority;
  assigneeId: EntityId | null;
  reporterId: EntityId | null;
  labels: string[];
  storyPoints: number | null;
  /** Срок в формате `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Родитель: эпик для обычных задач или задача для подзадачи. */
  parentId: EntityId | null;
  /** Спринт; `null` — задача в бэклоге. */
  sprintId: EntityId | null;
  /** Позиция в колонке/списке. Меньше — выше. */
  order: number;
}

// ---------------------------------------------------------------------------
// Спринты, люди, комментарии, история
// ---------------------------------------------------------------------------

export type SprintState = 'planned' | 'active' | 'closed';

export interface Sprint extends BaseEntity {
  projectId: EntityId;
  name: string;
  goal: string;
  state: SprintState;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Участник. Пока это просто «карточки» людей, которых можно назначать
 * исполнителями. В P2P-режиме участник станет реальным пиром.
 */
export interface Person extends BaseEntity {
  name: string;
  email: string;
  color: ProjectColor;
}

export interface Comment extends BaseEntity {
  issueId: EntityId;
  authorId: EntityId | null;
  body: string;
}

/** Запись истории изменений задачи. Только добавляется, не редактируется. */
export interface Activity extends BaseEntity {
  issueId: EntityId;
  actorId: EntityId | null;
  kind: 'created' | 'changed' | 'commented';
  field: string | null;
  from: string | null;
  to: string | null;
}

/** Сообщение чата проекта. Хранится и синхронизируется как остальные данные. */
export interface Message extends BaseEntity {
  projectId: EntityId;
  authorId: EntityId | null;
  text: string;
}

// ---------------------------------------------------------------------------
// Коллекции
// ---------------------------------------------------------------------------

/** Соответствие «имя коллекции → тип сущности». */
export interface CollectionMap {
  projects: Project;
  issues: Issue;
  sprints: Sprint;
  people: Person;
  comments: Comment;
  activity: Activity;
  messages: Message;
}

export type CollectionName = keyof CollectionMap;

export const COLLECTIONS: readonly CollectionName[] = [
  'projects',
  'issues',
  'sprints',
  'people',
  'comments',
  'activity',
  'messages',
];

/** Полный снимок данных: все сущности всех коллекций, включая удалённые. */
export type Snapshot = { [C in CollectionName]: CollectionMap[C][] };

export function emptySnapshot(): Snapshot {
  return {
    projects: [],
    issues: [],
    sprints: [],
    people: [],
    comments: [],
    activity: [],
    messages: [],
  };
}
