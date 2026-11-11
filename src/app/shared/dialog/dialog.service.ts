import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { ComponentType } from '@angular/cdk/portal';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, ConfirmOptions } from './confirm-dialog';

/**
 * Обёртка над CDK Dialog с едиными настройками оформления.
 * Пример: `dialogs.open(IssueCreateDialog, { projectId })`.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  open<R = unknown, D = unknown, C = unknown>(
    component: ComponentType<C>,
    data?: D,
  ): DialogRef<R, C> {
    return this.dialog.open<R, D, C>(component, {
      data,
      panelClass: 'app-dialog',
      backdropClass: 'app-backdrop',
      maxHeight: '100dvh',
      restoreFocus: true,
    });
  }

  /** Спросить подтверждение. Возвращает `true`, если пользователь согласился. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.open<boolean>(ConfirmDialog, options);
    return (await firstValueFrom(ref.closed)) === true;
  }
}
