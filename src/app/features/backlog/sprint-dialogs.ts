import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Sprint } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { SprintService } from '../../core/services/sprint.service';
import { ToastService } from '../../core/services/toast.service';
import { todayIso } from '../../core/utils/dates';
import { DialogFrame } from '../../shared/dialog/dialog-frame';

export interface SprintFormData {
  sprint: Sprint;
  /** `start` — запуск спринта, `edit` — просто редактирование. */
  mode: 'start' | 'edit';
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Запуск или редактирование спринта: название, цель, даты. */
@Component({
  selector: 'app-sprint-form-dialog',
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="data.mode === 'start' ? 'Начать спринт' : 'Спринт'">
      <form id="sprint-form" class="space-y-4" (submit)="$event.preventDefault(); submit()">
        @if (data.mode === 'start') {
          <p class="text-sm text-slate-500">Задач в спринте: {{ issueCount() }}</p>
        }
        <div>
          <label class="label" for="sf-name">Название</label>
          <input id="sf-name" class="input" [value]="name()" (input)="name.set($any($event.target).value)" />
        </div>
        @if (data.sprint.state !== 'planned' || data.mode === 'start') {
          <fieldset>
            <legend class="label">Длительность</legend>
            <div class="flex flex-wrap gap-2">
              @for (w of [1, 2, 3, 4]; track w) {
                <button type="button" class="chip h-8 border border-slate-200 px-3 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" (click)="setWeeks(w)">
                  {{ w }} нед.
                </button>
              }
            </div>
          </fieldset>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="sf-start">Начало</label>
              <input id="sf-start" class="input" type="date" [value]="startDate()" (change)="startDate.set($any($event.target).value)" />
            </div>
            <div>
              <label class="label" for="sf-end">Окончание</label>
              <input id="sf-end" class="input" type="date" [value]="endDate()" (change)="endDate.set($any($event.target).value)" />
            </div>
          </div>
          @if (dateError()) {
            <p class="text-xs text-rose-600">{{ dateError() }}</p>
          }
        }
        <div>
          <label class="label" for="sf-goal">Цель спринта</label>
          <textarea id="sf-goal" class="input" rows="2" placeholder="Чего хотим достичь?" [value]="goal()" (input)="goal.set($any($event.target).value)"></textarea>
        </div>
      </form>
      <ng-container footer>
        <button type="button" class="btn-secondary" (click)="ref.close()">Отмена</button>
        <button type="submit" form="sprint-form" class="btn-primary">{{ data.mode === 'start' ? 'Начать' : 'Сохранить' }}</button>
      </ng-container>
    </app-dialog-frame>
  `,
})
export class SprintFormDialog {
  protected readonly data = inject<SprintFormData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly sprints = inject(SprintService);
  private readonly issues = inject(IssueService);
  private readonly toasts = inject(ToastService);

  protected readonly name = signal(this.data.sprint.name);
  protected readonly goal = signal(this.data.sprint.goal);
  protected readonly startDate = signal(this.data.sprint.startDate ?? todayIso());
  protected readonly endDate = signal(this.data.sprint.endDate ?? addDays(todayIso(), 14));
  protected readonly issueCount = computed(
    () => this.issues.issues().filter((i) => i.sprintId === this.data.sprint.id).length,
  );
  protected readonly dateError = computed(() =>
    !this.startDate() || !this.endDate()
      ? 'Укажите даты'
      : this.endDate() < this.startDate()
        ? 'Окончание раньше начала'
        : null,
  );

  protected setWeeks(weeks: number): void {
    this.endDate.set(addDays(this.startDate(), weeks * 7));
  }

  protected submit(): void {
    const needsDates = this.data.mode === 'start' || this.data.sprint.state !== 'planned';
    if (needsDates && this.dateError()) return;
    try {
      const id = this.data.sprint.id;
      this.sprints.update(id, {
        name: this.name().trim() || this.data.sprint.name,
        goal: this.goal().trim(),
        ...(needsDates ? { startDate: this.startDate(), endDate: this.endDate() } : {}),
      });
      if (this.data.mode === 'start') {
        this.sprints.start(id, { startDate: this.startDate(), endDate: this.endDate() });
        this.toasts.success('Спринт начат');
      }
      this.ref.close(true);
    } catch (error) {
      this.toasts.error((error as Error).message);
    }
  }
}

/** Завершение спринта: куда перенести незавершённые задачи. */
@Component({
  selector: 'app-sprint-complete-dialog',
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="'Завершить ' + sprint.name">
      <div class="space-y-4 text-sm">
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/50">
            <p class="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{{ stats().done }}</p>
            <p class="text-emerald-700/80 dark:text-emerald-400/80">готово</p>
          </div>
          <div class="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/50">
            <p class="text-2xl font-bold text-amber-700 dark:text-amber-400">{{ stats().open }}</p>
            <p class="text-amber-700/80 dark:text-amber-400/80">не завершено</p>
          </div>
        </div>
        @if (stats().open) {
          <div>
            <label class="label" for="sc-target">Перенести незавершённые задачи в</label>
            <select id="sc-target" class="input" (change)="target.set($any($event.target).value)">
              <option value="">Бэклог</option>
              @for (s of targets(); track s.id) {
                <option [value]="s.id">{{ s.name }}</option>
              }
              <option value="__new">Новый спринт</option>
            </select>
          </div>
        }
      </div>
      <ng-container footer>
        <button type="button" class="btn-secondary" (click)="ref.close()">Отмена</button>
        <button type="button" class="btn-primary" (click)="complete()">Завершить спринт</button>
      </ng-container>
    </app-dialog-frame>
  `,
})
export class SprintCompleteDialog {
  protected readonly sprint = inject<Sprint>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly sprints = inject(SprintService);
  private readonly issues = inject(IssueService);
  private readonly toasts = inject(ToastService);

  protected readonly target = signal('');
  protected readonly targets = computed(() =>
    this.sprints.forProject(this.sprint.projectId).filter((s) => s.state === 'planned'),
  );
  protected readonly stats = computed(() => {
    const list = this.issues.issues().filter((i) => i.sprintId === this.sprint.id);
    const done = list.filter((i) => this.issues.isDone(i)).length;
    return { done, open: list.length - done };
  });

  protected complete(): void {
    let target: string | null = this.target() || null;
    if (target === '__new') target = this.sprints.create(this.sprint.projectId).id;
    const moved = this.sprints.complete(this.sprint.id, target);
    this.toasts.success(moved ? `Спринт завершён, перенесено задач: ${moved}` : 'Спринт завершён');
    this.ref.close(true);
  }
}
