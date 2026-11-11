import { Injectable, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { ISSUE_TYPES, PRIORITIES } from '../models/catalog';
import { BaseEntity, COLLECTIONS, Snapshot, emptySnapshot } from '../models/entities';
import { entityToChange } from '../sync/merge';
import { IssueService } from './issue.service';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';
import { SprintService } from './sprint.service';

/** Формат файла резервной копии. Описан в docs/data-format.md. */
export interface ExportFile {
  app: 'task-tracker';
  formatVersion: 1;
  exportedAt: string;
  replicaId: string;
  data: Snapshot;
}

/**
 * Режим импорта:
 * - `merge`   — слить с текущими данными; для каждого поля побеждает более позднее изменение;
 * - `replace` — удалить текущие данные и загрузить файл.
 */
export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  mode: ImportMode;
  /** Сколько сущностей было в файле. */
  total: number;
  /** Сколько реально изменилось (для `merge`). */
  changed: number;
}

export class ImportError extends Error {}

@Injectable({ providedIn: 'root' })
export class ExportImportService {
  private readonly store = inject(DataStore);
  private readonly issues = inject(IssueService);
  private readonly projects = inject(ProjectService);
  private readonly people = inject(PeopleService);
  private readonly sprints = inject(SprintService);

  /** Собрать полную резервную копию (включая удалённые записи — они нужны для слияния). */
  createExport(): ExportFile {
    return {
      app: 'task-tracker',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      replicaId: this.store.replicaId,
      data: this.store.snapshot(),
    };
  }

  /** Скачать резервную копию в JSON. */
  downloadJson(): void {
    const json = JSON.stringify(this.createExport(), null, 2);
    download(json, `task-tracker-${today()}.json`, 'application/json');
  }

  /** Скачать задачи в CSV (для Excel / Google Таблиц). Только экспорт, импорт CSV не поддерживается. */
  downloadCsv(): void {
    const header = ['Ключ', 'Проект', 'Тип', 'Название', 'Статус', 'Приоритет', 'Исполнитель', 'Метки', 'Story points', 'Срок', 'Спринт', 'Создана', 'Описание'];
    const rows = this.issues.issues().map((i) => [
      this.issues.key(i),
      this.projects.get(i.projectId)?.name ?? '',
      ISSUE_TYPES[i.type].label,
      i.title,
      this.issues.status(i)?.name ?? '',
      PRIORITIES[i.priority].label,
      this.people.get(i.assigneeId)?.name ?? '',
      i.labels.join(', '),
      i.storyPoints ?? '',
      i.dueDate ?? '',
      this.sprints.get(i.sprintId)?.name ?? '',
      new Date(i.createdAt).toISOString(),
      i.description,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // BOM нужен, чтобы Excel правильно открыл кириллицу.
    download('﻿' + csv, `task-tracker-${today()}.csv`, 'text/csv;charset=utf-8');
  }

  /** Разобрать и проверить содержимое файла. Бросает {@link ImportError} с понятным текстом. */
  parse(text: string): ExportFile {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ImportError('Файл не является корректным JSON');
    }
    if (!isObject(raw) || raw['app'] !== 'task-tracker') {
      throw new ImportError('Это не резервная копия Task Tracker');
    }
    if (raw['formatVersion'] !== 1) {
      throw new ImportError(`Неподдерживаемая версия формата: ${String(raw['formatVersion'])}`);
    }
    const data = raw['data'];
    if (!isObject(data)) throw new ImportError('В файле нет данных');

    const snapshot = emptySnapshot();
    for (const collection of COLLECTIONS) {
      const items = data[collection] ?? [];
      if (!Array.isArray(items)) throw new ImportError(`Раздел «${collection}» повреждён`);
      for (const item of items) {
        if (!isValidEntity(item)) throw new ImportError(`Повреждена запись в разделе «${collection}»`);
      }
      (snapshot[collection] as BaseEntity[]) = items as BaseEntity[];
    }
    return {
      app: 'task-tracker',
      formatVersion: 1,
      exportedAt: String(raw['exportedAt'] ?? ''),
      replicaId: String(raw['replicaId'] ?? ''),
      data: snapshot,
    };
  }

  async import(file: ExportFile, mode: ImportMode): Promise<ImportSummary> {
    const total = COLLECTIONS.reduce((sum, c) => sum + file.data[c].length, 0);
    if (mode === 'replace') {
      await this.store.replaceAll(file.data);
      return { mode, total, changed: total };
    }
    const changes = COLLECTIONS.flatMap((c) =>
      (file.data[c] as BaseEntity[]).map((e) => entityToChange(c, e)),
    );
    const changed = this.store.applyChanges(changes, 'import');
    await this.store.whenPersisted();
    return { mode, total, changed };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidEntity(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value['id'] === 'string' &&
    isObject(value['clock']) &&
    Object.values(value['clock']).every((v) => typeof v === 'string')
  );
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function download(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
