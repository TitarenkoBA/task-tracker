import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataStore } from '../../core/data/data-store';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { LANGUAGES, Lang } from '../../core/i18n/lang';
import { TKey } from '../../core/i18n/ru';
import { emptySnapshot, Person } from '../../core/models/entities';
import { ExportImportService, ImportError } from '../../core/services/export-import.service';
import { PeopleService } from '../../core/services/people.service';
import { PwaService } from '../../core/services/pwa.service';
import { ThemePreference } from '../../core/services/settings.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { CollaborationService } from '../../core/p2p/collaboration.service';
import { ProjectService } from '../../core/services/project.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { ImportDialog } from './import-dialog';

@Component({
  selector: 'app-settings-page',
  imports: [PageHeader, Avatar, Icon, TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  protected readonly people = inject(PeopleService);
  protected readonly theme = inject(ThemeService);
  protected readonly pwa = inject(PwaService);
  protected readonly collab = inject(CollaborationService);
  protected readonly projects = inject(ProjectService);
  /** Проект, над которым идёт совместная работа. */
  protected readonly sharedProject = computed(() => this.projects.get(this.collab.projectId()));
  protected readonly collabStatus = computed(() => `collab.status.${this.collab.status()}` as TKey);
  protected readonly i18n = inject(I18n);
  private readonly store = inject(DataStore);
  private readonly exporter = inject(ExportImportService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);

  protected readonly themes: { value: ThemePreference; label: TKey; icon: string }[] = [
    { value: 'light', label: 'settings.themeLight', icon: 'sun' },
    { value: 'dark', label: 'settings.themeDark', icon: 'moon' },
    { value: 'system', label: 'settings.themeSystem', icon: 'monitor' },
  ];
  protected readonly languages = LANGUAGES;

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

  /** Переключить язык интерфейса. Стандартное имя профиля («Я» / «Me») тоже переводится. */
  protected setLanguage(lang: Lang): void {
    this.i18n.set(lang);
    this.people.translateDefaultName();
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
      title: this.i18n.t('settings.removePersonTitle', { name: person.name }),
      message: this.i18n.t('settings.removePersonText'),
      confirmLabel: this.i18n.t('common.delete'),
      danger: true,
    });
    if (ok) this.people.remove(person.id);
  }

  // Данные -----------------------------------------------------------------

  protected exportJson(): void {
    this.exporter.downloadJson();
    this.toasts.success(this.i18n.t('settings.backupSaved'));
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
      this.toasts.error(
        error instanceof ImportError ? error.message : this.i18n.t('settings.fileUnreadable'),
      );
    }
  }

  protected async resetAll(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: this.i18n.t('settings.deleteAllTitle'),
      message: this.i18n.t('settings.deleteAllText'),
      confirmLabel: this.i18n.t('settings.deleteAllConfirm'),
      danger: true,
    });
    if (!ok) return;
    await this.store.replaceAll(emptySnapshot());
    this.people.ensureMe();
    this.toasts.success(this.i18n.t('settings.deletedAll'));
  }

  /** Попросить браузер не удалять данные при нехватке места. */
  protected async persist(): Promise<void> {
    const granted = await navigator.storage?.persist?.();
    if (granted) this.toasts.success(this.i18n.t('settings.persistGranted'));
    else this.toasts.show(this.i18n.t('settings.persistDenied'));
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
    const t = (key: TKey) => this.i18n.t(key);
    if (bytes < 1024) return `${bytes} ${t('unit.b')}`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} ${t('unit.kb')}`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} ${t('unit.mb')}`;
    return `${(bytes / 1024 ** 3).toFixed(1)} ${t('unit.gb')}`;
  }
}
