# Тестирование

Тесты пишутся на [Vitest](https://vitest.dev) и запускаются через Angular CLI. Браузер не нужен —
используется jsdom (эмуляция DOM в Node.js).

## Запуск

```bash
npm test          # режим наблюдения: перезапускает тесты при сохранении файлов
npm run test:ci   # один прогон (для CI и перед коммитом)
```

Запустить один файл: `npx ng test --include src/app/core/sync/merge.spec.ts`.

## Что покрыто

| Файл | Что проверяет |
| --- | --- |
| `core/sync/hlc.spec.ts` | Монотонность часов, обработка чужих меток, формат |
| `core/sync/merge.spec.ts` | LWW-слияние: коммутативность, идемпотентность, надгробия, независимость полей |
| `core/sync/sync.service.spec.ts` | Отправка локальных изменений, приём от пиров, отсутствие эха |
| `core/data/data-store.spec.ts` | CRUD, сохранение и загрузка, id устройства, подписки, ошибки записи |
| `core/services/project.service.spec.ts` | Ключи проектов, статусы, каскадное удаление |
| `core/services/issue.service.spec.ts` | Нумерация, история изменений, перемещение, подзадачи, комментарии |
| `core/services/sprint.service.spec.ts` | Один активный спринт, завершение с переносом задач |
| `core/services/export-import.service.spec.ts` | Проверка файла, перенос между «устройствами», слияние, удаление, замена |
| `core/utils/utils.spec.ts` | Дробный порядок, даты и сроки |
| `features/issues/issue-filter.spec.ts` | Поиск, фильтры и сортировка |
| `core/storage/indexeddb-storage.spec.ts` | Обновление схемы IndexedDB 1 → 2 не теряет данные (fake-indexeddb), старая вкладка уступает базу |
| `core/p2p/collaboration.service.spec.ts` | Совместная работа нескольких «устройств»: синхронизация, офлайн-правки, смена хоста, номера задач, защита чужих проектов |
| `core/p2p/scope.spec.ts` | Протокол комнаты, проверка полей, фильтр проекта, попытки подменить данные |
| `core/services/chat.service.spec.ts` | Чат: хранение, непрочитанные, удаление вместе с проектом |
| `core/i18n/i18n.spec.ts` | Полнота словарей, подстановки, множественное число, смена языка, даты |
| `core/utils/markdown.spec.ts` | Рендер Markdown и защита от HTML/опасных ссылок |
| `shared/ui/markdown-editor.spec.ts` | Кнопки форматирования, предпросмотр, Ctrl+Enter |
| `app.spec.ts` | Оболочка: навигация, ссылки в текущий проект, горячие клавиши |
| `features/board/board-page.spec.ts` | Колонки, фильтр, реактивность доски |
| `features/issues/issue-create-dialog.spec.ts` | Валидация и создание задачи |

## Как писать тесты

### Сервисы

Используйте `setupTestStore()` из `src/testing/test-store.ts` — он подменяет IndexedDB хранилищем в памяти:

```ts
import { TestBed } from '@angular/core/testing';
import { setupTestStore } from '../../../testing/test-store';
import { IssueService } from './issue.service';

describe('IssueService', () => {
  let issues: IssueService;

  beforeEach(async () => {
    await setupTestStore();
    issues = TestBed.inject(IssueService);
  });

  it('…', () => {
    // arrange → act → assert
  });
});
```

### Компоненты

Передайте компонент и провайдеры в `setupTestStore`, затем создайте компонент и дождитесь отрисовки:

```ts
beforeEach(async () => {
  await setupTestStore({ imports: [BoardPage], providers: [provideRouter([])] });
});

it('показывает колонки', async () => {
  const fixture = TestBed.createComponent(BoardPage);
  fixture.componentRef.setInput('projectKey', 'DEMO');   // input() компонента
  await fixture.whenStable();                             // дождаться отрисовки
  const el = fixture.nativeElement as HTMLElement;
  expect(el.querySelectorAll('section h2')).toHaveLength(4);
});
```

Советы:

- Ищите элементы так, как их видит пользователь: по тексту, `aria-label`, `id` полей.
- После изменения поля (`input.dispatchEvent(new Event('input'))`) вызывайте `await fixture.whenStable()`.
- Для демо-данных используйте `TestBed.inject(DemoDataService).create()`.
- Тесты по умолчанию идут на русском. Другой язык: `setupTestStore({ lang: 'en' })` или `TestBed.inject(I18n).set('en')`.
- Компонентам, которые используют `PwaService` (оболочка), нужен `provideServiceWorker('ngsw-worker.js', { enabled: false })`.

### Несколько устройств

Для сценариев совместной работы есть `createDevice(hub, name)` (`src/testing/device.ts`): у каждого
«устройства» своя база и сервисы, а сеть общая — в памяти (`src/testing/memory-network.ts`):

```ts
const hub = new MemoryHub();
const anna = await createDevice(hub, 'Анна');
const boris = await createDevice(hub, 'Борис');
await anna.collab.start(projectId);
await boris.collab.join(roomIdFor(projectId));
await settle(); // дождаться доставки сообщений
```

## Ручная проверка перед релизом

1. `npm run build` без ошибок и предупреждений.
2. Открыть сборку на телефоне: создать задачу, перетащить карточку (долгое нажатие), открыть задачу.
3. Экспорт → «Удалить все данные» → импорт: всё восстановилось.
4. Установить PWA, выключить сеть, перезапустить — приложение открывается с данными.
