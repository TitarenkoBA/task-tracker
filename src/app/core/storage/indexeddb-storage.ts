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
 * Версия схемы. Увеличивайте её при изменении структуры хранилищ
 * и добавляйте миграцию в `upgrade` (см. docs/architecture.md).
 */
const DB_VERSION = 1;

/** Хранилище в IndexedDB браузера: по одному object store на коллекцию. */
export class IndexedDbStorage implements StorageAdapter {
  private dbPromise: Promise<IDBPDatabase<TrackerDb>> | null = null;

  constructor(private readonly name = DB_NAME) {}

  private db(): Promise<IDBPDatabase<TrackerDb>> {
    this.dbPromise ??= openDB<TrackerDb>(this.name, DB_VERSION, {
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
