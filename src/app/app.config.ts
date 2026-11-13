import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { DataStore } from './core/data/data-store';
import { I18n } from './core/i18n/i18n.service';
import { I18nTitleStrategy } from './core/i18n/title-strategy';
import { PeopleService } from './core/services/people.service';
import { ThemeService } from './core/services/theme.service';
import { CollaborationService } from './core/p2p/collaboration.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      // Дочерние страницы проекта получают :projectKey родительского маршрута.
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // До показа интерфейса: загрузить данные из IndexedDB и подготовить профиль.
    provideAppInitializer(async () => {
      inject(ThemeService);
      inject(I18n);
      const store = inject(DataStore);
      const people = inject(PeopleService);
      const collaboration = inject(CollaborationService);
      await store.init();
      people.ensureMe();
      // Продолжить совместную работу, если она шла до перезапуска (в фоне, не блокируя запуск).
      collaboration.resume();
    }),
    { provide: TitleStrategy, useClass: I18nTitleStrategy },
    // Свой signaling-сервер для P2P: { provide: P2P_CONFIG, useValue: { ...DEFAULT_P2P_CONFIG, host: '…' } }
  ],
};
