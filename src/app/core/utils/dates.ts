import { currentLang, localeOf } from '../i18n/lang';

/**
 * Форматирование дат на текущем языке интерфейса.
 * Функции читают сигнал `currentLang`, поэтому шаблоны и computed,
 * которые их вызывают, обновятся сами при смене языка.
 */

const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = localeOf(currentLang());
  const key = `${locale}|${JSON.stringify(options)}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale, options));
  return cache.get(key) as Intl.DateTimeFormat;
}

function relativeFormat(): Intl.RelativeTimeFormat {
  const locale = localeOf(currentLang());
  const key = `${locale}|relative`;
  if (!cache.has(key)) cache.set(key, new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  return cache.get(key) as Intl.RelativeTimeFormat;
}

const JUST_NOW = { ru: 'только что', en: 'just now' };

/** Сегодняшняя дата в формате `YYYY-MM-DD` по местному времени. */
export function todayIso(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** `2026-11-11` → «11 нояб.» / «Nov 11» */
export function formatShortDate(iso: string): string {
  return dateFormat({ day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00`));
}

/** `2026-11-11` → «11 ноября 2026 г.» / «November 11, 2026» */
export function formatFullDate(iso: string): string {
  return dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );
}

export function formatDateTime(ms: number): string {
  return dateFormat({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    ms,
  );
}

/** «Среда, 11 ноября» / «Wednesday, November 11» */
export function formatWeekday(date = new Date()): string {
  return dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

/** «5 минут назад», «вчера», «3 дня назад». */
export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  const relative = relativeFormat();
  if (abs < 45) return JUST_NOW[currentLang()];
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDateTime(ms);
}

/** Состояние срока: просрочено, сегодня/завтра или ничего особенного. */
export function dueState(
  dueDate: string | null,
  done: boolean,
  today = todayIso(),
): 'overdue' | 'soon' | null {
  if (!dueDate || done) return null;
  if (dueDate < today) return 'overdue';
  const tomorrow = todayIso(new Date(new Date(`${today}T12:00:00`).getTime() + 86_400_000));
  return dueDate <= tomorrow ? 'soon' : null;
}
