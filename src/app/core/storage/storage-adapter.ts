import { InjectionToken } from '@angular/core';
import { BaseEntity, CollectionName, Snapshot } from '../models/entities';
import { IndexedDbStorage } from './indexeddb-storage';

/**
 * Абстракция постоянного хранилища.
 *
 * DataStore работает только через этот интерфейс, поэтому хранилище можно
 * заменить (IndexedDB в браузере, память в тестах, что-то ещё в будущем),
 * не трогая остальной код.
 */
export interface StorageAdapter {
  /** Загрузить все сущности всех коллекций (включая удалённые). */
  loadAll(): Promise<Snapshot>;
  /** Записать (вставить или заменить) сущности. */
  putMany(collection: CollectionName, entities: BaseEntity[]): Promise<void>;
  /** Полностью очистить данные (сущности, но не служебные значения). */
  clear(): Promise<void>;
  /** Служебные значения устройства (например, id реплики). */
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta<T>(key: string, value: T): Promise<void>;
}

export const STORAGE_ADAPTER = new InjectionToken<StorageAdapter>('STORAGE_ADAPTER', {
  providedIn: 'root',
  factory: () => new IndexedDbStorage(),
});
