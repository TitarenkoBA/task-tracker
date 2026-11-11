import { BaseEntity, CollectionName, EntityId, Hlc } from '../models/entities';

/**
 * Изменение одной сущности — минимальная единица, которой обмениваются
 * хранилище, импорт и (в будущем) P2P-транспорт.
 *
 * `fields` — новые значения полей, `clock` — HLC-метка для каждого из них.
 * Полная сущность — это тоже изменение (со всеми полями).
 */
export interface EntityChange {
  collection: CollectionName;
  id: EntityId;
  fields: Record<string, unknown>;
  clock: Record<string, Hlc>;
}

/**
 * Слияние по правилу «последняя запись побеждает» для каждого поля
 * (LWW-Element-Map, простейший CRDT).
 *
 * Свойства, важные для синхронизации:
 * - коммутативность: порядок применения изменений не важен;
 * - идемпотентность: повторное применение ничего не меняет;
 * - разные поля одной задачи, изменённые на разных устройствах, не конфликтуют.
 *
 * @returns новая сущность или `null`, если изменение ничего не поменяло.
 */
export function mergeEntity<T extends BaseEntity>(
  current: T | undefined,
  change: EntityChange,
): T | null {
  const base: Record<string, unknown> = current
    ? { ...(current as unknown as Record<string, unknown>), clock: { ...current.clock } }
    : { id: change.id, deleted: false, clock: {} };
  const clock = base['clock'] as Record<string, Hlc>;
  let changed = !current;

  for (const [field, value] of Object.entries(change.fields)) {
    if (field === 'id' || field === 'clock') continue;
    const incoming = change.clock[field];
    if (!incoming) continue;
    const existing = clock[field];
    // При равных метках (одно и то же изменение пришло повторно) ничего не делаем.
    if (existing === undefined || incoming > existing) {
      base[field] = value;
      clock[field] = incoming;
      changed = true;
    }
  }

  return changed ? (base as T) : null;
}

/** Представить сущность целиком как изменение (для импорта и отправки пирам). */
export function entityToChange(collection: CollectionName, entity: BaseEntity): EntityChange {
  const { id, clock, ...fields } = entity;
  return { collection, id, fields, clock };
}

/** Максимальная HLC-метка в сущности. */
export function maxClock(entity: BaseEntity): Hlc | null {
  let max: Hlc | null = null;
  for (const value of Object.values(entity.clock)) {
    if (max === null || value > max) max = value;
  }
  return max;
}
