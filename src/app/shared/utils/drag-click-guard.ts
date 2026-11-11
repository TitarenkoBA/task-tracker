import { DestroyRef, ElementRef, inject } from '@angular/core';

/**
 * Карточки задач — это ссылки. После перетаскивания браузер считает отпускание
 * кликом и открыл бы задачу. Этот хелпер «глотает» такой клик.
 *
 * Вызывать в конструкторе компонента:
 * ```ts
 * private readonly dragGuard = dragClickGuard();
 * // (cdkDragStarted)="dragGuard.started()"  (cdkDropListDropped)="dragGuard.ended(); …"
 * ```
 */
export function dragClickGuard(): { started(): void; ended(): void } {
  const host = inject(ElementRef).nativeElement as HTMLElement;
  let suppress = false;
  const onClick = (event: Event) => {
    if (!suppress) return;
    event.preventDefault();
    event.stopPropagation();
  };
  // Фаза перехвата (capture): срабатывает раньше, чем обработчик routerLink.
  host.addEventListener('click', onClick, true);
  inject(DestroyRef).onDestroy(() => host.removeEventListener('click', onClick, true));
  return {
    started: () => (suppress = true),
    ended: () => setTimeout(() => (suppress = false), 50),
  };
}
