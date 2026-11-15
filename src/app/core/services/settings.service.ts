import { Injectable, effect, signal } from '@angular/core';
import type { Lang } from '../i18n/lang';
import { EntityId } from '../models/entities';

export type ThemePreference = 'light' | 'dark' | 'system';

interface DeviceSettings {
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

  constructor() {
    effect(() => this.write(this.state()));
  }

  set<K extends keyof DeviceSettings>(key: K, value: DeviceSettings[K]): void {
    this.state.update((s) => (s[key] === value ? s : { ...s, [key]: value }));
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
