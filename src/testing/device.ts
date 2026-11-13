import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataStore } from '../app/core/data/data-store';
import { I18n } from '../app/core/i18n/i18n.service';
import { CollaborationService, NETWORK_FACTORY } from '../app/core/p2p/collaboration.service';
import { ChatService } from '../app/core/services/chat.service';
import { IssueService } from '../app/core/services/issue.service';
import { PeopleService } from '../app/core/services/people.service';
import { ProjectService } from '../app/core/services/project.service';
import { SettingsService } from '../app/core/services/settings.service';
import { SprintService } from '../app/core/services/sprint.service';
import { ToastService } from '../app/core/services/toast.service';
import { MemoryStorage } from '../app/core/storage/memory-storage';
import { STORAGE_ADAPTER } from '../app/core/storage/storage-adapter';
import { MemoryHub } from './memory-network';

/**
 * Отдельное «устройство» для тестов совместной работы: своя база, свои сервисы,
 * общая с другими устройствами сеть в памяти. Перед использованием нужен
 * `setupTestStore()` (он настраивает TestBed).
 */
export async function createDevice(hub: MemoryHub, name: string) {
  const storage = new MemoryStorage();
  const injector = createEnvironmentInjector(
    [
      { provide: STORAGE_ADAPTER, useValue: storage },
      { provide: NETWORK_FACTORY, useValue: hub.factory },
      DataStore,
      SettingsService,
      I18n,
      ToastService,
      PeopleService,
      ProjectService,
      IssueService,
      SprintService,
      ChatService,
      CollaborationService,
    ],
    TestBed.inject(EnvironmentInjector),
  );
  const get = <T>(token: new (...args: never[]) => T): T => injector.get(token);
  const store = get(DataStore);
  await store.init();
  const people = get(PeopleService);
  const me = people.ensureMe();
  people.update(me.id, { name });
  return {
    injector,
    storage,
    store,
    people,
    me: people.get(me.id)!,
    projects: get(ProjectService),
    issues: get(IssueService),
    sprints: get(SprintService),
    chat: get(ChatService),
    collab: get(CollaborationService),
    toasts: get(ToastService),
    destroy: () => injector.destroy(),
  };
}

export type Device = Awaited<ReturnType<typeof createDevice>>;
