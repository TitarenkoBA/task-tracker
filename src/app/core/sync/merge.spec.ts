import { Person } from '../models/entities';
import { formatHlc } from './hlc';
import { EntityChange, entityToChange, maxClock, mergeEntity } from './merge';

const t = (time: number, replica = 'a') => formatHlc(time, 0, replica);

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    name: 'Анна',
    email: '',
    color: 'indigo',
    createdAt: 1,
    updatedAt: 1,
    deleted: false,
    clock: {
      name: t(1),
      email: t(1),
      color: t(1),
      createdAt: t(1),
      updatedAt: t(1),
      deleted: t(1),
    },
    ...overrides,
  };
}

function change(fields: Record<string, unknown>, time: number, replica = 'a'): EntityChange {
  return {
    collection: 'people',
    id: 'p1',
    fields,
    clock: Object.fromEntries(Object.keys(fields).map((k) => [k, t(time, replica)])),
  };
}

describe('mergeEntity (LWW по полям)', () => {
  it('создаёт сущность, если её ещё нет', () => {
    const merged = mergeEntity<Person>(undefined, entityToChange('people', person()));
    expect(merged).toEqual(person());
  });

  it('применяет более позднее изменение поля', () => {
    const merged = mergeEntity(person(), change({ name: 'Анна С.' }, 5));
    expect(merged?.name).toBe('Анна С.');
    expect(merged?.clock['name']).toBe(t(5));
  });

  it('игнорирует более раннее изменение и возвращает null', () => {
    const current = person({ name: 'Новое', clock: { ...person().clock, name: t(10) } });
    expect(mergeEntity(current, change({ name: 'Старое' }, 5))).toBeNull();
  });

  it('идемпотентно: повторное применение ничего не меняет', () => {
    const once = mergeEntity(person(), change({ name: 'X' }, 5))!;
    expect(mergeEntity(once, change({ name: 'X' }, 5))).toBeNull();
  });

  it('коммутативно: порядок изменений не влияет на результат', () => {
    const a = change({ name: 'С устройства A' }, 5, 'a');
    const b = change({ name: 'С устройства B', color: 'rose' }, 6, 'b');
    const ab = mergeEntity(mergeEntity(person(), a)!, b)!;
    const ba = mergeEntity(mergeEntity(person(), b)!, a) ?? mergeEntity(person(), b)!;
    expect(ab).toEqual(ba);
  });

  it('разные поля с разных устройств не конфликтуют', () => {
    const merged = mergeEntity(
      mergeEntity(person(), change({ name: 'Новое имя' }, 5, 'a'))!,
      change({ email: 'anna@example.com' }, 6, 'b'),
    )!;
    expect(merged.name).toBe('Новое имя');
    expect(merged.email).toBe('anna@example.com');
  });

  it('удаление (tombstone) — обычное поле и тоже сливается по времени', () => {
    const deleted = mergeEntity(person(), change({ deleted: true }, 5))!;
    expect(deleted.deleted).toBe(true);
    // Более старая правка имени не «воскрешает» запись.
    expect(mergeEntity(deleted, change({ deleted: false }, 3))).toBeNull();
  });

  it('не меняет исходный объект', () => {
    const original = person();
    const snapshot = structuredClone(original);
    mergeEntity(original, change({ name: 'X' }, 5));
    expect(original).toEqual(snapshot);
  });

  it('пропускает поля без метки времени и служебные id/clock', () => {
    const merged = mergeEntity(person(), {
      collection: 'people',
      id: 'p1',
      fields: { name: 'X', id: 'другой', email: 'no-clock' },
      clock: { name: t(5), id: t(5) },
    })!;
    expect(merged.id).toBe('p1');
    expect(merged.email).toBe('');
  });

  it('maxClock возвращает самую позднюю метку', () => {
    const p = person({ clock: { ...person().clock, email: t(42) } });
    expect(maxClock(p)).toBe(t(42));
  });
});
