import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Icon } from '../ui/icon';

/**
 * Каркас диалога: заголовок с крестиком, прокручиваемое тело и подвал.
 *
 * ```html
 * <app-dialog-frame title="Заголовок">
 *   ...содержимое...
 *   <ng-container footer>...кнопки...</ng-container>
 * </app-dialog-frame>
 * ```
 */
@Component({
  selector: 'app-dialog-frame',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[85dvh] sm:rounded-3xl dark:bg-slate-900',
  },
  template: `
    <div
      class="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden dark:bg-slate-700"
    ></div>
    <header class="flex shrink-0 items-center gap-2 px-5 pt-3 pb-2 sm:pt-5">
      <h2 class="flex-1 text-lg font-semibold">{{ title() }}</h2>
      <button type="button" class="btn-icon -mr-2" aria-label="Закрыть" (click)="ref.close()">
        <app-icon name="x" />
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
      <ng-content />
    </div>
    <footer class="pb-safe shrink-0 border-t border-slate-100 dark:border-slate-800">
      <div class="flex flex-col-reverse gap-2 px-5 py-3 sm:flex-row sm:justify-end">
        <ng-content select="[footer]" />
      </div>
    </footer>
  `,
})
export class DialogFrame {
  readonly title = input.required<string>();
  protected readonly ref = inject(DialogRef);
}
