import { Injectable, inject } from '@angular/core';
import { I18n } from '../i18n/i18n.service';
import { Lang } from '../i18n/lang';
import { IssuePriority, IssueType, Project } from '../models/entities';
import { IssueService } from './issue.service';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';
import { SprintService } from './sprint.service';

/** Тексты демо-проекта на каждом языке. Порядок задач в `stories` важен: первая — «экран входа». */
const CONTENT: Record<Lang, DemoContent> = {
  ru: {
    people: ['Анна Смирнова', 'Иван Петров'],
    project: 'Мобильное приложение',
    projectDescription: 'Демонстрационный проект. Его можно смело менять или удалить.',
    goal: 'Выпустить первую версию с авторизацией',
    epic: 'Авторизация пользователей',
    epicDescription: 'Вход по email, восстановление пароля, профиль.',
    issues: [
      'Экран входа по email',
      'Восстановление пароля',
      'Кнопка «Войти» не реагирует на Android',
      'Настроить CI для сборки',
      'Описать API профиля',
    ],
    loginDescription:
      '## Что сделать\n\nФорма входа по **email и паролю**.\n\n- [x] Макет согласован\n- [ ] Вёрстка\n- [ ] Обработка ошибок\n\nМакеты: [Figma](https://www.figma.com)',
    subtasks: ['Вёрстка формы', 'Валидация полей'],
    comment: 'Макеты лежат в Figma, ссылку добавлю позже.',
    backlog: ['Тёмная тема', 'Push-уведомления', 'Экспорт отчётов в PDF'],
  },
  en: {
    people: ['Anna Smith', 'John Peters'],
    project: 'Mobile app',
    projectDescription: 'A demo project. Feel free to change or delete it.',
    goal: 'Ship the first version with sign-in',
    epic: 'User authentication',
    epicDescription: 'Email sign-in, password recovery, profile.',
    issues: [
      'Email sign-in screen',
      'Password recovery',
      '"Sign in" button does nothing on Android',
      'Set up CI builds',
      'Document the profile API',
    ],
    loginDescription:
      '## What to do\n\nSign-in form with **email and password**.\n\n- [x] Mockup approved\n- [ ] Layout\n- [ ] Error handling\n\nMockups: [Figma](https://www.figma.com)',
    subtasks: ['Form layout', 'Field validation'],
    comment: 'Mockups are in Figma, I will add the link later.',
    backlog: ['Dark theme', 'Push notifications', 'Export reports to PDF'],
  },
};

interface DemoContent {
  people: [string, string];
  project: string;
  projectDescription: string;
  goal: string;
  epic: string;
  epicDescription: string;
  issues: [string, string, string, string, string];
  loginDescription: string;
  subtasks: [string, string];
  comment: string;
  backlog: string[];
}

/** Создаёт демонстрационный проект на текущем языке, чтобы быстро посмотреть приложение в деле. */
@Injectable({ providedIn: 'root' })
export class DemoDataService {
  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly sprints = inject(SprintService);
  private readonly people = inject(PeopleService);
  private readonly i18n = inject(I18n);

  create(): Project {
    const text = CONTENT[this.i18n.lang()];
    const me = this.people.ensureMe();
    const anna = this.people.create(text.people[0]);
    const ivan = this.people.create(text.people[1]);

    const project = this.projects.create({
      name: text.project,
      key: this.projects.suggestKey('Demo'),
      description: text.projectDescription,
      color: 'indigo',
    });
    const sprint = this.sprints.create(project.id);
    const today = new Date();
    const inTwoWeeks = new Date(today.getTime() + 14 * 86_400_000);
    this.sprints.start(sprint.id, { startDate: isoDate(today), endDate: isoDate(inTwoWeeks) });
    this.sprints.update(sprint.id, { goal: text.goal });

    const epic = this.issues.create({
      projectId: project.id,
      type: 'epic',
      title: text.epic,
      description: text.epicDescription,
    });

    type Seed = [IssueType, string, IssuePriority, string | null, string[], number | null];
    const seeds: Seed[] = [
      ['story', 'in_progress', 'high', me.id, ['ui'], 5],
      ['story', 'todo', 'medium', anna.id, ['ui', 'backend'], 3],
      ['bug', 'in_review', 'highest', ivan.id, ['android'], 2],
      ['task', 'done', 'low', ivan.id, ['devops'], 1],
      ['task', 'todo', 'medium', null, ['backend', 'docs'], 2],
    ];
    const created = seeds.map(([type, statusId, priority, assigneeId, labels, storyPoints], i) =>
      this.issues.create({
        projectId: project.id,
        type,
        title: text.issues[i],
        description: i === 0 ? text.loginDescription : '',
        statusId,
        priority,
        assigneeId,
        labels,
        storyPoints,
        parentId: type === 'story' ? epic.id : null,
        sprintId: sprint.id,
      }),
    );

    const login = created[0];
    this.issues.create({
      projectId: project.id,
      type: 'subtask',
      title: text.subtasks[0],
      parentId: login.id,
      statusId: 'done',
    });
    this.issues.create({
      projectId: project.id,
      type: 'subtask',
      title: text.subtasks[1],
      parentId: login.id,
    });
    this.issues.addComment(login.id, text.comment);

    for (const title of text.backlog) {
      this.issues.create({ projectId: project.id, type: 'story', title, priority: 'low' });
    }
    return project;
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
