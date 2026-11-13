import { DBSchema, IDBPDatabase, openDB } from 'idb';
import {
  BaseEntity,
  COLLECTIONS,
  CollectionMap,
  CollectionName,
  Snapshot,
  emptySnapshot,
} from '../models/entities';
import type { StorageAdapter } from './storage-adapter';

type EntityStores = { [C in CollectionName]: { key: string; value: CollectionMap[C] } };

interface TrackerDb extends DBSchema, EntityStores {
  meta: { key: string; value: unknown };
}

const DB_NAME = 'task-tracker';
/**
 * Версия схемы. Увеличивайте её при изменении структуры хранилищ.
 *
 * ГЛАВНОЕ ПРАВИЛО: миграции только ДОБАВЛЯЮТ. Никогда не удаляйте и не очищайте
 * хранилища в `upgrade` — у пользователей там их единственная копия данных.
 *
 * История версий:
 * - 1 — projects, issues, sprints, people, comments, activity, meta;
 * - 2 — + messages (чат проекта).
 */
export const DB_VERSION = 2;

/** Событие на `window`: эту вкладку попросили закрыть базу, потому что открылась более новая версия. */
export const DB_OUTDATED_EVENT = 'task-tracker:db-outdated';

/** Хранилище в IndexedDB браузера: по одному object store на коллекцию. */
export class IndexedDbStorage implements StorageAdapter {
  private dbPromise: Promise<IDBPDatabase<TrackerDb>> | null = null;

  constructor(private readonly name = DB_NAME) {}

  private db(): Promise<IDBPDatabase<TrackerDb>> {
    this.dbPromise ??= openDB<TrackerDb>(this.name, DB_VERSION, {
      // Создаём только недостающие хранилища — существующие данные не трогаются,
      // с какой бы версии ни шло обновление.
      upgrade(db) {
        for (const collection of COLLECTIONS) {
          if (!db.objectStoreNames.contains(collection)) {
            db.createObjectStore(collection, { keyPath: 'id' });
          }
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
      // Другая вкладка открыла новую версию приложения и ждёт обновления схемы.
      // Освобождаем базу, иначе обновление зависнет, и просим эту вкладку перезагрузиться.
      blocking: () => {
        void this.dbPromise?.then((db) => db.close());
        this.dbPromise = null;
        globalThis.dispatchEvent?.(new Event(DB_OUTDATED_EVENT));
      },
    });
    return this.dbPromise;
  }

  async loadAll(): Promise<Snapshot> {
    const db = await this.db();
    const snapshot = emptySnapshot();
    const tx = db.transaction(COLLECTIONS as CollectionName[], 'readonly');
    for (const collection of COLLECTIONS) {
      (snapshot[collection] as BaseEntity[]) = await tx.objectStore(collection).getAll();
    }
    await tx.done;
    return snapshot;
  }

  async putMany(collection: CollectionName, entities: BaseEntity[]): Promise<void> {
    if (!entities.length) return;
    const db = await this.db();
    const tx = db.transaction(collection, 'readwrite');
    const store = tx.objectStore(collection);
    for (const entity of entities) {
      void store.put(entity as never);
    }
    await tx.done;
  }

  async clear(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(COLLECTIONS as CollectionName[], 'readwrite');
    await Promise.all(COLLECTIONS.map((c) => tx.objectStore(c).clear()));
    await tx.done;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.db();
    return (await db.get('meta', key)) as T | undefined;
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    const db = await this.db();
    await db.put('meta', value, key);
  }
}
