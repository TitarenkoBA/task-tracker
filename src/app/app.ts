import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { DataStore } from './core/data/data-store';
import { I18n, TranslatePipe } from './core/i18n/i18n.service';
import { TKey } from './core/i18n/ru';
import { COLOR_CLASSES } from './core/models/catalog';
import { CollaborationService } from './core/p2p/collaboration.service';
import { ChatService } from './core/services/chat.service';
import { ProjectService } from './core/services/project.service';
import { DB_OUTDATED_EVENT } from './core/storage/indexeddb-storage';
import { PwaService } from './core/services/pwa.service';
import { ToastService } from './core/services/toast.service';
import { ActionsService } from './features/actions.service';
import { Icon } from './shared/ui/icon';
import { Toasts } from './shared/ui/toasts';

interface NavItem {
  label: TKey;
  icon: string;
  link: string;
  exact?: boolean;
}

/**
 * Корневой компонент — «оболочка» приложения:
 * боковое меню (десктоп), нижняя навигация и кнопка «+» (телефон),
 * уведомления и горячие клавиши.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Toasts, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class App {
  protected readonly projects = inject(ProjectService);
  protected readonly pwa = inject(PwaService);
  protected readonly actions = inject(ActionsService);
  protected readonly chat = inject(ChatService);
  protected readonly collab = inject(CollaborationService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly store = inject(DataStore);
  private readonly i18n = inject(I18n);

  protected readonly colors = COLOR_CLASSES;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly isChat = computed(() => /^\/p\/[^/]+\/chat/.test(this.url()));

  /** Ссылки, зависящие от текущего проекта. */
  protected readonly projectBase = computed(() => {
    const project = this.projects.current();
    return project ? `/p/${this.projects.routeKey(project)}` : null;
  });

  protected readonly mobileNav = computed<NavItem[]>(() => {
    const base = this.projectBase();
    return [
      { label: 'nav.overview', icon: 'home', link: '/', exact: true },
      { label: 'common.board', icon: 'board', link: base ? `${base}/board` : '/projects' },
      { label: 'common.backlog', icon: 'layers', link: base ? `${base}/backlog` : '/projects' },
      { label: 'nav.issues', icon: 'list', link: '/issues' },
      { label: 'nav.more', icon: 'sliders', link: '/settings' },
    ];
  });

  constructor() {
    effect(() => {
      if (this.store.persistError()) {
        this.toasts.error(this.i18n.t('app.saveFailed'));
      }
    });

    // Другая вкладка открыла новую версию приложения и обновила базу: эта вкладка
    // больше не может писать в неё — просим перезагрузиться, чтобы ничего не потерять.
    const onOutdated = (): void =>
      this.toasts.show(this.i18n.t('app.dbOutdated'), {
        kind: 'error',
        duration: 600_000,
        action: { label: this.i18n.t('app.reload'), run: () => location.reload() },
      });
    globalThis.addEventListener?.(DB_OUTDATED_EVENT, onOutdated);
    inject(DestroyRef).onDestroy(() =>
      globalThis.removeEventListener?.(DB_OUTDATED_EVENT, onOutdated),
    );
  }

  /** Горячие клавиши: `c` — новая задача, `/` — поиск задач. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable], .cdk-overlay-container'))
      return;
    // «с» — та же клавиша в русской раскладке.
    if (event.key === 'c' || event.key === 'с') {
      event.preventDefault();
      this.actions.createIssue();
    } else if (event.key === '/') {
      event.preventDefault();
      void this.router.navigate(['/issues'], { queryParams: { focus: 1 } });
    }
  }
}
