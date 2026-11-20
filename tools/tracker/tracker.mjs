#!/usr/bin/env node
/**
 * Трекер из терминала: участник P2P-комнаты проекта, как ещё один браузер.
 *
 * Как это работает:
 * - Держит локальную реплику ОДНОГО проекта (state.json рядом со скриптом) с теми же
 *   HLC-часами и тем же слиянием «последняя запись побеждает» по полям, что и приложение
 *   (src/app/core/sync). Поэтому правки отсюда и из браузера никогда не затирают друг друга.
 * - Каждая команда подключается к комнате `tt-<id проекта>` гостем, обменивается снимком
 *   проекта с хостом (браузером), применяет правку, отправляет её и отключается.
 * - Если в комнате никого нет, команда работает с репликой, а правки уйдут
 *   при следующей удачной синхронизации (они входят в снимок, который отправляется при входе).
 *
 * Протокол — src/app/core/p2p/protocol.ts и room.ts, правила проверки — scope.ts.
 * Справка: node tools/tracker/tracker.mjs help
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as Y from 'yjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = process.env.TRACKER_STATE ?? join(HERE, 'state.json');

/** Как в src/app/core/p2p/p2p.config.ts. */
const P2P = {
  host: 'zik2009-my-peerjs-server.hf.space',
  port: 443,
  path: '/myapp',
  secure: true,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs',
      credential: 'peerjsp',
    },
  ],
};
/** Как в protocol.ts. */
const APP_ID = 'task-tracker';
const PROTOCOL_VERSION = 1;
const ROOM_PREFIX = 'tt-';

const SIGNALING_TIMEOUT_MS = 15_000;
const WELCOME_TIMEOUT_MS = 20_000;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const ORDER_STEP = 1000;

const COLLECTIONS = ['projects', 'issues', 'sprints', 'people', 'comments', 'activity', 'messages'];
const TYPES = ['epic', 'story', 'task', 'bug', 'subtask'];
const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];
const CATEGORIES = ['todo', 'in_progress', 'done'];
const COLORS = ['indigo', 'sky', 'emerald', 'amber', 'rose', 'violet', 'teal', 'orange'];
/** Как TRACKED_FIELDS в src/app/core/models/catalog.ts: изменения этих полей попадают в историю. */
const TRACKED_FIELDS = [
  'title',
  'description',
  'type',
  'statusId',
  'priority',
  'assigneeId',
  'reporterId',
  'labels',
  'storyPoints',
  'dueDate',
  'parentId',
  'sprintId',
];

class UserError extends Error {}

// ---------------------------------------------------------------------------
// HLC и слияние — копия src/app/core/sync/hlc.ts и merge.ts
// ---------------------------------------------------------------------------

function formatHlc(time, counter, replicaId) {
  return `${String(time).padStart(13, '0')}:${counter.toString(36).padStart(5, '0')}:${replicaId}`;
}

function parseHlc(hlc) {
  const [time, counter, ...rest] = String(hlc).split(':');
  const replicaId = rest.join(':');
  if (!time || !counter || !replicaId) return null;
  const t = Number(time);
  const c = parseInt(counter, 36);
  if (!Number.isFinite(t) || !Number.isFinite(c)) return null;
  return { time: t, counter: c };
}

class Clock {
  constructor(replicaId, lastTime = 0, counter = 0) {
    this.replicaId = replicaId;
    this.lastTime = lastTime;
    this.counter = counter;
  }

  tick() {
    const time = Date.now();
    if (time > this.lastTime) {
      this.lastTime = time;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatHlc(this.lastTime, this.counter, this.replicaId);
  }

  receive(remote) {
    const parsed = parseHlc(remote);
    if (!parsed) return;
    const time = Math.max(Date.now(), this.lastTime, parsed.time);
    if (time === this.lastTime && time === parsed.time) {
      this.counter = Math.max(this.counter, parsed.counter) + 1;
    } else if (time === this.lastTime) {
      this.counter++;
    } else if (time === parsed.time) {
      this.counter = parsed.counter + 1;
    } else {
      this.counter = 0;
    }
    this.lastTime = time;
  }
}

function mergeEntity(current, change) {
  const base = current
    ? { ...current, clock: { ...current.clock } }
    : { id: change.id, deleted: false, clock: {} };
  let changed = !current;
  for (const [field, value] of Object.entries(change.fields)) {
    if (field === 'id' || field === 'clock') continue;
    if (change.collection === 'issues' && field === 'descriptionState') continue;
    const incoming = change.clock[field];
    if (!incoming) continue;
    const existing = base.clock[field];
    if (existing === undefined || incoming > existing) {
      base[field] = value;
      base.clock[field] = incoming;
      changed = true;
    }
  }
  if (change.collection === 'issues' && mergeDescription(current, change, base)) changed = true;
  return changed ? base : null;
}

function mergeDescription(current, change, base) {
  const incoming = change.fields.descriptionState;
  if (typeof incoming === 'string' && incoming) {
    const merged = mergeTextStates(base.descriptionState || '', incoming);
    const text = textOf(merged);
    if (text === (current?.description ?? '') && current?.descriptionState) return false;
    base.descriptionState = merged;
    base.description = text;
    const stamp = later(base.clock.descriptionState, change.clock.descriptionState);
    if (stamp) {
      base.clock.descriptionState = stamp;
      base.clock.description = stamp;
    }
    return true;
  }
  if (!base.descriptionState || typeof base.description !== 'string') return false;
  if (textOf(base.descriptionState) === base.description) return false;
  base.descriptionState = applyTextEdit(base.descriptionState, textOf(base.descriptionState), base.description);
  const stamp = base.clock.description ?? change.clock.description;
  if (stamp) base.clock.descriptionState = stamp;
  return true;
}

function later(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

const TEXT = 'd';

function textOf(state) {
  if (!state) return '';
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytesFrom(state));
    return doc.getText(TEXT).toString();
  } catch {
    return '';
  }
}

function stateFromText(text) {
  const doc = new Y.Doc();
  if (text) doc.getText(TEXT).insert(0, text);
  return bytesTo(Y.encodeStateAsUpdate(doc));
}

function mergeTextStates(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytesFrom(a));
    Y.applyUpdate(doc, bytesFrom(b));
    return bytesTo(Y.encodeStateAsUpdate(doc));
  } catch {
    return a;
  }
}

function applyTextEdit(state, before, after) {
  if (before === after) return state && textOf(state) === before ? state : stateFromText(before);
  if (state && textOf(state) !== before) return applyTextEdit(stateFromText(before), before, after);
  const doc = new Y.Doc();
  if (state && textOf(state) === before) Y.applyUpdate(doc, bytesFrom(state));
  const text = doc.getText(TEXT);
  if (!state && before) text.insert(0, before);
  const start = sharedPrefix(before, after);
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  const remove = before.length - suffix - start;
  if (remove > 0) text.delete(start, remove);
  const insert = after.slice(start, after.length - suffix);
  if (insert) text.insert(start, insert);
  return bytesTo(Y.encodeStateAsUpdate(doc));
}

function sharedPrefix(a, b) {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}

function bytesFrom(state) {
  const binary = atob(state);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesTo(update) {
  let binary = '';
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function entityToChange(collection, entity) {
  const { id, clock, ...fields } = entity;
  return { collection, id, fields, clock };
}

// ---------------------------------------------------------------------------
// Реплика
// ---------------------------------------------------------------------------

class Replica {
  constructor(state) {
    this.state = state;
    this.clock = new Clock(state.replicaId, state.clock?.time ?? 0, state.clock?.counter ?? 0);
    /** Изменения этого запуска — их отправляем в комнату. */
    this.outbox = [];
  }

  static load() {
    if (!existsSync(STATE_FILE)) return null;
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    for (const c of COLLECTIONS) state.data[c] ??= {};
    return new Replica(state);
  }

  static create(projectId, name) {
    const data = Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
    const replica = new Replica({
      version: 1,
      replicaId: randomUUID().slice(0, 8),
      projectId,
      personId: null,
      name,
      pending: false,
      lastSync: null,
      clock: { time: 0, counter: 0 },
      data,
    });
    return replica;
  }

  save() {
    this.state.clock = { time: this.clock.lastTime, counter: this.clock.counter };
    const tmp = STATE_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    renameSync(tmp, STATE_FILE);
  }

  get projectId() {
    return this.state.projectId;
  }

  raw(collection, id) {
    return this.state.data[collection][id];
  }

  get(collection, id) {
    const entity = id ? this.state.data[collection][id] : undefined;
    return entity && !entity.deleted ? entity : undefined;
  }

  list(collection) {
    return Object.values(this.state.data[collection]).filter((e) => !e.deleted);
  }

  /** Применить изменения от других. Возвращает, сколько сущностей изменилось. */
  applyRemote(changes) {
    let applied = 0;
    for (const change of changes) {
      if (!COLLECTIONS.includes(change?.collection) || typeof change.id !== 'string') continue;
      for (const hlc of Object.values(change.clock ?? {})) this.clock.receive(hlc);
      const merged = mergeEntity(this.raw(change.collection, change.id), change);
      if (!merged) continue;
      this.state.data[change.collection][change.id] = merged;
      applied++;
    }
    return applied;
  }

  /** Все данные реплики как изменения — снимок, который отправляется при входе в комнату. */
  snapshot() {
    return COLLECTIONS.flatMap((c) =>
      Object.values(this.state.data[c]).map((e) => entityToChange(c, e)),
    );
  }

  commit(collection, id, fields) {
    const hlc = this.clock.tick();
    const clock = Object.fromEntries(Object.keys(fields).map((k) => [k, hlc]));
    const change = { collection, id, fields: structuredClone(fields), clock };
    this.state.data[collection][id] = mergeEntity(this.raw(collection, id), change);
    this.outbox.push(change);
  }

  create(collection, data) {
    const id = randomUUID();
    const now = Date.now();
    this.commit(collection, id, { ...data, createdAt: now, updatedAt: now, deleted: false });
    return this.get(collection, id);
  }

  update(collection, id, patch) {
    const current = this.get(collection, id);
    if (!current) return undefined;
    const fields = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) fields[key] = value;
    }
    if (!Object.keys(fields).length) return current;
    fields.updatedAt = Date.now();
    this.commit(collection, id, fields);
    return this.get(collection, id);
  }

  remove(collection, id) {
    if (!this.get(collection, id)) return;
    this.commit(collection, id, { deleted: true, updatedAt: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Предметная логика — как в IssueService / ProjectService
// ---------------------------------------------------------------------------

class Tracker {
  constructor(replica) {
    this.r = replica;
  }

  get project() {
    const project = this.r.get('projects', this.r.projectId);
    if (!project) {
      throw new UserError(
        'Проекта ещё нет в реплике: нужна хотя бы одна синхронизация с браузером (команда sync).',
      );
    }
    return project;
  }

  get me() {
    return this.r.get('people', this.r.state.personId);
  }

  /** Своя карточка участника: от её имени создаются задачи и комментарии. */
  ensureMe() {
    if (this.me) return this.me;
    const person = this.r.create('people', {
      name: this.r.state.name,
      email: '',
      color: 'violet',
    });
    this.r.state.personId = person.id;
    return person;
  }

  issues() {
    return this.r.list('issues').filter((i) => i.projectId === this.r.projectId);
  }

  key(issue) {
    return `${this.project.key}-${issue.number}`;
  }

  issue(key) {
    const match = /^(?:([A-Za-z][A-Za-z0-9]*)-)?(\d+)$/.exec(String(key).trim());
    if (!match) throw new UserError(`Не похоже на ключ задачи: ${key}`);
    if (match[1] && match[1].toUpperCase() !== this.project.key) {
      throw new UserError(`Задача ${key} не из проекта ${this.project.key}.`);
    }
    const number = Number(match[2]);
    const issue = this.issues().find((i) => i.number === number);
    if (!issue) throw new UserError(`Задачи ${this.project.key}-${number} нет.`);
    return issue;
  }

  status(issue) {
    return this.project.statuses.find((s) => s.id === issue.statusId);
  }

  /** Статус по id, названию (без учёта регистра) или категории: todo / in_progress / done. */
  findStatus(query) {
    const q = String(query).trim().toLowerCase();
    const statuses = this.project.statuses;
    const found =
      statuses.find((s) => s.id.toLowerCase() === q) ??
      statuses.find((s) => s.name.toLowerCase() === q) ??
      statuses.find((s) => s.category === q.replace(/[\s-]/g, '_')) ??
      statuses.find((s) => s.name.toLowerCase().includes(q));
    if (!found) {
      throw new UserError(
        `Статус «${query}» не найден. Есть: ${statuses.map((s) => s.name).join(', ')}.`,
      );
    }
    return found;
  }

  /** `me` — я сам, `none` — никто, иначе имя или его часть, или email. */
  findPerson(query) {
    const q = String(query).trim().toLowerCase();
    if (['none', 'null', '-', ''].includes(q)) return null;
    if (q === 'me') return this.ensureMe();
    const people = this.r.list('people');
    const found =
      people.find((p) => p.id === query) ??
      people.find((p) => p.name.toLowerCase() === q || p.email.toLowerCase() === q) ??
      people.filter((p) => p.name.toLowerCase().includes(q));
    if (Array.isArray(found)) {
      if (found.length === 1) return found[0];
      const names = (found.length ? found : people).map((p) => p.name).join(', ');
      throw new UserError(
        `${found.length ? 'Неоднозначно' : 'Не найден'}: «${query}». Люди: ${names}.`,
      );
    }
    return found;
  }

  sprints() {
    return this.r.list('sprints').filter((s) => s.projectId === this.r.projectId);
  }

  /** `active` — текущий спринт, `none`/`backlog` — бэклог, иначе название. */
  findSprint(query) {
    const q = String(query).trim().toLowerCase();
    if (['none', 'backlog', 'null', '-'].includes(q)) return null;
    const sprints = this.sprints();
    const found =
      q === 'active'
        ? sprints.find((s) => s.state === 'active')
        : (sprints.find((s) => s.id === query || s.name.toLowerCase() === q) ??
          sprints.find((s) => s.name.toLowerCase().includes(q)));
    if (!found) {
      throw new UserError(
        `Спринт «${query}» не найден. Есть: ${sprints.map((s) => `${s.name} (${s.state})`).join(', ') || 'нет'}.`,
      );
    }
    return found;
  }

  nextIssueNumber() {
    const project = this.project;
    let max = project.issueCounter;
    for (const issue of Object.values(this.r.state.data.issues)) {
      if (issue.projectId === project.id && issue.number > max) max = issue.number;
    }
    this.r.update('projects', project.id, { issueCounter: max + 1 });
    return max + 1;
  }

  /** Позиция в конце колонки статуса. */
  bottomOf(statusId, except) {
    const orders = this.issues()
      .filter((i) => i.statusId === statusId && i.id !== except)
      .map((i) => i.order);
    return orders.length ? Math.max(...orders) + ORDER_STEP : ORDER_STEP;
  }

  create(input) {
    const me = this.ensureMe();
    const project = this.project;
    const type = input.type ?? 'task';
    const parent = input.parentId ? this.r.get('issues', input.parentId) : null;
    if (type === 'subtask' && !parent) throw new UserError('Подзадаче нужен --parent.');
    const allOrders = this.issues().map((i) => i.order);
    const issue = this.r.create('issues', {
      projectId: project.id,
      number: this.nextIssueNumber(),
      type,
      title: input.title,
      description: input.description ?? '',
      descriptionState: stateFromText(input.description ?? ''),
      statusId: input.statusId ?? project.statuses[0].id,
      priority: input.priority ?? 'medium',
      assigneeId: input.assigneeId ?? null,
      reporterId: me.id,
      labels: input.labels ?? [],
      storyPoints: input.storyPoints ?? null,
      dueDate: input.dueDate ?? null,
      parentId: parent?.id ?? null,
      sprintId: type === 'subtask' ? (parent?.sprintId ?? null) : (input.sprintId ?? null),
      order: allOrders.length ? Math.max(...allOrders) + ORDER_STEP : ORDER_STEP,
    });
    this.log(issue.id, 'created', null, null, null);
    return issue;
  }

  update(issue, patch) {
    if (patch.description !== undefined) {
      patch.descriptionState = applyTextEdit(
        issue.descriptionState,
        issue.description ?? '',
        patch.description,
      );
    }
    if (patch.statusId !== undefined && patch.statusId !== issue.statusId) {
      patch.order ??= this.bottomOf(patch.statusId, issue.id);
    }
    const after = this.r.update('issues', issue.id, patch);
    for (const field of TRACKED_FIELDS) {
      if (JSON.stringify(issue[field]) === JSON.stringify(after[field])) continue;
      const describe = field === 'description' ? () => null : (v) => this.describe(field, v);
      this.log(issue.id, 'changed', field, describe(issue[field]), describe(after[field]));
    }
    if (issue.sprintId !== after.sprintId) {
      for (const child of this.issues()) {
        if (child.parentId === issue.id && child.type === 'subtask') {
          this.r.update('issues', child.id, { sprintId: after.sprintId });
        }
      }
    }
    return after;
  }

  remove(issue) {
    for (const child of this.issues().filter((i) => i.parentId === issue.id)) {
      if (child.type === 'subtask') this.remove(child);
      else this.r.update('issues', child.id, { parentId: null });
    }
    for (const comment of this.r.list('comments')) {
      if (comment.issueId === issue.id) this.r.remove('comments', comment.id);
    }
    this.r.remove('issues', issue.id);
  }

  comment(issue, body) {
    const comment = this.r.create('comments', {
      issueId: issue.id,
      authorId: this.ensureMe().id,
      body,
    });
    this.log(issue.id, 'commented', null, null, null);
    return comment;
  }

  chat(text) {
    return this.r.create('messages', {
      projectId: this.project.id,
      authorId: this.ensureMe().id,
      text,
    });
  }

  log(issueId, kind, field, from, to) {
    this.r.create('activity', { issueId, actorId: this.ensureMe().id, kind, field, from, to });
  }

  describe(field, value) {
    if (value === null || value === undefined || value === '') return null;
    switch (field) {
      case 'statusId':
        return this.project.statuses.find((s) => s.id === value)?.name ?? String(value);
      case 'assigneeId':
      case 'reporterId':
        return this.r.get('people', value)?.name ?? '—';
      case 'sprintId':
        return this.r.get('sprints', value)?.name ?? '—';
      case 'parentId': {
        const parent = this.r.get('issues', value);
        return parent ? this.key(parent) : '—';
      }
      case 'labels':
        return value.join(', ') || null;
      default:
        return String(value).slice(0, 1000);
    }
  }
}

// ---------------------------------------------------------------------------
// Сеть
// ---------------------------------------------------------------------------

class OfflineError extends Error {}

async function loadPeer() {
  const polyfill = await import('node-datachannel/polyfill');
  for (const [name, value] of Object.entries(polyfill)) {
    if (name.startsWith('RTC')) globalThis[name] = value;
  }
  globalThis.window ??= globalThis;
  const mod = await import('peerjs');
  return mod.Peer ?? mod.default?.Peer ?? mod.default;
}

function timeout(ms, error) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(error), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

const SECRET_FIELDS = {
  projects: ['name', 'description', 'statuses'],
  issues: ['title', 'description', 'descriptionState', 'labels'],
  sprints: ['name', 'goal'],
  people: ['name', 'email'],
  comments: ['body'],
  activity: ['from', 'to'],
  messages: ['text'],
};

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function sealChange(change, key) {
  const fields = { ...change.fields };
  for (const name of SECRET_FIELDS[change.collection] ?? []) {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
    const value = fields[name];
    if (typeof value !== 'string' && !Array.isArray(value) && (typeof value !== 'object' || value === null)) {
      continue;
    }
    fields[name] = await encryptValue(value, key);
  }
  return { ...change, fields };
}

async function openChange(change, key) {
  const fields = { ...change.fields };
  for (const name of SECRET_FIELDS[change.collection] ?? []) {
    const value = fields[name];
    if (typeof value !== 'string' || !value.startsWith('enc:v1:')) continue;
    fields[name] = await decryptValue(value, key);
  }
  return { ...change, fields };
}

async function encryptValue(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `enc:v1:${bytesTo(iv)}:${bytesTo(new Uint8Array(cipher))}`;
}

async function decryptValue(payload, key) {
  const body = payload.slice('enc:v1:'.length);
  const sep = body.indexOf(':');
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFrom(body.slice(0, sep)) },
    key,
    bytesFrom(body.slice(sep + 1)),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

function plainHash(change) {
  return createHash('sha256').update(JSON.stringify(change)).digest('hex');
}

async function requestJson(url, token, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new UserError(json.error || `Сервер ответил ${response.status}`);
  return json;
}

/** Обменять журнал с командным сервером. Тот же контракт, что у комнаты: send и close. */
async function joinServer(replica, log) {
  const base = String(replica.state.serverUrl || '').replace(/\/$/, '');
  const token = replica.state.serverToken;
  const passphrase = replica.state.passphrase;
  if (!base || !token || !passphrase) {
    throw new UserError('Для сервера нужны адрес, токен и парольная фраза. Укажите их в setup.');
  }
  const meta = await requestJson(`${base}/v1/meta`, token, 'GET');
  const key = await deriveKey(passphrase, Uint8Array.from(Buffer.from(meta.salt, 'base64')));
  const me = await requestJson(`${base}/v1/me`, token, 'GET');
  const remote = await requestJson(`${base}/v1/projects/${replica.projectId}`, token, 'GET');
  const opened = [];
  for (const change of remote.changes ?? []) opened.push(await openChange(change, key));
  const applied = replica.applyRemote(opened);
  log(`сервер «${me.name}» (${me.role}), применено изменений: ${applied}`);
  return {
    async send(changes) {
      if (me.role === 'viewer') {
        if (changes.length) {
          replica.state.pending = true;
          console.error('⚠ Токен только для чтения: правки на сервер не ушли.');
        }
        return;
      }
      // Снимок, а не только правки этого запуска: так доезжает то, что не ушло в прошлый раз.
      // Сервер узнаёт повтор по хешу и не раздувает журнал.
      const payload = [];
      for (const change of replica.snapshot()) {
        payload.push({ plainHash: plainHash(change), change: await sealChange(change, key) });
      }
      if (!payload.length) return;
      replica.state.pending = true;
      await requestJson(`${base}/v1/projects/${replica.projectId}`, token, 'POST', { changes: payload });
      replica.state.pending = false;
    },
    async close() {},
  };
}

/**
 * Войти в комнату гостем, обменяться снимками с хостом.
 * Возвращает сессию: `send(changes)` и `close()`.
 */
async function joinRoom(replica, log) {
  const Peer = await loadPeer();
  const roomId = ROOM_PREFIX + replica.projectId;
  const peer = new Peer({
    host: P2P.host,
    port: P2P.port,
    path: P2P.path,
    secure: P2P.secure,
    debug: 0,
    config: { iceServers: P2P.iceServers },
  });

  let fail;
  const failed = new Promise((_, reject) => (fail = reject));
  failed.catch(() => {});
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      fail(new OfflineError('В комнате проекта никого нет (браузер с трекером не в сети).'));
    } else {
      fail(new OfflineError(`Сеть: ${err.type ?? ''} ${err.message}`));
    }
  });

  const close = () => {
    try {
      peer.destroy();
    } catch {
      // всё равно выходим
    }
  };

  try {
    const signaling = timeout(SIGNALING_TIMEOUT_MS, new OfflineError('Signaling-сервер не отвечает.'));
    await Promise.race([new Promise((resolve) => peer.on('open', resolve)), failed, signaling.promise]);
    signaling.cancel();
    log('signaling: ok');

    const conn = peer.connect(roomId, {
      reliable: true,
      metadata: {
        app: APP_ID,
        v: PROTOCOL_VERSION,
        room: roomId,
        name: replica.state.name,
        person: replica.state.personId,
      },
    });

    let onWelcome;
    let onSnapshot;
    const welcomed = new Promise((resolve, reject) => (onWelcome = { resolve, reject }));
    const snapshot = new Promise((resolve) => (onSnapshot = resolve));
    let received = 0;

    conn.on('data', (message) => {
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'welcome':
          onWelcome.resolve(message);
          break;
        case 'room-full':
          onWelcome.reject(new UserError('Комната переполнена.'));
          break;
        case 'version-mismatch':
          onWelcome.reject(new UserError('Версия протокола не совпадает с приложением.'));
          break;
        case 'sync':
          if (Array.isArray(message.changes)) received += replica.applyRemote(message.changes);
          if (message.initial) onSnapshot();
          break;
      }
    });
    conn.on('close', () => fail(new OfflineError('Хост закрыл соединение.')));

    const waitWelcome = timeout(WELCOME_TIMEOUT_MS, new OfflineError('Хост не ответил.'));
    const welcome = await Promise.race([welcomed, failed, waitWelcome.promise]);
    waitWelcome.cancel();
    log(`в комнате: хост «${welcome.host?.name || '?'}», ещё участников: ${welcome.members?.length ?? 0}`);

    // Как CollaborationService.sendSnapshot: при входе отправляем всё, что у нас есть, —
    // так доходят и правки, сделанные без связи.
    conn.send({ type: 'sync', changes: replica.snapshot(), initial: true });

    const waitSnapshot = timeout(SNAPSHOT_TIMEOUT_MS, new OfflineError('Не дождались снимка проекта.'));
    await Promise.race([snapshot, failed, waitSnapshot.promise]);
    waitSnapshot.cancel();
    log(`получено изменений: ${received}`);

    return {
      send(changes) {
        if (changes.length) conn.send({ type: 'sync', changes, initial: false });
      },
      async close() {
        // Дождаться, пока данные уйдут из буфера канала.
        const deadline = Date.now() + 10_000;
        while (
          Date.now() < deadline &&
          ((conn.bufferSize ?? 0) > 0 || (conn.dataChannel?.bufferedAmount ?? 0) > 0)
        ) {
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 700));
        close();
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Вывод
// ---------------------------------------------------------------------------

const PRIORITY_MARK = { highest: '⇈', high: '↑', medium: '=', low: '↓', lowest: '⇊' };

function issueLine(t, issue) {
  const assignee = t.r.get('people', issue.assigneeId);
  const sprint = t.r.get('sprints', issue.sprintId);
  const parts = [
    t.key(issue).padEnd(8),
    `${PRIORITY_MARK[issue.priority] ?? ' '} ${issue.type.padEnd(7)}`,
    issue.title,
  ];
  const tail = [];
  if (assignee) tail.push(`@${assignee.name}`);
  if (sprint) tail.push(`[${sprint.name}]`);
  if (issue.storyPoints !== null) tail.push(`${issue.storyPoints}sp`);
  if (issue.labels.length) tail.push(issue.labels.map((l) => `#${l}`).join(' '));
  if (issue.dueDate) tail.push(`до ${issue.dueDate}`);
  return `  ${parts.join(' ')}${tail.length ? '  — ' + tail.join(' ') : ''}`;
}

function issueJson(t, issue) {
  const parent = t.r.get('issues', issue.parentId);
  return {
    key: t.key(issue),
    type: issue.type,
    title: issue.title,
    status: t.status(issue)?.name ?? issue.statusId,
    statusCategory: t.status(issue)?.category ?? null,
    priority: issue.priority,
    assignee: t.r.get('people', issue.assigneeId)?.name ?? null,
    reporter: t.r.get('people', issue.reporterId)?.name ?? null,
    labels: issue.labels,
    storyPoints: issue.storyPoints,
    dueDate: issue.dueDate,
    parent: parent ? t.key(parent) : null,
    sprint: t.r.get('sprints', issue.sprintId)?.name ?? null,
    updatedAt: new Date(issue.updatedAt).toISOString(),
  };
}

const byOrder = (a, b) => a.order - b.order || a.createdAt - b.createdAt;

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------

const HELP = `Трекер из терминала (участник P2P-комнаты проекта).

  setup <ссылка-приглашение|tt-...> [--name Claude]
       [--server URL --token TOKEN --passphrase ФРАЗА]   привязаться к проекту
       Без --server команды ходят в P2P-комнату. С --server — на командный сервер.
  sync                                         синхронизироваться с браузером
  info                                         проект, статусы, спринты, люди
  list [--all] [--status S] [--assignee A] [--type T] [--sprint S] [--label L] [--json]
  show <KEY> [--json]                          задача целиком: описание, подзадачи, комментарии
  create --title "..." [поля]                  создать задачу
  update <KEY> [--title "..."] [поля]          изменить задачу
  move <KEY> <статус>                          сменить статус (название, id или todo/in_progress/done)
  comment <KEY> "текст" | --file F             добавить комментарий (Markdown)
  delete <KEY>                                 удалить задачу
  chat "текст"                                 написать в чат проекта

Поля: --type epic|story|task|bug|subtask  --priority highest|high|medium|low|lowest
      --status S  --assignee me|none|<имя>  --labels a,b  --add-label L  --remove-label L
      --points N|none  --due YYYY-MM-DD|none  --parent KEY|none  --sprint active|backlog|<имя>
      --desc "Markdown" | --desc-file F
Общие: --offline (без сети, только реплика)  --verbose`;

const OPTIONS = {
  name: { type: 'string' },
  server: { type: 'string' },
  token: { type: 'string' },
  passphrase: { type: 'string' },
  all: { type: 'boolean' },
  json: { type: 'boolean' },
  offline: { type: 'boolean' },
  verbose: { type: 'boolean' },
  title: { type: 'string' },
  type: { type: 'string' },
  priority: { type: 'string' },
  status: { type: 'string' },
  assignee: { type: 'string' },
  labels: { type: 'string' },
  'add-label': { type: 'string', multiple: true },
  'remove-label': { type: 'string', multiple: true },
  label: { type: 'string' },
  points: { type: 'string' },
  due: { type: 'string' },
  parent: { type: 'string' },
  sprint: { type: 'string' },
  desc: { type: 'string' },
  'desc-file': { type: 'string' },
  file: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const MUTATING = new Set(['create', 'update', 'move', 'comment', 'delete', 'chat']);

function cleanLabels(labels) {
  const result = [...new Set(labels.map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean))];
  if (result.length > 50 || result.some((l) => l.length > 50)) {
    throw new UserError('Меток не больше 50, каждая не длиннее 50 символов.');
  }
  return result;
}

function text(value, max, what) {
  const result = String(value).trim();
  if (result.length > max) throw new UserError(`${what}: не длиннее ${max} символов.`);
  return result;
}

/** Поля задачи из опций командной строки. */
function issuePatch(t, values, current) {
  const patch = {};
  if (values.title !== undefined) {
    patch.title = text(values.title, 500, 'Название');
    if (!patch.title) throw new UserError('Название не может быть пустым.');
  }
  if (values.type !== undefined) {
    if (!TYPES.includes(values.type)) throw new UserError(`Тип: ${TYPES.join(', ')}.`);
    patch.type = values.type;
  }
  if (values.priority !== undefined) {
    if (!PRIORITIES.includes(values.priority)) {
      throw new UserError(`Приоритет: ${PRIORITIES.join(', ')}.`);
    }
    patch.priority = values.priority;
  }
  if (values.status !== undefined) patch.statusId = t.findStatus(values.status).id;
  if (values.assignee !== undefined) patch.assigneeId = t.findPerson(values.assignee)?.id ?? null;
  if (values.sprint !== undefined) patch.sprintId = t.findSprint(values.sprint)?.id ?? null;
  if (values.parent !== undefined) {
    patch.parentId = ['none', '-'].includes(values.parent) ? null : t.issue(values.parent).id;
  }
  if (values.points !== undefined) {
    const points = values.points === 'none' ? null : Number(values.points);
    if (points !== null && !(Number.isFinite(points) && points >= 0)) {
      throw new UserError('Оценка — неотрицательное число или none.');
    }
    patch.storyPoints = points;
  }
  if (values.due !== undefined) {
    if (values.due !== 'none' && !/^\d{4}-\d{2}-\d{2}$/.test(values.due)) {
      throw new UserError('Срок в формате YYYY-MM-DD или none.');
    }
    patch.dueDate = values.due === 'none' ? null : values.due;
  }
  if (values.desc !== undefined) patch.description = text(values.desc, 100_000, 'Описание');
  if (values['desc-file'] !== undefined) {
    patch.description = text(readFileSync(values['desc-file'], 'utf8'), 100_000, 'Описание');
  }
  let labels = values.labels !== undefined ? values.labels.split(',') : current?.labels;
  if (values['add-label'] || values['remove-label']) {
    const remove = new Set((values['remove-label'] ?? []).map((l) => l.trim()));
    labels = [...(labels ?? []), ...(values['add-label'] ?? [])].filter((l) => !remove.has(l));
  }
  if (labels !== undefined && (values.labels !== undefined || values['add-label'] || values['remove-label'])) {
    patch.labels = cleanLabels(labels);
  }
  return patch;
}

function runCommand(command, args, values, t, print) {
  switch (command) {
    case 'sync':
      return;

    case 'info': {
      const project = t.project;
      print(`${project.name} (${project.key}), задач: ${t.issues().length}`);
      print(`Статусы: ${project.statuses.map((s) => `${s.name} [${s.category}]`).join(' → ')}`);
      const sprints = t.sprints().filter((s) => s.state !== 'closed');
      print(`Спринты: ${sprints.map((s) => `${s.name} (${s.state})`).join(', ') || 'нет'}`);
      print(`Люди: ${t.r.list('people').map((p) => p.name).join(', ')}`);
      print(`Я: ${t.me?.name ?? t.r.state.name}`);
      return;
    }

    case 'list': {
      let issues = t.issues();
      if (values.status) {
        const status = t.findStatus(values.status);
        issues = issues.filter((i) => i.statusId === status.id);
      } else if (!values.all) {
        issues = issues.filter((i) => t.status(i)?.category !== 'done');
      }
      if (values.assignee) {
        const person = t.findPerson(values.assignee);
        issues = issues.filter((i) => i.assigneeId === (person?.id ?? null));
      }
      if (values.type) issues = issues.filter((i) => i.type === values.type);
      if (values.label) issues = issues.filter((i) => i.labels.includes(values.label));
      if (values.sprint) {
        const sprint = t.findSprint(values.sprint);
        issues = issues.filter((i) => i.sprintId === (sprint?.id ?? null));
      }
      if (values.json) {
        print(JSON.stringify(issues.sort(byOrder).map((i) => issueJson(t, i)), null, 2));
        return;
      }
      for (const status of t.project.statuses) {
        const column = issues.filter((i) => i.statusId === status.id).sort(byOrder);
        if (!column.length) continue;
        print(`${status.name} (${column.length})`);
        for (const issue of column) print(issueLine(t, issue));
      }
      if (!issues.length) print('Задач нет.');
      if (!values.all && !values.status) {
        const done = t.issues().filter((i) => t.status(i)?.category === 'done').length;
        if (done) print(`(завершённых скрыто: ${done}; --all чтобы показать)`);
      }
      return;
    }

    case 'show': {
      const issue = t.issue(args[0]);
      const comments = t.r
        .list('comments')
        .filter((c) => c.issueId === issue.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      const children = t.issues().filter((i) => i.parentId === issue.id).sort(byOrder);
      if (values.json) {
        print(
          JSON.stringify(
            {
              ...issueJson(t, issue),
              description: issue.description,
              children: children.map((c) => issueJson(t, c)),
              comments: comments.map((c) => ({
                author: t.r.get('people', c.authorId)?.name ?? null,
                at: new Date(c.createdAt).toISOString(),
                body: c.body,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }
      const j = issueJson(t, issue);
      print(`${j.key} [${j.type}] ${j.title}`);
      print(`Статус: ${j.status} · Приоритет: ${j.priority} · Исполнитель: ${j.assignee ?? '—'} · Автор: ${j.reporter ?? '—'}`);
      const extra = [
        j.sprint && `Спринт: ${j.sprint}`,
        j.parent && `Родитель: ${j.parent}`,
        j.storyPoints !== null && `Оценка: ${j.storyPoints}`,
        j.dueDate && `Срок: ${j.dueDate}`,
        j.labels.length && `Метки: ${j.labels.join(', ')}`,
      ].filter(Boolean);
      if (extra.length) print(extra.join(' · '));
      if (issue.description) print(`\n${issue.description}`);
      if (children.length) {
        print(`\nВложенные (${children.length}):`);
        for (const child of children) print(`${issueLine(t, child)}  {${t.status(child)?.name}}`);
      }
      for (const c of comments) {
        const author = t.r.get('people', c.authorId)?.name ?? '?';
        print(`\n— ${author}, ${new Date(c.createdAt).toLocaleString('ru-RU')}:\n${c.body}`);
      }
      return;
    }

    case 'create': {
      if (!values.title) throw new UserError('Нужно --title.');
      const patch = issuePatch(t, values);
      const issue = t.create({
        title: patch.title,
        type: patch.type,
        description: patch.description,
        statusId: patch.statusId,
        priority: patch.priority,
        assigneeId: patch.assigneeId,
        labels: patch.labels,
        storyPoints: patch.storyPoints,
        dueDate: patch.dueDate,
        parentId: patch.parentId,
        sprintId: patch.sprintId,
      });
      print(`Создана ${t.key(issue)}: ${issue.title} {${t.status(issue)?.name}}`);
      return;
    }

    case 'update': {
      const issue = t.issue(args[0]);
      const patch = issuePatch(t, values, issue);
      if (!Object.keys(patch).length) throw new UserError('Нечего менять: укажите поля.');
      const after = t.update(issue, patch);
      print(`Обновлена ${t.key(after)}: ${after.title} {${t.status(after)?.name}}`);
      return;
    }

    case 'move': {
      const issue = t.issue(args[0]);
      if (!args[1]) throw new UserError('Укажите статус: move <KEY> <статус>.');
      const status = t.findStatus(args.slice(1).join(' '));
      const after = t.update(issue, { statusId: status.id });
      print(`${t.key(after)} → ${status.name}`);
      return;
    }

    case 'comment': {
      const issue = t.issue(args[0]);
      const body = text(
        values.file !== undefined ? readFileSync(values.file, 'utf8') : args.slice(1).join(' '),
        50_000,
        'Комментарий',
      );
      if (!body) throw new UserError('Пустой комментарий.');
      t.comment(issue, body);
      print(`Комментарий добавлен к ${t.key(issue)}.`);
      return;
    }

    case 'delete': {
      const issue = t.issue(args[0]);
      t.remove(issue);
      print(`Удалена ${t.key(issue)}: ${issue.title}`);
      return;
    }

    case 'chat': {
      const message = text(args.join(' '), 4000, 'Сообщение');
      if (!message) throw new UserError('Пустое сообщение.');
      t.chat(message);
      print('Отправлено в чат проекта.');
      return;
    }

    default:
      throw new UserError(`Неизвестная команда «${command}». См. help.`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  const [command = 'help', ...args] = positionals;
  const print = (line) => console.log(line);
  const log = (line) => values.verbose && console.error(`· ${line}`);

  if (command === 'help' || values.help) {
    print(HELP);
    return;
  }

  let replica;
  if (command === 'setup') {
    const match = /tt-([A-Za-z0-9_-]{1,64})/.exec(args[0] ?? '');
    if (!match) throw new UserError('Нужна ссылка-приглашение проекта (…/join/tt-…).');
    const existing = Replica.load();
    if (existing && existing.projectId === match[1]) {
      replica = existing;
      if (values.name) replica.state.name = values.name;
    } else {
      replica = Replica.create(match[1], values.name ?? 'Claude');
    }
    if (values.server) replica.state.serverUrl = values.server.replace(/\/$/, '');
    if (values.token) replica.state.serverToken = values.token;
    if (values.passphrase) replica.state.passphrase = values.passphrase;
  } else {
    replica = Replica.load();
    if (!replica) throw new UserError('Сначала: setup <ссылка-приглашение проекта>.');
  }
  const t = new Tracker(replica);

  // Карточку участника заводим до входа в комнату, чтобы хост сразу знал, кто пришёл.
  if (command === 'setup' || MUTATING.has(command)) t.ensureMe();

  let session = null;
  if (!values.offline) {
    try {
      session = replica.state.serverUrl ? await joinServer(replica, log) : await joinRoom(replica, log);
      replica.state.lastSync = new Date().toISOString();
      replica.state.pending = false;
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;
      if (command === 'setup' || command === 'sync') {
        replica.save();
        throw new UserError(
          `${error.message}\nОткройте трекер в браузере и включите совместную работу над проектом.`,
        );
      }
      console.error(`⚠ ${error.message} Работаю с локальной репликой${replica.state.lastSync ? ` (синхронизирована ${replica.state.lastSync})` : ''}.`);
    }
  }

  try {
    if (command === 'setup') {
      print(`Привязан к проекту «${t.project.name}» (${t.project.key}) как «${t.me.name}».`);
    } else {
      runCommand(command, args, values, t, print);
    }
    if (session) {
      session.send(replica.outbox);
    } else if (replica.outbox.length) {
      replica.state.pending = true;
      console.error('⚠ Изменения сохранены локально и уйдут при следующей синхронизации (sync).');
    }
  } finally {
    replica.save();
    await session?.close();
  }

  if (command === 'sync') {
    print(`Синхронизировано: «${t.project.name}», задач: ${t.issues().length}.`);
  } else if (replica.state.pending && !session && !MUTATING.has(command)) {
    console.error('⚠ Есть неотправленные изменения — запустите sync, когда браузер будет в сети.');
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof UserError || error instanceof OfflineError ? error.message : error);
    process.exit(1);
  },
);
