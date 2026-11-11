import { Routes } from '@angular/router';

/**
 * Маршруты приложения. Каждая страница загружается лениво (loadComponent),
 * поэтому стартовый бандл остаётся маленьким.
 *
 * Параметры маршрута попадают в input() компонентов автоматически
 * (см. withComponentInputBinding в app.config.ts).
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Обзор · Task Tracker',
    loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  {
    path: 'projects',
    title: 'Проекты · Task Tracker',
    loadComponent: () => import('./features/projects/projects-page').then((m) => m.ProjectsPage),
  },
  {
    path: 'p/:projectKey',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'board' },
      {
        path: 'board',
        title: 'Доска · Task Tracker',
        loadComponent: () => import('./features/board/board-page').then((m) => m.BoardPage),
      },
      {
        path: 'backlog',
        title: 'Бэклог · Task Tracker',
        loadComponent: () => import('./features/backlog/backlog-page').then((m) => m.BacklogPage),
      },
      {
        path: 'settings',
        title: 'Настройки проекта · Task Tracker',
        loadComponent: () =>
          import('./features/projects/project-settings-page').then((m) => m.ProjectSettingsPage),
      },
    ],
  },
  {
    path: 'issues',
    title: 'Задачи · Task Tracker',
    loadComponent: () => import('./features/issues/issues-page').then((m) => m.IssuesPage),
  },
  {
    path: 'browse/:issueKey',
    title: 'Задача · Task Tracker',
    loadComponent: () => import('./features/issues/issue-detail-page').then((m) => m.IssueDetailPage),
  },
  {
    path: 'settings',
    title: 'Настройки · Task Tracker',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
