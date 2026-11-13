import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import {
  BaseEntity,
  COLLECTIONS,
  CollectionMap,
  CollectionName,
  EntityId,
  EntityPatch,
  NewEntity,
  Snapshot,
  emptySnapshot,
} from '../models/entities';
import { HybridLogicalClock } from '../sync/hlc';
import { EntityChange, maxClock, mergeEntity } from '../sync/merge';
import { STORAGE_ADAPTER } from '../storage/storage-adapter';

/** Откуда пришло изменение. От этого зависит, рассылать ли его пирам. */
export type ChangeOrigin = 'local' | 'remote' | 'import';

type CollectionSignals = {
  [C in CollectionName]: WritableSignal<ReadonlyMap<EntityId, CollectionMap[C]>>;
};
type ListSignals = { [C in CollectionName]: Signal<CollectionMap[C][]> };

const REPLICA_KEY = 'replicaId';

/**
 * Центральное хранилище данных.
 *
 * - Держит все сущности в памяти в виде сигналов (данных немного,
 *   а UI так обновляется мгновенно и реактивно).
 * - Любое изменение проходит через {@link applyChanges}: слияние (LWW),
 *   обновление сигналов, запись в IndexedDB, уведомление подписчиков.
 * - Ничего не знает о бизнес-логике: это делают доменные сервисы
 *   (`ProjectService`, `IssueService` и т.д.).
 */
@Injectable({ providedIn: 'root' })
export class DataStore {
  private readonly storage = inject(STORAGE_ADAPTER);

  private readonly maps = Object.fromEntries(
    COLLECTIONS.map((c) => [c, signal(new Map())]),
  ) as unknown as CollectionSignals;

  /** Списки «живых» (не удалённых) сущностей по коллекциям. */
  private readonly lists = Object.fromEntries(
    COLLECTIONS.map((c) => [
      c,
      computed(() => [...this.maps[c]().values()].filter((e) => !e.deleted)),
    ]),
  ) as unknown as ListSignals;

  private clock = new HybridLogicalClock('pending');
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(changes: EntityChange[], origin: ChangeOrigin) => void>();

  /** `true`, когда данные загружены из хранилища. */
  readonly ready = signal(false);
  /** Последняя ошибка записи в хранилище (например, закончилось место). */
  readonly persistError = signal<unknown>(null);

  /** Загрузить данные из хранилища. Вызывается один раз при старте приложения. */
  async init(): Promise<void> {
    let replicaId = await this.storage.getMeta<string>(REPLICA_KEY);
    if (!replicaId) {
      replicaId = crypto.randomUUID().slice(0, 8);
      await this.storage.setMeta(REPLICA_KEY, replicaId);
    }
    this.clock = new HybridLogicalClock(replicaId);
    this.load(await this.storage.loadAll());
    this.ready.set(true);
  }

  /** Id этого устройства. Попадает в HLC-метки. */
  get replicaId(): string {
    return this.clock.replicaId;
  }

  // ---------------------------------------------------------------------------
  // Чтение
  // ---------------------------------------------------------------------------

  /** Реактивный список живых сущностей коллекции. */
  list<C extends CollectionName>(collection: C): Signal<CollectionMap[C][]> {
    return this.lists[collection];
  }

  /** Живая сущность по id (без реактивности — читает текущее значение сигнала). */
  get<C extends CollectionName>(
    collection: C,
    id: EntityId | null | undefined,
  ): CollectionMap[C] | undefined {
    if (!id) return undefined;
    const entity = this.maps[collection]().get(id);
    return entity && !entity.deleted ? entity : undefined;
  }

  /**
   * Доступ к данным вместе с удалёнными записями — для синхронизации, где
   * надгробия тоже нужно передавать. Для интерфейса используйте {@link get} и {@link list}.
   */
  readonly raw = {
    get: (collection: CollectionName, id: EntityId): BaseEntity | undefined =>
      this.maps[collection]().get(id) as BaseEntity | undefined,
    all: (collection: CollectionName): Iterable<BaseEntity> =>
      this.maps[collection]().values() as Iterable<BaseEntity>,
  };

  /** Полный снимок данных, включая удалённые записи. Используется для экспорта. */
  snapshot(): Snapshot {
    const snapshot = emptySnapshot();
    for (const c of COLLECTIONS) {
      (snapshot[c] as BaseEntity[]) = structuredClone([...this.maps[c]().values()]);
    }
    return snapshot;
  }

  // ---------------------------------------------------------------------------
  // Запись
  // ---------------------------------------------------------------------------

  /** Создать сущность. Id и служебные поля проставляются автоматически. */
  create<C extends CollectionName>(
    collection: C,
    data: NewEntity<CollectionMap[C]>,
  ): CollectionMap[C] {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.commit(collection, id, { ...data, createdAt: now, updatedAt: now, deleted: false });
    return this.get(collection, id)!;
  }

  /**
   * Изменить поля сущности. В изменение попадают только реально изменившиеся
   * поля — так меньше конфликтов при синхронизации.
   * @returns обновлённая сущность или `undefined`, если её нет.
   */
  update<C extends CollectionName>(
    collection: C,
    id: EntityId,
    patch: EntityPatch<CollectionMap[C]>,
  ): CollectionMap[C] | undefined {
    const current = this.get(collection, id);
    if (!current) return undefined;
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!isEqual((current as unknown as Record<string, unknown>)[key], value)) {
        fields[key] = value;
      }
    }
    if (!Object.keys(fields).length) return current;
    fields['updatedAt'] = Date.now();
    this.commit(collection, id, fields);
    return this.get(collection, id);
  }

  /** Мягко удалить сущность (см. {@link BaseEntity.deleted}). */
  remove(collection: CollectionName, id: EntityId): void {
    if (!this.get(collection, id)) return;
    this.commit(collection, id, { deleted: true, updatedAt: Date.now() });
  }

  /**
   * Применить набор изменений: слить с текущими данными, обновить UI,
   * сохранить. Это единая точка входа для локальных правок, импорта
   * и будущих изменений от пиров.
   * @returns количество сущностей, которые реально изменились.
   */
  applyChanges(changes: EntityChange[], origin: ChangeOrigin): number {
    const updated = new Map<CollectionName, BaseEntity[]>();
    const applied: EntityChange[] = [];

    for (const change of changes) {
      if (origin !== 'local') {
        for (const hlc of Object.values(change.clock)) this.clock.receive(hlc);
      }
      const map = this.maps[change.collection];
      const merged = mergeEntity(map().get(change.id) as BaseEntity | undefined, change);
      if (!merged) continue;
      const next = new Map(map() as ReadonlyMap<EntityId, BaseEntity>);
      next.set(change.id, merged);
      (map as WritableSignal<ReadonlyMap<EntityId, BaseEntity>>).set(next);
      updated.set(change.collection, [...(updated.get(change.collection) ?? []), merged]);
      applied.push(change);
    }

    for (const [collection, entities] of updated) this.persist(collection, entities);
    if (applied.length) {
      for (const listener of this.listeners) listener(applied, origin);
    }
    return applied.length;
  }

  /** Заменить все данные снимком (импорт в режиме «заменить»). */
  async replaceAll(snapshot: Snapshot): Promise<void> {
    for (const c of COLLECTIONS) {
      for (const entity of snapshot[c]) {
        const max = maxClock(entity);
        if (max) this.clock.receive(max);
      }
    }
    this.load(snapshot);
    this.enqueue(async () => {
      await this.storage.clear();
      for (const c of COLLECTIONS) await this.storage.putMany(c, snapshot[c]);
    });
    await this.whenPersisted();
  }

  /**
   * Подписка на применённые изменения. Через неё CollaborationService (core/p2p)
   * отправит локальные изменения пирам.
   */
  onChange(listener: (changes: EntityChange[], origin: ChangeOrigin) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Дождаться, пока все изменения запишутся в хранилище. */
  whenPersisted(): Promise<void> {
    return this.writeQueue;
  }

  // ---------------------------------------------------------------------------

  private commit(collection: CollectionName, id: EntityId, fields: Record<string, unknown>): void {
    const hlc = this.clock.tick();
    const clock = Object.fromEntries(Object.keys(fields).map((k) => [k, hlc]));
    this.applyChanges([{ collection, id, fields: structuredClone(fields), clock }], 'local');
  }

  private load(snapshot: Snapshot): void {
    for (const c of COLLECTIONS) {
      const map = new Map<EntityId, BaseEntity>(snapshot[c].map((e) => [e.id, e]));
      (this.maps[c] as WritableSignal<ReadonlyMap<EntityId, BaseEntity>>).set(map);
    }
  }

  private persist(collection: CollectionName, entities: BaseEntity[]): void {
    this.enqueue(() => this.storage.putMany(collection, entities));
  }

  /** Записи выполняются строго по очереди, чтобы порядок на диске совпадал с порядком в памяти. */
  private enqueue(task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue.then(task).catch((error: unknown) => {
      console.error('Не удалось сохранить данные', error);
      this.persistError.set(error);
    });
  }
}

/** Глубокое сравнение для простых JSON-значений (строки, числа, массивы, объекты). */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
