import { Routes } from '@angular/router';

/**
 * Маршруты приложения. Каждая страница загружается лениво (loadComponent),
 * поэтому стартовый бандл остаётся маленьким.
 *
 * 	itle — ключ словаря переводов (см. core/i18n/title-strategy.ts).
 *
 * Параметры маршрута попадают в input() компонентов автоматически
 * (см. withComponentInputBinding в app.config.ts).
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'nav.overview',
    loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  {
    path: 'projects',
    title: 'nav.projects',
    loadComponent: () => import('./features/projects/projects-page').then((m) => m.ProjectsPage),
  },
  {
    path: 'p/:projectKey',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'board' },
      {
        path: 'board',
        title: 'common.board',
        loadComponent: () => import('./features/board/board-page').then((m) => m.BoardPage),
      },
      {
        path: 'backlog',
        title: 'common.backlog',
        loadComponent: () => import('./features/backlog/backlog-page').then((m) => m.BacklogPage),
      },
      {
        path: 'settings',
        title: 'nav.projectSettings',
        loadComponent: () =>
          import('./features/projects/project-settings-page').then((m) => m.ProjectSettingsPage),
      },
    ],
  },
  {
    path: 'issues',
    title: 'nav.issues',
    loadComponent: () => import('./features/issues/issues-page').then((m) => m.IssuesPage),
  },
  {
    path: 'browse/:issueKey',
    title: 'nav.issue',
    loadComponent: () =>
      import('./features/issues/issue-detail-page').then((m) => m.IssueDetailPage),
  },
  {
    path: 'settings',
    title: 'nav.settings',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
