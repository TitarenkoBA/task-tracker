import { MarkdownRenderer, loadMarkdownRenderer } from './markdown';

describe('renderMarkdown', () => {
  let render: MarkdownRenderer;

  beforeAll(async () => {
    render = await loadMarkdownRenderer();
  });

  it('базовое форматирование', () => {
    const html = render('# Заголовок\n\n**жирный** и _курсив_\n\n- раз\n- два');
    expect(html).toContain('<h1>Заголовок</h1>');
    expect(html).toContain('<strong>жирный</strong>');
    expect(html).toContain('<em>курсив</em>');
    expect(html).toContain('<li>раз</li>');
  });

  it('одиночный перенос строки становится <br>', () => {
    expect(render('строка 1\nстрока 2')).toContain('<br>');
  });

  it('пустой текст — пустой HTML', () => {
    expect(render('   ')).toBe('');
  });

  it('сырой HTML не выполняется, а экранируется', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ссылки открываются в новой вкладке, опасные схемы отбрасываются', () => {
    expect(render('[сайт](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">сайт</a>',
    );
    const evil = render('[клик](javascript:alert(1))');
    expect(evil).not.toContain('href');
    expect(evil).toContain('клик');
  });

  it('картинки не загружаются, а показываются ссылкой', () => {
    const html = render('![схема](https://example.com/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://example.com/a.png"');
  });

  it('чек-листы рисуются символами', () => {
    const html = render('- [ ] сделать\n- [x] готово');
    expect(html).toContain('☐');
    expect(html).toContain('md-check md-check-done');
    expect(html).not.toContain('<input');
  });
});
