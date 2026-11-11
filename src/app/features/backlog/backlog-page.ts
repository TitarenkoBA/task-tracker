import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
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
import { EntityId, Issue, Sprint } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { ProjectService } from '../../core/services/project.service';
import { SprintService } from '../../core/services/sprint.service';
import { ToastService } from '../../core/services/toast.service';
import { formatShortDate } from '../../core/utils/dates';
import { byOrder } from '../../core/utils/order';
import { DialogService } from '../../shared/dialog/dialog.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { dragClickGuard } from '../../shared/utils/drag-click-guard';
import { ActionsService } from '../actions.service';
import { IssueRow } from '../issues/issue-row';
import { matchesQuery } from '../issues/issue-filter';
import { ProjectSwitcher } from '../projects/project-switcher';
import { SprintCompleteDialog, SprintFormDialog } from './sprint-dialogs';

/** Секция бэклога: спринт или сам бэклог (`sprint = null`). */
interface Section {
  id: string;
  sprint: Sprint | null;
  issues: Issue[];
  points: number;
  done: number;
}

/**
 * Бэклог: планирование спринтов. Задачи перетаскиваются между спринтами
 * и бэклогом; порядок внутри списка — это приоритет.
 */
@Component({
  selector: 'app-backlog-page',
  imports: [
    RouterLink,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    PageHeader,
    ProjectSwitcher,
    IssueRow,
    Icon,
    EmptyState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './backlog-page.html',
})
export class BacklogPage {
  readonly projectKey = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly sprints = inject(SprintService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  protected readonly actions = inject(ActionsService);

  protected readonly project = computed(() => this.projects.byKey(this.projectKey()));
  protected readonly query = signal('');
  protected readonly epicFilter = signal<EntityId | null>(null);
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected readonly epics = computed(() =>
    this.issues.issues().filter((i) => i.projectId === this.project()?.id && i.type === 'epic'),
  );

  protected readonly sections = computed<Section[]>(() => {
    const project = this.project();
    if (!project) return [];
    const query = this.query();
    const epic = this.epicFilter();
    const issues = this.issues
      .issues()
      .filter(
        (i) =>
          i.projectId === project.id &&
          i.type !== 'epic' &&
          i.type !== 'subtask' &&
          (!epic || i.parentId === epic) &&
          matchesQuery(i, query, this.issues.key(i)),
      );
    const section = (id: string, sprint: Sprint | null): Section => {
      const list = issues.filter((i) => i.sprintId === (sprint?.id ?? null)).sort(byOrder);
      return {
        id,
        sprint,
        issues: list,
        points: list.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
        done: list.filter((i) => this.issues.isDone(i)).length,
      };
    };
    const open = this.sprints.forProject(project.id).filter((s) => s.state !== 'closed');
    return [...open.map((s) => section(s.id, s)), section('backlog', null)];
  });

  protected readonly hasActiveSprint = computed(() =>
    this.sections().some((s) => s.sprint?.state === 'active'),
  );
  protected readonly formatDate = formatShortDate;
  protected readonly dragGuard = dragClickGuard();

  constructor() {
    effect(() => {
      const project = this.project();
      if (project) this.projects.select(project.id);
    });
  }

  protected toggle(id: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected drop(event: CdkDragDrop<Section, Section, Issue>): void {
    this.dragGuard.ended();
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex)
      return;
    const target = event.container.data;
    const issue = event.item.data;
    const list = target.issues.filter((i) => i.id !== issue.id);
    this.issues.move(issue.id, { sprintId: target.sprint?.id ?? null }, list, event.currentIndex);
  }

  /** Быстрое создание задачи прямо в списке (Enter в поле ввода). */
  protected quickCreate(section: Section, input: HTMLInputElement): void {
    const project = this.project();
    const title = input.value.trim();
    if (!project || !title) return;
    this.issues.create({
      projectId: project.id,
      title,
      type: 'task',
      sprintId: section.sprint?.id ?? null,
      parentId: this.epicFilter(),
    });
    input.value = '';
  }

  protected createSprint(): void {
    const project = this.project();
    if (project) this.sprints.create(project.id);
  }

  protected startSprint(sprint: Sprint): void {
    if (this.hasActiveSprint()) {
      this.toasts.error('Сначала завершите активный спринт');
      return;
    }
    this.dialogs.open(SprintFormDialog, { sprint, mode: 'start' });
  }

  protected editSprint(sprint: Sprint): void {
    this.dialogs.open(SprintFormDialog, { sprint, mode: 'edit' });
  }

  protected completeSprint(sprint: Sprint): void {
    this.dialogs.open(SprintCompleteDialog, sprint);
  }

  protected async removeSprint(sprint: Sprint): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: `Удалить ${sprint.name}?`,
      message: 'Задачи спринта вернутся в бэклог. Сами задачи не удалятся.',
      confirmLabel: 'Удалить спринт',
      danger: true,
    });
    if (ok) this.sprints.remove(sprint.id);
  }
}
