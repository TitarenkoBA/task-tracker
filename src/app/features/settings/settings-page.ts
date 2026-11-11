import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DataStore } from '../../core/data/data-store';
import { Person } from '../../core/models/entities';
import { ExportImportService, ImportError } from '../../core/services/export-import.service';
import { PeopleService } from '../../core/services/people.service';
import { PwaService } from '../../core/services/pwa.service';
import { ThemePreference } from '../../core/services/settings.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { SyncService } from '../../core/sync/sync.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { ImportDialog } from './import-dialog';

@Component({
  selector: 'app-settings-page',
  imports: [PageHeader, Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  protected readonly people = inject(PeopleService);
  protected readonly theme = inject(ThemeService);
  protected readonly pwa = inject(PwaService);
  protected readonly sync = inject(SyncService);
  private readonly store = inject(DataStore);
  private readonly exporter = inject(ExportImportService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);

  protected readonly themes: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'light', label: 'Светлая', icon: 'sun' },
    { value: 'dark', label: 'Тёмная', icon: 'moon' },
    { value: 'system', label: 'Как в системе', icon: 'monitor' },
  ];

  protected readonly storage = signal<{ used: number; quota: number; persisted: boolean } | null>(
    null,
  );
  protected readonly editingPersonId = signal<string | null>(null);
  protected readonly replicaId = this.store.replicaId;
  protected readonly others = computed(() =>
    this.people.people().filter((p) => p.id !== this.people.me()?.id),
  );

  constructor() {
    void this.refreshStorage();
  }

  // Профиль и участники ----------------------------------------------------

  protected rename(person: Person, name: string): void {
    const trimmed = name.trim();
    if (trimmed && trimmed !== person.name) this.people.update(person.id, { name: trimmed });
    this.editingPersonId.set(null);
  }

  protected addPerson(field: HTMLInputElement): void {
    const name = field.value.trim();
    if (!name) return;
    this.people.create(name);
    field.value = '';
  }

  protected async removePerson(person: Person): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: `Удалить «${person.name}»?`,
      message: 'Задачи этого человека останутся, но станут неназначенными.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (ok) this.people.remove(person.id);
  }

  // Данные -----------------------------------------------------------------

  protected exportJson(): void {
    this.exporter.downloadJson();
    this.toasts.success('Резервная копия сохранена');
  }

  protected exportCsv(): void {
    this.exporter.downloadCsv();
  }

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = this.exporter.parse(await file.text());
      this.dialogs.open(ImportDialog, parsed);
    } catch (error) {
      this.toasts.error(error instanceof ImportError ? error.message : 'Не удалось прочитать файл');
    }
  }

  protected async resetAll(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Удалить все данные?',
      message:
        'Все проекты, задачи и комментарии на этом устройстве будут удалены без возможности восстановления. Сначала сделайте экспорт, если данные нужны.',
      confirmLabel: 'Удалить всё',
      danger: true,
    });
    if (!ok) return;
    await this.store.replaceAll({
      projects: [],
      issues: [],
      sprints: [],
      people: [],
      comments: [],
      activity: [],
    });
    this.people.ensureMe();
    this.toasts.success('Все данные удалены');
  }

  /** Попросить браузер не удалять данные при нехватке места. */
  protected async persist(): Promise<void> {
    const granted = await navigator.storage?.persist?.();
    if (granted) this.toasts.success('Браузер не будет удалять данные автоматически');
    else this.toasts.show('Браузер отклонил запрос. Установите приложение — это обычно помогает.');
    await this.refreshStorage();
  }

  private async refreshStorage(): Promise<void> {
    if (!navigator.storage?.estimate) return;
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ]);
    this.storage.set({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted });
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
    return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  }
}
