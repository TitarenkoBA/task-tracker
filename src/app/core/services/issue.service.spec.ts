import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { Project } from '../models/entities';
import { IssueService, normalizeLabels } from './issue.service';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';
import { SprintService } from './sprint.service';

describe('IssueService', () => {
  let issues: IssueService;
  let people: PeopleService;
  let project: Project;

  beforeEach(async () => {
    await setupTestStore();
    issues = TestBed.inject(IssueService);
    people = TestBed.inject(PeopleService);
    people.ensureMe();
    project = TestBed.inject(ProjectService).create({ name: 'Web', key: 'WEB', color: 'indigo' });
  });

  it('нумерует задачи внутри проекта и строит ключ', () => {
    const a = issues.create({ projectId: project.id, title: 'Первая' });
    const b = issues.create({ projectId: project.id, title: 'Вторая' });
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(issues.key(b)).toBe('WEB-2');
    expect(issues.byKey('web-2')?.id).toBe(b.id);
    expect(issues.byKey('WEB-99')).toBeUndefined();
    expect(issues.byKey('не ключ')).toBeUndefined();
  });

  it('заполняет значения по умолчанию и автора', () => {
    const issue = issues.create({ projectId: project.id, title: '  Задача  ' });
    expect(issue).toMatchObject({
      title: 'Задача',
      type: 'task',
      statusId: 'todo',
      priority: 'medium',
      assigneeId: null,
      reporterId: people.me()!.id,
    });
  });

  it('не создаёт задачу без названия и подзадачу без родителя', () => {
    expect(() => issues.create({ projectId: project.id, title: '   ' })).toThrow();
    expect(() => issues.create({ projectId: project.id, title: 'X', type: 'subtask' })).toThrow();
  });

  it('пишет историю создания и изменений с понятными значениями', () => {
    const issue = issues.create({ projectId: project.id, title: 'Задача' });
    issues.update(issue.id, { statusId: 'in_progress', priority: 'high' });
    const log = issues.activity().filter((a) => a.issueId === issue.id);
    expect(log.map((a) => a.kind)).toEqual(['created', 'changed', 'changed']);
    expect(log.find((a) => a.field === 'statusId')).toMatchObject({
      from: 'К выполнению',
      to: 'В работе',
    });
    expect(log.find((a) => a.field === 'priority')).toMatchObject({
      // Приоритет хранится кодом и переводится при показе (I18n.historyValue).
      from: 'medium',
      to: 'high',
    });
  });

  it('не пишет в историю, если ничего не изменилось', () => {
    const issue = issues.create({ projectId: project.id, title: 'Задача' });
    issues.update(issue.id, { title: 'Задача' });
    expect(issues.activity().filter((a) => a.kind === 'changed')).toHaveLength(0);
  });

  it('запрещает пустое название при изменении', () => {
    const issue = issues.create({ projectId: project.id, title: 'Задача' });
    expect(() => issues.update(issue.id, { title: ' ' })).toThrow();
  });

  it('isDone определяется категорией статуса', () => {
    const issue = issues.create({ projectId: project.id, title: 'Задача' });
    expect(issues.isDone(issue)).toBe(false);
    expect(issues.isDone(issues.update(issue.id, { statusId: 'done' })!)).toBe(true);
  });

  it('move ставит задачу между соседями и меняет статус', () => {
    const a = issues.create({ projectId: project.id, title: 'A' });
    const b = issues.create({ projectId: project.id, title: 'B' });
    const c = issues.create({ projectId: project.id, title: 'C', statusId: 'in_progress' });
    issues.move(c.id, { statusId: 'todo' }, [a, b], 1);
    const moved = issues.get(c.id)!;
    expect(moved.statusId).toBe('todo');
    expect(moved.order > a.order && moved.order < b.order).toBe(true);
  });

  it('подзадачи переходят в спринт вместе с родителем', () => {
    const sprint = TestBed.inject(SprintService).create(project.id);
    const parent = issues.create({ projectId: project.id, title: 'Родитель' });
    const child = issues.create({
      projectId: project.id,
      title: 'Подзадача',
      type: 'subtask',
      parentId: parent.id,
    });
    issues.update(parent.id, { sprintId: sprint.id });
    expect(issues.get(child.id)?.sprintId).toBe(sprint.id);
  });

  it('удаление задачи удаляет подзадачи и комментарии, а у задач эпика снимает связь', () => {
    const epic = issues.create({ projectId: project.id, title: 'Эпик', type: 'epic' });
    const story = issues.create({
      projectId: project.id,
      title: 'История',
      type: 'story',
      parentId: epic.id,
    });
    const sub = issues.create({
      projectId: project.id,
      title: 'Под',
      type: 'subtask',
      parentId: story.id,
    });
    issues.addComment(story.id, 'Комментарий');

    issues.remove(story.id);
    expect(issues.get(sub.id)).toBeUndefined();
    expect(issues.comments()).toHaveLength(0);

    const other = issues.create({ projectId: project.id, title: 'Другая', parentId: epic.id });
    issues.remove(epic.id);
    expect(issues.get(other.id)?.parentId).toBeNull();
  });

  it('комментарии: добавить, изменить, удалить; пустые игнорируются', () => {
    const issue = issues.create({ projectId: project.id, title: 'Задача' });
    expect(issues.addComment(issue.id, '   ')).toBeUndefined();
    const comment = issues.addComment(issue.id, ' Привет ')!;
    expect(comment.body).toBe('Привет');
    expect(comment.authorId).toBe(people.me()!.id);
    issues.updateComment(comment.id, 'Пока');
    expect(issues.comments()[0].body).toBe('Пока');
    issues.removeComment(comment.id);
    expect(issues.comments()).toHaveLength(0);
  });

  it('normalizeLabels убирает пробелы, дубли и пустые метки', () => {
    expect(normalizeLabels([' ui ', 'ui', '', 'front end'])).toEqual(['ui', 'front-end']);
  });
});
