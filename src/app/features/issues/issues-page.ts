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
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { TKey } from '../../core/i18n/ru';
import { ISSUE_TYPE_LIST, PRIORITY_ORDER, STATUS_CATEGORY_LIST } from '../../core/models/catalog';
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
  SORT_LIST,
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
  imports: [PageHeader, IssueRow, Icon, EmptyState, TranslatePipe],
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

  protected readonly i18n = inject(I18n);
  protected readonly typeList = ISSUE_TYPE_LIST;
  protected readonly priorityOrder = PRIORITY_ORDER;
  protected readonly categoryList = STATUS_CATEGORY_LIST;
  protected readonly sortList = SORT_LIST;

  protected sortLabel(sort: IssueSort): TKey {
    return `sort.${sort}` as TKey;
  }

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
