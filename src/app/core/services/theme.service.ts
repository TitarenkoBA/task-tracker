import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { SettingsService, ThemePreference } from './settings.service';

/** Применяет светлую/тёмную тему: класс `dark` на <html> (см. styles.css). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);
  private readonly systemDark = signal(false);

  readonly preference = computed(() => this.settings.theme());
  readonly isDark = computed(() =>
    this.preference() === 'system' ? this.systemDark() : this.preference() === 'dark',
  );

  constructor() {
    const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (media) {
      this.systemDark.set(media.matches);
      media.addEventListener('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() => {
      const dark = this.isDark();
      this.document.documentElement.classList.toggle('dark', dark);
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#0b1120' : '#ffffff');
    });
  }

  set(preference: ThemePreference): void {
    this.settings.set('theme', preference);
  }
}
