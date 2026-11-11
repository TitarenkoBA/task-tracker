import { Injectable, inject } from '@angular/core';
import { IssuePriority, IssueType, Project } from '../models/entities';
import { IssueService } from './issue.service';
import { PeopleService } from './people.service';
import { ProjectService } from './project.service';
import { SprintService } from './sprint.service';

/** Создаёт демонстрационный проект, чтобы быстро посмотреть приложение в деле. */
@Injectable({ providedIn: 'root' })
export class DemoDataService {
  private readonly projects = inject(ProjectService);
  private readonly issues = inject(IssueService);
  private readonly sprints = inject(SprintService);
  private readonly people = inject(PeopleService);

  create(): Project {
    const me = this.people.ensureMe();
    const anna = this.people.create('Анна Смирнова');
    const ivan = this.people.create('Иван Петров');

    const project = this.projects.create({
      name: 'Мобильное приложение',
      key: this.projects.suggestKey('Демо'),
      description: 'Демонстрационный проект. Его можно смело менять или удалить.',
      color: 'indigo',
    });
    const sprint = this.sprints.create(project.id);
    const today = new Date();
    const inTwoWeeks = new Date(today.getTime() + 14 * 86_400_000);
    this.sprints.start(sprint.id, { startDate: isoDate(today), endDate: isoDate(inTwoWeeks) });
    this.sprints.update(sprint.id, { goal: 'Выпустить первую версию с авторизацией' });

    const epic = this.issues.create({
      projectId: project.id,
      type: 'epic',
      title: 'Авторизация пользователей',
      description: 'Вход по email, восстановление пароля, профиль.',
    });

    type Seed = [IssueType, string, string, IssuePriority, string | null, string[], number | null];
    const seeds: Seed[] = [
      ['story', 'Экран входа по email', 'in_progress', 'high', me.id, ['ui'], 5],
      ['story', 'Восстановление пароля', 'todo', 'medium', anna.id, ['ui', 'backend'], 3],
      ['bug', 'Кнопка «Войти» не реагирует на Android', 'in_review', 'highest', ivan.id, ['android'], 2],
      ['task', 'Настроить CI для сборки', 'done', 'low', ivan.id, ['devops'], 1],
      ['task', 'Описать API профиля', 'todo', 'medium', null, ['backend', 'docs'], 2],
    ];
    for (const [type, title, statusId, priority, assigneeId, labels, storyPoints] of seeds) {
      this.issues.create({
        projectId: project.id,
        type,
        title,
        statusId,
        priority,
        assigneeId,
        labels,
        storyPoints,
        parentId: type === 'story' ? epic.id : null,
        sprintId: sprint.id,
      });
    }

    const login = this.issues.issues().find((i) => i.title === 'Экран входа по email')!;
    this.issues.create({ projectId: project.id, type: 'subtask', title: 'Вёрстка формы', parentId: login.id, statusId: 'done' });
    this.issues.create({ projectId: project.id, type: 'subtask', title: 'Валидация полей', parentId: login.id });
    this.issues.addComment(login.id, 'Макеты лежат в Figma, ссылку добавлю позже.');

    for (const title of ['Тёмная тема', 'Push-уведомления', 'Экспорт отчётов в PDF']) {
      this.issues.create({ projectId: project.id, type: 'story', title, priority: 'low' });
    }
    return project;
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
