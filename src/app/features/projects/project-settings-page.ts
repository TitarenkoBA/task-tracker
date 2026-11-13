import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { COLOR_CLASSES, STATUS_CATEGORIES, STATUS_CATEGORY_LIST } from '../../core/models/catalog';
import { WorkflowStatus } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { ProjectService } from '../../core/services/project.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { ProjectFormDialog } from './project-form-dialog';
import { ProjectSwitcher } from './project-switcher';
import { CollabButton } from '../collab/collab-button';

/** Настройки проекта: основные данные, статусы (колонки доски), удаление. */
@Component({
  selector: 'app-project-settings-page',
  imports: [
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    PageHeader,
    ProjectSwitcher,
    CollabButton,
    Icon,
    TranslatePipe,
    EmptyState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-settings-page.html',
})
export class ProjectSettingsPage {
  readonly projectKey = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly colors = COLOR_CLASSES;
  protected readonly categoryInfo = STATUS_CATEGORIES;
  protected readonly categoryList = STATUS_CATEGORY_LIST;
  protected readonly i18n = inject(I18n);

  protected readonly project = computed(() => this.projects.byKey(this.projectKey()));

  /** Черновик статусов: редактируется локально, сохраняется кнопкой. */
  protected readonly statuses = linkedSignal(() => structuredClone(this.project()?.statuses ?? []));
  protected readonly dirty = computed(
    () => JSON.stringify(this.statuses()) !== JSON.stringify(this.project()?.statuses ?? []),
  );
  protected readonly counts = computed(() => {
    const map = new Map<string, number>();
    for (const issue of this.issues.issues()) {
      if (issue.projectId === this.project()?.id)
        map.set(issue.statusId, (map.get(issue.statusId) ?? 0) + 1);
    }
    return map;
  });

  constructor() {
    effect(() => {
      const project = this.project();
      if (project) this.projects.select(project.id);
    });
  }

  protected edit(): void {
    this.dialogs.open(ProjectFormDialog, this.project());
  }

  protected patchStatus(index: number, patch: Partial<WorkflowStatus>): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  protected addStatus(): void {
    this.statuses.update((list) => [
      ...list,
      {
        id: crypto.randomUUID().slice(0, 8),
        name: this.i18n.t('projectSettings.newStatus'),
        category: 'in_progress',
      },
    ]);
  }

  protected removeStatus(index: number): void {
    this.statuses.update((list) => list.filter((_, i) => i !== index));
  }

  protected reorder(event: CdkDragDrop<WorkflowStatus[]>): void {
    this.statuses.update((list) => {
      const next = [...list];
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      return next;
    });
  }

  protected saveStatuses(): void {
    const project = this.project();
    if (!project) return;
    const list = this.statuses().map((s) => ({ ...s, name: s.name.trim() }));
    if (list.some((s) => !s.name)) {
      this.toasts.error(this.i18n.t('projectSettings.statusNameRequired'));
      return;
    }
    if (!list.some((s) => s.category === 'done')) {
      this.toasts.error(this.i18n.t('projectSettings.doneRequired'));
      return;
    }
    this.projects.updateStatuses(project.id, list);
    this.toasts.success(this.i18n.t('projectSettings.saved'));
  }

  protected async remove(): Promise<void> {
    const project = this.project();
    if (!project) return;
    const ok = await this.dialogs.confirm({
      title: this.i18n.t('projectSettings.deleteTitle', { name: project.name }),
      message: this.i18n.t('projectSettings.deleteText'),
      confirmLabel: this.i18n.t('projectSettings.delete'),
      danger: true,
    });
    if (!ok) return;
    this.projects.remove(project.id);
    this.toasts.success(this.i18n.t('projectSettings.deleted'));
    void this.router.navigate(['/projects']);
  }
}
