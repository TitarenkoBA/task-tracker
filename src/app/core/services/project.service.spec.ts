import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { IssueService } from './issue.service';
import { ProjectService } from './project.service';
import { SettingsService } from './settings.service';

describe('ProjectService', () => {
  let projects: ProjectService;
  let issues: IssueService;

  beforeEach(async () => {
    await setupTestStore();
    projects = TestBed.inject(ProjectService);
    issues = TestBed.inject(IssueService);
  });

  describe('suggestKey', () => {
    it('берёт первые буквы слов, транслитерируя кириллицу', () => {
      expect(projects.suggestKey('Мобильное приложение')).toBe('MP');
      expect(projects.suggestKey('Сайт компании')).toBe('SK');
    });

    it('для одного слова берёт до 4 букв', () => {
      expect(projects.suggestKey('Web')).toBe('WEB');
      expect(projects.suggestKey('Backend')).toBe('BACK');
    });

    it('добавляет число, если ключ занят', () => {
      projects.create({ name: 'Web', key: 'WEB', color: 'indigo' });
      expect(projects.suggestKey('Web')).toBe('WEB2');
    });
  });

  describe('validateKey', () => {
    it('принимает корректные ключи', () => {
      expect(projects.validateKey('AB')).toBeNull();
      expect(projects.validateKey('WEB2')).toBeNull();
    });

    it('отклоняет слишком короткие, с цифры и не латиницей', () => {
      expect(projects.validateKey('A')).not.toBeNull();
      expect(projects.validateKey('2AB')).not.toBeNull();
      expect(projects.validateKey('ПРО')).not.toBeNull();
    });

    it('отклоняет занятый ключ, кроме самого проекта', () => {
      const p = projects.create({ name: 'Web', key: 'WEB', color: 'indigo' });
      expect(projects.validateKey('WEB')).toBe('Такой ключ уже используется');
      expect(projects.validateKey('WEB', p.id)).toBeNull();
    });
  });

  it('создаёт проект со статусами по умолчанию', () => {
    const p = projects.create({ name: '  Web  ', key: 'web', color: 'sky' });
    expect(p.name).toBe('Web');
    expect(p.key).toBe('WEB');
    expect(p.statuses.map((s) => s.category)).toEqual([
      'todo',
      'in_progress',
      'in_progress',
      'done',
    ]);
    expect(projects.byKey('web')?.id).toBe(p.id);
  });

  it('current — последний выбранный проект или первый по алфавиту', () => {
    const b = projects.create({ name: 'Бета', key: 'BB', color: 'sky' });
    const a = projects.create({ name: 'Альфа', key: 'AA', color: 'sky' });
    expect(projects.current()?.id).toBe(a.id);
    projects.select(b.id);
    expect(projects.current()?.id).toBe(b.id);
    expect(TestBed.inject(SettingsService).lastProjectId()).toBe(b.id);
  });

  it('при удалении статуса переносит задачи в первый статус', () => {
    const p = projects.create({ name: 'Web', key: 'WEB', color: 'sky' });
    const issue = issues.create({ projectId: p.id, title: 'Задача', statusId: 'in_review' });
    projects.updateStatuses(
      p.id,
      p.statuses.filter((s) => s.id !== 'in_review'),
    );
    expect(issues.get(issue.id)?.statusId).toBe('todo');
  });

  it('удаление проекта удаляет его задачи и спринты', () => {
    const p = projects.create({ name: 'Web', key: 'WEB', color: 'sky' });
    issues.create({ projectId: p.id, title: 'Задача' });
    projects.remove(p.id);
    expect(projects.projects()).toHaveLength(0);
    expect(issues.issues()).toHaveLength(0);
  });
});
