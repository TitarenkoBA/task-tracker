import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { DataStore } from '../data/data-store';
import { DemoDataService } from './demo-data.service';
import { ExportFile, ExportImportService, ImportError } from './export-import.service';
import { IssueService } from './issue.service';
import { ProjectService } from './project.service';

/** Пересоздать TestBed — как будто это другое устройство с пустой базой. */
async function freshDevice() {
  TestBed.resetTestingModule();
  await setupTestStore();
  return {
    exporter: TestBed.inject(ExportImportService),
    issues: TestBed.inject(IssueService),
    projects: TestBed.inject(ProjectService),
    store: TestBed.inject(DataStore),
  };
}

describe('ExportImportService', () => {
  let exporter: ExportImportService;
  let file: ExportFile;

  beforeEach(async () => {
    await setupTestStore();
    TestBed.inject(DemoDataService).create();
    exporter = TestBed.inject(ExportImportService);
    file = exporter.createExport();
  });

  it('экспорт содержит метаданные и все коллекции', () => {
    expect(file.app).toBe('task-tracker');
    expect(file.formatVersion).toBe(1);
    expect(file.data.projects).toHaveLength(1);
    expect(file.data.issues.length).toBeGreaterThan(5);
    expect(file.data.people.length).toBe(3);
  });

  it('parse принимает собственный экспорт', () => {
    const parsed = exporter.parse(JSON.stringify(file));
    expect(parsed.data.issues).toHaveLength(file.data.issues.length);
  });

  it.each([
    ['не JSON', '{oops', 'корректным JSON'],
    ['чужой файл', JSON.stringify({ hello: 1 }), 'не резервная копия'],
    [
      'другая версия',
      JSON.stringify({ app: 'task-tracker', formatVersion: 99, data: {} }),
      'версия формата',
    ],
    ['нет данных', JSON.stringify({ app: 'task-tracker', formatVersion: 1 }), 'нет данных'],
    [
      'повреждён раздел',
      JSON.stringify({ app: 'task-tracker', formatVersion: 1, data: { issues: 5 } }),
      'повреждён',
    ],
    [
      'запись без clock',
      JSON.stringify({ app: 'task-tracker', formatVersion: 1, data: { issues: [{ id: 'x' }] } }),
      'Повреждена запись',
    ],
  ])('parse отклоняет: %s', (_, text, message) => {
    expect(() => exporter.parse(text)).toThrow(ImportError);
    expect(() => exporter.parse(text)).toThrow(message);
  });

  it('импорт на чистом устройстве восстанавливает все данные', async () => {
    const device = await freshDevice();
    const summary = await device.exporter.import(file, 'merge');
    expect(summary.changed).toBe(summary.total);
    expect(device.issues.issues()).toHaveLength(file.data.issues.length);
    expect(device.issues.byKey('DEMO-1')?.title).toBe('Авторизация пользователей');
  });

  it('повторный импорт того же файла ничего не меняет', async () => {
    const device = await freshDevice();
    await device.exporter.import(file, 'merge');
    const again = await device.exporter.import(file, 'merge');
    expect(again.changed).toBe(0);
  });

  it('слияние сохраняет более поздние локальные правки и добавляет новые чужие', async () => {
    const device = await freshDevice();
    await device.exporter.import(file, 'merge');
    const issue = device.issues.byKey('DEMO-2')!;
    device.issues.update(issue.id, { title: 'Изменено на втором устройстве' });

    // «Первое» устройство не знало о правке — его старый экспорт не должен её затереть.
    await device.exporter.import(file, 'merge');
    expect(device.issues.get(issue.id)?.title).toBe('Изменено на втором устройстве');
  });

  it('удаление на одном устройстве переносится на другое', async () => {
    const device = await freshDevice();
    await device.exporter.import(file, 'merge');
    const issue = device.issues.byKey('DEMO-3')!;
    device.issues.remove(issue.id);
    const exported = device.exporter.createExport();

    const third = await freshDevice();
    await third.exporter.import(file, 'merge');
    await third.exporter.import(exported, 'merge');
    expect(third.issues.byKey('DEMO-3')).toBeUndefined();
  });

  it('режим replace полностью заменяет данные', async () => {
    const device = await freshDevice();
    device.projects.create({ name: 'Свой', key: 'OWN', color: 'rose' });
    await device.exporter.import(file, 'replace');
    expect(device.projects.byKey('OWN')).toBeUndefined();
    expect(device.projects.byKey('DEMO')).toBeDefined();
  });
});
