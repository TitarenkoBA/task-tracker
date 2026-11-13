import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { COLOR_CLASSES } from '../../core/models/catalog';
import { PROJECT_COLORS, Project, ProjectColor } from '../../core/models/entities';
import { ProjectService } from '../../core/services/project.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogFrame } from '../../shared/dialog/dialog-frame';
import { Icon } from '../../shared/ui/icon';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';

/** Создание проекта (без данных) или редактирование (передаётся проект). */
@Component({
  selector: 'app-project-form-dialog',
  imports: [DialogFrame, Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="(existing ? 'projectForm.title' : 'nav.newProject') | t">
      <form id="project-form" class="space-y-4" (submit)="$event.preventDefault(); submit()">
        <div>
          <label class="label" for="pf-name">{{ 'projectForm.name' | t }}</label>
          <input
            id="pf-name"
            class="input"
            [placeholder]="'projectForm.namePlaceholder' | t"
            autocomplete="off"
            cdkFocusInitial
            [value]="name()"
            (input)="onName($any($event.target).value)"
          />
          @if (submitted() && !name().trim()) {
            <p class="mt-1 text-xs text-rose-600">{{ 'projectForm.nameRequired' | t }}</p>
          }
        </div>

        <div>
          <label class="label" for="pf-key">{{ 'field.key' | t }}</label>
          <input
            id="pf-key"
            class="input font-mono uppercase"
            maxlength="10"
            autocomplete="off"
            [disabled]="!!existing"
            [value]="key()"
            (input)="onKey($any($event.target).value)"
          />
          @if (keyError() && (submitted() || keyTouched())) {
            <p class="mt-1 text-xs text-rose-600">{{ keyError() }}</p>
          } @else {
            <p class="mt-1 text-xs text-slate-500">
              {{
                existing
                  ? ('projectForm.keyLocked' | t)
                  : ('projectForm.keyHint' | t: { key: key() || 'KEY' })
              }}
            </p>
          }
        </div>

        <div>
          <label class="label" for="pf-desc">{{ 'projectForm.description' | t }}</label>
          <textarea
            id="pf-desc"
            class="input"
            rows="2"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
          ></textarea>
        </div>

        <fieldset>
          <legend class="label">{{ 'projectForm.color' | t }}</legend>
          <div class="flex flex-wrap gap-2">
            @for (c of colorList; track c) {
              <button
                type="button"
                class="flex size-9 items-center justify-center rounded-full text-white transition"
                [class]="
                  colors[c].solid +
                  (color() === c
                    ? ' ring-4 ring-brand-500/40 ring-offset-2 dark:ring-offset-slate-900'
                    : '')
                "
                [attr.aria-label]="c"
                [attr.aria-pressed]="color() === c"
                (click)="color.set(c)"
              >
                @if (color() === c) {
                  <app-icon name="check" [size]="16" [strokeWidth]="3" />
                }
              </button>
            }
          </div>
        </fieldset>
      </form>
      <ng-container footer>
        <button type="button" class="btn-secondary" (click)="ref.close()">
          {{ 'common.cancel' | t }}
        </button>
        <button type="submit" form="project-form" class="btn-primary">
          {{ (existing ? 'common.save' : 'projectForm.create') | t }}
        </button>
      </ng-container>
    </app-dialog-frame>
  `,
})
export class ProjectFormDialog {
  protected readonly existing = inject<Project | null>(DIALOG_DATA, { optional: true });
  protected readonly ref = inject<DialogRef<Project>>(DialogRef);
  private readonly projects = inject(ProjectService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  protected readonly colors = COLOR_CLASSES;
  protected readonly colorList = PROJECT_COLORS;

  protected readonly name = signal(this.existing?.name ?? '');
  protected readonly key = signal(this.existing?.key ?? '');
  protected readonly description = signal(this.existing?.description ?? '');
  protected readonly color = signal<ProjectColor>(
    this.existing?.color ?? PROJECT_COLORS[this.projects.projects().length % PROJECT_COLORS.length],
  );
  protected readonly keyTouched = signal(false);
  protected readonly submitted = signal(false);
  protected readonly keyError = computed(() =>
    this.existing ? null : this.projects.validateKey(this.key()),
  );

  protected onName(value: string): void {
    this.name.set(value);
    // Пока пользователь не правил ключ вручную — предлагаем его по названию.
    if (!this.existing && !this.keyTouched()) {
      this.key.set(value.trim() ? this.projects.suggestKey(value) : '');
    }
  }

  protected onKey(value: string): void {
    this.keyTouched.set(true);
    this.key.set(value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }

  protected submit(): void {
    this.submitted.set(true);
    if (!this.name().trim() || this.keyError()) return;
    if (this.existing) {
      this.projects.update(this.existing.id, {
        name: this.name().trim(),
        description: this.description(),
        color: this.color(),
      });
      this.ref.close(this.projects.get(this.existing.id));
      return;
    }
    const project = this.projects.create({
      name: this.name(),
      key: this.key(),
      description: this.description(),
      color: this.color(),
    });
    this.toasts.success(this.i18n.t('projectForm.created', { name: project.name }));
    this.ref.close(project);
    void this.router.navigate(['/p', this.projects.routeKey(project), 'board']);
  }
}
