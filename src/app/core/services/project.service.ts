import { Injectable, computed, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { I18n } from '../i18n/i18n.service';
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
  private readonly i18n = inject(I18n);

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

  /**
   * Найти проект по ключу из адреса. Обычно это просто ключ (`WEB`), а если у двух
   * проектов ключи совпали (например, после совместной работы), — `WEB~a1b2c3`, см. {@link routeKey}.
   */
  byKey(key: string): Project | undefined {
    const [rawKey, idPrefix] = key.split('~');
    const upper = rawKey.toUpperCase();
    const matches = this.projects().filter((p) => p.key === upper);
    if (idPrefix) return matches.find((p) => p.id.startsWith(idPrefix.toLowerCase()));
    return matches[0];
  }

  /** Ключ проекта для адреса страницы: однозначный, даже если у двух проектов одинаковые ключи. */
  routeKey(project: Project): string {
    const duplicate = this.projects().some((p) => p.key === project.key && p.id !== project.id);
    return duplicate ? `${project.key}~${project.id.replace(/-/g, '').slice(0, 6)}` : project.key;
  }

  /** Предложить ключ по названию: «Мобильное приложение» → «MP». */
  suggestKey(name: string): string {
    const translit = transliterate(name).toUpperCase();
    const words = translit.split(/[^A-Z0-9]+/).filter(Boolean);
    let key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
    key = key.replace(/^[0-9]+/, '').slice(0, 10);
    if (key.length < 2) key = (key + 'PRJ').slice(0, 3);
    let candidate = key;
    for (let i = 2; this.projects().some((p) => p.key === candidate); i++)
      candidate = `${key.slice(0, 8)}${i}`;
    return candidate;
  }

  /** Проверка ключа. Возвращает текст ошибки или `null`. */
  validateKey(key: string, exceptId?: EntityId): string | null {
    if (!PROJECT_KEY_PATTERN.test(key)) {
      return this.i18n.t('error.keyFormat');
    }
    const existing = this.projects().find((p) => p.key === key && p.id !== exceptId);
    if (existing) return this.i18n.t('error.keyTaken');
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
      statuses: defaultStatuses((key) => this.i18n.t(key)),
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
    if (!statuses.length) throw new Error(this.i18n.t('error.statusRequired'));
    const ids = new Set(statuses.map((s) => s.id));
    for (const issue of this.store.list('issues')()) {
      if (issue.projectId === id && !ids.has(issue.statusId)) {
        this.store.update('issues', issue.id, { statusId: statuses[0].id });
      }
    }
    this.store.update('projects', id, { statuses });
  }

  /**
   * Выдать следующий номер задачи в проекте. Учитывает и счётчик, и реальные номера:
   * после синхронизации счётчик с другого устройства может отставать.
   */
  nextIssueNumber(id: EntityId): number {
    const project = this.get(id);
    if (!project) throw new Error(this.i18n.t('error.projectNotFound'));
    let max = project.issueCounter;
    for (const issue of this.store.raw.all('issues')) {
      const i = issue as unknown as { projectId: EntityId; number: number };
      if (i.projectId === id && i.number > max) max = i.number;
    }
    const number = max + 1;
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
    for (const message of this.store.list('messages')()) {
      if (message.projectId === id) this.store.remove('messages', message.id);
    }
    this.store.remove('projects', id);
  }
}

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
}
