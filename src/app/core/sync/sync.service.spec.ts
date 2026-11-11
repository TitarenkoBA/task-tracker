import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MemoryStorage } from '../storage/memory-storage';
import { STORAGE_ADAPTER } from '../storage/storage-adapter';
import { DataStore } from '../data/data-store';
import { EntityChange } from './merge';
import { SYNC_TRANSPORT, SyncStatus, SyncTransport } from './sync-transport';
import { SyncService } from './sync.service';

/** Поддельный транспорт: запоминает отправленное и позволяет «прислать» изменения. */
class FakeTransport implements SyncTransport {
  readonly status = signal<SyncStatus>('offline');
  sent: EntityChange[][] = [];
  private handler: ((c: EntityChange[]) => void) | null = null;
  async connect() {
    this.status.set('online');
  }
  async disconnect() {
    this.status.set('offline');
  }
  send(changes: EntityChange[]) {
    this.sent.push(changes);
  }
  onReceive(handler: (c: EntityChange[]) => void) {
    this.handler = handler;
    return () => (this.handler = null);
  }
  deliver(changes: EntityChange[]) {
    this.handler?.(changes);
  }
}

describe('SyncService (точка расширения для P2P)', () => {
  let transport: FakeTransport;
  let store: DataStore;

  beforeEach(async () => {
    transport = new FakeTransport();
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_ADAPTER, useValue: new MemoryStorage() },
        { provide: SYNC_TRANSPORT, useValue: transport },
      ],
    });
    store = TestBed.inject(DataStore);
    await store.init();
    TestBed.inject(SyncService);
  });

  it('отправляет локальные изменения в транспорт', () => {
    store.create('people', { name: 'Анна', email: '', color: 'indigo' });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0][0].fields['name']).toBe('Анна');
  });

  it('применяет изменения от пиров и не отправляет их обратно (без эха)', () => {
    transport.deliver([
      {
        collection: 'people',
        id: 'remote-1',
        fields: {
          name: 'Пир',
          email: '',
          color: 'rose',
          deleted: false,
          createdAt: 1,
          updatedAt: 1,
        },
        clock: { name: '0000000000001:00000:peer', deleted: '0000000000001:00000:peer' },
      },
    ]);
    expect(store.get('people', 'remote-1')?.name).toBe('Пир');
    expect(transport.sent).toHaveLength(0);
  });

  it('прокидывает статус и подключение', async () => {
    const sync = TestBed.inject(SyncService);
    await sync.connect('room');
    expect(sync.status()).toBe('online');
  });
});
