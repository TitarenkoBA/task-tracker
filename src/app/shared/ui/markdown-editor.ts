import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { TKey } from '../../core/i18n/ru';
import { Icon } from './icon';
import { Markdown } from './markdown';

interface ToolbarAction {
  icon: string;
  label: TKey;
  run: (editor: MarkdownEditor) => void;
}

/** Кнопки панели форматирования. Каждая оборачивает выделение или вставляет префикс строки. */
const ACTIONS: ToolbarAction[] = [
  { icon: 'bold', label: 'md.bold', run: (e) => e.wrap('**', '**') },
  { icon: 'italic', label: 'md.italic', run: (e) => e.wrap('_', '_') },
  { icon: 'heading', label: 'md.heading', run: (e) => e.prefixLines('## ') },
  { icon: 'list', label: 'md.list', run: (e) => e.prefixLines('- ') },
  { icon: 'check-square', label: 'md.checklist', run: (e) => e.prefixLines('- [ ] ') },
  { icon: 'link', label: 'md.link', run: (e) => e.link() },
  { icon: 'code', label: 'md.code', run: (e) => e.wrap('`', '`') },
];

/**
 * Поле ввода с поддержкой Markdown: вкладки «Текст / Просмотр»
 * и панель кнопок форматирования. Значение — обычная строка Markdown.
 *
 * ```html
 * <app-markdown-editor [(value)]="text" (submitted)="save()" (cancelled)="close()" />
 * ```
 */
@Component({
  selector: 'app-markdown-editor',
  imports: [Icon, Markdown, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="overflow-hidden rounded-xl border border-slate-200 bg-white transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-900"
    >
      <div
        class="flex items-center gap-0.5 border-b border-slate-100 px-1.5 py-1 dark:border-slate-800"
      >
        <div
          class="mr-1 flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800"
          role="tablist"
        >
          @for (tab of tabs; track tab.id) {
            <button
              type="button"
              role="tab"
              class="rounded-md px-2.5 py-1 font-medium transition"
              [class]="
                mode() === tab.id ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500'
              "
              [attr.aria-selected]="mode() === tab.id"
              (click)="mode.set(tab.id)"
            >
              {{ tab.label | t }}
            </button>
          }
        </div>
        @if (mode() === 'write') {
          <div class="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
            @for (action of actions; track action.label) {
              <button
                type="button"
                class="btn-icon size-8 shrink-0 rounded-lg"
                [attr.aria-label]="action.label | t"
                [title]="action.label | t"
                (mousedown)="$event.preventDefault()"
                (click)="action.run(this)"
              >
                <app-icon [name]="action.icon" [size]="16" />
              </button>
            }
          </div>
        }
      </div>

      @if (mode() === 'write') {
        <textarea
          #field
          class="autosize block w-full resize-y bg-transparent px-3 py-2 text-base leading-relaxed outline-none placeholder:text-slate-400 sm:text-sm"
          [style.min-height.rem]="minRows() * 1.5 + 1"
          [id]="inputId()"
          [placeholder]="placeholder()"
          [value]="value()"
          (input)="value.set($any($event.target).value)"
          (keydown)="onKeydown($event)"
        ></textarea>
      } @else {
        <div class="px-3 py-2" [style.min-height.rem]="minRows() * 1.5 + 1">
          @if (value().trim()) {
            <app-markdown [text]="value()" />
          } @else {
            <p class="text-sm text-slate-400">{{ 'md.empty' | t }}</p>
          }
        </div>
      }
    </div>
    <p class="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
      <app-icon name="markdown" [size]="14" /> {{ 'md.hint' | t }}
    </p>
  `,
})
export class MarkdownEditor {
  readonly value = model('');
  readonly placeholder = input('');
  readonly inputId = input<string | null>(null);
  readonly minRows = input(4);
  /** Поставить курсор в поле сразу после появления. */
  readonly autofocus = input(false);
  /** Ctrl/⌘ + Enter. */
  readonly submitted = output<void>();
  /** Escape. */
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18n);
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  protected readonly mode = signal<'write' | 'preview'>('write');
  protected readonly actions = ACTIONS;
  protected readonly tabs: { id: 'write' | 'preview'; label: TKey }[] = [
    { id: 'write', label: 'md.write' },
    { id: 'preview', label: 'md.preview' },
  ];

  constructor() {
    afterNextRender(() => {
      if (this.autofocus()) this.focus();
    });
  }

  focus(): void {
    const el = this.field()?.nativeElement;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submitted.emit();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancelled.emit();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.wrap('**', '**');
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      this.wrap('_', '_');
    }
  }

  // Операции панели инструментов (публичные — их вызывают ACTIONS) ---------------

  /** Обернуть выделение: `**текст**`. */
  wrap(before: string, after: string): void {
    this.edit((text, start, end) => {
      const selected = text.slice(start, end);
      return {
        text: text.slice(0, start) + before + selected + after + text.slice(end),
        start: start + before.length,
        end: end + before.length,
      };
    });
  }

  /** Добавить префикс к каждой выделенной строке: `- `, `## `. */
  prefixLines(prefix: string): void {
    this.edit((text, start, end) => {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const block = text.slice(lineStart, end);
      const prefixed = block
        .split('\n')
        .map((line) => prefix + line)
        .join('\n');
      const added = prefixed.length - block.length;
      return {
        text: text.slice(0, lineStart) + prefixed + text.slice(end),
        start: start + prefix.length,
        end: end + added,
      };
    });
  }

  /** Вставить ссылку `[текст](https://)` и выделить адрес. */
  link(): void {
    this.edit((text, start, end) => {
      const label = text.slice(start, end) || this.i18n.t('md.linkText');
      const url = 'https://';
      const inserted = `[${label}](${url})`;
      const urlStart = start + label.length + 3;
      return {
        text: text.slice(0, start) + inserted + text.slice(end),
        start: urlStart,
        end: urlStart + url.length,
      };
    });
  }

  private edit(
    change: (
      text: string,
      start: number,
      end: number,
    ) => { text: string; start: number; end: number },
  ): void {
    const el = this.field()?.nativeElement;
    if (!el) return;
    const result = change(el.value, el.selectionStart, el.selectionEnd);
    el.value = result.text;
    this.value.set(result.text);
    el.focus();
    el.setSelectionRange(result.start, result.end);
  }
}
