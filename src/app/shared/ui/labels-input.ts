import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { IssueService } from '../../core/services/issue.service';
import { Icon } from './icon';

/**
 * Ввод меток «чипсами»: Enter или запятая добавляет метку,
 * Backspace в пустом поле удаляет последнюю. Подсказки — из уже существующих меток.
 */
@Component({
  selector: 'app-labels-input',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="input flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5"
      (click)="field.focus()"
    >
      @for (label of value(); track label) {
        <span class="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {{ label }}
          <button type="button" class="-mr-1 opacity-60 hover:opacity-100" [attr.aria-label]="'Удалить метку ' + label" (click)="remove(label)">
            <app-icon name="x" [size]="12" />
          </button>
        </span>
      }
      <input
        #field
        class="min-w-24 flex-1 bg-transparent text-base outline-none sm:text-sm"
        [id]="inputId()"
        [attr.list]="inputId() + '-list'"
        [value]="draft()"
        [placeholder]="value().length ? '' : 'Добавить метку…'"
        (input)="onInput(field.value)"
        (keydown)="onKeydown($event)"
        (blur)="commit()"
      />
      <datalist [id]="inputId() + '-list'">
        @for (s of suggestions(); track s) {
          <option [value]="s"></option>
        }
      </datalist>
    </div>
  `,
})
export class LabelsInput {
  readonly value = model<string[]>([]);
  readonly inputId = input('labels');

  private readonly issues = inject(IssueService);
  protected readonly draft = signal('');
  protected readonly suggestions = computed(() => {
    const all = new Set(this.issues.issues().flatMap((i) => i.labels));
    for (const l of this.value()) all.delete(l);
    return [...all].sort();
  });

  protected onInput(text: string): void {
    if (text.includes(',')) {
      this.draft.set(text.replace(/,/g, ''));
      this.commit();
    } else {
      this.draft.set(text);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Backspace' && !this.draft() && this.value().length) {
      this.value.update((v) => v.slice(0, -1));
    }
  }

  protected commit(): void {
    const label = this.draft().trim().replace(/\s+/g, '-');
    if (label && !this.value().includes(label)) this.value.update((v) => [...v, label]);
    this.draft.set('');
  }

  protected remove(label: string): void {
    this.value.update((v) => v.filter((l) => l !== label));
  }
}
