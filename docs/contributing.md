# Как вносить изменения

## Порядок работы

1. Создайте ветку: `git switch -c feature/короткое-описание`.
2. Внесите изменения, запустите `npm run test:ci` и `npm run build`.
3. Отформатируйте код: `npm run format`.
4. Закоммитьте с понятным сообщением (см. ниже).

## Сообщения коммитов

Используем [Conventional Commits](https://www.conventionalcommits.org/ru/):

```
<тип>(<область>): <что сделано>
```

| Тип | Когда |
| --- | --- |
| `feat` | Новая возможность |
| `fix` | Исправление ошибки |
| `docs` | Только документация |
| `test` | Только тесты |
| `refactor` | Переделка без изменения поведения |
| `style` | Форматирование |
| `chore` | Зависимости, настройки |

Примеры: `feat(board): фильтр по эпику`, `fix(import): не падать на пустом файле`.

## Стиль кода

- **TypeScript strict.** Никаких `any` без крайней необходимости.
- **Standalone-компоненты**, `ChangeDetectionStrategy.OnPush`, `input()` / `output()` / `model()`, сигналы вместо полей-переменных.
- **Новый синтаксис шаблонов**: `@if`, `@for`, `@switch`.
- **`inject()`** вместо внедрения через конструктор.
- Имена файлов по стилю Angular 2025: `board-page.ts`, класс `BoardPage` (без суффикса `.component`).
- Комментарии — на русском, объясняют **зачем**, а не **что**.
- Тексты интерфейса — только через словари `core/i18n/ru.ts` и `en.ts` (см. рецепт ниже).
- Компонент **не меняет** данные сам — только через сервисы из `core/services`.

## Рецепты

### Рецепт: добавить поле задаче

Пример: поле «Окружение» (`environment: string`) для багов.

1. **Тип.** В `core/models/entities.ts` добавьте в `Issue`:
   ```ts
   /** Окружение, где воспроизводится баг. */
   environment: string | null;
   ```
2. **Создание.** В `IssueService.create` (и `IssueInput`) задайте значение по умолчанию: `environment: input.environment ?? null`.
3. **Старые данные.** У задач, созданных раньше, поля нет — читайте его как `issue.environment ?? null`.
4. **История.** Чтобы изменения попадали в историю, добавьте поле в `TRACKED_FIELDS` (`catalog.ts`) и подпись в словари: `'field.environment': 'Окружение'` в `ru.ts` и `'Environment'` в `en.ts`.
5. **Интерфейс.** На странице задачи (`features/issues/issue-detail-page.html`) добавьте строку в блок `<dl>`:
   ```html
   <div class="field-row">
     <dt>{{ 'field.environment' | t }}</dt>
     <dd>
       <input class="field-select" [value]="issue.environment ?? ''"
              (change)="save({ environment: $any($event.target).value || null })" />
     </dd>
   </div>
   ```
6. **CSV.** При желании добавьте колонку в `ExportImportService.downloadCsv`.
7. **Тест.** Проверьте в `issue.service.spec.ts`, что поле сохраняется и пишется в историю.

Синхронизация и импорт заработают сами: `DataStore` и `mergeEntity` не зависят от конкретных полей.

### Рецепт: добавить страницу

1. Создайте компонент в `features/<раздел>/<имя>-page.ts`.
2. Зарегистрируйте маршрут в `app.routes.ts` через `loadComponent` (ленивую загрузку).
3. Добавьте ссылку в меню (`app.html`) — в боковое меню и, если нужно, в нижнюю навигацию.
4. Используйте `<app-page-header title="…">` для заголовка — он сам прилипает к верху на телефоне.

### Рецепт: добавить иконку

Откройте `shared/ui/icon.ts` и добавьте строку в `ICONS`: имя и SVG-путь для области 24×24
(пути удобно брать с [lucide.dev](https://lucide.dev), атрибут `d` у `<path>`). Использование: `<app-icon name="имя" />`.

### Рецепт: добавить или изменить текст интерфейса

1. Добавьте ключ в `core/i18n/ru.ts`, например `'board.archive': 'В архив'`.
2. Добавьте тот же ключ в `core/i18n/en.ts`: `'board.archive': 'Archive'`. Без этого проект не соберётся.
3. Используйте: в шаблоне `{{ 'board.archive' | t }}` (добавьте `TranslatePipe` в `imports`), в коде `this.i18n.t('board.archive')`.

Никогда не пишите видимый пользователю текст прямо в шаблоне — только через словарь.

### Рецепт: добавить язык

1. Добавьте код в тип `Lang` и в массив `LANGUAGES` (`core/i18n/lang.ts`), например `{ code: 'de', label: 'Deutsch', locale: 'de-DE' }`.
2. Создайте `core/i18n/de.ts` по образцу `en.ts` (тип `Record<TKey, Entry>`) и подключите его в `DICTIONARIES` в `i18n.service.ts`.
3. Добавьте фразу «только что» в `JUST_NOW` (`core/utils/dates.ts`) и демо-тексты в `CONTENT` (`demo-data.service.ts`).
4. При необходимости поправьте `detectLang()` — язык по умолчанию по языку браузера.
5. Тест `i18n.spec.ts` проверяет, что в словарях одинаковые ключи — расширьте его на новый язык.

### Рецепт: добавить новую коллекцию данных

1. Опишите тип в `entities.ts`, добавьте его в `CollectionMap`, `COLLECTIONS` и `emptySnapshot()`.
2. Увеличьте `DB_VERSION` в `indexeddb-storage.ts` — новый object store создастся в `upgrade` автоматически.
3. Напишите сервис в `core/services/`, работающий через `DataStore`.
4. Экспорт/импорт подхватят коллекцию сами (они перебирают `COLLECTIONS`). Добавьте подписи `import.collection.<имя>` в оба словаря.

### Рецепт: поменять акцентный цвет

В `src/styles.css`, блок `@theme`: замените `indigo` в переменных `--color-brand-*` на другую палитру Tailwind (например, `violet` или `emerald`).
