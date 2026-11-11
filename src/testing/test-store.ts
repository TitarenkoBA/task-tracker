import { EnvironmentProviders, Provider, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataStore } from '../app/core/data/data-store';
import { I18n } from '../app/core/i18n/i18n.service';
import { Lang } from '../app/core/i18n/lang';
import { MemoryStorage } from '../app/core/storage/memory-storage';
import { STORAGE_ADAPTER } from '../app/core/storage/storage-adapter';

export interface TestStoreOptions {
  /** Компоненты для тестов компонентов. */
  imports?: Type<unknown>[];
  /** Дополнительные провайдеры (роутер, данные диалога и т.п.). */
  providers?: (Provider | EnvironmentProviders)[];
  /** Язык интерфейса в тесте. По умолчанию русский. */
  lang?: Lang;
}

/**
 * Настраивает TestBed с хранилищем в памяти вместо IndexedDB
 * и загружает DataStore. Использовать в beforeEach:
 *
 * ```ts
 * let ctx: TestStore;
 * beforeEach(async () => (ctx = await setupTestStore()));
 * ```
 */
export async function setupTestStore(options: TestStoreOptions = {}) {
  localStorage.clear();
  localStorage.setItem('task-tracker.settings', JSON.stringify({ language: options.lang ?? 'ru' }));
  const storage = new MemoryStorage();
  TestBed.configureTestingModule({
    imports: options.imports ?? [],
    providers: [{ provide: STORAGE_ADAPTER, useValue: storage }, ...(options.providers ?? [])],
  });
  // Язык — глобальный сигнал, поэтому выставляем его заново в каждом тесте.
  TestBed.inject(I18n);
  const store = TestBed.inject(DataStore);
  await store.init();
  return { store, storage };
}

export type TestStore = Awaited<ReturnType<typeof setupTestStore>>;
