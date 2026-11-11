import { DestroyRef, Injectable, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { SYNC_TRANSPORT } from './sync-transport';

/**
 * Связывает DataStore с транспортом синхронизации:
 * - локальные изменения → транспорт → пиры;
 * - изменения от пиров → DataStore.applyChanges(…, 'remote').
 *
 * Сейчас транспорт — заглушка ({@link NoopSyncTransport}), поэтому сервис
 * ничего не отправляет. Чтобы включить P2P, достаточно подменить
 * `SYNC_TRANSPORT` в app.config.ts (см. docs/p2p-sync.md).
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(DataStore);
  private readonly transport = inject(SYNC_TRANSPORT);

  readonly status = this.transport.status;

  constructor() {
    const offLocal = this.store.onChange((changes, origin) => {
      // Изменения, пришедшие от пиров, обратно не отправляем — иначе получится эхо.
      if (origin !== 'remote') this.transport.send(changes);
    });
    const offRemote = this.transport.onReceive((changes) => {
      this.store.applyChanges(changes, 'remote');
    });
    inject(DestroyRef).onDestroy(() => {
      offLocal();
      offRemote();
    });
  }

  connect(roomId: string): Promise<void> {
    return this.transport.connect(roomId);
  }

  disconnect(): Promise<void> {
    return this.transport.disconnect();
  }
}
