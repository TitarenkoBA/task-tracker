import * as Y from 'yjs';

/**
 * Текст описания задачи как CRDT (Yjs).
 *
 * В данных хранится снимок документа (`descriptionState`, base64).
 * Строка `description` — его проекция для интерфейса и поиска.
 * Два снимка сливаются объединением правок, а не выбором одной версии.
 */

const TEXT = 'd';

function bytes(state: string): Uint8Array {
  const binary = atob(state);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encode(update: Uint8Array): string {
  let binary = '';
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function docFrom(state: string | undefined): Y.Doc {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, bytes(state));
  return doc;
}

/** Текст, который показывает снимок. Пустой и битый снимок — пустая строка. */
export function textOf(state: string | undefined): string {
  if (!state) return '';
  try {
    return docFrom(state).getText(TEXT).toString();
  } catch {
    return '';
  }
}

/** Снимок, в котором весь текст вставлен одним куском. */
export function stateFromText(text: string): string {
  const doc = new Y.Doc();
  if (text) doc.getText(TEXT).insert(0, text);
  return encode(Y.encodeStateAsUpdate(doc));
}

/**
 * Объединить два снимка. Порядок аргументов не важен,
 * повтор того же снимка текст не меняет.
 */
export function mergeTextStates(a: string | undefined, b: string | undefined): string {
  if (!a) return b || '';
  if (!b) return a;
  try {
    const doc = docFrom(a);
    Y.applyUpdate(doc, bytes(b));
    return encode(Y.encodeStateAsUpdate(doc));
  } catch {
    return a;
  }
}

/**
 * Правка описания в редакторе: `before` — текст до правки, `after` — после.
 * В снимок попадает только изменённый кусок, поэтому одновременные правки
 * разных мест складываются.
 */
export function applyTextEdit(state: string | undefined, before: string, after: string): string {
  if (before === after) return state && textOf(state) === before ? state : stateFromText(before);
  if (state && textOf(state) !== before) return applyTextEdit(stateFromText(before), before, after);
  const doc = docFrom(state && textOf(state) === before ? state : undefined);
  const text = doc.getText(TEXT);
  if (!state && before) text.insert(0, before);
  if (text.toString() !== before) return stateFromText(after);
  const start = sharedPrefix(before, after);
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  const remove = before.length - suffix - start;
  if (remove > 0) text.delete(start, remove);
  const insert = after.slice(start, after.length - suffix);
  if (insert) text.insert(start, insert);
  return encode(Y.encodeStateAsUpdate(doc));
}

function sharedPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}
