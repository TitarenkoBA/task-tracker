import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { setupTestStore } from '../../../testing/test-store';
import { DemoDataService } from '../../core/services/demo-data.service';
import { IssueService } from '../../core/services/issue.service';
import { BoardPage } from './board-page';

describe('BoardPage', () => {
  beforeEach(async () => {
    await setupTestStore({ imports: [BoardPage], providers: [provideRouter([])] });
    TestBed.inject(DemoDataService).create();
  });

  async function render() {
    const fixture = TestBed.createComponent(BoardPage);
    fixture.componentRef.setInput('projectKey', 'DEMO');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('показывает колонки по статусам проекта и задачи активного спринта', async () => {
    const el = await render();
    const headers = [...el.querySelectorAll('section h2')].map((h) => h.textContent?.trim());
    expect(headers).toEqual(['К выполнению', 'В работе', 'На проверке', 'Готово']);
    // Эпики и задачи вне спринта на доске не показываются.
    const titles = [...el.querySelectorAll('app-issue-card')].map((c) => c.textContent);
    expect(
      titles.some((t) => t?.includes('Авторизация пользователей') && t.includes('DEMO-1')),
    ).toBe(false);
    expect(titles.some((t) => t?.includes('Тёмная тема'))).toBe(false);
    expect(titles.some((t) => t?.includes('Экран входа по email'))).toBe(true);
  });

  it('фильтрует карточки поиском', async () => {
    const fixture = TestBed.createComponent(BoardPage);
    fixture.componentRef.setInput('projectKey', 'DEMO');
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[type=search]',
    )!;
    input.value = 'android';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-issue-card')).toHaveLength(
      1,
    );
  });

  it('показывает заглушку для несуществующего проекта', async () => {
    const fixture = TestBed.createComponent(BoardPage);
    fixture.componentRef.setInput('projectKey', 'NOPE');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Проект не найден');
  });

  it('реагирует на изменение данных без перезагрузки', async () => {
    const fixture = TestBed.createComponent(BoardPage);
    fixture.componentRef.setInput('projectKey', 'DEMO');
    await fixture.whenStable();
    const before = (fixture.nativeElement as HTMLElement).querySelectorAll('app-issue-card').length;
    const issues = TestBed.inject(IssueService);
    const any = issues.issues().find((i) => i.sprintId && i.type !== 'epic')!;
    issues.create({ projectId: any.projectId, title: 'Новая', sprintId: any.sprintId });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-issue-card')).toHaveLength(
      before + 1,
    );
  });
});
