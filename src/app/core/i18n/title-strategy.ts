import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { I18n } from './i18n.service';
import { TKey } from './ru';

/**
 * Заголовок вкладки браузера. В маршрутах `title` — это ключ словаря
 * (`title: 'nav.settings'`), а здесь он переводится. При смене языка
 * заголовок обновится сам.
 */
@Injectable({ providedIn: 'root' })
export class I18nTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18n);
  private readonly key = signal<TKey | null>(null);

  constructor() {
    super();
    effect(() => {
      const key = this.key();
      this.title.setTitle(key ? `${this.i18n.t(key)} · Task Tracker` : 'Task Tracker');
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key.set((this.buildTitle(snapshot) as TKey | undefined) ?? null);
  }
}
