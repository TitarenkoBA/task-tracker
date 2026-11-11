import { BaseEntity, COLLECTIONS, CollectionName, Snapshot, emptySnapshot } from '../models/entities';
import type { StorageAdapter } from './storage-adapter';

/** Хранилище в памяти. Используется в тестах; данные живут до перезагрузки. */
export class MemoryStorage implements StorageAdapter {
  private readonly data = new Map<CollectionName, Map<string, BaseEntity>>(
    COLLECTIONS.map((c) => [c, new Map()]),
  );
  private readonly meta = new Map<string, unknown>();

  constructor(initial?: Partial<Snapshot>) {
    for (const collection of COLLECTIONS) {
      for (const entity of initial?.[collection] ?? []) {
        this.data.get(collection)!.set(entity.id, structuredClone(entity));
      }
    }
  }

  async loadAll(): Promise<Snapshot> {
    const snapshot = emptySnapshot();
    for (const collection of COLLECTIONS) {
      (snapshot[collection] as BaseEntity[]) = [...this.data.get(collection)!.values()].map((e) =>
        structuredClone(e),
      );
    }
    return snapshot;
  }

  async putMany(collection: CollectionName, entities: BaseEntity[]): Promise<void> {
    for (const entity of entities) {
      this.data.get(collection)!.set(entity.id, structuredClone(entity));
    }
  }

  async clear(): Promise<void> {
    for (const map of this.data.values()) map.clear();
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    this.meta.set(key, value);
  }
}
