import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

/** Короткие всплывающие уведомления внизу экрана. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);

  show(
    message: string,
    options: Partial<Omit<Toast, 'id' | 'message'>> & { duration?: number } = {},
  ): void {
    const toast: Toast = {
      id: this.nextId++,
      message,
      kind: options.kind ?? 'info',
      action: options.action,
    };
    this.toasts.update((list) => [...list.slice(-2), toast]);
    setTimeout(() => this.dismiss(toast.id), options.duration ?? 4000);
  }

  success(message: string): void {
    this.show(message, { kind: 'success' });
  }

  error(message: string): void {
    this.show(message, { kind: 'error', duration: 6000 });
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
