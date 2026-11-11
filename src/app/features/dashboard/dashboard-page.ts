import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FIELD_LABELS, PRIORITIES } from '../../core/models/catalog';
import { Activity } from '../../core/models/entities';
import { DemoDataService } from '../../core/services/demo-data.service';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { formatRelative, todayIso } from '../../core/utils/dates';
import { Avatar } from '../../shared/ui/avatar';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { ActionsService } from '../actions.service';
import { IssuesFilterState } from '../issues/issues-filter-state';
import { IssueRow } from '../issues/issue-row';
import { emptyFilter } from '../issues/issue-filter';

const WEEK = 7 * 86_400_000;

/** Главная страница: сводка по моим задачам и последние события. */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, Avatar, EmptyState, Icon, IssueRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
})
export class DashboardPage {
  private readonly issues = inject(IssueService);
  private readonly demo = inject(DemoDataService);
  private readonly router = inject(Router);
  private readonly filterState = inject(IssuesFilterState);
  protected readonly projects = inject(ProjectService);
  protected readonly people = inject(PeopleService);
  protected readonly actions = inject(ActionsService);

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part =
      hour < 6
        ? 'Доброй ночи'
        : hour < 12
          ? 'Доброе утро'
          : hour < 18
            ? 'Добрый день'
            : 'Добрый вечер';
    const name = this.people.me()?.name;
    return name && name !== 'Я' ? `${part}, ${name.split(' ')[0]}` : part;
  });
  protected readonly today = new Intl.DateTimeFormat('ru', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  private readonly openIssues = computed(() =>
    this.issues.issues().filter((i) => i.type !== 'epic' && !this.issues.isDone(i)),
  );

  protected readonly mine = computed(() => {
    const me = this.people.me()?.id;
    return this.openIssues()
      .filter((i) => i.assigneeId === me)
      .sort(
        (a, b) =>
          PRIORITIES[b.priority].weight - PRIORITIES[a.priority].weight ||
          b.updatedAt - a.updatedAt,
      );
  });

  protected readonly stats = computed(() => {
    const today = todayIso();
    const weekAgo = Date.now() - WEEK;
    const open = this.openIssues();
    return {
      mine: this.mine().length,
      overdue: open.filter((i) => i.dueDate && i.dueDate < today).length,
      inProgress: open.filter((i) => this.issues.status(i)?.category === 'in_progress').length,
      doneThisWeek: this.issues
        .issues()
        .filter((i) => i.type !== 'epic' && this.issues.isDone(i) && i.updatedAt > weekAgo).length,
    };
  });

  protected readonly upcoming = computed(() =>
    this.openIssues()
      .filter((i) => i.dueDate)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
      .slice(0, 6),
  );

  protected readonly feed = computed(() =>
    [...this.issues.activity()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map((entry) => ({ entry, issue: this.issues.get(entry.issueId) }))
      .filter((x) => x.issue),
  );

  protected readonly formatRelative = formatRelative;

  protected issueKey(id: string): string {
    const issue = this.issues.get(id);
    return issue ? this.issues.key(issue) : '';
  }

  protected describe(entry: Activity): string {
    if (entry.kind === 'created') return 'создал(а)';
    if (entry.kind === 'commented') return 'прокомментировал(а)';
    const field = FIELD_LABELS[entry.field ?? ''] ?? entry.field;
    return entry.to ? `${field} → «${entry.to}» в` : `изменил(а) ${field?.toLowerCase()} в`;
  }

  /** Перейти к списку задач с готовым фильтром. */
  protected showMine(): void {
    this.filterState.filter.set({ ...emptyFilter(), assignee: 'me', category: '' });
    void this.router.navigate(['/issues']);
  }

  protected createDemo(): void {
    const project = this.demo.create();
    void this.router.navigate(['/p', project.key, 'board']);
  }
}
