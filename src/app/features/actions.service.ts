import { Injectable, inject } from '@angular/core';
import { I18n } from '../core/i18n/i18n.service';
import { ProjectService } from '../core/services/project.service';
import { ToastService } from '../core/services/toast.service';
import { DialogService } from '../shared/dialog/dialog.service';
import { IssueCreateData, IssueCreateDialog } from './issues/issue-create-dialog';
import { ProjectFormDialog } from './projects/project-form-dialog';

/** Общие действия, которые вызываются из разных мест интерфейса. */
@Injectable({ providedIn: 'root' })
export class ActionsService {
  private readonly dialogs = inject(DialogService);
  private readonly projects = inject(ProjectService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18n);

  createIssue(data: IssueCreateData = {}): void {
    if (!this.projects.projects().length) {
      this.toasts.show(this.i18n.t('app.needProject'));
      this.createProject();
      return;
    }
    this.dialogs.open(IssueCreateDialog, data);
  }

  createProject(): void {
    this.dialogs.open(ProjectFormDialog);
  }
}
