import { signal } from '@angular/core';
import { DataChannel } from './network';

const CONNECT_TIMEOUT_MS = 20_000;

export type LinkStatus = 'connecting' | 'connected' | 'failed';

export interface LinkHandlers {
  open(link: PeerLink): void;
  data(link: PeerLink, data: unknown): void;
  /** Канал закрылся: участник ушёл. Срабатывает один раз. */
  closed(link: PeerLink): void;
  /** Канал не открылся вовремя. */
  failed(link: PeerLink): void;
}

/** Всё об одном другом участнике: его канал данных, имя и состояние. Перенесено из p2p без медиа. */
export class PeerLink {
  readonly name = signal('');
  /** ID участника (Person) в данных трекера. */
  readonly person = signal<string | null>(null);
  readonly status = signal<LinkStatus>('connecting');

  /** Хост поручился за этого участника. До этого его сообщения придерживаются. */
  admitted = false;
  readonly held: unknown[] = [];

  private channel?: DataChannel;
  private isClosed = false;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    readonly id: string,
    readonly isHost: boolean,
    private readonly handlers: LinkHandlers,
  ) {
    this.timer = setTimeout(() => {
      if (!this.isClosed && this.status() === 'connecting') {
        this.status.set('failed');
        this.handlers.failed(this);
      }
    }, CONNECT_TIMEOUT_MS);
  }

  get isOpen(): boolean {
    return !this.isClosed && !!this.channel?.open;
  }

  /** `false`, если канал у этого участника уже есть: дубликат закрывается. */
  attach(channel: DataChannel): boolean {
    if (this.channel || this.isClosed) {
      channel.close();
      return false;
    }
    this.channel = channel;

    const onOpen = (): void => {
      if (this.channel !== channel || this.isClosed) return;
      clearTimeout(this.timer);
      this.status.set('connected');
      this.handlers.open(this);
    };
    channel.on('open', onOpen);
    channel.on('data', (data) => {
      if (this.channel === channel && !this.isClosed) this.handlers.data(this, data);
    });
    channel.on('close', () => {
      if (this.channel === channel) this.close();
    });
    channel.on('error', () => {
      // Ошибка канала обычно сопровождается его закрытием — его и обрабатываем.
    });
    // Входящий канал мог открыться раньше, чем мы подписались.
    if (channel.open) queueMicrotask(onOpen);
    return true;
  }

  send(message: unknown): boolean {
    if (!this.isOpen) return false;
    this.channel?.send(message);
    return true;
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    clearTimeout(this.timer);
    const channel = this.channel;
    this.channel = undefined;
    channel?.close();
    this.handlers.closed(this);
  }
}
