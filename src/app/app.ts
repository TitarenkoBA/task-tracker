import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DataStore } from './core/data/data-store';
import { COLOR_CLASSES } from './core/models/catalog';
import { ProjectService } from './core/services/project.service';
import { PwaService } from './core/services/pwa.service';
import { ToastService } from './core/services/toast.service';
import { ActionsService } from './features/actions.service';
import { Icon } from './shared/ui/icon';
import { Toasts } from './shared/ui/toasts';

interface NavItem {
  label: string;
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Toasts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class App {
  protected readonly projects = inject(ProjectService);
  protected readonly pwa = inject(PwaService);
  protected readonly actions = inject(ActionsService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly store = inject(DataStore);

  protected readonly colors = COLOR_CLASSES;

  /** Ссылки, зависящие от текущего проекта. */
  protected readonly projectBase = computed(() => {
    const project = this.projects.current();
    return project ? `/p/${project.key}` : null;
  });

  protected readonly mobileNav = computed<NavItem[]>(() => {
    const base = this.projectBase();
    return [
      { label: 'Обзор', icon: 'home', link: '/', exact: true },
      { label: 'Доска', icon: 'board', link: base ? `${base}/board` : '/projects' },
      { label: 'Бэклог', icon: 'layers', link: base ? `${base}/backlog` : '/projects' },
      { label: 'Задачи', icon: 'list', link: '/issues' },
      { label: 'Ещё', icon: 'sliders', link: '/settings' },
    ];
  });

  constructor() {
    effect(() => {
      if (this.store.persistError()) {
        this.toasts.error('Не удалось сохранить изменения. Проверьте свободное место и сделайте экспорт.');
      }
    });
  }

  /** Горячие клавиши: `c` — новая задача, `/` — поиск задач. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable], .cdk-overlay-container')) return;
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
