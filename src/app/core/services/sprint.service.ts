import { Injectable, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { I18n } from '../i18n/i18n.service';
import { EntityId, Sprint } from '../models/entities';
import { IssueService } from './issue.service';
import { ProjectService } from './project.service';

const STATE_ORDER: Record<Sprint['state'], number> = { active: 0, planned: 1, closed: 2 };

/** Спринты: планирование, старт и завершение. */
@Injectable({ providedIn: 'root' })
export class SprintService {
  private readonly store = inject(DataStore);
  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly i18n = inject(I18n);

  readonly sprints = this.store.list('sprints');

  get(id: EntityId | null | undefined): Sprint | undefined {
    return this.store.get('sprints', id);
  }

  /** Спринты проекта: активный, затем запланированные, затем закрытые. */
  forProject(projectId: EntityId): Sprint[] {
    return this.sprints()
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.createdAt - b.createdAt);
  }

  active(projectId: EntityId): Sprint | undefined {
    return this.sprints().find((s) => s.projectId === projectId && s.state === 'active');
  }

  create(projectId: EntityId, name?: string): Sprint {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(this.i18n.t('error.projectNotFound'));
    const count = this.store
      .list('sprints')()
      .filter((s) => s.projectId === projectId).length;
    return this.store.create('sprints', {
      projectId,
      name: name?.trim() || this.i18n.t('sprint.defaultName', { key: project.key, n: count + 1 }),
      goal: '',
      state: 'planned',
      startDate: null,
      endDate: null,
    });
  }

  update(
    id: EntityId,
    patch: Partial<Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate'>>,
  ): void {
    this.store.update('sprints', id, patch);
  }

  /** Запустить спринт. В проекте может быть только один активный спринт. */
  start(id: EntityId, dates: { startDate: string; endDate: string }): void {
    const sprint = this.get(id);
    if (!sprint) throw new Error(this.i18n.t('error.sprintNotFound'));
    if (this.active(sprint.projectId)) throw new Error(this.i18n.t('error.sprintActive'));
    if (dates.endDate < dates.startDate) throw new Error(this.i18n.t('error.sprintDates'));
    this.store.update('sprints', id, { ...dates, state: 'active' });
  }

  /**
   * Завершить спринт. Незавершённые задачи переносятся в другой
   * спринт или в бэклог (`moveTo = null`).
   * @returns количество перенесённых задач
   */
  complete(id: EntityId, moveTo: EntityId | null): number {
    const unfinished = this.issues
      .issues()
      .filter((i) => i.sprintId === id && !this.issues.isDone(i));
    for (const issue of unfinished) this.issues.update(issue.id, { sprintId: moveTo });
    this.store.update('sprints', id, { state: 'closed' });
    return unfinished.length;
  }

  /** Удалить спринт; его задачи возвращаются в бэклог. */
  remove(id: EntityId): void {
    for (const issue of this.issues.issues()) {
      if (issue.sprintId === id) this.issues.update(issue.id, { sprintId: null });
    }
    this.store.remove('sprints', id);
  }
}
