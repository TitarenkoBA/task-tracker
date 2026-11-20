/**
 * Командный сервер Task Tracker.
 *
 * Слушает только localhost. Снаружи его открывает обратный прокси с HTTPS.
 * Каждый человек входит своим токеном. Зритель может читать, но не писать.
 * Поля с текстом сервер не расшифровывает — ключ есть только у клиентов.
 *
 *   DATA_DIR=./data HOST=127.0.0.1 PORT=8787 node index.mjs
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createHub, HubError } from './lib.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
const origins = (process.env.ORIGIN ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function cors(req, res) {
  const origin = req.headers.origin;
  const allow = !origins.length || (origin && origins.includes(origin));
  if (allow) res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

function tokenOf(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8_000_000) {
        reject(new HubError('too-large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HubError('bad-json', 400));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Поднять HTTP и WebSocket на уже созданном хранилище.
 * @returns сервер, который слушает `port` (0 — выбрать свободный).
 */
export function startServer(hub, listenPort = 0, listenHost = host) {
  const sockets = new Set();

  function broadcast(projectId, changes, except) {
    const message = JSON.stringify({ type: 'changes', projectId, changes });
    for (const socket of sockets) {
      if (socket === except || socket.readyState !== 1) continue;
      if (!socket.projects.has(projectId)) continue;
      socket.send(message);
    }
  }

  const server = createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/v1/meta') {
        hub.requireMember(tokenOf(req));
        return send(res, 200, { salt: hub.salt });
      }
      if (req.method === 'GET' && url.pathname === '/v1/me') return send(res, 200, hub.me(tokenOf(req)));
      if (req.method === 'GET' && url.pathname === '/v1/members') {
        return send(res, 200, { members: hub.listMembers(tokenOf(req)) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/members') {
        return send(res, 201, hub.addMember(tokenOf(req), await readBody(req)));
      }
      const memberMatch = /^\/v1\/members\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
      if (req.method === 'DELETE' && memberMatch) {
        hub.removeMember(tokenOf(req), memberMatch[1]);
        return send(res, 200, { ok: true });
      }
      const projectMatch = /^\/v1\/projects\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
      if (projectMatch && req.method === 'GET') {
        return send(res, 200, { changes: hub.read(tokenOf(req), projectMatch[1]) });
      }
      if (projectMatch && req.method === 'POST') {
        const body = await readBody(req);
        const changes = hub.append(tokenOf(req), projectMatch[1], body.changes ?? []);
        if (changes.length) broadcast(projectMatch[1], changes, null);
        return send(res, 200, { accepted: changes.length });
      }
      send(res, 404, { error: 'not-found' });
    } catch (error) {
      if (error instanceof HubError) send(res, error.status, { error: error.message });
      else {
        console.error(error);
        send(res, 500, { error: 'internal' });
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    if (url.pathname !== '/v1/sync' || (origins.length && (!origin || !origins.includes(origin)))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    ws.projects = new Set();
    ws.token = '';
    const timer = setTimeout(() => {
      if (!ws.token) ws.close(4001, 'auth');
    }, 5000);
    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'bad-json' }));
        return;
      }
      if (!ws.token) {
        const member = message?.type === 'auth' ? hub.memberByToken(message.token) : null;
        if (!member) {
          ws.close(4001, 'auth');
          return;
        }
        clearTimeout(timer);
        ws.token = message.token;
        sockets.add(ws);
        ws.send(JSON.stringify({ type: 'hello', role: member.role, memberId: member.id, name: member.name, salt: hub.salt }));
        return;
      }
      if (message.type === 'subscribe') {
        try {
          const changes = hub.read(ws.token, message.projectId);
          ws.projects.add(message.projectId);
          ws.send(JSON.stringify({ type: 'snapshot', projectId: message.projectId, changes }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', error: error instanceof HubError ? error.message : 'bad-project' }));
        }
        return;
      }
      if (message.type === 'push') {
        try {
          const changes = hub.append(ws.token, message.projectId, message.changes ?? []);
          if (changes.length) broadcast(message.projectId, changes, ws);
          ws.send(JSON.stringify({ type: 'ack', projectId: message.projectId, accepted: changes.length }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', error: error instanceof HubError ? error.message : 'bad-changes' }));
        }
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      sockets.delete(ws);
    });
  });

  return new Promise((resolve) => {
    server.listen(listenPort, listenHost, () => resolve(server));
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('./data/', import.meta.url));
  const hub = createHub(dataDir);
  if (hub.owner) {
    console.log(`Первый запуск. Токен владельца: ${dataDir}\\owner-token.txt`);
    console.log('Передайте его себе и больше никому. Повторно сервер его не показывает.');
  }
  await startServer(hub, port, host);
  console.log(`Task Tracker слушает http://${host}:${port}`);
}
