import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { COLOR_CLASSES } from '../../core/models/catalog';
import { Project } from '../../core/models/entities';
import { DemoDataService } from '../../core/services/demo-data.service';
import { IssueService } from '../../core/services/issue.service';
import { ProjectService } from '../../core/services/project.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { ActionsService } from '../actions.service';

@Component({
  selector: 'app-projects-page',
  imports: [RouterLink, PageHeader, EmptyState, Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header [title]="'nav.projects' | t">
      <button actions type="button" class="btn-primary" (click)="actions.createProject()">
        <app-icon name="plus" [size]="18" />
        <span class="hidden sm:inline">{{ 'projects.add' | t }}</span>
      </button>
    </app-page-header>

    <div class="mx-auto max-w-7xl px-4 py-4 lg:px-8">
      @if (cards().length) {
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          @for (card of cards(); track card.project.id) {
            <a
              [routerLink]="['/p', projects.routeKey(card.project), 'board']"
              class="card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div class="flex items-center gap-3">
                <span
                  class="flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                  [class]="colors[card.project.color].solid"
                >
                  {{ card.project.key.slice(0, 2) }}
                </span>
                <div class="min-w-0 flex-1">
                  <h2 class="truncate font-semibold">{{ card.project.name }}</h2>
                  <p class="font-mono text-xs text-slate-500">{{ card.project.key }}</p>
                </div>
                <app-icon
                  name="chevron-right"
                  class="text-slate-300 transition group-hover:translate-x-0.5"
                />
              </div>
              @if (card.project.description) {
                <p class="mt-3 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                  {{ card.project.description }}
                </p>
              }
              <div class="mt-4">
                <div class="mb-1.5 flex justify-between text-xs text-slate-500">
                  <span>{{ 'projects.progress' | t: { done: card.done, total: card.total } }}</span>
                  <span>{{ card.percent }}%</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    class="h-full rounded-full bg-emerald-500 transition-all"
                    [style.width.%]="card.percent"
                  ></div>
                </div>
              </div>
            </a>
          }
        </div>
      } @else {
        <app-empty-state
          icon="folder"
          [title]="'projects.emptyTitle' | t"
          [text]="'projects.emptyText' | t"
        >
          <button type="button" class="btn-primary" (click)="actions.createProject()">
            <app-icon name="plus" [size]="18" /> {{ 'nav.newProject' | t }}
          </button>
          <button type="button" class="btn-secondary" (click)="createDemo()">
            <app-icon name="sparkles" [size]="18" /> {{ 'projects.demo' | t }}
          </button>
        </app-empty-state>
      }
    </div>
  `,
})
export class ProjectsPage {
  protected readonly actions = inject(ActionsService);
  protected readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly demo = inject(DemoDataService);
  private readonly router = inject(Router);
  protected readonly colors = COLOR_CLASSES;

  protected readonly cards = computed(() =>
    this.projects.projects().map((project) => {
      const issues = this.issues
        .issues()
        .filter((i) => i.projectId === project.id && i.type !== 'epic');
      const done = issues.filter((i) => this.isDone(project, i.statusId)).length;
      return {
        project,
        total: issues.length,
        done,
        percent: issues.length ? Math.round((done / issues.length) * 100) : 0,
      };
    }),
  );

  private isDone(project: Project, statusId: string): boolean {
    return project.statuses.find((s) => s.id === statusId)?.category === 'done';
  }

  protected createDemo(): void {
    const project = this.demo.create();
    void this.router.navigate(['/p', this.projects.routeKey(project), 'board']);
  }
}
