import { Signal, signal } from '@angular/core';
import type { DataConnection, PeerOptions } from 'peerjs';
import { P2pConfig } from './p2p.config';

/**
 * Абстракция сети, с которой работает комната (room.ts).
 * В приложении — PeerJS ({@link PeerJsNetwork}), в тестах — сеть в памяти.
 */

/** Канал данных до одного участника. Совпадает с подмножеством DataConnection из PeerJS. */
export interface DataChannel {
  readonly peer: string;
  readonly metadata: unknown;
  readonly open: boolean;
  on(event: 'open' | 'close', handler: () => void): void;
  on(event: 'data', handler: (data: unknown) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  send(data: unknown): void;
  close(): void;
}

export type NetworkErrorCode =
  'peer-unavailable' | 'unavailable-id' | 'network' | 'browser-incompatible' | 'timeout' | 'other';

export class NetworkError extends Error {
  constructor(
    readonly code: NetworkErrorCode,
    message: string,
    /** Для `peer-unavailable` — кого не удалось найти. */
    readonly peerId: string | null = null,
  ) {
    super(message);
  }
}

export interface NetworkHandlers {
  connection(channel: DataChannel): void;
  /** Ошибка после открытия. `signalingOnly` — пропал только signaling, каналы живы. */
  error(err: NetworkError, signalingOnly: boolean): void;
  /** Узел закрыт окончательно. */
  closed(): void;
}

/** Наш узел в сети: регистрация ID на signaling-сервере и исходящие соединения. */
export interface NetworkPeer {
  /** `true`, пока нет связи с signaling-сервером (уже открытые каналы при этом работают). */
  readonly lost: Signal<boolean>;
  /** Зарегистрироваться под ID (или получить случайный). Резолвится подтверждённым ID. */
  open(id?: string): Promise<string>;
  connect(peerId: string, metadata: unknown): DataChannel | undefined;
  destroy(): void;
}

export type NetworkFactory = (handlers: NetworkHandlers) => NetworkPeer;

// ---------------------------------------------------------------------------
// PeerJS
// ---------------------------------------------------------------------------

const SIGNALING_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Ошибки, которые означают только обрыв связи с signaling-сервером. */
const SIGNALING_ERRORS = new Set([
  'network',
  'socket-error',
  'socket-closed',
  'disconnected',
  'server-error',
]);

type PeerJsError = Error & { type?: string };
type PeerInstance = InstanceType<typeof import('peerjs').default>;

function toNetworkError(err: PeerJsError): NetworkError {
  switch (err.type) {
    case 'peer-unavailable':
      // PeerJS сообщает ID недоступного пира только в тексте ошибки.
      return new NetworkError(
        'peer-unavailable',
        err.message,
        /peer (.+)$/.exec(err.message)?.[1] ?? null,
      );
    case 'unavailable-id':
    case 'browser-incompatible':
      return new NetworkError(err.type, err.message);
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return new NetworkError('network', err.message);
    default:
      return new NetworkError('other', err.message || 'Unknown error');
  }
}

/**
 * Узел PeerJS: подключение к signaling-серверу, переподключение при обрыве, исходящие каналы.
 * Перенесено из проекта p2p (SignalingClient) без медиа. Библиотека PeerJS
 * загружается лениво — только когда пользователь начинает совместную работу.
 */
export class PeerJsNetwork implements NetworkPeer {
  private peer?: PeerInstance;
  private abortOpen?: (err: Error) => void;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  readonly lost = signal(false);

  constructor(
    private readonly config: P2pConfig,
    private readonly handlers: NetworkHandlers,
  ) {}

  async open(id?: string): Promise<string> {
    const { default: Peer } = await import('peerjs');
    const options: PeerOptions = {
      host: this.config.host,
      port: this.config.port,
      path: this.config.path,
      secure: this.config.secure,
      debug: this.config.debug,
      config: { iceServers: this.config.iceServers },
    };
    const peer = id ? new Peer(id, options) : new Peer(options);
    this.peer = peer;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => fail(new NetworkError('timeout', 'Timed out waiting for the signaling server.')),
        SIGNALING_TIMEOUT_MS,
      );
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.destroy();
        reject(err);
      };
      this.abortOpen = fail;

      // Каждый обработчик проверяет this.peer: destroy() сбрасывает его первым,
      // потому что peer.destroy() генерирует 'disconnected', и переподключение оттуда
      // оставило бы живой сокет, держащий ID.
      peer.on('open', (openId) => {
        if (this.peer !== peer) return;
        this.reconnectAttempts = 0;
        this.lost.set(false);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(openId);
        }
      });
      peer.on('connection', (conn: DataConnection) => {
        if (this.peer === peer) this.handlers.connection(conn as unknown as DataChannel);
      });
      // Звонки трекеру не нужны — отклоняем.
      peer.on('call', (call) => call.close());
      peer.on('disconnected', () => {
        if (this.peer === peer) this.scheduleReconnect(peer);
      });
      peer.on('close', () => {
        if (this.peer !== peer) return;
        if (!settled) {
          fail(new NetworkError('network', 'The connection to the signaling server was closed.'));
          return;
        }
        this.destroy();
        this.handlers.closed();
      });
      peer.on('error', (err: PeerJsError) => {
        if (this.peer !== peer) return;
        if (!settled) {
          fail(toNetworkError(err));
          return;
        }
        this.handlers.error(toNetworkError(err), !!err.type && SIGNALING_ERRORS.has(err.type));
      });
    });
  }

  connect(peerId: string, metadata: unknown): DataChannel | undefined {
    // Двоичная сериализация PeerJS сама режет большие сообщения (снимок проекта) на куски.
    return this.peer?.connect(peerId, { reliable: true, metadata }) as unknown as
      DataChannel | undefined;
  }

  /** Заодно отменяет `open()`, который ещё не завершился. */
  destroy(): void {
    const { peer, abortOpen } = this;
    this.peer = undefined;
    this.abortOpen = undefined;
    clearTimeout(this.reconnectTimer);
    this.reconnectAttempts = 0;
    this.lost.set(false);
    peer?.destroy();
    abortOpen?.(new NetworkError('other', 'Cancelled'));
  }

  private scheduleReconnect(peer: PeerInstance): void {
    this.lost.set(true);
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      if (this.peer === peer && peer.disconnected && !peer.destroyed) peer.reconnect();
    }, delay);
  }
}
