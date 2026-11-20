/**
 * Dropbox как общая папка журнала.
 * У каждого устройства свой файл, поэтому два браузера не перетирают одну запись.
 * Текст в файле уже зашифрован.
 */

export interface DropboxFile {
  name: string;
  path: string;
}

export async function dropboxList(token: string, folder: string): Promise<DropboxFile[]> {
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folder, recursive: false }),
  });
  if (response.status === 409) {
    const created = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folder, autorename: false }),
    });
    if (!created.ok && created.status !== 409) throw new Error('dropbox');
    return [];
  }
  if (!response.ok) throw new Error('dropbox');
  const json = (await response.json()) as {
    entries?: { '.tag': string; name: string; path_lower?: string }[];
  };
  return (json.entries ?? [])
    .filter((entry) => entry['.tag'] === 'file' && entry.name.endsWith('.jsonl'))
    .map((entry) => ({ name: entry.name, path: entry.path_lower ?? `${folder}/${entry.name}` }));
}

export async function dropboxDownload(token: string, path: string): Promise<string | null> {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) },
  });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error('dropbox');
  return response.text();
}

export async function dropboxUpload(token: string, path: string, body: string): Promise<void> {
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: { '.tag': 'overwrite' }, mute: true }),
    },
    body,
  });
  if (!response.ok) throw new Error('dropbox');
}
