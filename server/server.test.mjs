import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createHub } from './lib.mjs';
import { startServer } from './index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tt-hub-'));
const hub = createHub(dir);
const server = await startServer(hub, 0, '127.0.0.1');
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const owner = hub.owner.token;

async function call(path, { method = 'GET', token = owner, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  return { status: response.status, json };
}

before(() => {
  assert.ok(owner);
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('без токена сервер молчит', async () => {
  const response = await fetch(base + '/v1/me');
  assert.equal(response.status, 401);
});

test('владелец заводит зрителя, зритель не может писать', async () => {
  const created = await call('/v1/members', {
    method: 'POST',
    body: { name: 'Лена', role: 'viewer' },
  });
  assert.equal(created.status, 201);
  const viewer = created.json.token;
  const read = await call('/v1/projects/project-1', { token: viewer });
  assert.equal(read.status, 200);
  assert.deepEqual(read.json.changes, []);
  const write = await call('/v1/projects/project-1', {
    method: 'POST',
    token: viewer,
    body: { changes: [change()] },
  });
  assert.equal(write.status, 403);
});

test('правка редактора доходит до второго подключения', async () => {
  const editor = await call('/v1/members', {
    method: 'POST',
    body: { name: 'Борис', role: 'editor' },
  });
  const token = editor.json.token;
  const posted = await call('/v1/projects/project-1', {
    method: 'POST',
    token,
    body: { changes: [{ plainHash: 'h1', change: change() }] },
  });
  assert.equal(posted.json.accepted, 1);
  const again = await call('/v1/projects/project-1', {
    method: 'POST',
    token,
    body: { changes: [{ plainHash: 'h1', change: change() }] },
  });
  assert.equal(again.json.accepted, 0);

  const remote = await socket(token);
  remote.send(JSON.stringify({ type: 'subscribe', projectId: 'project-1' }));
  const snapshot = await once(remote, 'snapshot');
  assert.equal(snapshot.changes.length, 1);
  assert.equal(snapshot.changes[0].fields.title, 'enc:secret');

  const live = await socket(owner);
  live.send(JSON.stringify({ type: 'subscribe', projectId: 'project-1' }));
  await once(live, 'snapshot');
  remote.send(
    JSON.stringify({
      type: 'push',
      projectId: 'project-1',
      changes: [{ plainHash: 'h2', change: change('enc:next') }],
    }),
  );
  const incoming = await once(live, 'changes');
  assert.equal(incoming.changes[0].fields.title, 'enc:next');
  remote.close();
  live.close();
});

function change(title = 'enc:secret') {
  return {
    collection: 'issues',
    id: 'issue-1',
    fields: { projectId: 'project-1', title },
    clock: { projectId: '1', title: '2' },
  };
}

function socket(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`);
  return new Promise((resolve, reject) => {
    ws.once('error', reject);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    once(ws, 'hello').then(() => resolve(ws), reject);
  });
}

function once(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`нет сообщения ${type}`)), 3000);
    ws.on('message', function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    });
  });
}
