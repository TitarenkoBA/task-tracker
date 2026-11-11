import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { COLOR_CLASSES } from '../../core/models/catalog';
import { Person } from '../../core/models/entities';
import { initials } from '../../core/services/people.service';
import { Icon } from './icon';
import { TranslatePipe } from '../../core/i18n/i18n.service';

/** Круглый аватар с инициалами. Без человека — пунктирный кружок «не назначено». */
@Component({
  selector: 'app-avatar',
  imports: [Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    @if (person(); as p) {
      <span
        class="inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-900"
        [class]="colorClass() + ' ' + sizeClass()"
        [title]="p.name"
      >
        {{ letters() }}
      </span>
    } @else {
      <span
        class="inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-600"
        [class]="sizeClass()"
        [title]="'avatar.unassigned' | t"
      >
        <app-icon name="user" [size]="size() === 'sm' ? 12 : 16" />
      </span>
    }
  `,
})
export class Avatar {
  readonly person = input<Person | null | undefined>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  protected readonly letters = computed(() => initials(this.person()?.name ?? ''));
  protected readonly colorClass = computed(
    () => COLOR_CLASSES[this.person()?.color ?? 'indigo'].solid,
  );
  protected readonly sizeClass = computed(
    () =>
      ({ sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-12 text-base' })[this.size()],
  );
}
