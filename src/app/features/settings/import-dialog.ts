import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { COLLECTIONS } from '../../core/models/entities';
import {
  ExportFile,
  ExportImportService,
  ImportMode,
  ImportSummary,
} from '../../core/services/export-import.service';
import { ToastService } from '../../core/services/toast.service';
import { formatDateTime } from '../../core/utils/dates';
import { DialogFrame } from '../../shared/dialog/dialog-frame';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { TKey } from '../../core/i18n/ru';

/** Подтверждение импорта: что в файле и как его загрузить. */
@Component({
  selector: 'app-import-dialog',
  imports: [DialogFrame, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="'import.title' | t">
      <div class="space-y-4 text-sm">
        <p class="text-slate-500">
          {{ 'import.backupFrom' | t: { date: exportedAt ?? ('import.unknownDate' | t) } }}
        </p>
        <dl
          class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50"
        >
          @for (row of counts; track row.label) {
            <dt class="text-slate-500">{{ row.label | t }}</dt>
            <dd class="text-right font-medium">{{ row.count }}</dd>
          }
        </dl>

        <fieldset class="space-y-2">
          <legend class="label">{{ 'import.how' | t }}</legend>
          <label
            class="flex cursor-pointer gap-3 rounded-xl border p-3 transition"
            [class]="
              mode() === 'merge'
                ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40'
                : 'border-slate-200 dark:border-slate-700'
            "
          >
            <input
              type="radio"
              name="mode"
              class="mt-0.5 accent-brand-600"
              [checked]="mode() === 'merge'"
              (change)="mode.set('merge')"
            />
            <span>
              <span class="block font-medium">{{ 'import.merge' | t }}</span>
              <span class="block text-slate-500">{{ 'import.mergeText' | t }}</span>
            </span>
          </label>
          <label
            class="flex cursor-pointer gap-3 rounded-xl border p-3 transition"
            [class]="
              mode() === 'replace'
                ? 'border-rose-500 bg-rose-50/60 dark:bg-rose-950/40'
                : 'border-slate-200 dark:border-slate-700'
            "
          >
            <input
              type="radio"
              name="mode"
              class="mt-0.5 accent-rose-600"
              [checked]="mode() === 'replace'"
              (change)="mode.set('replace')"
            />
            <span>
              <span class="block font-medium">{{ 'import.replace' | t }}</span>
              <span class="block text-slate-500">{{ 'import.replaceText' | t }}</span>
            </span>
          </label>
        </fieldset>
      </div>
      <ng-container footer>
        <button type="button" class="btn-secondary" (click)="ref.close()">
          {{ 'common.cancel' | t }}
        </button>
        <button
          type="button"
          [class]="mode() === 'replace' ? 'btn-danger' : 'btn-primary'"
          [disabled]="busy()"
          (click)="run()"
        >
          {{ (mode() === 'replace' ? 'import.replaceButton' : 'import.button') | t }}
        </button>
      </ng-container>
    </app-dialog-frame>
  `,
})
export class ImportDialog {
  private readonly file = inject<ExportFile>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<ImportSummary>>(DialogRef);
  private readonly service = inject(ExportImportService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly mode = signal<ImportMode>('merge');
  protected readonly busy = signal(false);
  protected readonly exportedAt = this.file.exportedAt
    ? formatDateTime(Date.parse(this.file.exportedAt))
    : null;
  protected readonly counts = COLLECTIONS.map((c) => ({
    label: `import.collection.${c}` as TKey,
    count: this.file.data[c].filter((e) => !e.deleted).length,
  }));

  protected async run(): Promise<void> {
    this.busy.set(true);
    try {
      const summary = await this.service.import(this.file, this.mode());
      this.toasts.success(
        summary.mode === 'replace'
          ? this.i18n.t('import.replaced')
          : summary.changed
            ? this.i18n.t('import.merged', { count: summary.changed })
            : this.i18n.t('import.upToDate'),
      );
      this.ref.close(summary);
    } catch (error) {
      this.toasts.error(this.i18n.t('import.failed', { message: (error as Error).message }));
      this.busy.set(false);
    }
  }
}
