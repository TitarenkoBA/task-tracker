import { Injectable, effect, signal } from '@angular/core';
import type { Lang } from '../i18n/lang';
import { EntityId } from '../models/entities';

export type ThemePreference = 'light' | 'dark' | 'system';
/** Как устройства обмениваются общими проектами. */
export type SyncMode = 'p2p' | 'server' | 'dropbox';

export interface DeviceSettings {
  theme: ThemePreference;
  /** Кто «я» на этом устройстве (id участника). */
  currentUserId: EntityId | null;
  /** Последний открытый проект — чтобы вкладки «Доска» и «Бэклог» знали, что показать. */
  lastProjectId: EntityId | null;
  /** Язык интерфейса; 
ull — определить по языку браузера. */
  language: Lang | null;
  /** Проекты, над которыми идёт совместная работа, — чтобы продолжить её после перезапуска. */
  collabProjectIds: EntityId[];
  /** P2P — напрямую между браузерами. Сервер и Dropbox — через хаб, с шифрованием полей. */
  syncMode: SyncMode;
  /** Адрес командного сервера, без завершающего слэша. */
  serverUrl: string;
  /** Личный токен доступа. На сервере хранится только его хеш. */
  serverToken: string;
  /** Парольная фраза команды. Из неё выводится ключ шифрования, на сервер она не уходит. */
  contentPassphrase: string;
  /** Токен доступа Dropbox (scope files.content.write). */
  dropboxToken: string;
  /** Папка в Dropbox, своя на команду. */
  dropboxFolder: string;
  /** Когда чат проекта прочитан в последний раз (мс), по id проекта. */
  chatReadAt: Record<EntityId, number>;
}

const STORAGE_KEY = 'task-tracker.settings';
const DEFAULTS: DeviceSettings = {
  theme: 'system',
  currentUserId: null,
  lastProjectId: null,
  language: null,
  collabProjectIds: [],
  chatReadAt: {},
  syncMode: 'p2p',
  serverUrl: '',
  serverToken: '',
  contentPassphrase: '',
  dropboxToken: '',
  dropboxFolder: '/task-tracker',
};

/**
 * Настройки конкретного устройства (тема, текущий пользователь).
 * Хранятся в localStorage и НЕ синхронизируются между устройствами —
 * в отличие от данных в DataStore.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly state = signal<DeviceSettings>(this.read());

  readonly theme = () => this.state().theme;
  readonly currentUserId = () => this.state().currentUserId;
  readonly lastProjectId = () => this.state().lastProjectId;
  readonly language = () => this.state().language;
  readonly collabProjectIds = () => this.state().collabProjectIds;
  readonly chatReadAt = () => this.state().chatReadAt;
  readonly syncMode = () => this.state().syncMode;
  readonly serverUrl = () => this.state().serverUrl;
  readonly serverToken = () => this.state().serverToken;
  readonly contentPassphrase = () => this.state().contentPassphrase;
  readonly dropboxToken = () => this.state().dropboxToken;
  readonly dropboxFolder = () => this.state().dropboxFolder;

  constructor() {
    effect(() => this.write(this.state()));
  }

  set<K extends keyof DeviceSettings>(key: K, value: DeviceSettings[K]): void {
    this.state.update((s) => (s[key] === value ? s : { ...s, [key]: value }));
  }

  /** Несколько полей сразу, чтобы подключение не перезапускалось на каждое поле. */
  patch(partial: Partial<DeviceSettings>): void {
    this.state.update((current) => ({ ...current, ...partial }));
  }

  private read(): DeviceSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const { collabProjectId, ...saved } = JSON.parse(raw) as Partial<DeviceSettings> & {
        /** До совместной работы над несколькими проектами сразу — один проект. */
        collabProjectId?: EntityId | null;
      };
      const settings = { ...DEFAULTS, ...saved };
      if (!saved.collabProjectIds && collabProjectId) settings.collabProjectIds = [collabProjectId];
      return settings;
    } catch {
      return { ...DEFAULTS };
    }
  }

  private write(value: DeviceSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // localStorage может быть недоступен (приватный режим) — это не критично.
    }
  }
}
