import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { MarkdownEditor } from './markdown-editor';

@Component({
  imports: [MarkdownEditor],
  template: `<app-markdown-editor [(value)]="text" (submitted)="submits = submits + 1" />`,
})
class Host {
  readonly text = signal('');
  submits = 0;
}

describe('MarkdownEditor', () => {
  beforeEach(async () => {
    await setupTestStore({ imports: [Host] });
  });

  async function render(initial = '') {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text.set(initial);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const textarea = () => el.querySelector('textarea')!;
    const button = (label: string) =>
      el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    return { fixture, el, textarea, button };
  }

  function select(textarea: HTMLTextAreaElement, start: number, end: number) {
    textarea.focus();
    textarea.setSelectionRange(start, end);
  }

  it('кнопка «Жирный» оборачивает выделение', async () => {
    const { fixture, textarea, button } = await render('сделать сегодня');
    select(textarea(), 8, 15);
    button('Жирный').click();
    expect(fixture.componentInstance.text()).toBe('сделать **сегодня**');
  });

  it('«Чек-лист» добавляет префикс к каждой выделенной строке', async () => {
    const { fixture, textarea, button } = await render('раз\nдва');
    select(textarea(), 0, 7);
    button('Чек-лист').click();
    expect(fixture.componentInstance.text()).toBe('- [ ] раз\n- [ ] два');
  });

  it('«Ссылка» вставляет шаблон ссылки вокруг выделения', async () => {
    const { fixture, textarea, button } = await render('документация');
    select(textarea(), 0, 12);
    button('Ссылка').click();
    expect(fixture.componentInstance.text()).toBe('[документация](https://)');
  });

  it('вкладка «Просмотр» показывает отрендеренный Markdown', async () => {
    const { fixture, el } = await render('**важно**');
    const preview = [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
      (b) => b.textContent?.trim() === 'Просмотр',
    )!;
    preview.click();
    // Парсер загружается лениво — ждём, пока он подгрузится и отрисует текст.
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(el.querySelector('strong')?.textContent).toBe('важно');
    });
    expect(el.querySelector('textarea')).toBeNull();
  });

  it('Ctrl+Enter отправляет', async () => {
    const { fixture, textarea } = await render('текст');
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(fixture.componentInstance.submits).toBe(1);
  });
});
