import { Injectable, computed, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { defaultStatuses } from '../models/catalog';
import { EntityId, Project, ProjectColor, WorkflowStatus } from '../models/entities';
import { SettingsService } from './settings.service';

export interface ProjectInput {
  name: string;
  key: string;
  description?: string;
  color: ProjectColor;
}

/** Ключ проекта: 2–10 латинских букв/цифр, начинается с буквы. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly store = inject(DataStore);
  private readonly settings = inject(SettingsService);

  readonly projects = computed(() =>
    [...this.store.list('projects')()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** Текущий проект: последний открытый или первый по алфавиту. */
  readonly current = computed(
    () => this.get(this.settings.lastProjectId()) ?? this.projects()[0] ?? null,
  );

  select(id: EntityId): void {
    this.settings.set('lastProjectId', id);
  }

  get(id: EntityId | null | undefined): Project | undefined {
    return this.store.get('projects', id);
  }

  byKey(key: string): Project | undefined {
    const upper = key.toUpperCase();
    return this.projects().find((p) => p.key === upper);
  }

  /** Предложить ключ по названию: «Мобильное приложение» → «MP». */
  suggestKey(name: string): string {
    const translit = transliterate(name).toUpperCase();
    const words = translit.split(/[^A-Z0-9]+/).filter(Boolean);
    let key =
      words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
    key = key.replace(/^[0-9]+/, '').slice(0, 10);
    if (key.length < 2) key = (key + 'PRJ').slice(0, 3);
    let candidate = key;
    for (let i = 2; this.byKey(candidate); i++) candidate = `${key.slice(0, 8)}${i}`;
    return candidate;
  }

  /** Проверка ключа. Возвращает текст ошибки или `null`. */
  validateKey(key: string, exceptId?: EntityId): string | null {
    if (!PROJECT_KEY_PATTERN.test(key)) {
      return 'От 2 до 10 латинских букв или цифр, первая — буква';
    }
    const existing = this.byKey(key);
    if (existing && existing.id !== exceptId) return 'Такой ключ уже используется';
    return null;
  }

  create(input: ProjectInput): Project {
    const key = input.key.toUpperCase();
    const error = this.validateKey(key);
    if (error) throw new Error(error);
    return this.store.create('projects', {
      name: input.name.trim(),
      key,
      description: input.description?.trim() ?? '',
      color: input.color,
      statuses: defaultStatuses(),
      issueCounter: 0,
    });
  }

  update(id: EntityId, patch: Partial<Pick<Project, 'name' | 'description' | 'color'>>): void {
    this.store.update('projects', id, patch);
  }

  /**
   * Сохранить список статусов. Задачи из удалённых статусов
   * переносятся в первый статус списка.
   */
  updateStatuses(id: EntityId, statuses: WorkflowStatus[]): void {
    if (!statuses.length) throw new Error('Нужен хотя бы один статус');
    const ids = new Set(statuses.map((s) => s.id));
    for (const issue of this.store.list('issues')()) {
      if (issue.projectId === id && !ids.has(issue.statusId)) {
        this.store.update('issues', issue.id, { statusId: statuses[0].id });
      }
    }
    this.store.update('projects', id, { statuses });
  }

  /** Выдать следующий номер задачи в проекте. */
  nextIssueNumber(id: EntityId): number {
    const project = this.get(id);
    if (!project) throw new Error('Проект не найден');
    const number = project.issueCounter + 1;
    this.store.update('projects', id, { issueCounter: number });
    return number;
  }

  /** Удалить проект вместе с задачами и спринтами. */
  remove(id: EntityId): void {
    for (const issue of this.store.list('issues')()) {
      if (issue.projectId === id) this.store.remove('issues', issue.id);
    }
    for (const sprint of this.store.list('sprints')()) {
      if (sprint.projectId === id) this.store.remove('sprints', sprint.id);
    }
    this.store.remove('projects', id);
  }
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
}
