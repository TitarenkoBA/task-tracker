import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { DataStore } from '../data/data-store';
import { I18n } from '../i18n/i18n.service';
import { TKey } from '../i18n/ru';
import { EntityId } from '../models/entities';
import { IssueService } from '../services/issue.service';
import { PeopleService } from '../services/people.service';
import { ProjectService } from '../services/project.service';
import { SettingsService } from '../services/settings.service';
import { ToastService } from '../services/toast.service';
import { EntityChange, entityToChange } from '../sync/merge';
import { NetworkError, NetworkFactory, PeerJsNetwork } from './network';
import { P2P_CONFIG } from './p2p.config';
import { PeerLink } from './peer-link';
import { projectIdFromRoom, roomIdFor } from './protocol';
import { Room, RoomError, RoomHandlers } from './room';
import { filterIncoming, filterOutgoing, projectSnapshot } from './scope';

/** Как создавать сетевой узел. В тестах подменяется сетью в памяти. */
export const NETWORK_FACTORY = new InjectionToken<NetworkFactory>('NETWORK_FACTORY', {
  providedIn: 'root',
  factory: () => {
    const config = inject(P2P_CONFIG);
    return (handlers) => new PeerJsNetwork(config, handlers);
  },
});

export type CollabStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface Participant {
  peerId: string;
  name: string;
  personId: string | null;
  connected: boolean;
  isHost: boolean;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/** Сколько раз подряд пытаться стать хостом/гостем, если комнату одновременно перехватывают. */
const MAX_HANDOVER_ATTEMPTS = 4;

/**
 * Совместная работа над проектом в реальном времени.
 *
 * - Комната проекта — `tt-<id проекта>`. Ссылка-приглашение содержит её ID.
 * - Подключение: попробовать войти в комнату; если её никто не держит — стать хостом.
 *   Поэтому, когда хост уходит, кто-то из оставшихся сам становится новым хостом,
 *   а остальные переподключаются к нему.
 * - При подключении участники обмениваются снимком проекта, дальше — изменениями.
 *   Слияние — тот же CRDT (LWW по полям), что и при импорте: никакие данные не затираются.
 * - Чужие проекты на устройстве никуда не отправляются и не могут быть изменены (scope.ts).
 */
@Injectable({ providedIn: 'root' })
export class CollaborationService {
  private readonly store = inject(DataStore);
  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly people = inject(PeopleService);
  private readonly settings = inject(SettingsService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly networkFactory = inject(NETWORK_FACTORY);

  private readonly room = signal<Room | null>(null);
  /** Проект, над которым идёт совместная работа (даже пока переподключаемся). */
  readonly projectId = signal<EntityId | null>(null);
  readonly status = signal<CollabStatus>('idle');
  readonly error = signal<TKey | null>(null);
  /** Получен ли снимок проекта от комнаты (для того, кто вошёл по приглашению). */
  readonly synced = signal(false);

  readonly role = computed(() => this.room()?.role ?? null);
  readonly lost = computed(() => this.room()?.lost() ?? false);
  readonly participants = computed<Participant[]>(() =>
    (this.room()?.participants() ?? []).map((link) => ({
      peerId: link.id,
      // Карточка человека синхронизируется и меняется сразу, имя из метаданных — только при входе.
      name: this.people.get(link.person())?.name || link.name() || '?',
      personId: link.person(),
      connected: link.status() === 'connected',
      isHost: link.isHost,
    })),
  );
  readonly active = computed(() => this.projectId() !== null);

  /** Через какое соединение пришли изменения, которые сейчас применяются (для пересылки). */
  private relaySource: PeerLink | null = null;
  private generation = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;

  constructor() {
    const off = this.store.onChange((changes, origin) => this.onStoreChange(changes, origin));
    // Закрываем каналы сразу, чтобы другие не ждали таймаута.
    const onPageHide = (): void => this.room()?.close();
    globalThis.addEventListener?.('pagehide', onPageHide);
    inject(DestroyRef).onDestroy(() => {
      off();
      globalThis.removeEventListener?.('pagehide', onPageHide);
      this.stop();
    });
  }

  /** ID комнаты и ссылка-приглашение проекта. */
  roomId(projectId: EntityId): string {
    return roomIdFor(projectId);
  }

  inviteLink(projectId: EntityId): string {
    const base = globalThis.document?.baseURI ?? '/';
    return new URL(`join/${roomIdFor(projectId)}`, base).toString();
  }

  /** Начать (или продолжить) совместную работу над своим проектом. */
  async start(projectId: EntityId): Promise<boolean> {
    if (!this.projects.get(projectId)) return false;
    this.settings.set('collabProjectId', projectId);
    return this.connect(projectId, true);
  }

  /**
   * Войти по приглашению. Если проекта у нас ещё нет, стать хостом нельзя:
   * нужен кто-то в сети, кто его пришлёт.
   */
  async join(roomId: string): Promise<boolean> {
    const projectId = projectIdFromRoom(roomId);
    if (!projectId) {
      this.fail('collab.error.badLink');
      return false;
    }
    this.settings.set('collabProjectId', projectId);
    return this.connect(projectId, !!this.projects.get(projectId));
  }

  /** После перезапуска приложения продолжить сессию, если она была. */
  resume(): void {
    const projectId = this.settings.collabProjectId();
    if (projectId && this.projects.get(projectId) && !this.active()) {
      void this.connect(projectId, true);
    }
  }

  /** Выйти из совместной работы. Данные проекта остаются на устройстве. */
  leave(): void {
    this.settings.set('collabProjectId', null);
    this.stop();
  }

  // ---------------------------------------------------------------------------

  private stop(): void {
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.reconnectAttempts = 0;
    this.room()?.close();
    this.room.set(null);
    this.projectId.set(null);
    this.status.set('idle');
    this.error.set(null);
    this.synced.set(false);
  }

  private async connect(projectId: EntityId, allowHost: boolean): Promise<boolean> {
    if (this.projectId() !== projectId) {
      this.stop();
      this.projectId.set(projectId);
    }
    const generation = ++this.generation;
    clearTimeout(this.reconnectTimer);
    this.room()?.close();
    this.room.set(null);
    this.error.set(null);
    this.status.set(this.reconnectAttempts ? 'reconnecting' : 'connecting');
    this.synced.set(!!this.projects.get(projectId));

    const roomId = roomIdFor(projectId);
    const me = { name: this.myName(), person: this.people.me()?.id ?? null };

    for (let attempt = 0; attempt < MAX_HANDOVER_ATTEMPTS; attempt++) {
      try {
        const room = await Room.join(this.networkFactory, roomId, me, this.handlers(generation));
        return this.opened(room, generation);
      } catch (error) {
        if (generation !== this.generation) return false;
        if (!(error instanceof NetworkError && error.code === 'peer-unavailable')) {
          return this.connectFailed(error, projectId, generation);
        }
      }
      // Комнату никто не держит.
      if (!allowHost) {
        this.fail('collab.error.noHost');
        return false;
      }
      try {
        const room = await Room.host(this.networkFactory, roomId, me, this.handlers(generation));
        return this.opened(room, generation);
      } catch (error) {
        if (generation !== this.generation) return false;
        // Кто-то стал хостом одновременно с нами — подключимся к нему.
        if (!(error instanceof NetworkError && error.code === 'unavailable-id')) {
          return this.connectFailed(error, projectId, generation);
        }
      }
    }
    return this.connectFailed(new RoomError('no-answer'), projectId, generation);
  }

  private opened(room: Room, generation: number): boolean {
    if (generation !== this.generation) {
      room.close();
      return false;
    }
    this.room.set(room);
    this.status.set('online');
    this.reconnectAttempts = 0;
    return true;
  }

  private connectFailed(error: unknown, projectId: EntityId, generation: number): boolean {
    if (generation !== this.generation) return false;
    const code = errorKey(error);
    // Сетевые сбои — повторяем в фоне; ошибки комнаты (переполнена, другая версия) — нет.
    if (error instanceof NetworkError && (error.code === 'network' || error.code === 'timeout')) {
      this.scheduleReconnect(projectId, code);
    } else {
      this.fail(code);
    }
    return false;
  }

  private fail(code: TKey): void {
    this.status.set('error');
    this.error.set(code);
  }

  private scheduleReconnect(projectId: EntityId, reason: TKey | null = null): void {
    this.room()?.close();
    this.room.set(null);
    this.status.set('reconnecting');
    this.error.set(reason);
    const generation = this.generation;
    // Случайная добавка, чтобы оставшиеся участники не пытались стать хостом одновременно.
    const delay =
      Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS) +
      Math.random() * 1500;
    this.reconnectAttempts++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (generation === this.generation && this.projectId() === projectId) {
        void this.connect(projectId, !!this.projects.get(projectId));
      }
    }, delay);
  }

  private handlers(generation: number): RoomHandlers {
    const current = (): boolean => generation === this.generation;
    return {
      ready: (link) => current() && this.sendSnapshot(link),
      message: (link, message) => current() && this.receive(link, message.changes, message.initial),
      left: (link) => {
        if (current() && link.name()) {
          this.toasts.show(this.i18n.t('collab.left', { name: link.name() }));
        }
      },
      closed: () => {
        const projectId = this.projectId();
        if (current() && projectId) this.scheduleReconnect(projectId);
      },
      error: (err) => {
        if (current()) this.toasts.error(this.i18n.t(errorKey(err)));
      },
    };
  }

  /**
   * Участник готов к обмену — отправляем ему снимок проекта. Пишем прямо в его канал:
   * у гостя это происходит в момент приветствия хоста, когда Room.join() ещё не вернул
   * комнату в этот сервис.
   */
  private sendSnapshot(link: PeerLink): void {
    const projectId = this.projectId();
    if (!projectId) return;
    if (link.name() && !link.isHost && this.room()?.role === 'host') {
      this.toasts.show(this.i18n.t('collab.joined', { name: link.name() }));
    }
    const me = this.people.me()?.id;
    const changes = projectSnapshot(this.store.raw, projectId, me ? [me] : []).map(
      ({ collection, entity }) => entityToChange(collection, entity),
    );
    link.send({ type: 'sync', changes, initial: true });
  }

  private receive(link: PeerLink, changes: EntityChange[], initial: boolean): void {
    const projectId = this.projectId();
    if (!projectId) return;
    const accepted = filterIncoming(changes, this.store.raw, projectId, this.participantPeople());
    this.relaySource = link;
    try {
      this.store.applyChanges(accepted, 'remote');
    } finally {
      this.relaySource = null;
    }
    if (accepted.some((c) => c.collection === 'issues')) {
      this.issues.resolveNumberConflicts(projectId);
    }
    if (initial && this.projects.get(projectId)) this.synced.set(true);
  }

  private onStoreChange(changes: EntityChange[], origin: 'local' | 'remote' | 'import'): void {
    const room = this.room();
    const projectId = this.projectId();
    if (!room || !projectId) return;
    if (origin === 'remote') {
      // Хост пересылает чужие изменения остальным: вдруг у них нет прямой связи друг с другом.
      // Слияние идемпотентно, поэтому дубли безвредны, а цикла нет — дальше хоста не уходит.
      if (room.role === 'host' && this.relaySource && changes.length) {
        room.broadcast({ type: 'sync', changes, initial: false }, this.relaySource);
      }
      return;
    }
    const outgoing = filterOutgoing(changes, this.store.raw, projectId, this.participantPeople());
    if (outgoing.length) room.broadcast({ type: 'sync', changes: outgoing, initial: false });
  }

  private participantPeople(): EntityId[] {
    const ids = this.participants()
      .map((p) => p.personId)
      .filter((id): id is string => !!id);
    const me = this.people.me()?.id;
    return me ? [...ids, me] : ids;
  }

  private myName(): string {
    const me = this.people.me();
    return me && !this.people.hasDefaultName(me) ? me.name : '';
  }
}

function errorKey(error: unknown): TKey {
  if (error instanceof RoomError) return `collab.error.${error.code}` as TKey;
  if (error instanceof NetworkError) {
    switch (error.code) {
      case 'browser-incompatible':
        return 'collab.error.browser';
      case 'network':
      case 'timeout':
        return 'collab.error.network';
      case 'peer-unavailable':
        return 'collab.error.noHost';
      default:
        return 'collab.error.unknown';
    }
  }
  return 'collab.error.unknown';
}
