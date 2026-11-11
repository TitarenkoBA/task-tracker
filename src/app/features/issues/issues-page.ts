import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  ISSUE_TYPES,
  PRIORITIES,
  PRIORITY_ORDER,
  STATUS_CATEGORIES,
} from '../../core/models/catalog';
import { IssueType, StatusCategory } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { ActionsService } from '../actions.service';
import {
  IssueFilter,
  IssueSort,
  SORT_LABELS,
  activeFilterCount,
  emptyFilter,
  filterIssues,
  sortIssues,
} from './issue-filter';
import { IssueRow } from './issue-row';
import { IssuesFilterState } from './issues-filter-state';

const PAGE_SIZE = 100;

@Component({
  selector: 'app-issues-page',
  imports: [PageHeader, IssueRow, Icon, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issues-page.html',
})
export class IssuesPage {
  /** `?focus=1` — сразу поставить курсор в поиск (горячая клавиша `/`). */
  readonly focus = input<string>();

  private readonly issues = inject(IssueService);
  protected readonly projects = inject(ProjectService);
  protected readonly people = inject(PeopleService);
  protected readonly actions = inject(ActionsService);
  protected readonly state = inject(IssuesFilterState);

  protected readonly typeInfo = ISSUE_TYPES;
  protected readonly typeList = Object.keys(ISSUE_TYPES) as IssueType[];
  protected readonly priorityInfo = PRIORITIES;
  protected readonly priorityOrder = PRIORITY_ORDER;
  protected readonly categoryInfo = STATUS_CATEGORIES;
  protected readonly categoryList = Object.keys(STATUS_CATEGORIES) as StatusCategory[];
  protected readonly sortLabels = SORT_LABELS;
  protected readonly sortList = Object.keys(SORT_LABELS) as IssueSort[];

  protected readonly limit = signal(PAGE_SIZE);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly allLabels = computed(() =>
    [...new Set(this.issues.issues().flatMap((i) => i.labels))].sort(),
  );

  protected readonly results = computed(() => {
    const key = (i: Parameters<IssueService['key']>[0]) => this.issues.key(i);
    const filtered = filterIssues(this.issues.issues(), this.state.filter(), {
      key,
      category: (i) => this.issues.status(i)?.category,
      meId: this.people.me()?.id ?? null,
    });
    return sortIssues(filtered, this.state.sort(), key);
  });
  protected readonly visible = computed(() => this.results().slice(0, this.limit()));
  protected readonly filterCount = computed(() => activeFilterCount(this.state.filter()));

  constructor() {
    afterNextRender(() => {
      if (this.focus()) this.searchField()?.nativeElement.focus();
    });
  }

  protected set<K extends keyof IssueFilter>(key: K, value: IssueFilter[K]): void {
    this.state.filter.update((f) => ({ ...f, [key]: value }));
    this.limit.set(PAGE_SIZE);
  }

  protected reset(): void {
    this.state.filter.set(emptyFilter());
  }
}
