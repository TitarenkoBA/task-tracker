import { applyTextEdit, mergeTextStates, stateFromText, textOf } from './text-crdt';

describe('текст описания (Yjs)', () => {
  it('снимок хранит введённый текст', () => {
    const state = stateFromText('Привет');
    expect(textOf(state)).toBe('Привет');
  });

  it('одновременные правки разных мест складываются', () => {
    const base = stateFromText('abcdef');
    const left = applyTextEdit(base, 'abcdef', 'abXcdef');
    const right = applyTextEdit(base, 'abcdef', 'abcdeYf');
    const merged = mergeTextStates(left, right);
    expect(textOf(merged)).toBe('abXcdeYf');
    expect(textOf(mergeTextStates(right, left))).toBe(textOf(merged));
  });

  it('повтор того же снимка не меняет текст', () => {
    const state = applyTextEdit(stateFromText('раз'), 'раз', 'раз-два');
    expect(textOf(mergeTextStates(state, state))).toBe('раз-два');
  });

  it('битый снимок не затирает целый', () => {
    const state = stateFromText('целое');
    expect(textOf(mergeTextStates(state, '@@@'))).toBe('целое');
  });
});
