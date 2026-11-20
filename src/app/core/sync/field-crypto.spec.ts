import { decodeSalt, deriveKey, encodeSalt, openChange, sealChange } from './field-crypto';

describe('шифрование полей', () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  it('прячет текст и возвращает его с той же парольной фразой', async () => {
    const key = await deriveKey('фраза команды', salt);
    const sealed = await sealChange(
      {
        collection: 'issues',
        id: 'i1',
        fields: { title: 'Секрет', statusId: 'todo', labels: ['ui'] },
        clock: { title: '1', statusId: '1', labels: '1' },
      },
      key,
    );
    expect(sealed.fields['statusId']).toBe('todo');
    expect(String(sealed.fields['title'])).not.toContain('Секрет');
    expect(String(sealed.fields['labels'])).not.toContain('ui');
    const opened = await openChange(sealed, key);
    expect(opened.fields['title']).toBe('Секрет');
    expect(opened.fields['labels']).toEqual(['ui']);
  });

  it('чужая парольная фраза не открывает поле', async () => {
    const sealed = await sealChange(
      {
        collection: 'comments',
        id: 'c1',
        fields: { body: 'тихо' },
        clock: { body: '1' },
      },
      await deriveKey('наша', salt),
    );
    await expect(openChange(sealed, await deriveKey('чужая', salt))).rejects.toBeTruthy();
  });

  it('соль переживает запись в текст и обратно', () => {
    expect(decodeSalt(encodeSalt(salt))).toEqual(salt);
  });
});
