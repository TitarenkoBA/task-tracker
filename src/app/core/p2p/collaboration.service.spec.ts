import { Device, createDevice } from '../../../testing/device';
import { MemoryHub, settle } from '../../../testing/memory-network';
import { setupTestStore } from '../../../testing/test-store';
import { Project } from '../models/entities';
import { roomIdFor } from './protocol';

/**
 * Совместная работа нескольких «устройств» через сеть в памяти.
 * Протокол комнаты, синхронизация и слияние — настоящие.
 */
describe('CollaborationService', () => {
  let hub: MemoryHub;
  let anna: Device;
  let boris: Device;
  let project: Project;
  const devices: Device[] = [];

  async function device(name: string): Promise<Device> {
    const d = await createDevice(hub, name);
    devices.push(d);
    return d;
  }

  beforeEach(async () => {
    await setupTestStore();
    hub = new MemoryHub();
    anna = await device('Анна');
    boris = await device('Борис');
    project = anna.projects.create({ name: 'Сайт', key: 'WEB', color: 'indigo' });
    anna.issues.create({ projectId: project.id, title: 'Вёрстка', assigneeId: anna.me.id });
    anna.chat.send(project.id, 'Всем привет');
  });

  afterEach(() => {
    devices.splice(0).forEach((d) => {
      d.collab.leave();
      d.destroy();
    });
  });

  async function connectBoth(): Promise<void> {
    expect(await anna.collab.start(project.id)).toBe(true);
    expect(await boris.collab.join(roomIdFor(project.id))).toBe(true);
    await settle();
  }

  it('первый участник становится хостом, второй — гостем', async () => {
    await connectBoth();
    expect(anna.collab.role()).toBe('host');
    expect(boris.collab.role()).toBe('guest');
    expect(anna.collab.status()).toBe('online');
    expect(anna.collab.participants().map((p) => p.name)).toEqual(['Борис']);
    expect(boris.collab.participants().map((p) => p.name)).toEqual(['Анна']);
  });

  it('приглашённый получает проект целиком: задачи, чат и людей', async () => {
    await connectBoth();
    expect(boris.projects.get(project.id)?.name).toBe('Сайт');
    expect(boris.issues.issues().map((i) => i.title)).toEqual(['Вёрстка']);
    expect(boris.chat.messages(project.id).map((m) => m.text)).toEqual(['Всем привет']);
    // Исполнитель задачи пришёл вместе с ней.
    expect(boris.people.get(anna.me.id)?.name).toBe('Анна');
    expect(boris.collab.synced()).toBe(true);
  });

  it('изменения расходятся в обе стороны в реальном времени', async () => {
    await connectBoth();
    const issue = boris.issues.issues()[0];
    boris.issues.update(issue.id, { statusId: 'in_progress' });
    anna.issues.create({ projectId: project.id, title: 'Тесты' });
    boris.chat.send(project.id, 'Взял в работу');
    await settle();

    expect(anna.issues.get(issue.id)?.statusId).toBe('in_progress');
    expect(
      boris.issues
        .issues()
        .map((i) => i.title)
        .sort(),
    ).toEqual(['Вёрстка', 'Тесты']);
    expect(anna.chat.messages(project.id).map((m) => m.text)).toEqual([
      'Всем привет',
      'Взял в работу',
    ]);
    // История изменений тоже общая.
    expect(
      anna.issues.activity().some((a) => a.field === 'statusId' && a.actorId === boris.me.id),
    ).toBe(true);
  });

  it('одновременные правки разных полей одной задачи не теряются', async () => {
    await connectBoth();
    const id = anna.issues.issues()[0].id;
    anna.issues.update(id, { title: 'Вёрстка главной' });
    boris.issues.update(id, { priority: 'high' });
    await settle();
    for (const d of [anna, boris]) {
      expect(d.issues.get(id)).toMatchObject({ title: 'Вёрстка главной', priority: 'high' });
    }
  });

  it('другие проекты на устройстве не отправляются и не могут быть изменены', async () => {
    const secret = anna.projects.create({ name: 'Личное', key: 'ME', color: 'rose' });
    anna.issues.create({ projectId: secret.id, title: 'Секрет' });
    await connectBoth();
    expect(boris.projects.get(secret.id)).toBeUndefined();
    expect(boris.issues.issues().some((i) => i.title === 'Секрет')).toBe(false);

    // Даже если Борис узнает id и пришлёт изменение — Анна его не примет.
    const secretIssue = anna.issues.issues().find((i) => i.title === 'Секрет')!;
    const room = (
      boris.collab as unknown as { room: () => { broadcast: (m: unknown) => void } }
    ).room();
    room.broadcast({
      type: 'sync',
      initial: false,
      changes: [
        {
          collection: 'issues',
          id: secretIssue.id,
          fields: { title: 'Взломано' },
          clock: { title: `${Date.now()}`.padStart(13, '0') + ':00000:evil' },
        },
        {
          collection: 'issues',
          id: anna.issues.issues()[0].id,
          fields: { projectId: secret.id },
          clock: { projectId: `${Date.now()}`.padStart(13, '0') + ':00000:evil' },
        },
      ],
    });
    await settle();
    expect(anna.issues.get(secretIssue.id)?.title).toBe('Секрет');
    expect(anna.issues.issues().find((i) => i.title === 'Вёрстка')?.projectId).toBe(project.id);
  });

  it('свои данные гостя сохраняются: при подключении всё сливается, а не заменяется', async () => {
    await connectBoth();
    boris.collab.leave();
    await settle();

    // Оба работают офлайн.
    const id = anna.issues.issues()[0].id;
    anna.issues.update(id, { title: 'Правка Анны' });
    boris.issues.create({ projectId: project.id, title: 'Задача Бориса офлайн' });
    boris.chat.send(project.id, 'Написано офлайн');
    const borisOwn = boris.projects.create({ name: 'Своё', key: 'OWN', color: 'teal' });

    expect(await boris.collab.start(project.id)).toBe(true);
    await settle();

    for (const d of [anna, boris]) {
      expect(d.issues.get(id)?.title).toBe('Правка Анны');
      expect(d.issues.issues().some((i) => i.title === 'Задача Бориса офлайн')).toBe(true);
      expect(d.chat.messages(project.id).map((m) => m.text)).toContain('Написано офлайн');
    }
    expect(boris.projects.get(borisOwn.id)).toBeDefined();
    expect(anna.projects.get(borisOwn.id)).toBeUndefined();
  });

  it('одинаковые номера задач, созданных одновременно, разрешаются одинаково у всех', async () => {
    await connectBoth();
    boris.collab.leave();
    await settle();
    anna.issues.create({ projectId: project.id, title: 'От Анны' });
    boris.issues.create({ projectId: project.id, title: 'От Бориса' });
    // Обе задачи получили номер 2.
    expect(anna.issues.issues().find((i) => i.title === 'От Анны')?.number).toBe(2);
    expect(boris.issues.issues().find((i) => i.title === 'От Бориса')?.number).toBe(2);

    await boris.collab.start(project.id);
    await settle(40);
    const numbers = (d: Device) =>
      Object.fromEntries(d.issues.issues().map((i) => [i.title, i.number]));
    expect(numbers(anna)).toEqual(numbers(boris));
    expect(new Set(Object.values(numbers(anna))).size).toBe(3);
  });

  it('третий участник получает изменения, а хост пересылает их дальше', async () => {
    await connectBoth();
    const vera = await device('Вера');
    expect(await vera.collab.join(roomIdFor(project.id))).toBe(true);
    await settle(40);
    expect(
      vera.collab
        .participants()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Анна', 'Борис']);

    vera.issues.create({ projectId: project.id, title: 'От Веры' });
    await settle(40);
    expect(boris.issues.issues().some((i) => i.title === 'От Веры')).toBe(true);
    expect(anna.issues.issues().some((i) => i.title === 'От Веры')).toBe(true);
  });

  it('если хост ушёл, кто-то из оставшихся становится хостом и работа продолжается', async () => {
    await connectBoth();
    const vera = await device('Вера');
    await vera.collab.join(roomIdFor(project.id));
    await settle(40);

    anna.collab.leave();
    // Переподключение идёт с задержкой (с разбросом, чтобы не толкаться).
    await vi.waitFor(
      () => {
        expect([boris.collab.role(), vera.collab.role()].sort()).toEqual(['guest', 'host']);
        expect(boris.collab.status()).toBe('online');
        expect(vera.collab.status()).toBe('online');
      },
      { timeout: 8000, interval: 50 },
    );
    await settle(40);
    boris.issues.create({ projectId: project.id, title: 'После смены хоста' });
    await settle(40);
    expect(vera.issues.issues().some((i) => i.title === 'После смены хоста')).toBe(true);
  }, 15_000);

  it('войти по приглашению нельзя, если никого нет в сети и проекта у нас нет', async () => {
    expect(await boris.collab.join(roomIdFor(project.id))).toBe(false);
    expect(boris.collab.error()).toBe('collab.error.noHost');
    expect(boris.collab.role()).toBeNull();
  });

  it('неверная ссылка-приглашение', async () => {
    expect(await boris.collab.join('not-a-room')).toBe(false);
    expect(boris.collab.error()).toBe('collab.error.badLink');
  });

  it('выход оставляет данные проекта на устройстве', async () => {
    await connectBoth();
    boris.collab.leave();
    expect(boris.collab.status()).toBe('idle');
    expect(boris.projects.get(project.id)).toBeDefined();
    expect(boris.issues.issues()).toHaveLength(1);
  });

  it('ссылка-приглашение ведёт на /join/tt-<id проекта>', () => {
    expect(anna.collab.inviteLink(project.id)).toMatch(new RegExp(`/join/tt-${project.id}$`));
  });
});
