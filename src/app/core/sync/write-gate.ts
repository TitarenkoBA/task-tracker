import { Injectable, inject, signal } from '@angular/core';
import { EntityId } from '../models/entities';
import { SettingsService } from '../services/settings.service';

export type TeamRole = 'owner' | 'editor' | 'viewer';

/**
 * Кто может менять данные общего проекта.
 * Сервер с правом «только чтение» отвергает запись; здесь то же правило
 * на устройстве, чтобы локальная копия не разъехалась с сервером.
 * P2P и Dropbox этот замок не включают: там нет ролей.
 */
@Injectable({ providedIn: 'root' })
export class WriteGate {
  private readonly settings = inject(SettingsService);
  readonly role = signal<TeamRole | null>(null);
  /** Сколько раз запись отклонена. Оболочка показывает уведомление. */
  readonly blocked = signal(0);

  allows(projectId: string | null): boolean {
    if (this.settings.syncMode() !== 'server' || this.role() !== 'viewer') return true;
    if (!projectId) return true;
    return !this.settings.collabProjectIds().includes(projectId);
  }

  /** Любой общий проект — чтобы запретить зрителю править карточки людей. */
  sharedProjectId(): EntityId | null {
    return this.settings.collabProjectIds()[0] ?? null;
  }

  bump(): void {
    this.blocked.update((n) => n + 1);
  }
}
