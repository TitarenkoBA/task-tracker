// Ставит глобальные классы IndexedDB (IDBRequest, IDBCursor, …), которых нет в jsdom.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { COLLECTIONS } from '../models/entities';
import { DB_OUTDATED_EVENT, DB_VERSION, IndexedDbStorage } from './indexeddb-storage';

/**
 * Обновление приложения не должно терять данные пользователей.
 * Здесь настоящая логика IndexedDB (fake-indexeddb реализует спецификацию в памяти).
 */

/** Как выглядела база в первой версии приложения. */
const V1_STORES = ['projects', 'issues', 'sprints', 'people', 'comments', 'activity'];

const entity = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: 1,
  updatedAt: 1,
  deleted: false,
  clock: { title: '0000000000001:00000:old' },
  ...extra,
});

async function createV1Database(name: string): Promise<void> {
  const db = await openDB(name, 1, {
    upgrade(db) {
      for (const store of V1_STORES) db.createObjectStore(store, { keyPath: 'id' });
      db.createObjectStore('meta');
    },
  });
  await db.put('projects', entity('p1', { key: 'WEB', name: 'Сайт' }));
  await db.put('issues', entity('i1', { projectId: 'p1', title: 'Старая задача' }));
  await db.put('issues', entity('i2', { projectId: 'p1', title: 'Удалённая', deleted: true }));
  await db.put('people', entity('u1', { name: 'Анна' }));
  await db.put('comments', entity('c1', { issueId: 'i1', body: 'Комментарий' }));
  await db.put('activity', entity('a1', { issueId: 'i1', kind: 'created' }));
  await db.put('meta', 'replica-old', 'replicaId');
  db.close();
}

describe('IndexedDbStorage: обновление схемы', () => {
  beforeEach(() => {
    // Чистая «браузерная» база для каждого теста.
    globalThis.indexedDB = new IDBFactory();
  });

  it('текущая версия схемы — 2', () => {
    expect(DB_VERSION).toBe(2);
  });

  it('при обновлении с версии 1 все старые данные сохраняются', async () => {
    await createV1Database('upgrade-test');
    const storage = new IndexedDbStorage('upgrade-test');

    const data = await storage.loadAll();
    expect(data.projects.map((p) => p.id)).toEqual(['p1']);
    expect(data.issues.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
    // Надгробия тоже сохраняются — они нужны для синхронизации.
    expect(data.issues.find((i) => i.id === 'i2')?.deleted).toBe(true);
    expect(data.people).toHaveLength(1);
    expect(data.comments).toHaveLength(1);
    expect(data.activity).toHaveLength(1);
    expect(data.messages).toEqual([]);
    expect(await storage.getMeta('replicaId')).toBe('replica-old');
  });

  it('после обновления схема содержит все коллекции, а запись в новую работает', async () => {
    await createV1Database('upgrade-write');
    const storage = new IndexedDbStorage('upgrade-write');
    await storage.putMany('messages', [entity('m1', { projectId: 'p1', text: 'Привет' })]);

    const db = await openDB('upgrade-write');
    expect(db.version).toBe(DB_VERSION);
    for (const store of [...COLLECTIONS, 'meta']) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
    db.close();
    expect((await storage.loadAll()).messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('повторное открытие обновлённой базы ничего не меняет', async () => {
    await createV1Database('reopen');
    await new IndexedDbStorage('reopen').loadAll();
    const again = await new IndexedDbStorage('reopen').loadAll();
    expect(again.issues).toHaveLength(2);
  });

  it('новая установка создаёт пустую базу', async () => {
    const data = await new IndexedDbStorage('fresh').loadAll();
    for (const collection of COLLECTIONS) expect(data[collection]).toEqual([]);
  });

  it('старая вкладка уступает базу новой версии и получает сигнал перезагрузиться', async () => {
    const old = new IndexedDbStorage('tabs');
    await old.loadAll();
    const outdated = vi.fn();
    globalThis.addEventListener(DB_OUTDATED_EVENT, outdated);

    // Новая версия приложения в другой вкладке открывает базу с большей версией.
    const newer = await openDB('tabs', DB_VERSION + 1);
    expect(newer.version).toBe(DB_VERSION + 1);
    expect(outdated).toHaveBeenCalled();
    newer.close();
    globalThis.removeEventListener(DB_OUTDATED_EVENT, outdated);
  });
});
