import { TestBed } from '@angular/core/testing';
import { setupTestStore, TestStore } from '../../../testing/test-store';
import { ChatService, MAX_MESSAGE_LENGTH } from './chat.service';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';

describe('ChatService', () => {
  let ctx: TestStore;
  let chat: ChatService;
  let projectId: string;

  beforeEach(async () => {
    ctx = await setupTestStore();
    chat = TestBed.inject(ChatService);
    TestBed.inject(PeopleService).ensureMe();
    projectId = TestBed.inject(ProjectService).create({ name: 'Web', key: 'WEB', color: 'sky' }).id;
  });

  it('сообщения хранятся по проектам в порядке времени и переживают перезапуск', async () => {
    chat.send(projectId, ' Первое ');
    chat.send(projectId, 'Второе');
    expect(chat.messages(projectId).map((m) => m.text)).toEqual(['Первое', 'Второе']);
    await ctx.store.whenPersisted();
    expect((await ctx.storage.loadAll()).messages).toHaveLength(2);
  });

  it('пустые не отправляются, длинные обрезаются', () => {
    expect(chat.send(projectId, '   ')).toBeUndefined();
    expect(chat.send(projectId, 'x'.repeat(MAX_MESSAGE_LENGTH + 10))?.text).toHaveLength(
      MAX_MESSAGE_LENGTH,
    );
  });

  it('считает непрочитанные сообщения от других', () => {
    // Каждое сообщение — в свою миллисекунду, как в жизни.
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
    // Сообщение от другого участника (как будто пришло по сети).
    ctx.store.create('messages', { projectId, authorId: 'someone', text: 'Привет' });
    chat.send(projectId, 'Моё'); // своё не считается и отмечает чат прочитанным
    expect(chat.unread(projectId)).toBe(0);
    ctx.store.create('messages', { projectId, authorId: 'someone', text: 'Ещё' });
    expect(chat.unread(projectId)).toBe(1);
    chat.markRead(projectId);
    expect(chat.unread(projectId)).toBe(0);
    vi.restoreAllMocks();
  });

  it('удаление проекта удаляет его чат', () => {
    chat.send(projectId, 'Привет');
    TestBed.inject(ProjectService).remove(projectId);
    expect(chat.messages(projectId)).toEqual([]);
  });
});
