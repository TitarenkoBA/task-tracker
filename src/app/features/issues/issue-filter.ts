import { PRIORITIES } from '../../core/models/catalog';
import {
  EntityId,
  Issue,
  IssuePriority,
  IssueType,
  StatusCategory,
} from '../../core/models/entities';

/** Фильтр списка задач (упрощённый аналог JQL). Пустая строка — «любой». */
export interface IssueFilter {
  query: string;
  projectId: EntityId | '';
  category: StatusCategory | '';
  /** id исполнителя, `none` — не назначен, `me` — я. */
  assignee: EntityId | 'none' | 'me' | '';
  type: IssueType | '';
  priority: IssuePriority | '';
  label: string;
}

export type IssueSort = 'updated' | 'created' | 'priority' | 'due' | 'key';

export const SORT_LABELS: Record<IssueSort, string> = {
  updated: 'Недавно изменённые',
  created: 'Новые',
  priority: 'По приоритету',
  due: 'По сроку',
  key: 'По ключу',
};

export function emptyFilter(): IssueFilter {
  return {
    query: '',
    projectId: '',
    category: '',
    assignee: '',
    type: '',
    priority: '',
    label: '',
  };
}

/** Поиск по ключу, названию, описанию и меткам без учёта регистра. */
export function matchesQuery(issue: Issue, query: string, key: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    key.toLowerCase().includes(q) ||
    issue.title.toLowerCase().includes(q) ||
    issue.description.toLowerCase().includes(q) ||
    issue.labels.some((l) => l.toLowerCase().includes(q))
  );
}

/** Данные, которых нет в самой задаче, но которые нужны фильтру. */
export interface FilterContext {
  key(issue: Issue): string;
  category(issue: Issue): StatusCategory | undefined;
  meId: EntityId | null;
}

export function filterIssues(issues: Issue[], filter: IssueFilter, ctx: FilterContext): Issue[] {
  const assignee = filter.assignee === 'me' ? (ctx.meId ?? '\0') : filter.assignee;
  return issues.filter(
    (i) =>
      (!filter.projectId || i.projectId === filter.projectId) &&
      (!filter.category || ctx.category(i) === filter.category) &&
      (!assignee || (assignee === 'none' ? i.assigneeId === null : i.assigneeId === assignee)) &&
      (!filter.type || i.type === filter.type) &&
      (!filter.priority || i.priority === filter.priority) &&
      (!filter.label || i.labels.includes(filter.label)) &&
      matchesQuery(i, filter.query, ctx.key(i)),
  );
}

export function sortIssues(issues: Issue[], sort: IssueSort, key: (i: Issue) => string): Issue[] {
  const list = [...issues];
  switch (sort) {
    case 'updated':
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt);
    case 'priority':
      return list.sort(
        (a, b) =>
          PRIORITIES[b.priority].weight - PRIORITIES[a.priority].weight ||
          b.updatedAt - a.updatedAt,
      );
    case 'due':
      // Задачи без срока — в конце.
      return list.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    case 'key':
      return list.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
  }
}

/** Сколько фильтров активно (для бейджа на кнопке «Фильтры»). */
export function activeFilterCount(filter: IssueFilter): number {
  return Object.entries(filter).filter(([k, v]) => k !== 'query' && v !== '').length;
}
