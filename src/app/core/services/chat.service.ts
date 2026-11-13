import { Injectable, computed, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { EntityId, Message } from '../models/entities';
import { PeopleService } from './people.service';
import { SettingsService } from './settings.service';

/** Не больше этого — длиннее не примут другие участники (см. p2p/scope.ts). */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Чат проекта. Сообщения — обычные данные (коллекция `messages`): хранятся на устройстве,
 * работают офлайн и синхронизируются с участниками совместной работы вместе с проектом.
 * Поэтому новый участник сразу видит историю, а написанное офлайн уйдёт при подключении.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly store = inject(DataStore);
  private readonly people = inject(PeopleService);
  private readonly settings = inject(SettingsService);

  private readonly byProject = computed(() => {
    const map = new Map<EntityId, Message[]>();
    for (const message of this.store.list('messages')()) {
      map.set(message.projectId, [...(map.get(message.projectId) ?? []), message]);
    }
    for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    return map;
  });

  messages(projectId: EntityId): Message[] {
    return this.byProject().get(projectId) ?? [];
  }

  send(projectId: EntityId, text: string): Message | undefined {
    const body = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!body) return undefined;
    const message = this.store.create('messages', {
      projectId,
      authorId: this.people.me()?.id ?? null,
      text: body,
    });
    this.markRead(projectId);
    return message;
  }

  remove(id: EntityId): void {
    this.store.remove('messages', id);
  }

  /** Непрочитанные сообщения от других в чате проекта. */
  unread(projectId: EntityId): number {
    const readAt = this.settings.chatReadAt()[projectId] ?? 0;
    const me = this.people.me()?.id;
    return this.messages(projectId).filter((m) => m.createdAt > readAt && m.authorId !== me).length;
  }

  markRead(projectId: EntityId): void {
    const latest = this.messages(projectId).at(-1)?.createdAt ?? Date.now();
    const current = this.settings.chatReadAt();
    if ((current[projectId] ?? 0) >= latest) return;
    this.settings.set('chatReadAt', { ...current, [projectId]: latest });
  }
}
