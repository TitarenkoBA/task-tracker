/** Шаг между соседними элементами при добавлении в конец/начало списка. */
export const ORDER_STEP = 1000;

/**
 * Позиция между двумя соседями (дробная индексация).
 *
 * При перетаскивании меняется `order` только у перемещённой задачи,
 * а не у всего списка. Это важно для синхронизации: меньше изменений —
 * меньше конфликтов между устройствами.
 */
export function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return ORDER_STEP;
  if (prev === undefined) return next! - ORDER_STEP;
  if (next === undefined) return prev + ORDER_STEP;
  return (prev + next) / 2;
}

/** Сортировка по полю `order`, при равенстве — по времени создания. */
export function byOrder<T extends { order: number; createdAt: number }>(a: T, b: T): number {
  return a.order - b.order || a.createdAt - b.createdAt;
}
