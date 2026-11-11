import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ISSUE_TYPES, PRIORITIES, STATUS_CATEGORIES } from '../../core/models/catalog';
import { IssuePriority, IssueType, WorkflowStatus } from '../../core/models/entities';
import { Icon } from './icon';

/** Цветной квадратик с иконкой типа задачи. */
@Component({
  selector: 'app-type-icon',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <span
      class="inline-flex size-5 items-center justify-center rounded-md"
      [class]="info().classes"
      [title]="info().label"
    >
      <app-icon [name]="info().icon" [size]="13" [strokeWidth]="2.5" />
    </span>
  `,
})
export class TypeIcon {
  readonly type = input.required<IssueType>();
  protected readonly info = computed(() => ISSUE_TYPES[this.type()]);
}

/** Иконка приоритета (стрелки). */
@Component({
  selector: 'app-priority-icon',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <span [class]="info().classes" [title]="'Приоритет: ' + info().label">
      <app-icon [name]="info().icon" [size]="18" [strokeWidth]="2.5" />
    </span>
  `,
})
export class PriorityIcon {
  readonly priority = input.required<IssuePriority>();
  protected readonly info = computed(() => PRIORITIES[this.priority()]);
}

/** Плашка статуса, окрашенная по категории. */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex min-w-0' },
  template: `
    <span class="chip max-w-full uppercase tracking-wide" [class]="classes()">
      <span class="truncate">{{ status()?.name ?? '—' }}</span>
    </span>
  `,
})
export class StatusBadge {
  readonly status = input<WorkflowStatus | undefined>();
  protected readonly classes = computed(
    () => STATUS_CATEGORIES[this.status()?.category ?? 'todo'].classes,
  );
}
