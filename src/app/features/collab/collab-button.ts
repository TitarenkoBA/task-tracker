import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { Person, Project } from '../../core/models/entities';
import { CollaborationService } from '../../core/p2p/collaboration.service';
import { ChatService } from '../../core/services/chat.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { CollabDialog, STATUS_DOT } from './collab-dialog';

/**
 * Кнопки в шапке страницы проекта: «Вместе» (аватары тех, кто в сети, и статус)
 * и «Чат» с числом непрочитанных.
 */
@Component({
  selector: 'app-collab-button',
  imports: [Avatar, Icon, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-1' },
  template: `
    @if (showChat()) {
      <a
        class="btn-ghost relative px-2.5"
        [routerLink]="['/p', projects.routeKey(project()), 'chat']"
        [attr.aria-label]="'nav.chat' | t"
      >
        <app-icon name="message" [size]="18" />
        <span class="hidden md:inline">{{ 'nav.chat' | t }}</span>
        @if (unread()) {
          <span
            class="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
          >
            {{ unread() > 99 ? '99+' : unread() }}
          </span>
        }
      </a>
    }
    <button
      type="button"
      class="btn-ghost relative px-2.5"
      (click)="open()"
      [attr.aria-label]="'collab.title' | t"
    >
      @if (online().length) {
        <span class="flex -space-x-1.5">
          @for (p of online().slice(0, 3); track p.id) {
            <app-avatar size="sm" [person]="p" />
          }
        </span>
      } @else {
        <app-icon name="users" [size]="18" />
      }
      <span class="hidden md:inline">{{ 'collab.button' | t }}</span>
      @if (isThisProject()) {
        <span
          class="absolute top-1 right-1 size-2 rounded-full ring-2 ring-white dark:ring-slate-950"
          [class]="dot()"
        ></span>
      }
    </button>
  `,
})
export class CollabButton {
  readonly project = input.required<Project>();
  /** Показывать ли ссылку на чат (на самой странице чата она не нужна). */
  readonly showChat = input(true);

  protected readonly projects = inject(ProjectService);
  private readonly collab = inject(CollaborationService);
  private readonly people = inject(PeopleService);
  private readonly chat = inject(ChatService);
  private readonly dialogs = inject(DialogService);

  protected readonly isThisProject = computed(() => this.collab.projectId() === this.project().id);
  protected readonly dot = computed(() => STATUS_DOT[this.collab.status()]);
  protected readonly unread = computed(() => this.chat.unread(this.project().id));
  /** Другие участники в сети — для аватаров на кнопке. */
  protected readonly online = computed<Person[]>(() =>
    this.isThisProject()
      ? this.collab
          .participants()
          .filter((p) => p.connected)
          .map(
            (p) =>
              this.people.get(p.personId) ??
              ({ id: p.peerId, name: p.name, email: '', color: 'violet' } as unknown as Person),
          )
      : [],
  );

  protected open(): void {
    this.dialogs.open(CollabDialog, this.project().id);
  }
}
