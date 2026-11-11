import type { Renderer, Tokens } from 'marked';

/**
 * Превращает Markdown в HTML.
 *
 * Парсер (`marked`) загружается лениво — при первом показе Markdown,
 * чтобы не увеличивать стартовый размер приложения.
 *
 * Безопасность в два слоя:
 * 1. Сырой HTML внутри Markdown не выполняется, а показывается как текст.
 * 2. Результат вставляется через `[innerHTML]`, и Angular дополнительно
 *    вычищает всё опасное (скрипты, обработчики событий, `javascript:`-ссылки).
 */
export type MarkdownRenderer = (source: string) => string;

let rendererPromise: Promise<MarkdownRenderer> | null = null;

export function loadMarkdownRenderer(): Promise<MarkdownRenderer> {
  rendererPromise ??= import('marked').then(({ Marked }) => {
    const marked = new Marked({
      gfm: true, // таблицы, ~~зачёркивание~~, списки задач
      breaks: true, // одиночный перенос строки = <br>, как ожидают обычные пользователи
      renderer: {
        // Сырой HTML показываем как текст.
        html({ text }: Tokens.HTML | Tokens.Tag): string {
          return escapeHtml(text);
        },
        // Ссылки открываются в новой вкладке.
        link(this: Renderer, { href, title, tokens }: Tokens.Link): string {
          const text = this.parser.parseInline(tokens);
          if (!isSafeUrl(href)) return text;
          const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
          return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
        },
        // Картинки не загружаем (приложение работает офлайн и не должно ходить в сеть) — показываем ссылкой.
        image({ href, text }: Tokens.Image): string {
          if (!isSafeUrl(href)) return escapeHtml(text);
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">🖼 ${escapeHtml(text || href)}</a>`;
        },
        // <input type="checkbox"> Angular вырезает при санитизации, поэтому рисуем символом.
        checkbox({ checked }: Tokens.Checkbox): string {
          return `<span class="md-check${checked ? ' md-check-done' : ''}">${checked ? '☑' : '☐'}</span> `;
        },
      },
    });
    return (source: string) => (source.trim() ? marked.parse(source, { async: false }) : '');
  });
  return rendererPromise;
}

function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:|\/|#)/i.test(url.trim());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
