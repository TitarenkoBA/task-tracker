import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STATUS_CATEGORIES } from '../../core/models/catalog';
import { Issue } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { dueState, formatShortDate } from '../../core/utils/dates';
import { Avatar } from '../../shared/ui/avatar';
import { PriorityIcon, StatusBadge, TypeIcon } from '../../shared/ui/issue-badges';

/** Компактная строка задачи для списков (бэклог, поиск, обзор). */
@Component({
  selector: 'app-issue-row',
  imports: [RouterLink, Avatar, PriorityIcon, StatusBadge, TypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <a
      [routerLink]="['/browse', key()]"
      class="flex min-h-12 items-center gap-2.5 px-3 py-2 transition hover:bg-slate-50 sm:px-4 dark:hover:bg-slate-800/50"
    >
      <app-type-icon [type]="issue().type" />
      <span class="hidden w-16 shrink-0 font-mono text-xs text-slate-500 sm:inline" [class.line-through]="done()">{{ key() }}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm" [class.text-slate-400]="done()">{{ issue().title }}</span>
        <!-- На телефоне ключ и статус — второй строкой, чтобы название не обрезалось -->
        <span class="flex items-center gap-1.5 text-[11px] text-slate-500 sm:hidden">
          <span class="font-mono">{{ key() }}</span>
          @if (showStatus()) {
            <span class="size-1.5 rounded-full" [class]="statusDot()"></span>
            <span class="truncate">{{ status()?.name }}</span>
          }
        </span>
      </span>
      @if (issue().dueDate && due$()) {
        <span class="hidden text-xs sm:inline" [class]="due$() === 'overdue' ? 'text-rose-600' : 'text-amber-600'">
          {{ formatDate(issue().dueDate!) }}
        </span>
      }
      @if (showStatus()) {
        <span class="hidden max-w-36 sm:inline-flex"><app-status-badge [status]="status()" /></span>
      }
      @if (issue().storyPoints !== null) {
        <span class="hidden h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600 sm:flex dark:bg-slate-800 dark:text-slate-300">
          {{ issue().storyPoints }}
        </span>
      }
      <app-priority-icon [priority]="issue().priority" />
      <app-avatar size="sm" [person]="assignee()" />
    </a>
  `,
})
export class IssueRow {
  readonly issue = input.required<Issue>();
  readonly showStatus = input(true);

  private readonly issues = inject(IssueService);
  private readonly people = inject(PeopleService);

  protected readonly key = computed(() => this.issues.key(this.issue()));
  protected readonly status = computed(() => this.issues.status(this.issue()));
  protected readonly done = computed(() => this.status()?.category === 'done');
  protected readonly statusDot = computed(() => STATUS_CATEGORIES[this.status()?.category ?? 'todo'].dot);
  protected readonly assignee = computed(() => this.people.get(this.issue().assigneeId));
  protected readonly due$ = computed(() => dueState(this.issue().dueDate, this.done()));
  protected readonly formatDate = formatShortDate;
}
