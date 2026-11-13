import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { Issue } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { dueState, formatShortDate } from '../../core/utils/dates';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { PriorityIcon, TypeIcon } from '../../shared/ui/issue-badges';

/** Карточка задачи на доске. */
@Component({
  selector: 'app-issue-card',
  imports: [RouterLink, Avatar, Icon, PriorityIcon, TypeIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <a
      [routerLink]="['/browse', routeKey()]"
      class="block rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs transition hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
      [class.opacity-70]="done()"
    >
      @if (epic(); as e) {
        <span
          class="chip mb-2 h-5 max-w-full bg-violet-100 text-[11px] text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        >
          <span class="truncate">{{ e.title }}</span>
        </span>
      }
      <p class="text-sm leading-snug font-medium" [class.line-through]="done()">
        {{ issue().title }}
      </p>

      @if (issue().labels.length) {
        <div class="mt-2 flex flex-wrap gap-1">
          @for (label of issue().labels.slice(0, 3); track label) {
            <span
              class="chip h-5 bg-slate-100 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >{{ label }}</span
            >
          }
        </div>
      }

      <div class="mt-3 flex items-center gap-2">
        <app-type-icon [type]="issue().type" />
        <span class="font-mono text-xs text-slate-500" [class.line-through]="done()">{{
          key()
        }}</span>
        @if (subtasks().total) {
          <span
            class="inline-flex items-center gap-0.5 text-xs text-slate-500"
            [title]="'issue.subtasks' | t"
          >
            <app-icon name="subtask" [size]="14" /> {{ subtasks().done }}/{{ subtasks().total }}
          </span>
        }
        @if (issue().dueDate; as due) {
          <span
            class="inline-flex items-center gap-0.5 text-xs"
            [class]="
              due$() === 'overdue'
                ? 'text-rose-600 font-medium'
                : due$() === 'soon'
                  ? 'text-amber-600'
                  : 'text-slate-500'
            "
            [title]="'field.dueDate' | t"
          >
            <app-icon name="calendar" [size]="13" /> {{ formatDate(due) }}
          </span>
        }
        <span class="ml-auto flex items-center gap-1.5">
          @if (issue().storyPoints !== null) {
            <span
              class="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Story points"
            >
              {{ issue().storyPoints }}
            </span>
          }
          <app-priority-icon [priority]="issue().priority" />
          <app-avatar size="sm" [person]="assignee()" />
        </span>
      </div>
    </a>
  `,
})
export class IssueCard {
  readonly issue = input.required<Issue>();

  private readonly issues = inject(IssueService);
  private readonly people = inject(PeopleService);

  protected readonly key = computed(() => this.issues.key(this.issue()));
  protected readonly routeKey = computed(() => this.issues.routeKey(this.issue()));
  protected readonly done = computed(() => this.issues.isDone(this.issue()));
  protected readonly assignee = computed(() => this.people.get(this.issue().assigneeId));
  protected readonly epic = computed(() => {
    const parent = this.issues.get(this.issue().parentId);
    return parent?.type === 'epic' ? parent : null;
  });
  protected readonly subtasks = computed(() => {
    const children = this.issues.children(this.issue().id).filter((c) => c.type === 'subtask');
    return { total: children.length, done: children.filter((c) => this.issues.isDone(c)).length };
  });
  protected readonly due$ = computed(() => dueState(this.issue().dueDate, this.done()));
  protected readonly formatDate = formatShortDate;
}
