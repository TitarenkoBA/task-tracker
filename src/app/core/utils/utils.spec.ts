import { currentLang } from '../i18n/lang';
import { dueState, formatRelative, todayIso } from './dates';
import { ORDER_STEP, byOrder, orderBetween } from './order';

describe('orderBetween', () => {
  it('пустой список', () => expect(orderBetween(undefined, undefined)).toBe(ORDER_STEP));
  it('в начало', () => expect(orderBetween(undefined, 500)).toBe(500 - ORDER_STEP));
  it('в конец', () => expect(orderBetween(500, undefined)).toBe(500 + ORDER_STEP));
  it('между соседями', () => expect(orderBetween(1000, 2000)).toBe(1500));

  it('byOrder сортирует по order, затем по дате создания', () => {
    const list = [
      { id: 'c', order: 2, createdAt: 1 },
      { id: 'b', order: 1, createdAt: 2 },
      { id: 'a', order: 1, createdAt: 1 },
    ];
    expect(list.sort(byOrder).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('даты', () => {
  // Язык — глобальный сигнал; другие тесты могли переключить его на английский.
  beforeEach(() => currentLang.set('ru'));

  it('todayIso возвращает местную дату', () => {
    expect(todayIso(new Date(2026, 10, 11, 23, 30))).toBe('2026-11-11');
  });

  it('dueState', () => {
    const today = '2026-11-11';
    expect(dueState(null, false, today)).toBeNull();
    expect(dueState('2026-11-10', false, today)).toBe('overdue');
    expect(dueState('2026-11-10', true, today)).toBeNull();
    expect(dueState('2026-11-11', false, today)).toBe('soon');
    expect(dueState('2026-11-12', false, today)).toBe('soon');
    expect(dueState('2026-11-20', false, today)).toBeNull();
  });

  it('formatRelative', () => {
    const now = Date.now();
    expect(formatRelative(now - 10_000, now)).toBe('только что');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 минут назад');
    expect(formatRelative(now - 86_400_000, now)).toBe('вчера');
  });
});
