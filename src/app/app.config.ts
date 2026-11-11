import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { DataStore } from './core/data/data-store';
import { PeopleService } from './core/services/people.service';
import { ThemeService } from './core/services/theme.service';
import { SyncService } from './core/sync/sync.service';

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
      const store = inject(DataStore);
      const people = inject(PeopleService);
      inject(SyncService);
      await store.init();
      people.ensureMe();
    }),
    // Точка расширения для P2P: здесь будет подмена транспорта, например
    // { provide: SYNC_TRANSPORT, useClass: WebRtcSyncTransport }
  ],
};
