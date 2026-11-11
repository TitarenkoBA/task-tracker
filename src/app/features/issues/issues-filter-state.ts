import { Injectable, signal } from '@angular/core';
import { IssueFilter, IssueSort, emptyFilter } from './issue-filter';

/**
 * Состояние фильтров страницы «Задачи». Живёт в сервисе, а не в компоненте,
 * чтобы фильтры не сбрасывались при переходе в задачу и обратно.
 */
@Injectable({ providedIn: 'root' })
export class IssuesFilterState {
  readonly filter = signal<IssueFilter>(emptyFilter());
  readonly sort = signal<IssueSort>('updated');
  readonly panelOpen = signal(false);
}
