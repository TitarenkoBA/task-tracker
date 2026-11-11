import { DOCUMENT, Injectable, Pipe, PipeTransform, inject } from '@angular/core';
import { IssuePriority, IssueType, StatusCategory } from '../models/entities';
import { SettingsService } from '../services/settings.service';
import { en } from './en';
import { Lang, currentLang, detectLang, localeOf } from './lang';
import { Entry, TKey, ru } from './ru';

export type TParams = Record<string, string | number>;

const DICTIONARIES: Record<Lang, Record<TKey, Entry>> = { ru, en };

/**
 * Переводы интерфейса.
 *
 * Язык — сигнал, поэтому всё, что прочитало перевод (шаблоны, computed),
 * перерисуется само при переключении языка, без перезагрузки страницы.
 *
 * В TypeScript: `i18n.t('issue.removed', { key })`.
 * В шаблоне: `{{ 'nav.settings' | t }}` или `{{ 'issues.found' | t: { count: n } }}`.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);

  readonly lang = currentLang.asReadonly();

  constructor() {
    this.apply(this.settings.language() ?? detectLang());
  }

  /** Локаль для Intl (`ru-RU`, `en-US`). */
  locale(): string {
    return localeOf(this.lang());
  }

  set(lang: Lang): void {
    this.settings.set('language', lang);
    this.apply(lang);
  }

  t(key: TKey, params?: TParams): string {
    const lang = this.lang();
    const entry = DICTIONARIES[lang][key] ?? ru[key] ?? key;
    let text: string;
    if (typeof entry === 'string') {
      text = entry;
    } else {
      const count = Number(params?.['count'] ?? 0);
      const form = new Intl.PluralRules(localeOf(lang)).select(count);
      text = entry[form] ?? entry.other;
    }
    return params ? interpolate(text, params) : text;
  }

  // Подписи значений из справочников ---------------------------------------

  issueType(type: IssueType): string {
    return this.t(`issueType.${type}` as TKey);
  }

  priority(priority: IssuePriority): string {
    return this.t(`priority.${priority}` as TKey);
  }

  category(category: StatusCategory): string {
    return this.t(`category.${category}` as TKey);
  }

  /** Подпись поля задачи для истории изменений. Неизвестное поле возвращается как есть. */
  field(field: string): string {
    const key = `field.${field}` as TKey;
    return key in ru ? this.t(key) : field;
  }

  /**
   * Значение из истории изменений. Приоритет и тип хранятся кодом (`high`, `bug`)
   * и переводятся при показе; остальное — текст, сохранённый на момент изменения.
   */
  historyValue(field: string | null, value: string | null): string {
    if (value === null) return '—';
    const key = (
      field === 'priority' ? `priority.${value}` : field === 'type' ? `issueType.${value}` : ''
    ) as TKey;
    return key && key in ru ? this.t(key) : value;
  }

  private apply(lang: Lang): void {
    currentLang.set(lang);
    this.document.documentElement.lang = lang;
  }
}

function interpolate(text: string, params: TParams): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Пайп перевода. Нечистый (`pure: false`), чтобы пересчитываться при смене языка;
 * он только ищет строку в словаре, поэтому это дёшево.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(key: TKey, params?: TParams): string {
    return this.i18n.t(key, params);
  }
}
