import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from './icon';

/** Заглушка для пустых списков. Кнопки действий передаются внутрь через <ng-content>. */
@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col items-center justify-center px-6 py-12 text-center' },
  template: `
    <div
      class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400"
    >
      <app-icon [name]="icon()" [size]="28" />
    </div>
    <h3 class="text-base font-semibold">{{ title() }}</h3>
    @if (text()) {
      <p class="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{{ text() }}</p>
    }
    <div class="mt-5 flex flex-wrap justify-center gap-2"><ng-content /></div>
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly text = input('');
}
