const shortDate = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

/** Сегодняшняя дата в формате `YYYY-MM-DD` по местному времени. */
export function todayIso(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** `2026-11-11` → «11 нояб.» */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(`${iso}T00:00:00`));
}

/** `2026-11-11` → «11 ноября 2026 г.» */
export function formatFullDate(iso: string): string {
  return fullDate.format(new Date(`${iso}T00:00:00`));
}

export function formatDateTime(ms: number): string {
  return dateTime.format(ms);
}

/** «5 минут назад», «вчера», «3 дня назад». */
export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'только что';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), 'day');
  return dateTime.format(ms);
}

/** Состояние срока: просрочено, сегодня/завтра или ничего особенного. */
export function dueState(dueDate: string | null, done: boolean, today = todayIso()): 'overdue' | 'soon' | null {
  if (!dueDate || done) return null;
  if (dueDate < today) return 'overdue';
  const tomorrow = todayIso(new Date(new Date(`${today}T12:00:00`).getTime() + 86_400_000));
  return dueDate <= tomorrow ? 'soon' : null;
}
