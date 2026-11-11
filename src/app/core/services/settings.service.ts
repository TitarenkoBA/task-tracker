import { Injectable, effect, signal } from '@angular/core';
import { EntityId } from '../models/entities';

export type ThemePreference = 'light' | 'dark' | 'system';

interface DeviceSettings {
  theme: ThemePreference;
  /** Кто «я» на этом устройстве (id участника). */
  currentUserId: EntityId | null;
  /** Последний открытый проект — чтобы вкладки «Доска» и «Бэклог» знали, что показать. */
  lastProjectId: EntityId | null;
}

const STORAGE_KEY = 'task-tracker.settings';
const DEFAULTS: DeviceSettings = { theme: 'system', currentUserId: null, lastProjectId: null };

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

  constructor() {
    effect(() => this.write(this.state()));
  }

  set<K extends keyof DeviceSettings>(key: K, value: DeviceSettings[K]): void {
    this.state.update((s) => (s[key] === value ? s : { ...s, [key]: value }));
  }

  private read(): DeviceSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DeviceSettings>) } : { ...DEFAULTS };
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
