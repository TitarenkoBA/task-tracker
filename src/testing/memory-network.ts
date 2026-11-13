import { signal } from '@angular/core';
import {
  DataChannel,
  NetworkError,
  NetworkFactory,
  NetworkHandlers,
  NetworkPeer,
} from '../app/core/p2p/network';

/**
 * Сеть в памяти для тестов совместной работы: ведёт себя как PeerJS
 * (регистрация ID, «занятый ID», «пир недоступен», асинхронная доставка,
 * закрытие каналов), но без браузерного WebRTC и signaling-сервера.
 */
export class MemoryHub {
  readonly peers = new Map<string, MemoryPeer>();
  private counter = 0;

  readonly factory: NetworkFactory = (handlers) => new MemoryPeer(this, handlers);

  nextId(): string {
    return `peer${++this.counter}`;
  }
}

/** Подождать, пока доставятся все сообщения (несколько циклов событий). */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

class MemoryPeer implements NetworkPeer {
  readonly lost = signal(false);
  id: string | null = null;
  readonly channels = new Set<MemoryChannel>();

  constructor(
    private readonly hub: MemoryHub,
    readonly handlers: NetworkHandlers,
  ) {}

  async open(id?: string): Promise<string> {
    await Promise.resolve();
    const peerId = id ?? this.hub.nextId();
    if (this.hub.peers.has(peerId)) {
      throw new NetworkError('unavailable-id', `ID "${peerId}" is taken`);
    }
    this.id = peerId;
    this.hub.peers.set(peerId, this);
    return peerId;
  }

  connect(peerId: string, metadata: unknown): DataChannel | undefined {
    if (!this.id) return undefined;
    const local = new MemoryChannel(peerId, metadata);
    this.channels.add(local);
    const target = this.hub.peers.get(peerId);
    if (!target) {
      setTimeout(() =>
        this.handlers.error(
          new NetworkError('peer-unavailable', `Could not connect to peer ${peerId}`, peerId),
          false,
        ),
      );
      return local;
    }
    const remote = new MemoryChannel(this.id, metadata);
    target.channels.add(remote);
    local.other = remote;
    remote.other = local;
    setTimeout(() => {
      target.handlers.connection(remote);
      setTimeout(() => {
        local.markOpen();
        remote.markOpen();
      });
    });
    return local;
  }

  destroy(): void {
    if (this.id && this.hub.peers.get(this.id) === this) this.hub.peers.delete(this.id);
    this.id = null;
    for (const channel of this.channels) channel.close();
    this.channels.clear();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (arg?: any) => void;

class MemoryChannel implements DataChannel {
  open = false;
  other?: MemoryChannel;
  private closed = false;
  private readonly handlers = new Map<string, Handler[]>();

  constructor(
    readonly peer: string,
    readonly metadata: unknown,
  ) {}

  on(event: string, handler: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  markOpen(): void {
    if (this.closed || this.open) return;
    this.open = true;
    this.emit('open');
  }

  send(data: unknown): void {
    if (!this.open || !this.other) return;
    // Как настоящая сеть: получатель видит копию, а не тот же объект.
    const copy = structuredClone(data);
    const other = this.other;
    setTimeout(() => other.open && other.emit('data', copy));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    const other = this.other;
    if (other) setTimeout(() => other.close());
  }

  private emit(event: string, arg?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(arg);
  }
}
