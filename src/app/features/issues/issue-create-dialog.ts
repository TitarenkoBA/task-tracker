import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ISSUE_TYPES, PRIORITIES, PRIORITY_ORDER, TOP_LEVEL_TYPES } from '../../core/models/catalog';
import { EntityId, Issue, IssuePriority, IssueType } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { SprintService } from '../../core/services/sprint.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogFrame } from '../../shared/dialog/dialog-frame';
import { Icon } from '../../shared/ui/icon';
import { TypeIcon } from '../../shared/ui/issue-badges';
import { LabelsInput } from '../../shared/ui/labels-input';

/** Начальные значения формы (например, при создании из колонки доски). */
export interface IssueCreateData {
  projectId?: EntityId;
  statusId?: string;
  sprintId?: EntityId | null;
  parentId?: EntityId;
  type?: IssueType;
}

@Component({
  selector: 'app-issue-create-dialog',
  imports: [DialogFrame, Icon, TypeIcon, LabelsInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-create-dialog.html',
})
export class IssueCreateDialog {
  private readonly data = inject<IssueCreateData | null>(DIALOG_DATA) ?? {};
  private readonly ref = inject<DialogRef<Issue>>(DialogRef);
  private readonly issues = inject(IssueService);
  private readonly sprints = inject(SprintService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly projects = inject(ProjectService);
  protected readonly people = inject(PeopleService);

  protected readonly typeInfo = ISSUE_TYPES;
  protected readonly priorityInfo = PRIORITIES;
  protected readonly priorityOrder = PRIORITY_ORDER;
  protected readonly isSubtask = this.data.type === 'subtask';
  protected readonly types: IssueType[] = this.isSubtask ? ['subtask'] : TOP_LEVEL_TYPES;

  // Поля формы
  protected readonly projectId = signal(this.data.projectId ?? this.projects.current()?.id ?? '');
  protected readonly type = signal<IssueType>(this.data.type ?? 'task');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly priority = signal<IssuePriority>('medium');
  protected readonly assigneeId = signal<EntityId | null>(null);
  protected readonly labels = signal<string[]>([]);
  protected readonly storyPoints = signal<number | null>(null);
  protected readonly dueDate = signal<string | null>(null);
  protected readonly parentId = signal<EntityId | null>(this.data.parentId ?? null);
  protected readonly sprintId = signal<EntityId | null>(this.data.sprintId ?? null);
  protected readonly createAnother = signal(false);
  protected readonly showMore = signal(false);
  protected readonly submitted = signal(false);

  protected readonly parent = computed(() => this.issues.get(this.data.parentId));
  protected readonly epics = computed(() =>
    this.issues.issues().filter((i) => i.projectId === this.projectId() && i.type === 'epic'),
  );
  protected readonly projectSprints = computed(() =>
    this.sprints.forProject(this.projectId()).filter((s) => s.state !== 'closed'),
  );
  protected readonly titleError = computed(() => this.submitted() && !this.title().trim());

  protected issueKey(issue: Issue): string {
    return this.issues.key(issue);
  }

  protected setNumber(value: string): void {
    this.storyPoints.set(value === '' ? null : Math.max(0, Number(value)));
  }

  protected submit(): void {
    this.submitted.set(true);
    if (!this.title().trim() || !this.projectId()) return;
    try {
      const issue = this.issues.create({
        projectId: this.projectId(),
        type: this.type(),
        title: this.title(),
        description: this.description(),
        priority: this.priority(),
        assigneeId: this.assigneeId(),
        labels: this.labels(),
        storyPoints: this.storyPoints(),
        dueDate: this.dueDate(),
        parentId: this.type() === 'epic' ? null : this.parentId(),
        sprintId: this.type() === 'epic' ? null : this.sprintId(),
        statusId: this.data.statusId,
      });
      const key = this.issues.key(issue);
      this.toasts.show(`Создана задача ${key}`, {
        kind: 'success',
        action: { label: 'Открыть', run: () => void this.router.navigate(['/browse', key]) },
      });
      if (this.createAnother()) {
        this.title.set('');
        this.description.set('');
        this.submitted.set(false);
      } else {
        this.ref.close(issue);
      }
    } catch (error) {
      this.toasts.error((error as Error).message);
    }
  }
}
