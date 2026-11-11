import type { TKey } from '../i18n/ru';
import { IssuePriority, IssueType, ProjectColor, StatusCategory, WorkflowStatus } from './entities';

/**
 * Справочники для отображения: цвета и иконки.
 * Подписи живут в словарях (`core/i18n/ru.ts`, `en.ts`) — см. методы
 * `I18n.issueType()`, `I18n.priority()`, `I18n.category()`.
 */

export interface IssueTypeInfo {
  icon: string;
  /** Классы Tailwind для фона значка. */
  classes: string;
}

export const ISSUE_TYPES: Record<IssueType, IssueTypeInfo> = {
  epic: { icon: 'bolt', classes: 'bg-violet-500 text-white' },
  story: { icon: 'bookmark', classes: 'bg-emerald-500 text-white' },
  task: { icon: 'check', classes: 'bg-sky-500 text-white' },
  bug: { icon: 'bug', classes: 'bg-rose-500 text-white' },
  subtask: { icon: 'subtask', classes: 'bg-cyan-500 text-white' },
};

export const ISSUE_TYPE_LIST = Object.keys(ISSUE_TYPES) as IssueType[];

/** Типы, которые можно выбрать при создании обычной задачи (без подзадачи). */
export const TOP_LEVEL_TYPES: IssueType[] = ['story', 'task', 'bug', 'epic'];

export interface PriorityInfo {
  icon: string;
  classes: string;
  /** Вес для сортировки: больше — важнее. */
  weight: number;
}

export const PRIORITIES: Record<IssuePriority, PriorityInfo> = {
  highest: { icon: 'chevrons-up', classes: 'text-rose-600 dark:text-rose-400', weight: 5 },
  high: { icon: 'chevron-up', classes: 'text-orange-500 dark:text-orange-400', weight: 4 },
  medium: { icon: 'equals', classes: 'text-amber-500 dark:text-amber-400', weight: 3 },
  low: { icon: 'chevron-down', classes: 'text-sky-500 dark:text-sky-400', weight: 2 },
  lowest: { icon: 'chevrons-down', classes: 'text-slate-400', weight: 1 },
};

export const PRIORITY_ORDER: IssuePriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

export const STATUS_CATEGORIES: Record<StatusCategory, { classes: string; dot: string }> = {
  todo: {
    classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  in_progress: {
    classes: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  done: {
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
};

export const STATUS_CATEGORY_LIST = Object.keys(STATUS_CATEGORIES) as StatusCategory[];

/**
 * Статусы нового проекта. Названия берутся на текущем языке и дальше
 * хранятся как данные проекта (их можно переименовать в настройках проекта).
 */
export function defaultStatuses(t: (key: TKey) => string): WorkflowStatus[] {
  return [
    { id: 'todo', name: t('status.todo'), category: 'todo' },
    { id: 'in_progress', name: t('status.in_progress'), category: 'in_progress' },
    { id: 'in_review', name: t('status.in_review'), category: 'in_progress' },
    { id: 'done', name: t('status.done'), category: 'done' },
  ];
}

/** Классы Tailwind для цветов проектов и аватаров. */
export const COLOR_CLASSES: Record<ProjectColor, { solid: string; soft: string }> = {
  indigo: {
    solid: 'bg-indigo-500',
    soft: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  },
  sky: { solid: 'bg-sky-500', soft: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  emerald: {
    solid: 'bg-emerald-500',
    soft: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  amber: {
    solid: 'bg-amber-500',
    soft: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  rose: {
    solid: 'bg-rose-500',
    soft: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  },
  violet: {
    solid: 'bg-violet-500',
    soft: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  },
  teal: {
    solid: 'bg-teal-500',
    soft: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  },
  orange: {
    solid: 'bg-orange-500',
    soft: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  },
};

/** Поля задачи, изменения которых попадают в историю. */
export const TRACKED_FIELDS = [
  'title',
  'description',
  'type',
  'statusId',
  'priority',
  'assigneeId',
  'reporterId',
  'labels',
  'storyPoints',
  'dueDate',
  'parentId',
  'sprintId',
] as const;
