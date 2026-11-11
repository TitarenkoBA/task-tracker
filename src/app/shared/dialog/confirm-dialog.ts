import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogFrame } from './dialog-frame';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Красная кнопка для необратимых действий. */
  danger?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="data.title">
      <p class="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{{ data.message }}</p>
      <ng-container footer>
        <button type="button" class="btn-secondary" (click)="ref.close(false)">Отмена</button>
        <button
          type="button"
          [class]="data.danger ? 'btn-danger' : 'btn-primary'"
          (click)="ref.close(true)"
        >
          {{ data.confirmLabel ?? 'Подтвердить' }}
        </button>
      </ng-container>
    </app-dialog-frame>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
