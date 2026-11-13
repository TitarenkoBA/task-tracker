import { BaseEntity, CollectionName } from '../models/entities';
import { formatHlc } from '../sync/hlc';
import { EntityChange } from '../sync/merge';
import {
  cleanName,
  parseMessage,
  projectIdFromRoom,
  readMetadata,
  roomIdFor,
  MAX_PARTICIPANTS,
} from './protocol';
import {
  ScopeLookup,
  filterIncoming,
  filterOutgoing,
  projectSnapshot,
  validateChange,
} from './scope';

const NOW = Date.UTC(2026, 10, 13);
const t = (offset = 0) => formatHlc(NOW + offset, 0, 'peer');

function change(
  collection: CollectionName,
  id: string,
  fields: Record<string, unknown>,
  at = t(),
): EntityChange {
  return {
    collection,
    id,
    fields,
    clock: Object.fromEntries(Object.keys(fields).map((k) => [k, at])),
  };
}

/** Простые данные устройства: общий проект P, личный проект SECRET. */
function lookup(): ScopeLookup {
  const data: Record<string, BaseEntity[]> = {
    projects: [{ id: 'P' }, { id: 'SECRET' }] as BaseEntity[],
    issues: [
      { id: 'i1', projectId: 'P', assigneeId: 'anna' },
      { id: 'i2', projectId: 'SECRET', assigneeId: 'mom' },
      { id: 'gone', projectId: 'P', deleted: true },
    ] as unknown as BaseEntity[],
    sprints: [],
    people: [
      { id: 'anna', name: 'Анна' },
      { id: 'mom', name: 'Мама' },
    ] as unknown as BaseEntity[],
    comments: [{ id: 'c1', issueId: 'i1', authorId: 'anna' }] as unknown as BaseEntity[],
    activity: [],
    messages: [{ id: 'm1', projectId: 'P', authorId: 'anna' }] as unknown as BaseEntity[],
  };
  return {
    get: (c, id) => data[c].find((e) => e.id === id),
    all: (c) => data[c],
  };
}

describe('protocol', () => {
  it('ID комнаты строится из id проекта и обратно', () => {
    const id = '3f2a9c1e-1111-4222-8333-944455556666';
    expect(roomIdFor(id)).toBe(`tt-${id}`);
    expect(projectIdFromRoom(roomIdFor(id))).toBe(id);
    expect(projectIdFromRoom('room-1')).toBeNull();
    expect(projectIdFromRoom('tt-../../x')).toBeNull();
  });

  it('проверяет метаданные соединения', () => {
    expect(
      readMetadata({ app: 'task-tracker', v: 1, room: 'tt-abc', name: ' Анна\n', person: 'p1' }),
    ).toEqual({
      app: 'task-tracker',
      v: 1,
      room: 'tt-abc',
      name: 'Анна',
      person: 'p1',
    });
    // Видеочат p2p и мусор не пускаем.
    expect(readMetadata({ v: 2, room: 'abc' })).toBeNull();
    expect(readMetadata({ app: 'task-tracker', v: '1', room: 'tt-abc' })).toBeNull();
    expect(readMetadata({ app: 'task-tracker', v: 1, room: 'bad id!' })).toBeNull();
  });

  it('разбирает сообщения и отбрасывает некорректные', () => {
    expect(parseMessage('hello')).toBeNull();
    expect(parseMessage({ type: 'shutdown' })).toBeNull();
    expect(parseMessage({ type: 'peer-left', id: '' })).toBeNull();
    const members = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => ({
      id: `p${i}`,
      name: 'x',
    }));
    expect(parseMessage({ type: 'welcome', host: { id: 'h', name: 'H' }, members })).toBeNull();
    expect(
      parseMessage({ type: 'welcome', host: { id: 'h', name: 'H', person: 'u1' }, members: [] }),
    ).toEqual({
      type: 'welcome',
      host: { id: 'h', name: 'H', person: 'u1' },
      members: [],
    });
  });

  it('из сообщения sync выбрасывает битые изменения, а остальные оставляет', () => {
    const good = change('issues', 'i1', { title: 'ok' });
    const message = parseMessage({ type: 'sync', initial: true, changes: [good, { id: 'x' }, 42] });
    expect(message).toEqual({ type: 'sync', initial: true, changes: [good] });
  });

  it('чистит имена', () => {
    expect(cleanName('  Анна\u0000 ')).toBe('Анна');
    expect(cleanName(5)).toBe('');
  });
});

describe('validateChange', () => {
  it('принимает корректное изменение', () => {
    const c = change('issues', 'i1', { title: 'Новое', priority: 'high', labels: ['ui'] });
    expect(validateChange(c, NOW)).toEqual(c);
  });

  it('отклоняет неизвестные поля, неверные типы и значения', () => {
    expect(validateChange(change('issues', 'i1', { evil: 1 }), NOW)).toBeNull();
    expect(validateChange(change('issues', 'i1', { title: { x: 1 } }), NOW)).toBeNull();
    expect(validateChange(change('issues', 'i1', { title: '   ' }), NOW)).toBeNull();
    expect(validateChange(change('issues', 'i1', { priority: 'urgent' }), NOW)).toBeNull();
    expect(validateChange(change('issues', 'i1', { title: 'x'.repeat(501) }), NOW)).toBeNull();
    expect(validateChange(change('people', 'p', { color: 'black' }), NOW)).toBeNull();
    expect(validateChange(change('nope' as CollectionName, 'x', { a: 1 }), NOW)).toBeNull();
  });

  it('отклоняет метки времени из далёкого будущего', () => {
    const future = change('issues', 'i1', { title: 'Навсегда моё' }, t(7 * 86_400_000));
    expect(validateChange(future, NOW)).toBeNull();
    expect(validateChange(change('issues', 'i1', { title: 'ok' }, t(60_000)), NOW)).not.toBeNull();
  });

  it('поле без метки времени — изменение отклоняется', () => {
    expect(
      validateChange({ collection: 'issues', id: 'i1', fields: { title: 'x' }, clock: {} }, NOW),
    ).toBeNull();
  });
});

describe('filterIncoming', () => {
  it('принимает изменения общего проекта, включая новые задачи с комментариями в том же пакете', () => {
    const accepted = filterIncoming(
      [
        change('comments', 'c2', { issueId: 'new', body: 'Привет' }),
        change('issues', 'new', { projectId: 'P', title: 'Новая' }),
        change('issues', 'i1', { title: 'Правка' }),
        change('messages', 'm2', { projectId: 'P', text: 'Чат' }),
      ],
      lookup(),
      'P',
      [],
      NOW,
    );
    expect(accepted.map((c) => c.id).sort()).toEqual(['c2', 'i1', 'm2', 'new']);
  });

  it('не даёт трогать личные проекты и уводить записи в чужой проект', () => {
    const accepted = filterIncoming(
      [
        change('projects', 'SECRET', { name: 'Взлом' }),
        change('issues', 'i2', { title: 'Взлом' }),
        change('issues', 'i1', { projectId: 'SECRET' }),
        change('issues', 'x', { projectId: 'SECRET', title: 'Подброшено' }),
        change('comments', 'c9', { issueId: 'i2', body: 'Взлом' }),
        change('messages', 'm9', { projectId: 'SECRET', text: 'Взлом' }),
      ],
      lookup(),
      'P',
      [],
      NOW,
    );
    expect(accepted).toEqual([]);
  });

  it('людей принимает только своих для проекта или новых', () => {
    const accepted = filterIncoming(
      [
        change('people', 'anna', { name: 'Анна С.' }), // упомянута в проекте
        change('people', 'newbie', { name: 'Новичок' }), // ещё нет у нас
        change('people', 'mom', { name: 'Взлом' }), // контакт из личного проекта
      ],
      lookup(),
      'P',
      [],
      NOW,
    );
    expect(accepted.map((c) => c.id).sort()).toEqual(['anna', 'newbie']);
  });

  it('удаление (надгробие) в общем проекте тоже принимается', () => {
    const accepted = filterIncoming(
      [change('issues', 'i1', { deleted: true })],
      lookup(),
      'P',
      [],
      NOW,
    );
    expect(accepted).toHaveLength(1);
  });
});

describe('projectSnapshot и filterOutgoing', () => {
  it('снимок проекта содержит только его данные, включая удалённые, и упомянутых людей', () => {
    const ids = projectSnapshot(lookup(), 'P').map(
      ({ collection, entity }) => `${collection}:${entity.id}`,
    );
    expect(ids.sort()).toEqual(
      [
        'comments:c1',
        'issues:gone',
        'issues:i1',
        'messages:m1',
        'people:anna',
        'projects:P',
      ].sort(),
    );
  });

  it('локальные изменения уходят, только если относятся к проекту; упомянутые люди прикладываются', () => {
    const out = filterOutgoing(
      [
        change('issues', 'i1', { assigneeId: 'anna' }),
        change('issues', 'i2', { title: 'Личное' }),
        change('people', 'mom', { name: 'Мама' }),
      ],
      lookup(),
      'P',
    );
    expect(out.map((c) => `${c.collection}:${c.id}`)).toEqual(['issues:i1', 'people:anna']);
  });
});
