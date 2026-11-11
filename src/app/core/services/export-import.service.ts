import { Injectable, inject } from '@angular/core';
import { DataStore } from '../data/data-store';
import { I18n } from '../i18n/i18n.service';
import { BaseEntity, COLLECTIONS, Snapshot, emptySnapshot } from '../models/entities';
import { entityToChange } from '../sync/merge';
import { IssueService } from './issue.service';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';
import { SprintService } from './sprint.service';

/** Формат файла резервной копии. Описан в docs/data-model.md. */
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
  private readonly i18n = inject(I18n);

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
    const t = (key: Parameters<I18n['t']>[0]) => this.i18n.t(key);
    const header = [
      t('field.key'),
      t('field.project'),
      t('field.type'),
      t('field.title'),
      t('field.statusId'),
      t('field.priority'),
      t('field.assigneeId'),
      t('field.labels'),
      t('field.storyPoints'),
      t('field.dueDate'),
      t('field.sprintId'),
      t('field.createdAt'),
      t('field.description'),
    ];
    const rows = this.issues
      .issues()
      .map((i) => [
        this.issues.key(i),
        this.projects.get(i.projectId)?.name ?? '',
        this.i18n.issueType(i.type),
        i.title,
        this.issues.status(i)?.name ?? '',
        this.i18n.priority(i.priority),
        this.people.get(i.assigneeId)?.name ?? '',
        i.labels.join(', '),
        i.storyPoints ?? '',
        i.dueDate ?? '',
        this.sprints.get(i.sprintId)?.name ?? '',
        new Date(i.createdAt).toISOString(),
        i.description,
      ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // BOM нужен, чтобы Excel правильно определил кодировку (кириллица).
    download('﻿' + csv, `task-tracker-${today()}.csv`, 'text/csv;charset=utf-8');
  }

  /** Разобрать и проверить содержимое файла. Бросает {@link ImportError} с понятным текстом. */
  parse(text: string): ExportFile {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ImportError(this.i18n.t('import.notJson'));
    }
    if (!isObject(raw) || raw['app'] !== 'task-tracker') {
      throw new ImportError(this.i18n.t('import.notBackup'));
    }
    if (raw['formatVersion'] !== 1) {
      throw new ImportError(
        this.i18n.t('import.badVersion', { version: String(raw['formatVersion']) }),
      );
    }
    const data = raw['data'];
    if (!isObject(data)) throw new ImportError(this.i18n.t('import.noData'));

    const snapshot = emptySnapshot();
    for (const collection of COLLECTIONS) {
      const items = data[collection] ?? [];
      if (!Array.isArray(items))
        throw new ImportError(this.i18n.t('import.badSection', { name: collection }));
      for (const item of items) {
        if (!isValidEntity(item))
          throw new ImportError(this.i18n.t('import.badRecord', { name: collection }));
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
