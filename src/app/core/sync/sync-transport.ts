import { InjectionToken, Signal, signal } from '@angular/core';
import { EntityChange } from './merge';

/** Состояние подключения к другим участникам. */
export type SyncStatus = 'offline' | 'connecting' | 'online';

/**
 * Точка расширения для будущей P2P-синхронизации.
 *
 * Транспорт отвечает только за доставку изменений между устройствами
 * (например, через WebRTC DataChannel). Слиянием занимается DataStore,
 * поэтому транспорт ничего не знает о задачах и проектах.
 *
 * Как добавить свою реализацию — см. docs/p2p-sync.md.
 */
export interface SyncTransport {
  readonly status: Signal<SyncStatus>;
  /** Подключиться к комнате/сессии. */
  connect(roomId: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Отправить локальные изменения всем подключённым пирам. */
  send(changes: EntityChange[]): void;
  /** Подписаться на изменения от пиров. Возвращает функцию отписки. */
  onReceive(handler: (changes: EntityChange[]) => void): () => void;
}

/** Реализация-заглушка: приложение работает полностью офлайн. */
export class NoopSyncTransport implements SyncTransport {
  readonly status = signal<SyncStatus>('offline').asReadonly();
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  send(): void {}
  onReceive(): () => void {
    return () => {};
  }
}

export const SYNC_TRANSPORT = new InjectionToken<SyncTransport>('SYNC_TRANSPORT', {
  providedIn: 'root',
  factory: () => new NoopSyncTransport(),
});
