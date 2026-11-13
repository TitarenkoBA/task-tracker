import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { Message } from '../../core/models/entities';
import { CollaborationService } from '../../core/p2p/collaboration.service';
import { ChatService, MAX_MESSAGE_LENGTH } from '../../core/services/chat.service';
import { PeopleService } from '../../core/services/people.service';
import { ProjectService } from '../../core/services/project.service';
import { formatDateTime } from '../../core/utils/dates';
import { Avatar } from '../../shared/ui/avatar';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { CollabButton } from '../collab/collab-button';
import { ProjectSwitcher } from '../projects/project-switcher';

/** Если до низа меньше этого, при новых сообщениях прокручиваем вниз. */
const STICK_TO_BOTTOM_PX = 80;
/** Сообщения одного автора с паузой меньше этой склеиваются в группу. */
const GROUP_GAP_MS = 5 * 60_000;

/** Чат проекта. Работает офлайн; с участниками синхронизируется через совместную работу. */
@Component({
  selector: 'app-chat-page',
  imports: [
    RouterLink,
    PageHeader,
    ProjectSwitcher,
    CollabButton,
    Avatar,
    Icon,
    EmptyState,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (project(); as project) {
      <app-page-header [title]="'nav.chat' | t">
        <app-collab-button actions [project]="project" [showChat]="false" />
        <div class="mx-auto max-w-3xl px-4 pb-2 lg:px-8">
          <div class="-mt-2"><app-project-switcher [project]="project" page="chat" /></div>
        </div>
      </app-page-header>

      <div class="mx-auto flex max-w-3xl flex-col px-4 lg:px-8">
        <div
          #scroller
          class="flex-1 space-y-1 py-4"
          role="log"
          aria-live="polite"
          [attr.aria-label]="'nav.chat' | t"
        >
          @for (message of messages(); track message.id; let i = $index) {
            @let mine = message.authorId === me();
            @let first = startsGroup(message, i);
            <div
              class="flex items-end gap-2"
              [class.flex-row-reverse]="mine"
              [class.mt-3]="first && i > 0"
            >
              <div class="w-8 shrink-0">
                @if (!mine && first) {
                  <app-avatar [person]="people.get(message.authorId)" />
                }
              </div>
              <div class="group flex max-w-[80%] flex-col" [class.items-end]="mine">
                @if (first) {
                  <span class="mb-0.5 px-1 text-xs text-slate-500">
                    @if (!mine) {
                      <span class="font-medium text-slate-700 dark:text-slate-300">{{
                        authorName(message)
                      }}</span>
                      ·
                    }
                    {{ time(message.createdAt) }}
                  </span>
                }
                <div class="flex items-center gap-1" [class.flex-row-reverse]="mine">
                  <p
                    class="rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap"
                    [class]="
                      mine ? 'bg-brand-600 text-white' : 'bg-white shadow-xs dark:bg-slate-800'
                    "
                  >
                    {{ message.text }}
                  </p>
                  @if (mine) {
                    <button
                      type="button"
                      class="btn-icon size-7 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                      [attr.aria-label]="'chat.delete' | t"
                      (click)="chat.remove(message.id)"
                    >
                      <app-icon name="trash" [size]="14" />
                    </button>
                  }
                </div>
              </div>
            </div>
          } @empty {
            <app-empty-state icon="message" [title]="'chat.empty' | t" />
          }
        </div>

        <!-- Поле ввода прилипает к низу (на телефоне — над нижней навигацией) -->
        <div
          class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 bg-slate-50/90 px-4 pt-2 pb-3 backdrop-blur lg:bottom-0 lg:-mx-8 lg:px-8 dark:bg-slate-950/90"
        >
          @if (!online()) {
            <p class="mb-2 flex items-center gap-1.5 text-xs text-amber-600">
              <app-icon name="alert" [size]="14" /> {{ 'chat.offline' | t }}
            </p>
          }
          <form class="flex items-end gap-2" (submit)="$event.preventDefault(); send()">
            <textarea
              #field
              class="input autosize max-h-40 min-h-11! flex-1 resize-none py-2.5"
              rows="1"
              [attr.maxlength]="maxLength"
              [placeholder]="'chat.placeholder' | t"
              [attr.aria-label]="'chat.placeholder' | t"
              [value]="draft()"
              (input)="draft.set($any($event.target).value)"
              (keydown)="onKeydown($event)"
            ></textarea>
            <button
              type="submit"
              class="btn-primary h-11 shrink-0 px-4"
              [disabled]="!draft().trim()"
              [attr.aria-label]="'chat.send' | t"
            >
              <app-icon name="send" [size]="18" />
            </button>
          </form>
          <p class="mt-1 hidden text-[11px] text-slate-400 lg:block">{{ 'chat.hint' | t }}</p>
        </div>
      </div>
    } @else {
      <app-empty-state
        icon="folder"
        [title]="'common.projectNotFound' | t"
        [text]="'common.projectNotFoundText' | t"
      >
        <a routerLink="/projects" class="btn-primary">{{ 'common.toProjects' | t }}</a>
      </app-empty-state>
    }
  `,
})
export class ChatPage {
  readonly projectKey = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly collab = inject(CollaborationService);
  protected readonly chat = inject(ChatService);
  protected readonly people = inject(PeopleService);

  protected readonly project = computed(() => this.projects.byKey(this.projectKey()));
  protected readonly messages = computed(() => {
    const project = this.project();
    return project ? this.chat.messages(project.id) : [];
  });
  protected readonly me = computed(() => this.people.me()?.id ?? null);
  protected readonly online = computed(
    () => this.collab.projectId() === this.project()?.id && this.collab.status() === 'online',
  );
  protected readonly draft = signal('');
  protected readonly maxLength = MAX_MESSAGE_LENGTH;

  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  private stickToBottom = true;

  constructor() {
    effect(() => {
      const project = this.project();
      if (project) this.projects.select(project.id);
    });
    // Пока чат открыт, всё пришедшее считается прочитанным.
    effect(() => {
      const project = this.project();
      this.messages();
      if (project) untracked(() => this.chat.markRead(project.id));
    });
    // Прокрутка к новым сообщениям, если пользователь и так был внизу (или написал сам).
    afterRenderEffect(() => {
      const last = this.messages().at(-1);
      if (this.stickToBottom || (last && last.authorId === this.me())) {
        globalThis.scrollTo?.({ top: document.body.scrollHeight });
      }
    });
    const onScroll = (): void => {
      const distance = document.body.scrollHeight - globalThis.scrollY - globalThis.innerHeight;
      this.stickToBottom = distance < STICK_TO_BOTTOM_PX;
    };
    globalThis.addEventListener?.('scroll', onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => globalThis.removeEventListener?.('scroll', onScroll));
  }

  protected send(): void {
    const project = this.project();
    if (!project || !this.draft().trim()) return;
    this.chat.send(project.id, this.draft());
    this.draft.set('');
    this.field()?.nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    // На сенсорной клавиатуре Enter — перенос строки: рядом есть кнопка «Отправить».
    const touch = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey || (touch && !event.ctrlKey))
      return;
    event.preventDefault();
    this.send();
  }

  /** Новая группа: другой автор или большая пауза. */
  protected startsGroup(message: Message, index: number): boolean {
    const previous = this.messages()[index - 1];
    return (
      !previous ||
      previous.authorId !== message.authorId ||
      message.createdAt - previous.createdAt > GROUP_GAP_MS
    );
  }

  protected authorName(message: Message): string {
    return this.people.get(message.authorId)?.name ?? '?';
  }

  protected time(ms: number): string {
    return formatDateTime(ms);
  }
}
