/**
 * Шифрование текстовых полей перед отправкой на сервер или в Dropbox.
 * Ключ выводится из парольной фразы команды и никуда не отправляется:
 * на диске сервера и в облаке лежат только ciphertext.
 *
 * Структурные поля (id, статусы-id, порядок, сроки, часы) остаются открытыми,
 * чтобы слияние и проверка проекта работали как раньше.
 */

const VERSION = 'enc:v1';
const ITERATIONS = 100_000;

/** Поля, в которых есть текст, написанный людьми. */
export const SECRET_FIELDS: Record<string, readonly string[]> = {
  projects: ['name', 'description', 'statuses'],
  issues: ['title', 'description', 'descriptionState', 'labels'],
  sprints: ['name', 'goal'],
  people: ['name', 'email'],
  comments: ['body'],
  activity: ['from', 'to'],
  messages: ['text'],
};

export interface SealedChange {
  collection: string;
  id: string;
  fields: Record<string, unknown>;
  clock: Record<string, string>;
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: asBuffer(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Соль Dropbox одна на папку: отдельного сервера, который раздаст её, нет. */
export async function dropboxSalt(folder: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`task-tracker-dropbox:${folder}`),
  );
  return new Uint8Array(digest).slice(0, 16);
}

export function encodeSalt(salt: Uint8Array): string {
  return b64(salt);
}

export function decodeSalt(value: string): Uint8Array {
  return fromB64(value);
}

export async function sealChange<T extends SealedChange>(change: T, key: CryptoKey): Promise<T> {
  const fields = { ...change.fields };
  for (const name of SECRET_FIELDS[change.collection] ?? []) {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
    if (!sealable(fields[name])) continue;
    fields[name] = await encryptValue(fields[name], key);
  }
  return { ...change, fields };
}

export async function openChange<T extends SealedChange>(change: T, key: CryptoKey): Promise<T> {
  const fields = { ...change.fields };
  for (const name of SECRET_FIELDS[change.collection] ?? []) {
    const value = fields[name];
    if (typeof value !== 'string' || !value.startsWith(`${VERSION}:`)) continue;
    fields[name] = await decryptValue(value, key);
  }
  return { ...change, fields };
}

async function encryptValue(value: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${VERSION}:${b64(iv)}:${b64(new Uint8Array(cipher))}`;
}

async function decryptValue(payload: string, key: CryptoKey): Promise<unknown> {
  const body = payload.slice(VERSION.length + 1);
  const sep = body.indexOf(':');
  const iv = sep >= 0 ? body.slice(0, sep) : '';
  const cipher = sep >= 0 ? body.slice(sep + 1) : '';
  if (!iv || !cipher) throw new Error('bad-cipher');
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBuffer(fromB64(iv)) },
    key,
    asBuffer(fromB64(cipher)),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

function sealable(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (Array.isArray(value)) return true;
  return typeof value === 'object' && value !== null;
}

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Копия в обычный ArrayBuffer: так принимает Web Crypto в строгих типах. */
function asBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}
