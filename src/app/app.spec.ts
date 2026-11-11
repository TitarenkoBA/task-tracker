import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { setupTestStore } from '../testing/test-store';
import { App } from './app';
import { ProjectService } from './core/services/project.service';
import { ActionsService } from './features/actions.service';

describe('App (оболочка)', () => {
  beforeEach(async () => {
    await setupTestStore({
      imports: [App],
      providers: [provideRouter([]), provideServiceWorker('ngsw-worker.js', { enabled: false })],
    });
  });

  it('показывает навигацию и кнопку создания', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('aside')?.textContent).toContain('Task Tracker');
    expect(el.querySelector('button[aria-label="Создать задачу"]')).toBeTruthy();
    const tabs = [...el.querySelectorAll('nav.fixed a')].map((a) => a.textContent?.trim());
    expect(tabs).toEqual(['Обзор', 'Доска', 'Бэклог', 'Задачи', 'Ещё']);
  });

  it('ссылки «Доска» и «Бэклог» ведут в текущий проект', async () => {
    TestBed.inject(ProjectService).create({ name: 'Web', key: 'WEB', color: 'indigo' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav.fixed a')].map(
      (a) => a.getAttribute('href'),
    );
    expect(links).toContain('/p/WEB/board');
    expect(links).toContain('/p/WEB/backlog');
  });

  it('горячая клавиша C открывает создание задачи', async () => {
    const actions = TestBed.inject(ActionsService);
    const spy = vi.spyOn(actions, 'createIssue').mockImplementation(() => {});
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  it('горячие клавиши не срабатывают при вводе текста', async () => {
    const actions = TestBed.inject(ActionsService);
    const spy = vi.spyOn(actions, 'createIssue').mockImplementation(() => {});
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    input.remove();
  });
});
