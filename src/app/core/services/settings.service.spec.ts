import { TestBed } from '@angular/core/testing';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  const KEY = 'task-tracker.settings';

  afterEach(() => localStorage.removeItem(KEY));

  function create(): SettingsService {
    return TestBed.runInInjectionContext(() => new SettingsService());
  }

  it('один проект совместной работы из прежней версии становится списком', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', collabProjectId: 'p1' }));
    const settings = create();
    expect(settings.collabProjectIds()).toEqual(['p1']);
    expect(settings.theme()).toBe('dark');
  });

  it('без прежней сессии список пуст', () => {
    localStorage.setItem(KEY, JSON.stringify({ collabProjectId: null }));
    expect(create().collabProjectIds()).toEqual([]);
  });

  it('сохранённый список не перетирается', () => {
    localStorage.setItem(KEY, JSON.stringify({ collabProjectIds: ['a', 'b'] }));
    expect(create().collabProjectIds()).toEqual(['a', 'b']);
  });
});
