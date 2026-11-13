import { Injectable, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { I18n } from '../i18n/i18n.service';
import { TRACKED_FIELDS } from '../models/catalog';
import {
  Activity,
  Comment,
  EntityId,
  EntityPatch,
  Issue,
  IssuePriority,
  IssueType,
  WorkflowStatus,
} from '../models/entities';
import { ORDER_STEP, orderBetween } from '../utils/order';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';

export interface IssueInput {
  projectId: EntityId;
  title: string;
  type?: IssueType;
  description?: string;
  statusId?: string;
  priority?: IssuePriority;
  assigneeId?: EntityId | null;
  labels?: string[];
  storyPoints?: number | null;
  dueDate?: string | null;
  parentId?: EntityId | null;
  sprintId?: EntityId | null;
}

/** Куда переместить задачу (статус и/или спринт). */
export interface MoveTarget {
  statusId?: string;
  sprintId?: EntityId | null;
}

/** `WEB-12` или `WEB~a1b2c3-12` (см. ProjectService.routeKey). */
const ISSUE_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9}(?:~[0-9a-fA-F]{1,32})?)-(\d+)$/;

/** Бизнес-логика задач: создание, изменение, перемещение, комментарии, история. */
@Injectable({ providedIn: 'root' })
export class IssueService {
  private readonly store = inject(DataStore);
  private readonly projects = inject(ProjectService);
  private readonly people = inject(PeopleService);
  private readonly i18n = inject(I18n);

  /** Все живые задачи (реактивно). */
  readonly issues = this.store.list('issues');
  readonly comments = this.store.list('comments');
  readonly activity = this.store.list('activity');

  get(id: EntityId | null | undefined): Issue | undefined {
    return this.store.get('issues', id);
  }

  /** Ключ задачи, например `WEB-12`. */
  key(issue: Issue): string {
    return `${this.projects.get(issue.projectId)?.key ?? '?'}-${issue.number}`;
  }

  /** Ключ задачи для адреса страницы: однозначный, даже если у двух проектов одинаковые ключи. */
  routeKey(issue: Issue): string {
    const project = this.projects.get(issue.projectId);
    return `${project ? this.projects.routeKey(project) : '?'}-${issue.number}`;
  }

  byKey(key: string): Issue | undefined {
    const match = ISSUE_KEY_PATTERN.exec(key.trim());
    if (!match) return undefined;
    const project = this.projects.byKey(match[1]);
    const number = Number(match[2]);
    return project && this.issues().find((i) => i.projectId === project.id && i.number === number);
  }

  status(issue: Issue): WorkflowStatus | undefined {
    return this.projects.get(issue.projectId)?.statuses.find((s) => s.id === issue.statusId);
  }

  isDone(issue: Issue): boolean {
    return this.status(issue)?.category === 'done';
  }

  /** Дочерние задачи: подзадачи задачи или задачи эпика. */
  children(parentId: EntityId): Issue[] {
    return this.issues().filter((i) => i.parentId === parentId);
  }

  // ---------------------------------------------------------------------------
  // Создание и изменение
  // ---------------------------------------------------------------------------

  create(input: IssueInput): Issue {
    const project = this.projects.get(input.projectId);
    if (!project) throw new Error(this.i18n.t('error.projectNotFound'));
    const title = input.title.trim();
    if (!title) throw new Error(this.i18n.t('error.titleRequired'));

    const parent = this.get(input.parentId);
    const type = input.type ?? 'task';
    if (type === 'subtask' && !parent) throw new Error(this.i18n.t('error.subtaskParent'));

    const projectOrders = this.issues()
      .filter((i) => i.projectId === project.id)
      .map((i) => i.order);

    const issue = this.store.create('issues', {
      projectId: project.id,
      number: this.projects.nextIssueNumber(project.id),
      type,
      title,
      description: input.description?.trim() ?? '',
      statusId: input.statusId ?? project.statuses[0].id,
      priority: input.priority ?? 'medium',
      assigneeId: input.assigneeId ?? null,
      reporterId: this.people.me()?.id ?? null,
      labels: normalizeLabels(input.labels ?? []),
      storyPoints: input.storyPoints ?? null,
      dueDate: input.dueDate ?? null,
      parentId: parent?.id ?? null,
      // Подзадача всегда в том же спринте, что и родитель.
      sprintId: type === 'subtask' ? (parent?.sprintId ?? null) : (input.sprintId ?? null),
      order: projectOrders.length ? Math.max(...projectOrders) + ORDER_STEP : ORDER_STEP,
    });
    this.log(issue.id, 'created', null, null, null);
    return issue;
  }

  update(id: EntityId, patch: EntityPatch<Issue>): Issue | undefined {
    const before = this.get(id);
    if (!before) return undefined;
    if (patch.title !== undefined && !patch.title.trim())
      throw new Error(this.i18n.t('error.titleEmpty'));
    if (patch.labels) patch = { ...patch, labels: normalizeLabels(patch.labels) };

    const after = this.store.update('issues', id, patch);
    if (!after) return undefined;

    for (const field of TRACKED_FIELDS) {
      if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
      const describe =
        field === 'description' ? () => null : (v: unknown) => this.describe(field, v, after);
      this.log(id, 'changed', field, describe(before[field]), describe(after[field]));
    }

    // Подзадачи следуют за родителем при смене спринта.
    if (before.sprintId !== after.sprintId) {
      for (const child of this.children(id)) {
        if (child.type === 'subtask')
          this.store.update('issues', child.id, { sprintId: after.sprintId });
      }
    }
    return after;
  }

  /**
   * Переместить задачу (drag-and-drop).
   * @param list   задачи целевого списка в порядке отображения, БЕЗ перемещаемой
   * @param index  позиция, куда её вставить
   */
  move(id: EntityId, target: MoveTarget, list: Issue[], index: number): void {
    const order = orderBetween(list[index - 1]?.order, list[index]?.order);
    this.update(id, { ...target, order });
  }

  /**
   * Разрешить одинаковые номера задач в проекте. Они появляются, когда два устройства
   * одновременно (или офлайн) создали задачу. Все участники выбирают «победителя»
   * одинаково — более раннюю задачу (при равенстве — с меньшим id), — а остальным
   * выдают новые номера.
   * @returns сколько задач перенумеровано
   */
  resolveNumberConflicts(projectId: EntityId): number {
    const byNumber = new Map<number, Issue[]>();
    for (const issue of this.issues()) {
      if (issue.projectId !== projectId) continue;
      byNumber.set(issue.number, [...(byNumber.get(issue.number) ?? []), issue]);
    }
    let renumbered = 0;
    for (const group of byNumber.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      for (const issue of group.slice(1)) {
        this.store.update('issues', issue.id, { number: this.projects.nextIssueNumber(projectId) });
        renumbered++;
      }
    }
    return renumbered;
  }

  /** Удалить задачу. Подзадачи удаляются, у задач эпика просто снимается связь. */
  remove(id: EntityId): void {
    for (const child of this.children(id)) {
      if (child.type === 'subtask') this.remove(child.id);
      else this.store.update('issues', child.id, { parentId: null });
    }
    for (const comment of this.comments()) {
      if (comment.issueId === id) this.store.remove('comments', comment.id);
    }
    this.store.remove('issues', id);
  }

  // ---------------------------------------------------------------------------
  // Комментарии и история
  // ---------------------------------------------------------------------------

  addComment(issueId: EntityId, body: string): Comment | undefined {
    const text = body.trim();
    if (!text) return undefined;
    const comment = this.store.create('comments', {
      issueId,
      authorId: this.people.me()?.id ?? null,
      body: text,
    });
    this.log(issueId, 'commented', null, null, null);
    return comment;
  }

  updateComment(id: EntityId, body: string): void {
    const text = body.trim();
    if (text) this.store.update('comments', id, { body: text });
  }

  removeComment(id: EntityId): void {
    this.store.remove('comments', id);
  }

  private log(
    issueId: EntityId,
    kind: Activity['kind'],
    field: string | null,
    from: string | null,
    to: string | null,
  ): void {
    this.store.create('activity', {
      issueId,
      actorId: this.people.me()?.id ?? null,
      kind,
      field,
      from,
      to,
    });
  }

  /**
   * Значение поля для истории. Имена статусов, людей и спринтов сохраняются текстом,
   * чтобы история оставалась понятной, даже если их удалят. Приоритет и тип —
   * кодом (high, ug): их подпись переводится при показе (I18n.historyValue).
   */
  private describe(field: keyof Issue, value: unknown, issue: Issue): string | null {
    if (value === null || value === undefined || value === '') return null;
    switch (field) {
      case 'statusId':
        return (
          this.projects.get(issue.projectId)?.statuses.find((s) => s.id === value)?.name ??
          String(value)
        );
      case 'assigneeId':
      case 'reporterId':
        return this.people.get(value as string)?.name ?? '—';
      case 'sprintId':
        return this.store.get('sprints', value as string)?.name ?? '—';
      case 'parentId': {
        const parent = this.get(value as string);
        return parent ? this.key(parent) : '—';
      }
      case 'labels':
        return (value as string[]).join(', ') || null;
      default:
        return String(value);
    }
  }
}

/** Метки: без пробелов по краям, без дублей, без пустых. */
export function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean))];
}
