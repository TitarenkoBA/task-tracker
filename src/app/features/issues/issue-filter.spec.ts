import { Issue, StatusCategory } from '../../core/models/entities';
import {
  FilterContext,
  activeFilterCount,
  emptyFilter,
  filterIssues,
  matchesQuery,
  sortIssues,
} from './issue-filter';

let n = 0;
function issue(overrides: Partial<Issue> = {}): Issue {
  n++;
  return {
    id: `i${n}`,
    projectId: 'p1',
    number: n,
    type: 'task',
    title: `Задача ${n}`,
    description: '',
    statusId: 'todo',
    priority: 'medium',
    assigneeId: null,
    reporterId: null,
    labels: [],
    storyPoints: null,
    dueDate: null,
    parentId: null,
    sprintId: null,
    order: n,
    createdAt: n,
    updatedAt: n,
    deleted: false,
    clock: {},
    ...overrides,
  };
}

const ctx: FilterContext = {
  key: (i) => `WEB-${i.number}`,
  category: (i) => (i.statusId === 'done' ? 'done' : 'todo') as StatusCategory,
  meId: 'me',
};

describe('issue-filter', () => {
  it('matchesQuery ищет по ключу, названию, описанию и меткам без учёта регистра', () => {
    const i = issue({
      number: 12,
      title: 'Кнопка Войти',
      description: 'Не работает на Android',
      labels: ['mobile'],
    });
    expect(matchesQuery(i, '', 'WEB-12')).toBe(true);
    expect(matchesQuery(i, 'web-12', 'WEB-12')).toBe(true);
    expect(matchesQuery(i, 'войти', 'WEB-12')).toBe(true);
    expect(matchesQuery(i, 'android', 'WEB-12')).toBe(true);
    expect(matchesQuery(i, 'MOB', 'WEB-12')).toBe(true);
    expect(matchesQuery(i, 'ios', 'WEB-12')).toBe(false);
  });

  it('filterIssues комбинирует условия', () => {
    const mine = issue({ assigneeId: 'me', priority: 'high', labels: ['ui'] });
    const done = issue({ assigneeId: 'me', statusId: 'done' });
    const nobody = issue({ type: 'bug' });
    const all = [mine, done, nobody];

    expect(filterIssues(all, { ...emptyFilter(), assignee: 'me' }, ctx)).toEqual([mine, done]);
    expect(filterIssues(all, { ...emptyFilter(), assignee: 'none' }, ctx)).toEqual([nobody]);
    expect(filterIssues(all, { ...emptyFilter(), category: 'done' }, ctx)).toEqual([done]);
    expect(filterIssues(all, { ...emptyFilter(), type: 'bug' }, ctx)).toEqual([nobody]);
    expect(filterIssues(all, { ...emptyFilter(), label: 'ui', priority: 'high' }, ctx)).toEqual([
      mine,
    ]);
  });

  it('фильтр «мои» без текущего пользователя ничего не находит', () => {
    expect(
      filterIssues(
        [issue({ assigneeId: null })],
        { ...emptyFilter(), assignee: 'me' },
        { ...ctx, meId: null },
      ),
    ).toEqual([]);
  });

  it('sortIssues', () => {
    const a = issue({ priority: 'low', dueDate: '2026-12-01', number: 10 });
    const b = issue({ priority: 'highest', dueDate: null, number: 2 });
    const c = issue({ priority: 'medium', dueDate: '2026-11-15', number: 1 });
    const key = ctx.key;
    expect(sortIssues([a, b, c], 'priority', key)).toEqual([b, c, a]);
    expect(sortIssues([a, b, c], 'due', key)).toEqual([c, a, b]);
    expect(sortIssues([a, b, c], 'key', key)).toEqual([c, b, a]);
    expect(sortIssues([a, b, c], 'created', key)).toEqual([c, b, a]);
  });

  it('activeFilterCount не считает текстовый поиск', () => {
    expect(activeFilterCount({ ...emptyFilter(), query: 'x', type: 'bug', assignee: 'me' })).toBe(
      2,
    );
  });
});
