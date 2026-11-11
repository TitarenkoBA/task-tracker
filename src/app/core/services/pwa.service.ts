import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** Событие браузера «можно установить приложение» (есть только в Chromium). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Установка PWA и уведомление о выходе новой версии. */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly window = inject(DOCUMENT).defaultView;
  private installEvent: BeforeInstallPromptEvent | null = null;

  /** Браузер разрешил показать кнопку «Установить». */
  readonly canInstall = signal(false);
  /** Скачана новая версия приложения — можно перезагрузиться. */
  readonly updateReady = signal(false);

  constructor() {
    this.window?.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installEvent = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    this.window?.addEventListener('appinstalled', () => this.canInstall.set(false));

    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') this.updateReady.set(true);
      });
    }
  }

  async install(): Promise<void> {
    if (!this.installEvent) return;
    await this.installEvent.prompt();
    await this.installEvent.userChoice;
    this.installEvent = null;
    this.canInstall.set(false);
  }

  applyUpdate(): void {
    this.window?.location.reload();
  }
}
