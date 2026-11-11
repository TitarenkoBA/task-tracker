import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toast, ToastService } from '../../core/services/toast.service';
import { Icon } from './icon';

/** Область, где показываются уведомления из {@link ToastService}. */
@Component({
  selector: 'app-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'pointer-events-none fixed inset-x-0 bottom-20 z-[1100] flex flex-col items-center gap-2 px-4 lg:bottom-6',
    'aria-live': 'polite',
  },
  template: `
    @for (toast of toasts.toasts(); track toast.id) {
      <div
        class="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-slate-100 dark:text-slate-900"
        role="status"
      >
        <app-icon [name]="icon(toast)" [class]="iconClass(toast)" />
        <span class="flex-1">{{ toast.message }}</span>
        @if (toast.action; as action) {
          <button
            type="button"
            class="font-semibold text-brand-400 dark:text-brand-600"
            (click)="action.run(); toasts.dismiss(toast.id)"
          >
            {{ action.label }}
          </button>
        }
        <button type="button" class="opacity-60 hover:opacity-100" aria-label="Закрыть" (click)="toasts.dismiss(toast.id)">
          <app-icon name="x" [size]="16" />
        </button>
      </div>
    }
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);

  protected icon(toast: Toast): string {
    return { info: 'sparkles', success: 'check-circle', error: 'alert' }[toast.kind];
  }

  protected iconClass(toast: Toast): string {
    return { info: 'text-brand-400', success: 'text-emerald-400', error: 'text-rose-400' }[toast.kind];
  }
}
