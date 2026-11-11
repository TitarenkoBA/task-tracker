import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { COLOR_CLASSES } from '../../core/models/catalog';
import { Project } from '../../core/models/entities';
import { ProjectService } from '../../core/services/project.service';
import { Icon } from '../../shared/ui/icon';
import { ActionsService } from '../actions.service';

/** Кнопка с названием проекта и выпадающим списком для быстрого переключения. */
@Component({
  selector: 'app-project-switcher',
  imports: [CdkMenuTrigger, CdkMenu, CdkMenuItem, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="-ml-1 inline-flex max-w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-800"
      [cdkMenuTriggerFor]="menu"
    >
      <span class="size-2 shrink-0 rounded-full" [class]="colors[project().color].solid"></span>
      <span class="truncate">{{ project().name }}</span>
      <app-icon name="chevron-down" [size]="14" />
    </button>

    <ng-template #menu>
      <div cdkMenu class="menu">
        @for (p of projects.projects(); track p.id) {
          <button cdkMenuItem class="menu-item" (cdkMenuItemTriggered)="open(p)">
            <span class="size-2.5 rounded-full" [class]="colors[p.color].solid"></span>
            <span class="flex-1 truncate">{{ p.name }}</span>
            @if (p.id === project().id) {
              <app-icon name="check" [size]="16" class="text-brand-600" />
            }
          </button>
        }
        <div class="my-1 border-t border-slate-100 dark:border-slate-800"></div>
        <button cdkMenuItem class="menu-item" (cdkMenuItemTriggered)="actions.createProject()">
          <app-icon name="plus" [size]="16" /> Новый проект
        </button>
      </div>
    </ng-template>
  `,
})
export class ProjectSwitcher {
  readonly project = input.required<Project>();
  /** Подстраница, которую открыть в выбранном проекте. */
  readonly page = input<'board' | 'backlog' | 'settings'>('board');

  protected readonly projects = inject(ProjectService);
  protected readonly actions = inject(ActionsService);
  private readonly router = inject(Router);
  protected readonly colors = COLOR_CLASSES;

  protected open(project: Project): void {
    void this.router.navigate(['/p', project.key, this.page()]);
  }
}
