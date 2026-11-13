import { Signal, signal } from '@angular/core';
import { DataChannel, NetworkError, NetworkFactory, NetworkPeer } from './network';
import { LinkHandlers, PeerLink } from './peer-link';
import {
  APP_ID,
  ConnectMetadata,
  MAX_PARTICIPANTS,
  MemberInfo,
  PROTOCOL_VERSION,
  RoomMessage,
  cleanName,
  parseMessage,
  readMetadata,
} from './protocol';

const WELCOME_TIMEOUT_MS = 20_000;
/** Сколько гость ждёт, пока хост поручится за того, кто подключился к нему напрямую. */
const ADMISSION_TIMEOUT_MS = 10_000;
const REFUSE_CLOSE_DELAY_MS = 1000;

export type RoomRole = 'host' | 'guest';

/** Как нас видят другие. */
export interface LocalMember {
  name: string;
  person: string | null;
}

export interface RoomHandlers {
  /** Участник в комнате и его канал открыт — можно обмениваться данными. */
  ready(link: PeerLink): void;
  /** Сообщение с данными от участника комнаты. */
  message(link: PeerLink, message: Extract<RoomMessage, { type: 'sync' }>): void;
  /** Участник покинул комнату. */
  left(link: PeerLink): void;
  /** Комната закрылась для нас: ушёл хост или пропал signaling-сервер. */
  closed(): void;
  error(err: NetworkError): void;
}

/** Ошибки комнаты для пользователя. Тексты — в словарях (`collab.error.*`). */
export type RoomErrorCode =
  'room-full' | 'version-mismatch' | 'no-answer' | 'host-closed' | 'not-tracker-room';

export class RoomError extends Error {
  constructor(readonly code: RoomErrorCode) {
    super(code);
  }
}

/**
 * Комната: до {@link MAX_PARTICIPANTS} участников, каждый связан с каждым.
 *
 * Логика перенесена из видеочата p2p (RoomService), но без медиа:
 * хост впускает гостей и сообщает всем, кто в комнате; гости принимают прямые
 * соединения только от тех, о ком сообщил хост. Хост ещё и пересылает данные
 * (см. CollaborationService), поэтому даже при оборванной связи между двумя гостями
 * изменения доходят через него.
 */
export class Room {
  private readonly linkMap = new Map<string, PeerLink>();
  /** Участники, о которых сообщил хост, но которые ещё не подключились к нам. */
  private readonly expected = new Map<string, MemberInfo>();
  private network?: NetworkPeer;
  private pending?: {
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private phase: 'opening' | 'joining' | 'open' | 'closed' = 'opening';
  private lastGuestNumber = 1;

  readonly participants = signal<PeerLink[]>([]);
  readonly myId = signal<string | null>(null);
  private readonly lostSignal = signal<Signal<boolean> | null>(null);

  private readonly linkHandlers: LinkHandlers = {
    open: (link) => {
      // Канал гостя к хосту готов к работе только после приветствия (handleHostReply).
      if (this.role === 'guest' && link.isHost) return;
      if (link.admitted && this.linkMap.get(link.id) === link) this.greet(link);
    },
    data: (link, data) => {
      if (this.linkMap.get(link.id) !== link) return;
      if (link.admitted) this.handleData(link, data);
      else link.held.push(data);
    },
    closed: (link) => this.handleLinkClosed(link),
    failed: (link) => this.handleLinkFailed(link),
  };

  private constructor(
    readonly role: RoomRole,
    readonly roomId: string,
    private readonly me: LocalMember,
    private readonly handlers: RoomHandlers,
  ) {}

  /** `true`, пока нет связи с signaling-сервером. */
  lost(): boolean {
    return this.lostSignal()?.() ?? false;
  }

  /** Открыть комнату под ID `roomId`. Ошибка `unavailable-id` — комнату уже кто-то держит. */
  static async host(
    factory: NetworkFactory,
    roomId: string,
    me: LocalMember,
    handlers: RoomHandlers,
  ): Promise<Room> {
    const room = new Room('host', roomId, me, handlers);
    try {
      const id = await room.openNetwork(factory, roomId);
      room.myId.set(id);
      room.phase = 'open';
      return room;
    } catch (error) {
      room.close();
      throw error;
    }
  }

  /** Войти в комнату. Резолвится, когда хост впустил, а не просто когда поднялось соединение. */
  static async join(
    factory: NetworkFactory,
    roomId: string,
    me: LocalMember,
    handlers: RoomHandlers,
  ): Promise<Room> {
    const room = new Room('guest', roomId, me, handlers);
    try {
      const id = await room.openNetwork(factory);
      room.myId.set(id);
      room.phase = 'joining';
      const welcomed = room.waitFor(WELCOME_TIMEOUT_MS);
      const host = room.addLink(roomId, true, { id: roomId, name: '', person: null });
      room.dial(host);
      await welcomed;
      return room;
    } catch (error) {
      room.close();
      throw error;
    }
  }

  send(link: PeerLink, message: RoomMessage): boolean {
    return link.admitted && link.send(message);
  }

  /** Отправить всем, кроме `except`. Возвращает, скольким ушло. */
  broadcast(message: RoomMessage, except?: PeerLink): number {
    return this.openLinks().filter((link) => link !== except && link.send(message)).length;
  }

  close(): void {
    if (this.phase === 'closed') return;
    this.rejectPending(new Error('Cancelled'));
    this.phase = 'closed';
    const links = [...this.linkMap.values()];
    this.linkMap.clear();
    this.expected.clear();
    links.forEach((link) => link.close());
    this.network?.destroy();
    this.network = undefined;
    this.participants.set([]);
  }

  // ---------------------------------------------------------------------------

  private async openNetwork(factory: NetworkFactory, id?: string): Promise<string> {
    const network = factory({
      connection: (channel) => this.network === network && this.acceptConnection(channel),
      error: (err, signalingOnly) =>
        this.network === network && this.handleNetworkError(err, signalingOnly),
      closed: () => {
        if (this.network === network) {
          this.close();
          this.handlers.closed();
        }
      },
    });
    this.network = network;
    this.lostSignal.set(network.lost);
    return network.open(id);
  }

  private metadata(): ConnectMetadata {
    return {
      app: APP_ID,
      v: PROTOCOL_VERSION,
      room: this.roomId,
      name: this.me.name,
      person: this.me.person,
    };
  }

  private addLink(id: string, isHost: boolean, member?: MemberInfo): PeerLink {
    const link = new PeerLink(id, isHost, this.linkHandlers);
    if (member) {
      link.admitted = true;
      link.name.set(member.name);
      link.person.set(member.person);
    }
    this.linkMap.set(id, link);
    this.syncParticipants();
    return link;
  }

  private dial(link: PeerLink): void {
    const channel = this.network?.connect(link.id, this.metadata());
    if (channel) link.attach(channel);
  }

  private acceptConnection(channel: DataChannel): void {
    const meta = readMetadata(channel.metadata);
    if (this.role === 'host') {
      this.acceptGuest(channel, meta);
      return;
    }
    // Гость принимает прямые соединения только от участников той же комнаты.
    if (
      this.phase !== 'open' ||
      meta?.v !== PROTOCOL_VERSION ||
      meta.room !== this.roomId ||
      this.linkMap.has(channel.peer)
    ) {
      channel.close();
      return;
    }
    const member = this.expected.get(channel.peer);
    const link = this.addLink(channel.peer, false, member);
    link.attach(channel);
    if (member) {
      this.expected.delete(channel.peer);
    } else {
      // Объявление от хоста может быть ещё в пути.
      setTimeout(() => {
        if (!link.admitted && this.linkMap.get(link.id) === link) link.close();
      }, ADMISSION_TIMEOUT_MS);
    }
  }

  private acceptGuest(channel: DataChannel, meta: ConnectMetadata | null): void {
    if (this.phase !== 'open' || this.linkMap.has(channel.peer)) {
      channel.close();
      return;
    }
    if (!meta || meta.v !== PROTOCOL_VERSION || meta.room !== this.roomId) {
      this.refuse(channel, { type: 'version-mismatch' });
      return;
    }
    if (this.linkMap.size >= MAX_PARTICIPANTS - 1) {
      this.refuse(channel, { type: 'room-full' });
      return;
    }
    const link = this.addLink(channel.peer, false, {
      id: channel.peer,
      name: meta.name || `#${++this.lastGuestNumber}`,
      person: meta.person,
    });
    link.attach(channel);
  }

  private refuse(channel: DataChannel, message: RoomMessage): void {
    channel.on('open', () => {
      channel.send(message);
      setTimeout(() => channel.close(), REFUSE_CLOSE_DELAY_MS);
    });
  }

  private admit(link: PeerLink, member: MemberInfo): void {
    link.admitted = true;
    link.name.set(member.name);
    link.person.set(member.person);
    this.syncParticipants();
    if (link.isOpen) this.greet(link);
    for (const data of link.held.splice(0)) this.handleData(link, data);
  }

  private memberOf(link: PeerLink): MemberInfo {
    return { id: link.id, name: link.name(), person: link.person() };
  }

  /** Участник открыл канал и точно состоит в комнате. */
  private greet(link: PeerLink): void {
    if (this.role === 'host') {
      const others = this.openLinks().filter((other) => other !== link);
      // Сначала объявляем новичка остальным, чтобы они ждали его соединения.
      others.forEach((other) => other.send({ type: 'peer-joined', member: this.memberOf(link) }));
      link.send({
        type: 'welcome',
        host: { id: this.myId() ?? this.roomId, name: this.me.name, person: this.me.person },
        members: others.map((other) => this.memberOf(other)),
      } satisfies RoomMessage);
    }
    this.syncParticipants();
    this.handlers.ready(link);
  }

  private handleData(link: PeerLink, data: unknown): void {
    const message = parseMessage(data);
    const fromHost = this.role === 'guest' && link.isHost;

    if (fromHost && this.phase === 'joining') {
      this.handleHostReply(link, message);
      return;
    }
    if (!message) return;

    switch (message.type) {
      case 'sync':
        this.handlers.message(link, message);
        break;
      case 'peer-joined':
        if (fromHost) this.handlePeerJoined(message.member);
        break;
      case 'peer-left':
        if (fromHost) this.handlePeerLeft(message.id);
        break;
    }
  }

  /** Первое, что говорит хост, решает, впустили ли нас. */
  private handleHostReply(host: PeerLink, message: RoomMessage | null): void {
    switch (message?.type) {
      case 'welcome': {
        host.name.set(message.host.name);
        host.person.set(message.host.person);
        for (const member of message.members) {
          if (member.id !== this.myId() && !this.linkMap.has(member.id)) {
            this.dial(this.addLink(member.id, false, member));
          }
        }
        this.phase = 'open';
        this.syncParticipants();
        this.resolvePending();
        // Хост уже готов к обмену данными, а мы — только сейчас.
        this.handlers.ready(host);
        break;
      }
      case 'room-full':
        this.rejectPending(new RoomError('room-full'));
        break;
      case 'version-mismatch':
        this.rejectPending(new RoomError('version-mismatch'));
        break;
      default:
        this.rejectPending(new RoomError('version-mismatch'));
    }
  }

  private handlePeerJoined(member: MemberInfo): void {
    if (member.id === this.myId()) return;
    const link = this.linkMap.get(member.id);
    if (link && !link.admitted) this.admit(link, member);
    else if (!link) this.expected.set(member.id, member);
  }

  private handlePeerLeft(id: string): void {
    this.expected.delete(id);
    this.linkMap.get(id)?.close();
  }

  private handleLinkClosed(link: PeerLink): void {
    if (this.linkMap.get(link.id) !== link) return;
    this.linkMap.delete(link.id);

    if (this.role === 'guest' && link.isHost) {
      // Канал хоста определяет комнату.
      if (this.pending) {
        this.rejectPending(new RoomError('host-closed'));
        return;
      }
      if (this.phase !== 'closed') {
        this.close();
        this.handlers.closed();
      }
      return;
    }

    this.syncParticipants();
    const wasInRoom = this.role === 'host' ? link.status() === 'connected' : link.admitted;
    if (!wasInRoom) return;
    if (this.role === 'host') this.broadcast({ type: 'peer-left', id: link.id });
    this.handlers.left(link);
  }

  private handleLinkFailed(link: PeerLink): void {
    if (this.linkMap.get(link.id) !== link) return;
    if (this.role === 'guest' && link.isHost) {
      this.rejectPending(new RoomError('no-answer'));
    } else if (this.role === 'host' || !link.admitted) {
      link.close();
    }
    // Гость оставляет неудавшийся прямой канал в списке: человек всё ещё в комнате,
    // а его изменения придут через хоста.
  }

  private handleNetworkError(err: NetworkError, signalingOnly: boolean): void {
    if (err.code === 'peer-unavailable' && err.peerId && err.peerId !== this.roomId) {
      // Участник ушёл раньше, чем мы до него дозвонились; хост это подтвердит.
      this.linkMap.get(err.peerId)?.close();
      return;
    }
    if (this.rejectPending(err)) return;
    // После подключения обрыв signaling видно через lost() и переподключение идёт само.
    if (!signalingOnly) this.handlers.error(err);
  }

  private openLinks(): PeerLink[] {
    return [...this.linkMap.values()].filter((link) => link.admitted && link.isOpen);
  }

  private syncParticipants(): void {
    this.participants.set([...this.linkMap.values()].filter((link) => link.admitted));
  }

  private waitFor(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectPending(new RoomError('no-answer')), timeoutMs);
      this.pending = { resolve, reject, timer };
    });
  }

  private resolvePending(): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve();
  }

  /** Проваливает текущую операцию. `false`, если ничего не ожидалось. */
  private rejectPending(err: Error): boolean {
    const pending = this.pending;
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.reject(err);
    return true;
  }
}

/** Имя по умолчанию для участника без имени. */
export function displayName(name: string, fallback: string): string {
  return cleanName(name) || fallback;
}
