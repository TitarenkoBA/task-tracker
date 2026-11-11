import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { PeopleService } from '../services/people.service';
import { ProjectService } from '../services/project.service';
import { SettingsService } from '../services/settings.service';
import { formatRelative } from '../utils/dates';
import { en } from './en';
import { I18n } from './i18n.service';
import { ru } from './ru';

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(async () => {
    await setupTestStore();
    i18n = TestBed.inject(I18n);
  });

  it('в английском словаре есть все ключи русского и нет лишних', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('у одинаковых ключей одинаковые параметры подстановки', () => {
    const params = (entry: unknown) =>
      [...new Set([...JSON.stringify(entry).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      expect(params(en[key]), key).toEqual(params(ru[key]));
    }
  });

  it('переводит и подставляет параметры', () => {
    expect(i18n.t('issue.removed', { key: 'WEB-1' })).toBe('WEB-1 удалена');
    i18n.set('en');
    expect(i18n.t('issue.removed', { key: 'WEB-1' })).toBe('WEB-1 deleted');
  });

  it('выбирает форму множественного числа', () => {
    expect(i18n.t('backlog.issueCount', { count: 1 })).toBe('1 задача');
    expect(i18n.t('backlog.issueCount', { count: 3 })).toBe('3 задачи');
    expect(i18n.t('backlog.issueCount', { count: 5 })).toBe('5 задач');
    i18n.set('en');
    expect(i18n.t('backlog.issueCount', { count: 1 })).toBe('1 issue');
    expect(i18n.t('backlog.issueCount', { count: 5 })).toBe('5 issues');
  });

  it('запоминает язык и меняет атрибут lang у <html>', () => {
    i18n.set('en');
    TestBed.tick();
    expect(document.documentElement.lang).toBe('en');
    expect(TestBed.inject(SettingsService).language()).toBe('en');
  });

  it('форматирование дат следует за языком', () => {
    const now = Date.now();
    expect(formatRelative(now - 10_000, now)).toBe('только что');
    i18n.set('en');
    expect(formatRelative(now - 10_000, now)).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 minutes ago');
  });

  it('значения из истории: приоритет и тип переводятся, остальное как есть', () => {
    expect(i18n.historyValue('priority', 'high')).toBe('Высокий');
    expect(i18n.historyValue('type', 'bug')).toBe('Баг');
    expect(i18n.historyValue('statusId', 'В работе')).toBe('В работе');
    // Старые записи, где приоритет уже сохранён текстом.
    expect(i18n.historyValue('priority', 'Высокий')).toBe('Высокий');
    expect(i18n.historyValue('priority', null)).toBe('—');
    i18n.set('en');
    expect(i18n.historyValue('priority', 'high')).toBe('High');
  });

  it('новый проект получает статусы на текущем языке', () => {
    i18n.set('en');
    const project = TestBed.inject(ProjectService).create({
      name: 'Web',
      key: 'WEB',
      color: 'sky',
    });
    expect(project.statuses.map((s) => s.name)).toEqual([
      'To Do',
      'In Progress',
      'In Review',
      'Done',
    ]);
  });

  it('стандартное имя профиля переводится при смене языка, а своё — нет', () => {
    const people = TestBed.inject(PeopleService);
    people.ensureMe();
    expect(people.me()?.name).toBe('Я');
    i18n.set('en');
    people.translateDefaultName();
    expect(people.me()?.name).toBe('Me');

    people.update(people.me()!.id, { name: 'Борис' });
    i18n.set('ru');
    people.translateDefaultName();
    expect(people.me()?.name).toBe('Борис');
  });
});

describe('I18n: язык по умолчанию', () => {
  it('без сохранённой настройки берётся язык браузера', async () => {
    await setupTestStore();
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    expect(TestBed.inject(I18n).lang()).toBe('en');
    vi.restoreAllMocks();
  });
});
