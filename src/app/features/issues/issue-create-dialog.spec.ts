import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { setupTestStore } from '../../../testing/test-store';
import { Project } from '../../core/models/entities';
import { IssueService } from '../../core/services/issue.service';
import { ProjectService } from '../../core/services/project.service';
import { IssueCreateDialog } from './issue-create-dialog';

describe('IssueCreateDialog', () => {
  let project: Project;
  const ref = { close: vi.fn() };
  /** Данные диалога; функция — потому что id проекта известен только после его создания. */
  let dialogData: (p: Project) => object;

  beforeEach(async () => {
    ref.close.mockReset();
    dialogData = () => ({});
    await setupTestStore({
      imports: [IssueCreateDialog],
      providers: [
        provideRouter([]),
        { provide: DIALOG_DATA, useFactory: () => dialogData(project) },
        { provide: DialogRef, useValue: ref },
      ],
    });
    project = TestBed.inject(ProjectService).create({ name: 'Web', key: 'WEB', color: 'indigo' });
  });

  async function render(data: (p: Project) => object = () => ({})) {
    dialogData = data;
    const fixture = TestBed.createComponent(IssueCreateDialog);
    await fixture.whenStable();
    return fixture;
  }

  function type(el: HTMLElement, selector: string, value: string) {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('не создаёт задачу без названия и показывает ошибку', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Введите название');
    expect(TestBed.inject(IssueService).issues()).toHaveLength(0);
    expect(ref.close).not.toHaveBeenCalled();
  });

  it('создаёт задачу с выбранным типом и закрывается', async () => {
    const fixture = await render((p) => ({ projectId: p.id }));
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#ic-title', 'Починить вход');
    [...el.querySelectorAll<HTMLButtonElement>('fieldset button')]
      .find((b) => b.textContent?.includes('Баг'))!
      .click();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    const [issue] = TestBed.inject(IssueService).issues();
    expect(issue).toMatchObject({ title: 'Починить вход', type: 'bug', projectId: project.id });
    expect(ref.close).toHaveBeenCalledWith(issue);
  });

  it('учитывает статус из колонки, откуда открыт диалог', async () => {
    const fixture = await render((p) => ({ projectId: p.id, statusId: 'in_review' }));
    const el = fixture.nativeElement as HTMLElement;
    type(el, '#ic-title', 'Из колонки');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(TestBed.inject(IssueService).issues()[0].statusId).toBe('in_review');
  });

  it('режим «создать ещё» очищает форму и не закрывает диалог', async () => {
    const fixture = await render((p) => ({ projectId: p.id }));
    const el = fixture.nativeElement as HTMLElement;
    const checkbox = el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    type(el, '#ic-title', 'Первая');
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(ref.close).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLInputElement>('#ic-title')!.value).toBe('');
    expect(TestBed.inject(IssueService).issues()).toHaveLength(1);
  });
});
