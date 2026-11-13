import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { PRIORITIES } from '../../core/models/catalog';
import { Activity } from '../../core/models/entities';
import { DemoDataService } from '../../core/services/demo-data.service';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { formatRelative, formatWeekday, todayIso } from '../../core/utils/dates';
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
  imports: [RouterLink, Avatar, EmptyState, Icon, IssueRow, TranslatePipe],
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
  private readonly i18n = inject(I18n);

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const greeting = this.i18n.t(
      hour < 6
        ? 'dash.night'
        : hour < 12
          ? 'dash.morning'
          : hour < 18
            ? 'dash.day'
            : 'dash.evening',
    );
    const me = this.people.me();
    return me && !this.people.hasDefaultName(me)
      ? this.i18n.t('dash.greetingName', { greeting, name: me.name.split(' ')[0] })
      : greeting;
  });
  protected readonly today = computed(() => formatWeekday());

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

  protected issueRouteKey(id: string): string {
    const issue = this.issues.get(id);
    return issue ? this.issues.routeKey(issue) : '';
  }

  protected issueKey(id: string): string {
    const issue = this.issues.get(id);
    return issue ? this.issues.key(issue) : '';
  }

  protected describe(entry: Activity): string {
    if (entry.kind === 'created') return this.i18n.t('dash.feedCreated');
    if (entry.kind === 'commented') return this.i18n.t('dash.feedCommented');
    const field = this.i18n.field(entry.field ?? '');
    return entry.to
      ? this.i18n.t('dash.feedChangedTo', {
          field,
          value: this.i18n.historyValue(entry.field, entry.to),
        })
      : this.i18n.t('dash.feedChanged', { field });
  }

  /** Перейти к списку задач с готовым фильтром. */
  protected showMine(): void {
    this.filterState.filter.set({ ...emptyFilter(), assignee: 'me', category: '' });
    void this.router.navigate(['/issues']);
  }

  protected createDemo(): void {
    const project = this.demo.create();
    void this.router.navigate(['/p', this.projects.routeKey(project), 'board']);
  }
}
