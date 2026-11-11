import { IssuePriority, IssueType, ProjectColor, StatusCategory, WorkflowStatus } from './entities';

/**
 * Справочники для отображения: подписи, цвета и иконки.
 * Всё, что видит пользователь, собрано здесь — так проще менять тексты.
 */

export interface IssueTypeInfo {
  label: string;
  icon: string;
  /** Классы Tailwind для фона значка. */
  classes: string;
}

export const ISSUE_TYPES: Record<IssueType, IssueTypeInfo> = {
  epic: { label: 'Эпик', icon: 'bolt', classes: 'bg-violet-500 text-white' },
  story: { label: 'История', icon: 'bookmark', classes: 'bg-emerald-500 text-white' },
  task: { label: 'Задача', icon: 'check', classes: 'bg-sky-500 text-white' },
  bug: { label: 'Баг', icon: 'bug', classes: 'bg-rose-500 text-white' },
  subtask: { label: 'Подзадача', icon: 'subtask', classes: 'bg-cyan-500 text-white' },
};

/** Типы, которые можно выбрать при создании обычной задачи (без подзадачи). */
export const TOP_LEVEL_TYPES: IssueType[] = ['story', 'task', 'bug', 'epic'];

export interface PriorityInfo {
  label: string;
  icon: string;
  classes: string;
  /** Вес для сортировки: больше — важнее. */
  weight: number;
}

export const PRIORITIES: Record<IssuePriority, PriorityInfo> = {
  highest: { label: 'Наивысший', icon: 'chevrons-up', classes: 'text-rose-600 dark:text-rose-400', weight: 5 },
  high: { label: 'Высокий', icon: 'chevron-up', classes: 'text-orange-500 dark:text-orange-400', weight: 4 },
  medium: { label: 'Средний', icon: 'equals', classes: 'text-amber-500 dark:text-amber-400', weight: 3 },
  low: { label: 'Низкий', icon: 'chevron-down', classes: 'text-sky-500 dark:text-sky-400', weight: 2 },
  lowest: { label: 'Наинизший', icon: 'chevrons-down', classes: 'text-slate-400', weight: 1 },
};

export const PRIORITY_ORDER: IssuePriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

export const STATUS_CATEGORIES: Record<StatusCategory, { label: string; classes: string; dot: string }> = {
  todo: {
    label: 'К выполнению',
    classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  in_progress: {
    label: 'В работе',
    classes: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  done: {
    label: 'Готово',
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
};

/** Статусы нового проекта. */
export function defaultStatuses(): WorkflowStatus[] {
  return [
    { id: 'todo', name: 'К выполнению', category: 'todo' },
    { id: 'in_progress', name: 'В работе', category: 'in_progress' },
    { id: 'in_review', name: 'На проверке', category: 'in_progress' },
    { id: 'done', name: 'Готово', category: 'done' },
  ];
}

/** Классы Tailwind для цветов проектов и аватаров. */
export const COLOR_CLASSES: Record<ProjectColor, { solid: string; soft: string }> = {
  indigo: { solid: 'bg-indigo-500', soft: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  sky: { solid: 'bg-sky-500', soft: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  emerald: { solid: 'bg-emerald-500', soft: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  amber: { solid: 'bg-amber-500', soft: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  rose: { solid: 'bg-rose-500', soft: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
  violet: { solid: 'bg-violet-500', soft: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  teal: { solid: 'bg-teal-500', soft: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' },
  orange: { solid: 'bg-orange-500', soft: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
};

/** Подписи полей задачи для истории изменений. */
export const FIELD_LABELS: Record<string, string> = {
  title: 'Название',
  description: 'Описание',
  type: 'Тип',
  statusId: 'Статус',
  priority: 'Приоритет',
  assigneeId: 'Исполнитель',
  reporterId: 'Автор',
  labels: 'Метки',
  storyPoints: 'Story points',
  dueDate: 'Срок',
  parentId: 'Родитель',
  sprintId: 'Спринт',
};
