import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { PRIORITY_ORDER, STATUS_CATEGORIES, TOP_LEVEL_TYPES } from '../../core/models/catalog';
import { Activity, Comment, EntityPatch, Issue } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { SprintService } from '../../core/services/sprint.service';
import { ToastService } from '../../core/services/toast.service';
import { formatDateTime, formatRelative } from '../../core/utils/dates';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Avatar } from '../../shared/ui/avatar';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { TypeIcon } from '../../shared/ui/issue-badges';
import { LabelsInput } from '../../shared/ui/labels-input';
import { Markdown } from '../../shared/ui/markdown';
import { MarkdownEditor } from '../../shared/ui/markdown-editor';
import { ActionsService } from '../actions.service';
import { IssueRow } from './issue-row';

/** Страница задачи: `/browse/WEB-12`. Все поля редактируются на месте и сохраняются сразу. */
@Component({
  selector: 'app-issue-detail-page',
  imports: [
    RouterLink,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    Avatar,
    EmptyState,
    Icon,
    TypeIcon,
    LabelsInput,
    IssueRow,
    Markdown,
    MarkdownEditor,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-detail-page.html',
})
export class IssueDetailPage {
  /** Ключ задачи из URL. */
  readonly issueKey = input.required<string>();

  private readonly issues = inject(IssueService);
  protected readonly projects = inject(ProjectService);
  private readonly sprints = inject(SprintService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly i18n = inject(I18n);
  protected readonly people = inject(PeopleService);
  protected readonly actions = inject(ActionsService);

  protected readonly priorityOrder = PRIORITY_ORDER;
  protected readonly topLevelTypes = TOP_LEVEL_TYPES;
  protected readonly categories = STATUS_CATEGORIES;

  protected readonly issue = computed(() => this.issues.byKey(this.issueKey()));
  protected readonly project = computed(() => this.projects.get(this.issue()?.projectId));
  protected readonly key = computed(() => {
    const issue = this.issue();
    return issue ? this.issues.key(issue) : this.issueKey();
  });
  protected readonly status = computed(() => {
    const issue = this.issue();
    return issue ? this.issues.status(issue) : undefined;
  });
  protected readonly parent = computed(() => this.issues.get(this.issue()?.parentId));
  protected readonly children = computed(() => {
    const issue = this.issue();
    return issue ? this.issues.children(issue.id).sort((a, b) => a.number - b.number) : [];
  });
  protected readonly childProgress = computed(() => {
    const list = this.children();
    const done = list.filter((c) => this.issues.isDone(c)).length;
    return {
      done,
      total: list.length,
      percent: list.length ? Math.round((done / list.length) * 100) : 0,
    };
  });
  protected readonly epics = computed(() =>
    this.issues
      .issues()
      .filter((i) => i.projectId === this.issue()?.projectId && i.type === 'epic'),
  );
  protected readonly projectSprints = computed(() => {
    const issue = this.issue();
    if (!issue) return [];
    // Закрытый спринт показываем, только если задача в нём.
    return this.sprints
      .forProject(issue.projectId)
      .filter((s) => s.state !== 'closed' || s.id === issue.sprintId);
  });

  protected readonly comments = computed(() =>
    this.issues
      .comments()
      .filter((c) => c.issueId === this.issue()?.id)
      .sort((a, b) => a.createdAt - b.createdAt),
  );
  protected readonly history = computed(() =>
    this.issues
      .activity()
      .filter((a) => a.issueId === this.issue()?.id)
      .sort((a, b) => b.createdAt - a.createdAt),
  );

  protected readonly tab = signal<'comments' | 'history'>('comments');
  /** Черновик описания; `null` — описание не редактируется. */
  protected readonly descriptionDraft = signal<string | null>(null);
  protected readonly commentDraft = signal('');
  protected readonly editingCommentId = signal<string | null>(null);
  protected readonly commentEditDraft = signal('');

  protected readonly formatDateTime = formatDateTime;
  protected readonly formatRelative = formatRelative;

  // ---------------------------------------------------------------------------

  protected save(patch: EntityPatch<Issue>): void {
    const issue = this.issue();
    if (!issue) return;
    try {
      this.issues.update(issue.id, patch);
    } catch (error) {
      this.toasts.error((error as Error).message);
    }
  }

  protected saveTitle(field: HTMLTextAreaElement): void {
    const title = field.value.replace(/\s+/g, ' ').trim();
    if (!title) {
      field.value = this.issue()?.title ?? '';
      return;
    }
    this.save({ title });
  }

  // Описание ---------------------------------------------------------------

  protected editDescription(): void {
    this.descriptionDraft.set(this.issue()?.description ?? '');
  }

  /** Клик по описанию открывает редактор, но клик по ссылке — просто переходит по ней. */
  protected onDescriptionClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a')) return;
    this.editDescription();
  }

  protected saveDescription(): void {
    const draft = this.descriptionDraft();
    if (draft === null) return;
    this.save({ description: draft.trim() });
    this.descriptionDraft.set(null);
  }

  protected setPoints(value: string): void {
    this.save({ storyPoints: value === '' ? null : Math.max(0, Number(value)) });
  }

  protected assignToMe(): void {
    const me = this.people.me();
    if (me) this.save({ assigneeId: me.id });
  }

  // Дочерние задачи --------------------------------------------------------

  protected addSubtask(input: HTMLInputElement): void {
    const issue = this.issue();
    const title = input.value.trim();
    if (!issue || !title) return;
    this.issues.create({ projectId: issue.projectId, type: 'subtask', title, parentId: issue.id });
    input.value = '';
  }

  protected toggleChildDone(child: Issue): void {
    const project = this.project();
    if (!project) return;
    const target = this.issues.isDone(child)
      ? project.statuses.find((s) => s.category === 'todo')
      : project.statuses.find((s) => s.category === 'done');
    if (target) this.issues.update(child.id, { statusId: target.id });
  }

  protected isDone(issue: Issue): boolean {
    return this.issues.isDone(issue);
  }

  protected childRouteKey(issue: Issue): string {
    return this.issues.routeKey(issue);
  }

  protected childKey(issue: Issue): string {
    return this.issues.key(issue);
  }

  // Комментарии ------------------------------------------------------------

  protected addComment(): void {
    const issue = this.issue();
    if (!issue || !this.commentDraft().trim()) return;
    this.issues.addComment(issue.id, this.commentDraft());
    this.commentDraft.set('');
  }

  protected editComment(comment: Comment): void {
    this.commentEditDraft.set(comment.body);
    this.editingCommentId.set(comment.id);
  }

  protected saveComment(comment: Comment): void {
    this.issues.updateComment(comment.id, this.commentEditDraft());
    this.editingCommentId.set(null);
  }

  protected async removeComment(comment: Comment): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: this.i18n.t('issue.removeCommentTitle'),
      message: this.i18n.t('issue.irreversible'),
      confirmLabel: this.i18n.t('common.delete'),
      danger: true,
    });
    if (ok) this.issues.removeComment(comment.id);
  }

  protected personName(id: string | null): string {
    return this.people.get(id)?.name ?? this.i18n.t('common.someone');
  }

  protected describe(entry: Activity): string {
    switch (entry.kind) {
      case 'created':
        return this.i18n.t('issue.activityCreated');
      case 'commented':
        return this.i18n.t('issue.activityCommented');
      default:
        return this.i18n.t('issue.activityChanged', { field: this.i18n.field(entry.field ?? '') });
    }
  }

  // Действия ---------------------------------------------------------------

  protected back(): void {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/']);
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.toasts.success(this.i18n.t('issue.linkCopied'));
    } catch {
      this.toasts.error(this.i18n.t('issue.linkFailed'));
    }
  }

  protected async remove(): Promise<void> {
    const issue = this.issue();
    if (!issue) return;
    const subtasks = this.children().filter((c) => c.type === 'subtask').length;
    const ok = await this.dialogs.confirm({
      title: this.i18n.t('issue.removeTitle', { key: this.key() }),
      message: subtasks
        ? this.i18n.t('issue.removeWithSubtasks', { count: subtasks })
        : this.i18n.t('issue.removeText'),
      confirmLabel: this.i18n.t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    const project = this.project();
    const key = this.key();
    this.issues.remove(issue.id);
    this.toasts.success(this.i18n.t('issue.removed', { key }));
    void this.router.navigate(project ? ['/p', this.projects.routeKey(project), 'board'] : ['/']);
  }
}
