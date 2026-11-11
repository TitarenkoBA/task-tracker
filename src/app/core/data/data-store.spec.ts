import { TestBed } from '@angular/core/testing';
import { setupTestStore, TestStore } from '../../../testing/test-store';
import { emptySnapshot } from '../models/entities';
import { STORAGE_ADAPTER } from '../storage/storage-adapter';
import { DataStore } from './data-store';

describe('DataStore', () => {
  let ctx: TestStore;
  beforeEach(async () => (ctx = await setupTestStore()));

  it('создаёт сущность со служебными полями', () => {
    const person = ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    expect(person.id).toMatch(/[0-9a-f-]{36}/);
    expect(person.deleted).toBe(false);
    expect(Object.keys(person.clock)).toEqual(
      expect.arrayContaining(['name', 'email', 'color', 'createdAt', 'updatedAt', 'deleted']),
    );
    expect(ctx.store.list('people')()).toHaveLength(1);
  });

  it('update меняет только изменившиеся поля', () => {
    const person = ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    const clockBefore = { ...person.clock };
    const updated = ctx.store.update('people', person.id, { name: 'Анна', email: 'a@b.c' })!;
    expect(updated.email).toBe('a@b.c');
    expect(updated.clock['name']).toBe(clockBefore['name']);
    expect(updated.clock['email'] > clockBefore['email']).toBe(true);
  });

  it('update без изменений не трогает запись', () => {
    const person = ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    expect(ctx.store.update('people', person.id, { name: 'Анна' })).toBe(person);
  });

  it('remove делает мягкое удаление', () => {
    const person = ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    ctx.store.remove('people', person.id);
    expect(ctx.store.list('people')()).toHaveLength(0);
    expect(ctx.store.get('people', person.id)).toBeUndefined();
    expect(ctx.store.snapshot().people[0].deleted).toBe(true);
  });

  it('сохраняет данные в хранилище и загружает их заново', async () => {
    ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    await ctx.store.whenPersisted();
    const fresh = await ctx.storage.loadAll();
    expect(fresh.people.map((p) => p.name)).toEqual(['Анна']);
  });

  it('id устройства сохраняется между запусками', async () => {
    const replicaId = ctx.store.replicaId;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_ADAPTER, useValue: ctx.storage }],
    });
    const again = TestBed.inject(DataStore);
    await again.init();
    expect(again.replicaId).toBe(replicaId);
  });

  it('уведомляет подписчиков с указанием источника изменения', () => {
    const origins: string[] = [];
    ctx.store.onChange((_, origin) => origins.push(origin));
    const person = ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    ctx.store.applyChanges(
      [
        {
          collection: 'people',
          id: person.id,
          fields: { name: 'Remote' },
          clock: { name: '9999999999999:00000:zz' },
        },
      ],
      'remote',
    );
    expect(origins).toEqual(['local', 'remote']);
    expect(ctx.store.get('people', person.id)?.name).toBe('Remote');
  });

  it('после удалённого изменения локальные метки становятся позже', () => {
    const person = ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    const remote = '9999999999999:00000:zz';
    ctx.store.applyChanges(
      [{ collection: 'people', id: person.id, fields: { name: 'R' }, clock: { name: remote } }],
      'remote',
    );
    const updated = ctx.store.update('people', person.id, { name: 'Локально' })!;
    expect(updated.name).toBe('Локально');
    expect(updated.clock['name'] > remote).toBe(true);
  });

  it('replaceAll заменяет все данные', async () => {
    ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    await ctx.store.replaceAll(emptySnapshot());
    expect(ctx.store.list('people')()).toHaveLength(0);
    expect((await ctx.storage.loadAll()).people).toHaveLength(0);
  });

  it('при ошибке записи выставляет persistError', async () => {
    ctx.storage.putMany = () => Promise.reject(new Error('QuotaExceededError'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    await ctx.store.whenPersisted();
    expect(ctx.store.persistError()).toBeInstanceOf(Error);
    spy.mockRestore();
  });
});
