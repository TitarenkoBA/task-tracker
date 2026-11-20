import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { DataStore } from '../data/data-store';
import { TKey } from '../i18n/ru';
import { EntityId } from '../models/entities';
import { CollabStatus } from '../p2p/collaboration.service';
import { filterIncoming, filterOutgoing, projectSnapshot } from '../p2p/scope';
import { IssueService } from '../services/issue.service';
import { PeopleService } from '../services/people.service';
import { ProjectService } from '../services/project.service';
import { SettingsService } from '../services/settings.service';
import { EntityChange, entityToChange } from './merge';
import { dropboxDownload, dropboxList, dropboxUpload } from './dropbox-sync';
import {
  SealedChange,
  decodeSalt,
  deriveKey,
  dropboxSalt,
  openChange,
  sealChange,
} from './field-crypto';
import { TeamRole, WriteGate } from './write-gate';

/** Участник командного сервера. Токен сюда не входит — его показывают один раз при создании. */
export interface TeamMember {
  id: string;
  name: string;
  role: TeamRole;
  createdAt: number;
}

interface Envelope {
  plainHash: string;
  change: SealedChange;
}

const SENT_KEY = 'task-tracker.hub-sent';

/**
 * Обмен общими проектами через командный сервер или папку Dropbox.
 * P2P этот сервис не трогает: при режиме «вместе» он просто молчит.
 * На проводе — те же изменения, что и между браузерами, только текстовые поля зашифрованы.
 */
@Injectable({ providedIn: 'root' })
export class TeamSyncService {
  private readonly store = inject(DataStore);
  private readonly settings = inject(SettingsService);
  private readonly people = inject(PeopleService);
  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly gate = inject(WriteGate);

  readonly status = signal<CollabStatus>('idle');
  readonly error = signal<TKey | null>(null);
  readonly role = signal<TeamRole | null>(null);
  readonly members = signal<TeamMember[]>([]);
  /** Проекты, для которых обмен уже прошёл хотя бы раз. */
  readonly ready = signal<ReadonlySet<EntityId>>(new Set());
  /** Токен, выданный только что. Показывается один раз. */
  readonly issuedToken = signal<string | null>(null);

  private generation = 0;
  private key: CryptoKey | null = null;
  private socket: WebSocket | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly sent = new Set<string>(this.readSent());
  private pushQueue: Promise<void> = Promise.resolve();

  constructor() {
    const off = this.store.onChange((changes, origin) => {
      if (origin === 'remote' || this.settings.syncMode() === 'p2p') return;
      void this.deliver(changes);
    });
    effect(() => {
      this.store.ready();
      this.settings.syncMode();
      this.settings.serverUrl();
      this.settings.serverToken();
      this.settings.contentPassphrase();
      this.settings.dropboxToken();
      this.settings.dropboxFolder();
      this.settings.collabProjectIds();
      untracked(() => void this.connect());
    });
    inject(DestroyRef).onDestroy(() => {
      off();
      this.generation++;
      this.socket?.close();
      clearTimeout(this.timer);
    });
  }

  async createMember(name: string, role: TeamRole): Promise<void> {
    const created = await this.api('/v1/members', {
      method: 'POST',
      body: JSON.stringify({ name, role }),
    });
    this.issuedToken.set(String(created['token']));
    await this.refreshMembers();
  }

  async revokeMember(id: string): Promise<void> {
    await this.api(`/v1/members/${id}`, { method: 'DELETE' });
    await this.refreshMembers();
  }

  // -------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.store.ready()) return;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.ready.set(new Set());
    const mode = this.settings.syncMode();
    if (mode === 'p2p') {
      this.status.set('idle');
      this.error.set(null);
      this.role.set(null);
      this.gate.role.set(null);
      return;
    }
    if (!this.settings.contentPassphrase()) {
      this.fail('sync.error.passphrase');
      return;
    }
    this.status.set(this.status() === 'online' ? 'reconnecting' : 'connecting');
    this.error.set(null);
    try {
      if (mode === 'server') await this.connectServer(generation);
      else await this.connectDropbox(generation);
    } catch {
      if (generation === this.generation) this.failLater(generation);
    }
  }

  private async connectServer(generation: number): Promise<void> {
    const url = this.settings.serverUrl().replace(/\/$/, '');
    const token = this.settings.serverToken();
    if (!url || !token) {
      this.fail('sync.error.credentials');
      return;
    }
    const meta = await this.api('/v1/meta');
    if (generation !== this.generation) return;
    this.key = await deriveKey(this.settings.contentPassphrase(), decodeSalt(String(meta['salt'])));
    const me = await this.api('/v1/me');
    if (generation !== this.generation) return;
    this.applyRole(me['role'] as TeamRole);
    if (me['role'] === 'owner') await this.refreshMembers();
    this.openSocket(generation, url, token);
  }

  private openSocket(generation: number, url: string, token: string): void {
    const socket = new WebSocket(socketUrl(url));
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      void this.onSocket(JSON.parse(String(event.data)) as Record<string, unknown>);
    };
    socket.onclose = () => {
      if (generation !== this.generation || this.socket !== socket) return;
      this.socket = null;
      this.failLater(generation);
    };
    socket.onerror = () => socket.close();
  }

  private async onSocket(message: Record<string, unknown>): Promise<void> {
    if (message['type'] === 'hello') {
      this.status.set('online');
      this.error.set(null);
      for (const projectId of this.settings.collabProjectIds()) {
        this.socket?.send(JSON.stringify({ type: 'subscribe', projectId }));
      }
      return;
    }
    if (message['type'] === 'error' && message['error'] === 'forbidden') {
      this.fail('sync.error.forbidden');
      return;
    }
    const projectId = message['projectId'];
    if (typeof projectId !== 'string') return;
    if (message['type'] === 'snapshot' || message['type'] === 'changes') {
      const changes = Array.isArray(message['changes'])
        ? (message['changes'] as SealedChange[])
        : [];
      await this.ingest(projectId, changes);
      if (message['type'] === 'snapshot') await this.pushSnapshot(projectId);
      this.markReady(projectId);
    }
  }

  private async connectDropbox(generation: number): Promise<void> {
    const token = this.settings.dropboxToken();
    const folder = this.settings.dropboxFolder() || '/task-tracker';
    if (!token) {
      this.fail('sync.error.credentials');
      return;
    }
    this.key = await deriveKey(this.settings.contentPassphrase(), await dropboxSalt(folder));
    this.applyRole('editor');
    const pull = async (): Promise<void> => {
      if (generation !== this.generation) return;
      const files = await dropboxList(token, folder);
      const mine = `${this.store.replicaId}.jsonl`;
      for (const file of files) {
        if (file.name === mine) continue;
        const text = await dropboxDownload(token, file.path);
        if (!text) continue;
        await this.ingestLines(text);
      }
      for (const projectId of this.settings.collabProjectIds()) {
        await this.pushSnapshot(projectId);
        this.markReady(projectId);
      }
      if (generation !== this.generation) return;
      this.status.set('online');
      this.error.set(null);
      this.timer = setTimeout(() => void pull().catch(() => this.failLater(generation)), 3000);
    };
    await pull();
  }

  private async ingestLines(text: string): Promise<void> {
    const byProject = new Map<string, SealedChange[]>();
    for (const line of text.split('\n')) {
      if (!line) continue;
      let row: { projectId?: string; change?: SealedChange };
      try {
        row = JSON.parse(line) as { projectId?: string; change?: SealedChange };
      } catch {
        continue;
      }
      if (!row.projectId || !row.change) continue;
      if (!this.settings.collabProjectIds().includes(row.projectId)) continue;
      byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.change]);
    }
    for (const [projectId, changes] of byProject) await this.ingest(projectId, changes);
  }

  private async ingest(projectId: EntityId, sealed: SealedChange[]): Promise<void> {
    if (!this.key || !sealed.length) return;
    const opened: EntityChange[] = [];
    for (const change of sealed) {
      try {
        opened.push((await openChange(change, this.key)) as EntityChange);
      } catch {
        // Чужой ключ или битый кадр — эту запись пропускаем.
      }
    }
    const me = this.people.me()?.id;
    const accepted = filterIncoming(opened, this.store.raw, projectId, me ? [me] : []);
    this.store.applyChanges(accepted, 'remote');
    if (accepted.some((change) => change.collection === 'issues')) {
      this.issues.resolveNumberConflicts(projectId);
    }
  }

  private async pushSnapshot(projectId: EntityId): Promise<void> {
    if (!this.projects.get(projectId) || this.role() === 'viewer') return;
    const me = this.people.me()?.id;
    const changes = projectSnapshot(this.store.raw, projectId, me ? [me] : []).map(
      ({ collection, entity }) => entityToChange(collection, entity),
    );
    await this.deliver(changes);
  }

  private deliver(changes: EntityChange[]): Promise<void> {
    const run = this.pushQueue.then(() => this.send(changes));
    this.pushQueue = run.catch(() => undefined);
    return run;
  }

  private async send(changes: EntityChange[]): Promise<void> {
    if (!this.key || this.role() === 'viewer' || this.settings.syncMode() === 'p2p') return;
    const projects = this.settings.collabProjectIds();
    for (const projectId of projects) {
      const outgoing = filterOutgoing(changes, this.store.raw, projectId, this.peopleIds());
      const fresh: Envelope[] = [];
      for (const change of outgoing) {
        const plainHash = await digest(change);
        if (this.sent.has(plainHash)) continue;
        fresh.push({ plainHash, change: await sealChange(change, this.key) });
      }
      if (!fresh.length) continue;
      if (this.settings.syncMode() === 'server') {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) continue;
        this.socket.send(JSON.stringify({ type: 'push', projectId, changes: fresh }));
      } else {
        await this.appendDropbox(fresh.map((item) => ({ projectId, ...item })));
      }
      for (const item of fresh) this.sent.add(item.plainHash);
      this.writeSent();
    }
  }

  private async appendDropbox(rows: unknown[]): Promise<void> {
    const token = this.settings.dropboxToken();
    const folder = this.settings.dropboxFolder() || '/task-tracker';
    const path = `${folder}/${this.store.replicaId}.jsonl`;
    const existing = (await dropboxDownload(token, path)) ?? '';
    const body = existing + rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await dropboxUpload(token, path, body);
  }

  private async refreshMembers(): Promise<void> {
    const listed = await this.api('/v1/members');
    this.members.set((listed['members'] as TeamMember[]) ?? []);
  }

  private async api(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const url = this.settings.serverUrl().replace(/\/$/, '');
    const response = await fetch(url + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.settings.serverToken()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(body['error'] ?? response.status));
    return body;
  }

  private applyRole(role: TeamRole): void {
    this.role.set(role);
    this.gate.role.set(role);
  }

  private markReady(projectId: EntityId): void {
    if (this.ready().has(projectId)) return;
    const next = new Set(this.ready());
    next.add(projectId);
    this.ready.set(next);
  }

  private peopleIds(): EntityId[] {
    const me = this.people.me()?.id;
    return me ? [me] : [];
  }

  private fail(key: TKey): void {
    this.status.set('error');
    this.error.set(key);
  }

  private failLater(generation: number): void {
    if (generation !== this.generation) return;
    this.status.set('reconnecting');
    this.error.set('sync.error.network');
    this.timer = setTimeout(() => void this.connect(), 2000);
  }

  private readSent(): string[] {
    try {
      const raw = localStorage.getItem(SENT_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  private writeSent(): void {
    try {
      localStorage.setItem(SENT_KEY, JSON.stringify([...this.sent]));
    } catch {
      // Память браузера кончилась — повторная отправка безвредна, сервер узнает хеш.
    }
  }
}

function socketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/v1/sync';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function digest(change: EntityChange): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(change));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
