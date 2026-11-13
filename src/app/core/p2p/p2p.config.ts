import { InjectionToken } from '@angular/core';

/**
 * Настройки P2P-соединения.
 *
 * Signaling-сервер (PeerJS) нужен только чтобы участники нашли друг друга;
 * сами данные идут напрямую между браузерами по WebRTC и через сервер не проходят.
 * По умолчанию используется тот же сервер, что и в проекте видеочата p2p.
 * Свой сервер: peer-server/ в проекте p2p или `npx peerjs --port 9000`.
 */
export interface P2pConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  /** STUN/TURN-серверы для обхода NAT. */
  iceServers: RTCIceServer[];
  /** Подробный лог PeerJS в консоли (0 — выключен, 3 — всё). */
  debug: 0 | 1 | 2 | 3;
}

export const DEFAULT_P2P_CONFIG: P2pConfig = {
  host: 'zik2009-my-peerjs-server.hf.space',
  port: 443,
  path: '/myapp',
  secure: true,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs',
      credential: 'peerjsp',
    },
  ],
  debug: 0,
};

export const P2P_CONFIG = new InjectionToken<P2pConfig>('P2P_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_P2P_CONFIG,
});
