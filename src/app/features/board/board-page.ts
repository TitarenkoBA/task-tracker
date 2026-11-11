import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { STATUS_CATEGORIES } from '../../core/models/catalog';
import { EntityId, Issue, WorkflowStatus } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { SprintService } from '../../core/services/sprint.service';
import { formatShortDate, todayIso } from '../../core/utils/dates';
import { byOrder } from '../../core/utils/order';
import { Avatar } from '../../shared/ui/avatar';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { dragClickGuard } from '../../shared/utils/drag-click-guard';
import { ActionsService } from '../actions.service';
import { IssueCard } from '../issues/issue-card';
import { matchesQuery } from '../issues/issue-filter';
import { ProjectSwitcher } from '../projects/project-switcher';

interface Column {
  status: WorkflowStatus;
  issues: Issue[];
}

/**
 * Доска проекта. Если есть активный спринт — показывает его задачи (Scrum),
 * иначе все задачи проекта (Kanban). Эпики на доске не показываются.
 */
@Component({
  selector: 'app-board-page',
  imports: [
    RouterLink,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkScrollable,
    PageHeader,
    ProjectSwitcher,
    IssueCard,
    Avatar,
    Icon,
    EmptyState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-page.html',
})
export class BoardPage {
  /** Ключ проекта из URL (`/p/:projectKey/board`). */
  readonly projectKey = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly sprints = inject(SprintService);
  protected readonly people = inject(PeopleService);
  protected readonly actions = inject(ActionsService);
  protected readonly categories = STATUS_CATEGORIES;

  protected readonly project = computed(() => this.projects.byKey(this.projectKey()));
  protected readonly sprint = computed(() => {
    const project = this.project();
    return project ? this.sprints.active(project.id) : undefined;
  });

  // Фильтры
  protected readonly query = signal('');
  protected readonly assigneeFilter = signal<ReadonlySet<EntityId | 'none'>>(new Set());

  protected readonly boardIssues = computed(() => {
    const project = this.project();
    if (!project) return [];
    const sprint = this.sprint();
    return this.issues
      .issues()
      .filter(
        (i) =>
          i.projectId === project.id &&
          i.type !== 'epic' &&
          (sprint ? i.sprintId === sprint.id : true),
      );
  });

  protected readonly visibleIssues = computed(() => {
    const query = this.query();
    const assignees = this.assigneeFilter();
    return this.boardIssues().filter(
      (i) =>
        matchesQuery(i, query, this.issues.key(i)) &&
        (!assignees.size || assignees.has(i.assigneeId ?? 'none')),
    );
  });

  protected readonly columns = computed<Column[]>(() => {
    const issues = this.visibleIssues();
    return (this.project()?.statuses ?? []).map((status) => ({
      status,
      issues: issues.filter((i) => i.statusId === status.id).sort(byOrder),
    }));
  });

  /** Люди, у которых есть задачи на доске, — для фильтра по исполнителю. */
  protected readonly boardPeople = computed(() => {
    const ids = new Set(this.boardIssues().map((i) => i.assigneeId));
    return this.people.people().filter((p) => ids.has(p.id));
  });

  protected readonly daysLeft = computed(() => {
    const end = this.sprint()?.endDate;
    if (!end) return null;
    return Math.ceil(
      (new Date(`${end}T00:00:00`).getTime() - new Date(`${todayIso()}T00:00:00`).getTime()) /
        86_400_000,
    );
  });

  protected readonly hasFilters = computed(() => !!this.query() || this.assigneeFilter().size > 0);
  protected readonly formatDate = formatShortDate;

  protected readonly dragGuard = dragClickGuard();

  constructor() {
    effect(() => {
      const project = this.project();
      if (project) this.projects.select(project.id);
    });
  }

  protected toggleAssignee(id: EntityId | 'none'): void {
    this.assigneeFilter.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected onlyMine(): void {
    const me = this.people.me();
    if (me) this.assigneeFilter.set(new Set([me.id]));
  }

  protected clearFilters(): void {
    this.query.set('');
    this.assigneeFilter.set(new Set());
  }

  protected drop(event: CdkDragDrop<Column, Column, Issue>): void {
    this.dragGuard.ended();
    const target = event.container.data;
    const issue = event.item.data;
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex)
      return;
    const list = target.issues.filter((i) => i.id !== issue.id);
    this.issues.move(issue.id, { statusId: target.status.id }, list, event.currentIndex);
  }

  protected createIn(status: WorkflowStatus): void {
    const project = this.project();
    if (!project) return;
    this.actions.createIssue({
      projectId: project.id,
      statusId: status.id,
      sprintId: this.sprint()?.id ?? null,
    });
  }
}
