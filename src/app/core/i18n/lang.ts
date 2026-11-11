import { signal } from '@angular/core';

/** Поддерживаемые языки интерфейса. */
export type Lang = 'ru' | 'en';

export const LANGUAGES: { code: Lang; label: string; locale: string }[] = [
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
  { code: 'en', label: 'English', locale: 'en-US' },
];

/**
 * Текущий язык. Вынесен в отдельный модуль (а не только в сервис),
 * чтобы функции форматирования дат могли читать его без DI.
 * Менять его нужно через `I18n.set()`.
 */
export const currentLang = signal<Lang>('ru');

export function localeOf(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-US';
}

/** Язык по умолчанию — язык браузера, если мы его поддерживаем, иначе английский. */
export function detectLang(): Lang {
  const browser = (globalThis.navigator?.language ?? '').toLowerCase();
  return browser.startsWith('ru') ? 'ru' : 'en';
}
