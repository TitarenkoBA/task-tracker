import { EntityChange } from '../sync/merge';

/**
 * Сообщения, которыми обмениваются участники комнаты по каналам данных WebRTC.
 * Основано на протоколе видеочата из проекта p2p, но без медиа: здесь только данные.
 *
 * Всё, что прислал другой участник, — недоверенные данные, поэтому каждое сообщение
 * проверяется здесь, а изменения данных — дополнительно в scope.ts.
 */
export const PROTOCOL_VERSION = 1;
/** Ключ приложения в метаданных: чтобы к комнате трекера не подключился видеочат и наоборот. */
export const APP_ID = 'task-tracker';
/** Участников в комнате вместе с хостом. Каждый связан с каждым, поэтому число небольшое. */
export const MAX_PARTICIPANTS = 8;
export const MAX_NAME_LENGTH = 40;
/** Больше изменений за одно сообщение не принимаем (защита от заваливания данными). */
export const MAX_CHANGES_PER_MESSAGE = 50_000;
/** Префикс ID комнаты. Комната проекта — `tt-<id проекта>`. */
export const ROOM_PREFIX = 'tt-';

export interface MemberInfo {
  /** ID пира в сети. */
  id: string;
  name: string;
  /** ID участника (Person) в данных трекера — чтобы показывать аватар и назначать задачи. */
  person: string | null;
}

/** Метаданные соединения: известны ещё до открытия канала. */
export interface ConnectMetadata {
  app: typeof APP_ID;
  v: number;
  room: string;
  name: string;
  person: string | null;
}

export type RoomMessage =
  | { type: 'welcome'; host: MemberInfo; members: MemberInfo[] }
  | { type: 'peer-joined'; member: MemberInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'room-full' }
  | { type: 'version-mismatch' }
  /** Изменения данных. `initial` — снимок проекта при подключении. */
  | { type: 'sync'; changes: EntityChange[]; initial: boolean };

/** ID, которые принимает PeerJS. */
const ID_PATTERN = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPeerId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

export function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

/** ID комнаты проекта. UUID проекта невозможно угадать, поэтому ссылка-приглашение — это и есть доступ. */
export function roomIdFor(projectId: string): string {
  return ROOM_PREFIX + projectId;
}

/** Обратное преобразование: из ID комнаты — ID проекта, или `null`, если это не комната трекера. */
export function projectIdFromRoom(roomId: string): string | null {
  if (!isPeerId(roomId) || !roomId.startsWith(ROOM_PREFIX)) return null;
  const projectId = roomId.slice(ROOM_PREFIX.length);
  return isEntityId(projectId) ? projectId : null;
}

/** Убирает управляющие символы и обрезает имя. Пустая строка — «имя по умолчанию». */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

export function readMetadata(value: unknown): ConnectMetadata | null {
  if (
    !isRecord(value) ||
    value['app'] !== APP_ID ||
    typeof value['v'] !== 'number' ||
    !isPeerId(value['room'])
  ) {
    return null;
  }
  return {
    app: APP_ID,
    v: value['v'],
    room: value['room'],
    name: cleanName(value['name']),
    person: isEntityId(value['person']) ? value['person'] : null,
  };
}

function readMember(value: unknown): MemberInfo | null {
  if (!isRecord(value) || !isPeerId(value['id'])) return null;
  return {
    id: value['id'],
    name: cleanName(value['name']),
    person: isEntityId(value['person']) ? value['person'] : null,
  };
}

/**
 * Проверка формы изменения. Содержимое полей и принадлежность проекту
 * проверяет scope.ts — там нужен доступ к данным.
 */
function readChange(value: unknown): EntityChange | null {
  if (!isRecord(value) || typeof value['collection'] !== 'string' || !isEntityId(value['id'])) {
    return null;
  }
  const fields = value['fields'];
  const clock = value['clock'];
  if (!isRecord(fields) || !isRecord(clock)) return null;
  if (!Object.values(clock).every((v) => typeof v === 'string')) return null;
  return {
    collection: value['collection'] as EntityChange['collection'],
    id: value['id'],
    fields,
    clock: clock as Record<string, string>,
  };
}

/** Возвращает сообщение, если оно корректно, иначе `null`. */
export function parseMessage(data: unknown): RoomMessage | null {
  if (!isRecord(data)) return null;

  switch (data['type']) {
    case 'welcome': {
      const host = readMember(data['host']);
      const raw = data['members'];
      if (!host || !Array.isArray(raw) || raw.length >= MAX_PARTICIPANTS) return null;
      const members = raw.map(readMember);
      return members.every((m) => m !== null)
        ? { type: 'welcome', host, members: members as MemberInfo[] }
        : null;
    }
    case 'peer-joined': {
      const member = readMember(data['member']);
      return member ? { type: 'peer-joined', member } : null;
    }
    case 'peer-left':
      return isPeerId(data['id']) ? { type: 'peer-left', id: data['id'] } : null;
    case 'room-full':
    case 'version-mismatch':
      return { type: data['type'] };
    case 'sync': {
      const raw = data['changes'];
      if (!Array.isArray(raw) || raw.length > MAX_CHANGES_PER_MESSAGE) return null;
      // Битые изменения просто отбрасываем, остальные принимаем.
      const changes = raw.map(readChange).filter((c): c is EntityChange => c !== null);
      return { type: 'sync', changes, initial: data['initial'] === true };
    }
    default:
      return null;
  }
}
