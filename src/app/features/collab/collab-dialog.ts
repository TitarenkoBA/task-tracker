import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18n, TranslatePipe } from '../../core/i18n/i18n.service';
import { TKey } from '../../core/i18n/ru';
import { EntityId, Person } from '../../core/models/entities';
import { CollaborationService } from '../../core/p2p/collaboration.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogFrame } from '../../shared/dialog/dialog-frame';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';

export const STATUS_DOT: Record<string, string> = {
  idle: 'bg-slate-300 dark:bg-slate-600',
  connecting: 'bg-amber-400 animate-pulse',
  reconnecting: 'bg-amber-400 animate-pulse',
  online: 'bg-emerald-500',
  error: 'bg-rose-500',
};

/** Совместная работа над проектом: старт, ссылка-приглашение, участники, выход. */
@Component({
  selector: 'app-collab-dialog',
  imports: [DialogFrame, Avatar, Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="'collab.title' | t">
      <div class="space-y-5 text-sm">
        @if (!isThisProject()) {
          <p class="leading-relaxed text-slate-600 dark:text-slate-300">{{ 'collab.intro' | t }}</p>
          @if (otherProject(); as other) {
            <p
              class="rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            >
              {{ 'collab.otherProject' | t: { name: other.name } }}
            </p>
          }
        } @else {
          <!-- Статус -->
          <div class="flex items-center gap-2">
            <span class="size-2.5 rounded-full" [class]="dot()"></span>
            <span class="font-medium">{{ statusLabel() | t }}</span>
            @if (collab.status() === 'online') {
              <span class="text-slate-500"
                >· {{ 'collab.onlineCount' | t: { count: online() } }}</span
              >
            }
          </div>
          @if (collab.error(); as error) {
            <p
              class="rounded-xl bg-rose-50 p-3 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
            >
              {{ error | t }}
            </p>
          }
          @if (collab.lost()) {
            <p class="text-xs text-amber-600">{{ 'collab.signalingLost' | t }}</p>
          }

          <!-- Приглашение -->
          <section>
            <h3 class="label">{{ 'collab.invite' | t }}</h3>
            <div class="flex gap-2">
              <input
                class="input min-w-0 flex-1 font-mono text-xs"
                readonly
                [value]="link()"
                (focus)="$any($event.target).select()"
                [attr.aria-label]="'collab.invite' | t"
              />
              <button type="button" class="btn-secondary shrink-0 px-3" (click)="copy()">
                <app-icon name="copy" [size]="16" />
                <span class="hidden sm:inline">{{ 'collab.copy' | t }}</span>
              </button>
              @if (canShare) {
                <button
                  type="button"
                  class="btn-secondary shrink-0 px-3"
                  (click)="share()"
                  [attr.aria-label]="'collab.share' | t"
                >
                  <app-icon name="upload" [size]="16" />
                </button>
              }
            </div>
            <p class="mt-1.5 text-xs text-slate-500">{{ 'collab.inviteHint' | t }}</p>
          </section>

          <!-- Участники -->
          <section>
            <h3 class="label">{{ 'collab.participants' | t }}</h3>
            <ul
              class="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700"
            >
              <li class="flex items-center gap-3 px-3 py-2">
                <app-avatar size="sm" [person]="people.me()" />
                <span class="flex-1 truncate"
                  >{{ people.me()?.name }}
                  <span class="text-slate-400">({{ 'collab.you' | t }})</span></span
                >
                @if (collab.role() === 'host') {
                  <span
                    class="chip h-5 bg-slate-100 text-[11px] text-slate-500 dark:bg-slate-800"
                    >{{ 'collab.host' | t }}</span
                  >
                }
              </li>
              @for (p of collab.participants(); track p.peerId) {
                <li class="flex items-center gap-3 px-3 py-2">
                  <app-avatar size="sm" [person]="personFor(p.personId, p.name)" />
                  <span class="flex-1 truncate">{{ p.name }}</span>
                  @if (p.isHost) {
                    <span
                      class="chip h-5 bg-slate-100 text-[11px] text-slate-500 dark:bg-slate-800"
                      >{{ 'collab.host' | t }}</span
                    >
                  }
                  <span
                    class="size-2 rounded-full"
                    [class]="p.connected ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'"
                  ></span>
                </li>
              } @empty {
                <li class="px-3 py-3 text-slate-500">{{ 'collab.alone' | t }}</li>
              }
            </ul>
          </section>
          <p class="text-xs text-slate-500">{{ 'collab.leaveHint' | t }}</p>
        }

        <!-- Имя, под которым нас видят -->
        @if (people.me(); as me) {
          <div>
            <label class="label" for="collab-name">{{ 'collab.yourName' | t }}</label>
            <input
              id="collab-name"
              class="input"
              autocomplete="name"
              [value]="me.name"
              (change)="rename(me, $any($event.target).value)"
            />
          </div>
        }
      </div>

      <ng-container footer>
        @if (isThisProject()) {
          <button type="button" class="btn-secondary text-rose-600!" (click)="collab.leave()">
            {{ 'collab.leave' | t }}
          </button>
          @if (collab.status() === 'error') {
            <button type="button" class="btn-primary" (click)="start()">
              {{ 'join.retry' | t }}
            </button>
          }
        } @else {
          <button type="button" class="btn-primary" (click)="start()">
            <app-icon name="users" [size]="18" /> {{ 'collab.start' | t }}
          </button>
        }
      </ng-container>
    </app-dialog-frame>
  `,
})
export class CollabDialog {
  private readonly projectIdValue = inject<EntityId>(DIALOG_DATA);
  protected readonly collab = inject(CollaborationService);
  protected readonly people = inject(PeopleService);
  private readonly projects = inject(ProjectService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18n);

  protected readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  protected readonly isThisProject = computed(
    () => this.collab.projectId() === this.projectIdValue,
  );
  protected readonly otherProject = computed(() => {
    const id = this.collab.projectId();
    return id && id !== this.projectIdValue ? this.projects.get(id) : undefined;
  });
  protected readonly link = computed(() => this.collab.inviteLink(this.projectIdValue));
  protected readonly online = computed(
    () => this.collab.participants().filter((p) => p.connected).length + 1,
  );
  protected readonly dot = computed(() => STATUS_DOT[this.collab.status()]);
  protected readonly statusLabel = computed(() => `collab.status.${this.collab.status()}` as TKey);

  protected start(): void {
    void this.collab.start(this.projectIdValue);
  }

  protected rename(me: Person, name: string): void {
    const trimmed = name.trim();
    if (trimmed && trimmed !== me.name) this.people.update(me.id, { name: trimmed });
  }

  /** Аватар участника, даже если его карточка ещё не пришла. */
  protected personFor(personId: string | null, name: string): Person {
    return (
      this.people.get(personId) ??
      ({ id: personId ?? name, name, email: '', color: 'violet' } as unknown as Person)
    );
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.toasts.success(this.i18n.t('collab.copied'));
    } catch {
      this.toasts.error(this.i18n.t('issue.linkFailed'));
    }
  }

  protected async share(): Promise<void> {
    const project = this.projects.get(this.projectIdValue);
    try {
      await navigator.share({ title: project?.name ?? 'Task Tracker', url: this.link() });
    } catch {
      // Пользователь закрыл окно «Поделиться» — это не ошибка.
    }
  }
}
