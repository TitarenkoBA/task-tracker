import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MarkdownRenderer, loadMarkdownRenderer } from '../../core/utils/markdown';

/**
 * Показывает текст в формате Markdown.
 * Пока парсер загружается (доли секунды при первом показе), виден исходный текст.
 */
@Component({
  selector: 'app-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Стили текста — плагин @tailwindcss/typography (классы prose-*), см. styles.css.
    class:
      'markdown prose prose-sm prose-slate block max-w-none break-words dark:prose-invert prose-a:text-brand-600 dark:prose-a:text-brand-400 prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none',
  },
  template: `
    @if (html(); as html) {
      <div [innerHTML]="html"></div>
    } @else {
      <p class="whitespace-pre-wrap">{{ text() }}</p>
    }
  `,
})
export class Markdown {
  readonly text = input('');

  private readonly render = signal<MarkdownRenderer | null>(null);
  protected readonly html = computed(() => this.render()?.(this.text()) ?? null);

  constructor() {
    void loadMarkdownRenderer().then((render) => this.render.set(render));
  }
}
