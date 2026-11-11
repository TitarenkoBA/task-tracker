import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Заголовок страницы. На телефоне прилипает к верху экрана.
 *
 * Слоты: `[leading]` — слева от заголовка (например, «назад»),
 * `[actions]` — кнопки справа, без атрибута — строка под заголовком (фильтры).
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'pt-safe sticky top-0 z-20 block border-b border-slate-200/70 bg-slate-50/85 backdrop-blur-lg lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none dark:border-slate-800/70 dark:bg-slate-950/85 lg:dark:bg-transparent',
  },
  template: `
    <div class="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 lg:px-8 lg:pt-8 lg:pb-4">
      <ng-content select="[leading]" />
      <div class="min-w-0 flex-1">
        @if (eyebrow()) {
          <p class="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{{ eyebrow() }}</p>
        }
        <h1 class="truncate text-xl font-bold tracking-tight lg:text-2xl">{{ title() }}</h1>
      </div>
      <div class="flex shrink-0 items-center gap-1"><ng-content select="[actions]" /></div>
    </div>
    <ng-content />
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly eyebrow = input('');
}
