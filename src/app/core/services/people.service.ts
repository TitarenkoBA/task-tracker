import { Injectable, computed, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { I18n } from '../i18n/i18n.service';
import { ru } from '../i18n/ru';
import { en } from '../i18n/en';
import { EntityId, PROJECT_COLORS, Person } from '../models/entities';
import { SettingsService } from './settings.service';

/** Участники: люди, которых можно назначать исполнителями. */
@Injectable({ providedIn: 'root' })
export class PeopleService {
  private readonly store = inject(DataStore);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18n);

  readonly people = computed(() =>
    [...this.store.list('people')()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** Текущий пользователь этого устройства. */
  readonly me = computed(() => {
    const id = this.settings.currentUserId();
    return this.people().find((p) => p.id === id) ?? null;
  });

  get(id: EntityId | null | undefined): Person | undefined {
    return this.store.get('people', id);
  }

  create(name: string, email = ''): Person {
    const color = PROJECT_COLORS[this.store.list('people')().length % PROJECT_COLORS.length];
    return this.store.create('people', { name: name.trim(), email: email.trim(), color });
  }

  update(id: EntityId, patch: Partial<Pick<Person, 'name' | 'email' | 'color'>>): void {
    this.store.update('people', id, patch);
  }

  /** Удалить участника и снять его со всех задач. */
  remove(id: EntityId): void {
    for (const issue of this.store.list('issues')()) {
      if (issue.assigneeId === id) this.store.update('issues', issue.id, { assigneeId: null });
    }
    this.store.remove('people', id);
    if (this.settings.currentUserId() === id) this.settings.set('currentUserId', null);
  }

  /** При первом запуске создаёт профиль «Я» / «Me», чтобы было кого назначать. */
  ensureMe(): Person {
    const existing = this.me();
    if (existing) return existing;
    const person = this.create(this.i18n.t('people.me'));
    this.settings.set('currentUserId', person.id);
    return person;
  }

  /** Имя профиля ещё стандартное («Я» / «Me») — пользователь его не менял. */
  hasDefaultName(person: Person | null | undefined): boolean {
    return !!person && DEFAULT_ME_NAMES.includes(person.name);
  }

  /** После смены языка перевести стандартное имя профиля. */
  translateDefaultName(): void {
    const me = this.me();
    if (this.hasDefaultName(me)) this.update(me!.id, { name: this.i18n.t('people.me') });
  }

  setMe(id: EntityId): void {
    this.settings.set('currentUserId', id);
  }
}

const DEFAULT_ME_NAMES = [ru['people.me'], en['people.me'] as string];

/** Инициалы для аватара: «Иван Петров» → «ИП». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}
