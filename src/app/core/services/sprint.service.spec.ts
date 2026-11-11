import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { Project } from '../models/entities';
import { IssueService } from './issue.service';
import { ProjectService } from './project.service';
import { SprintService } from './sprint.service';

describe('SprintService', () => {
  let sprints: SprintService;
  let issues: IssueService;
  let project: Project;
  const dates = { startDate: '2026-11-01', endDate: '2026-11-14' };

  beforeEach(async () => {
    await setupTestStore();
    sprints = TestBed.inject(SprintService);
    issues = TestBed.inject(IssueService);
    project = TestBed.inject(ProjectService).create({ name: 'Web', key: 'WEB', color: 'indigo' });
  });

  it('создаёт спринты с понятными именами по порядку', () => {
    expect(sprints.create(project.id).name).toBe('WEB Спринт 1');
    expect(sprints.create(project.id).name).toBe('WEB Спринт 2');
    expect(sprints.create(project.id, 'Релиз').name).toBe('Релиз');
  });

  it('в проекте может быть только один активный спринт', () => {
    const a = sprints.create(project.id);
    const b = sprints.create(project.id);
    sprints.start(a.id, dates);
    expect(sprints.active(project.id)?.id).toBe(a.id);
    expect(() => sprints.start(b.id, dates)).toThrow('уже есть активный');
  });

  it('проверяет даты при старте', () => {
    const a = sprints.create(project.id);
    expect(() => sprints.start(a.id, { startDate: '2026-11-10', endDate: '2026-11-01' })).toThrow();
  });

  it('при завершении переносит только незавершённые задачи', () => {
    const sprint = sprints.create(project.id);
    const next = sprints.create(project.id);
    const open = issues.create({ projectId: project.id, title: 'Открытая', sprintId: sprint.id });
    const done = issues.create({
      projectId: project.id,
      title: 'Готовая',
      sprintId: sprint.id,
      statusId: 'done',
    });
    sprints.start(sprint.id, dates);

    expect(sprints.complete(sprint.id, next.id)).toBe(1);
    expect(issues.get(open.id)?.sprintId).toBe(next.id);
    expect(issues.get(done.id)?.sprintId).toBe(sprint.id);
    expect(sprints.get(sprint.id)?.state).toBe('closed');
    expect(sprints.active(project.id)).toBeUndefined();
  });

  it('forProject сортирует: активный, запланированные, закрытые', () => {
    const closed = sprints.create(project.id);
    sprints.start(closed.id, dates);
    sprints.complete(closed.id, null);
    const planned = sprints.create(project.id);
    const active = sprints.create(project.id);
    sprints.start(active.id, dates);
    expect(sprints.forProject(project.id).map((s) => s.id)).toEqual([
      active.id,
      planned.id,
      closed.id,
    ]);
  });

  it('удаление спринта возвращает задачи в бэклог', () => {
    const sprint = sprints.create(project.id);
    const issue = issues.create({ projectId: project.id, title: 'Задача', sprintId: sprint.id });
    sprints.remove(sprint.id);
    expect(issues.get(issue.id)?.sprintId).toBeNull();
    expect(sprints.sprints()).toHaveLength(0);
  });
});
