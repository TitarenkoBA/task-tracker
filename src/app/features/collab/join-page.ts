import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { TKey } from '../../core/i18n/ru';
import { CollaborationService } from '../../core/p2p/collaboration.service';
import { projectIdFromRoom } from '../../core/p2p/protocol';
import { TeamSyncService } from '../../core/sync/team-sync.service';
import { PeopleService } from '../../core/services/people.service';
import { SettingsService } from '../../core/services/settings.service';
import { ProjectService } from '../../core/services/project.service';
import { Icon } from '../../shared/ui/icon';

/**
 * Страница приглашения: `/join/tt-<id проекта>`.
 * Подключаемся к участникам, получаем проект и открываем его доску.
 * Свои данные на устройстве при этом не затрагиваются — проект просто добавляется.
 */
@Component({
  selector: 'app-join-page',
  imports: [Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pt-safe">
      <div class="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-10">
        <div class="card overflow-hidden">
          <div class="bg-gradient-to-br from-brand-600 to-violet-600 px-6 py-7 text-white">
            <app-icon name="users" [size]="32" />
            <h1 class="mt-3 text-xl font-bold">{{ 'join.title' | t }}</h1>
            <p class="mt-2 text-sm text-white/85">{{ 'join.text' | t }}</p>
          </div>
          <div class="space-y-4 p-6">
            @if (!validLink()) {
              <p class="text-sm text-rose-600">{{ 'collab.error.badLink' | t }}</p>
            } @else {
              @if (people.me(); as me) {
                <div>
                  <label class="label" for="join-name">{{ 'collab.yourName' | t }}</label>
                  <input
                    id="join-name"
                    class="input"
                    autocomplete="name"
                    [value]="needsName() ? '' : me.name"
                    [placeholder]="me.name"
                    [disabled]="busy()"
                    (input)="name.set($any($event.target).value)"
                  />
                </div>
              }
              @if (busy()) {
                <p class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <span
                    class="size-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
                  ></span>
                  {{
                    ((teamMode() ? team.status() : session()?.status()) === 'online'
                      ? 'join.waiting'
                      : 'join.connecting'
                    ) | t
                  }}
                </p>
              }
              @if (errorKey(); as error) {
                <p
                  class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                >
                  {{ error | t }}
                </p>
              }
              <button type="button" class="btn-primary w-full" [disabled]="busy()" (click)="join()">
                {{ (errorKey() ? 'join.retry' : 'join.button') | t }}
              </button>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class JoinPage {
  readonly roomId = input.required<string>();

  protected readonly collab = inject(CollaborationService);
  protected readonly team = inject(TeamSyncService);
  private readonly settings = inject(SettingsService);
  protected readonly people = inject(PeopleService);
  private readonly projects = inject(ProjectService);
  private readonly router = inject(Router);

  protected readonly name = signal('');
  protected readonly started = signal(false);
  protected readonly needsName = computed(() => this.people.hasDefaultName(this.people.me()));
  private readonly projectId = computed(() => projectIdFromRoom(this.roomId()));
  protected readonly validLink = computed(() => !!this.projectId());
  /** Сессия этого проекта: статус и ошибка входа. */
  protected readonly session = computed(() => this.collab.session(this.projectId()));
  protected readonly teamMode = computed(() => this.settings.syncMode() !== 'p2p');
  protected readonly errorKey = computed((): TKey | null => {
    const id = this.projectId();
    if (this.teamMode()) {
      if (this.started() && id && this.team.ready().has(id) && !this.projects.get(id)) {
        return 'sync.error.noProject';
      }
      return this.team.error();
    }
    return this.session()?.error() ?? null;
  });
  protected readonly busy = computed(() => {
    if (!this.started() || this.errorKey()) return false;
    const id = this.projectId();
    if (this.teamMode()) return !id || !this.team.ready().has(id);
    const session = this.session();
    if (!session) return false;
    const status = session.status();
    return (
      status === 'connecting' ||
      status === 'reconnecting' ||
      (status === 'online' && !session.synced())
    );
  });

  constructor() {
    // Проект пришёл — открываем его.
    effect(() => {
      const id = this.projectId();
      const project = this.projects.get(id);
      const arrived = this.teamMode() ? this.team.ready().has(id ?? '') : this.session()?.synced();
      if (this.started() && project && arrived) {
        this.projects.select(project.id);
        void this.router.navigate(['/p', this.projects.routeKey(project), 'board'], {
          replaceUrl: true,
        });
      }
    });
  }

  protected join(): void {
    const me = this.people.me();
    const name = this.name().trim();
    if (me && name && name !== me.name) this.people.update(me.id, { name });
    this.started.set(true);
    void this.collab.join(this.roomId());
  }
}
