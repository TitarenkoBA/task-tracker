/**
 * Хранилище командного сервера.
 * Данные проектов — журнал изменений. Сервер их не сливает и не читает:
 * клиенты присылают уже зашифрованные поля.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, appendFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROLES = new Set(['owner', 'editor', 'viewer']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLLECTIONS = new Set([
  'projects',
  'issues',
  'sprints',
  'people',
  'comments',
  'activity',
  'messages',
]);

export class HubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sameHash(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createHub(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, 'projects'), { recursive: true });
  const file = join(dataDir, 'hub.json');
  let state = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { salt: randomBytes(16).toString('base64'), members: [] };
  const seen = new Set();

  function save() {
    const next = join(dataDir, 'hub.json.tmp');
    writeFileSync(next, JSON.stringify(state, null, 2));
    renameSync(next, file);
  }

  function memberByToken(token) {
    if (!token) return null;
    const hash = hashToken(token);
    return state.members.find((member) => sameHash(member.tokenHash, hash)) ?? null;
  }

  function requireMember(token) {
    const member = memberByToken(token);
    if (!member) throw new HubError('unauthorized', 401);
    return member;
  }

  function requireOwner(token) {
    const member = requireMember(token);
    if (member.role !== 'owner') throw new HubError('forbidden', 403);
    return member;
  }

  function publicMember(member) {
    return { id: member.id, name: member.name, role: member.role, createdAt: member.createdAt };
  }

  function ensureOwner() {
    if (state.members.length) return null;
    const token = randomBytes(32).toString('base64url');
    const member = {
      id: randomBytes(8).toString('hex'),
      name: 'Владелец',
      role: 'owner',
      tokenHash: hashToken(token),
      createdAt: Date.now(),
    };
    state.members.push(member);
    save();
    const tokenFile = join(dataDir, 'owner-token.txt');
    writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    return { token, member: publicMember(member) };
  }

  function addMember(actorToken, input) {
    requireOwner(actorToken);
    const name = String(input?.name ?? '').trim();
    const role = input?.role;
    if (!name || name.length > 100) throw new HubError('bad-name', 400);
    if (!ROLES.has(role)) throw new HubError('bad-role', 400);
    const token = randomBytes(32).toString('base64url');
    const member = {
      id: randomBytes(8).toString('hex'),
      name,
      role,
      tokenHash: hashToken(token),
      createdAt: Date.now(),
    };
    state.members.push(member);
    save();
    return { token, member: publicMember(member) };
  }

  function removeMember(actorToken, id) {
    const actor = requireOwner(actorToken);
    const member = state.members.find((item) => item.id === id);
    if (!member) throw new HubError('not-found', 404);
    const owners = state.members.filter((item) => item.role === 'owner');
    if (member.role === 'owner' && owners.length === 1) throw new HubError('last-owner', 400);
    if (member.id === actor.id && owners.length === 1) throw new HubError('last-owner', 400);
    state.members = state.members.filter((item) => item.id !== id);
    save();
  }

  function checkProject(projectId) {
    if (!ID.test(projectId ?? '')) throw new HubError('bad-project', 400);
  }

  function checkChange(change, projectId) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return false;
    if (!COLLECTIONS.has(change.collection) || !ID.test(change.id ?? '')) return false;
    if (!change.fields || typeof change.fields !== 'object' || Array.isArray(change.fields)) return false;
    if (!change.clock || typeof change.clock !== 'object' || Array.isArray(change.clock)) return false;
    const owner = change.collection === 'projects' ? change.id : change.fields.projectId;
    if (typeof owner === 'string' && owner !== projectId && change.collection !== 'people') return false;
    if (change.collection === 'projects' && change.id !== projectId) return false;
    return true;
  }

  function logPath(projectId) {
    return join(dataDir, 'projects', `${projectId}.jsonl`);
  }

  function append(actorToken, projectId, changes) {
    const member = requireMember(actorToken);
    if (member.role === 'viewer') throw new HubError('forbidden', 403);
    checkProject(projectId);
    if (!Array.isArray(changes) || changes.length > 5000) throw new HubError('bad-changes', 400);
    const accepted = [];
    for (const item of changes) {
      const change = item?.change ?? item;
      const plainHash = typeof item?.plainHash === 'string' ? item.plainHash : '';
      if (!checkChange(change, projectId)) continue;
      const key = plainHash || hashToken(JSON.stringify(change));
      if (seen.has(key)) continue;
      seen.add(key);
      accepted.push({ plainHash: key, change });
    }
    if (!accepted.length) return [];
    appendFileSync(
      logPath(projectId),
      accepted.map((item) => JSON.stringify({ memberId: member.id, ...item })).join('\n') + '\n',
    );
    return accepted.map((item) => item.change);
  }

  function read(actorToken, projectId) {
    requireMember(actorToken);
    checkProject(projectId);
    const path = logPath(projectId);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).change);
  }

  function loadSeen() {
    if (!existsSync(join(dataDir, 'projects'))) return;
    for (const name of readdirSync(join(dataDir, 'projects'))) {
      if (!name.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(dataDir, 'projects', name), 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          seen.add(row.plainHash || hashToken(JSON.stringify(row.change)));
        } catch {
          // Битая строка не должна мешать запуску.
        }
      }
    }
  }

  loadSeen();
  const owner = ensureOwner();

  return {
    get salt() {
      return state.salt;
    },
    owner,
    memberByToken,
    requireMember,
    listMembers(token) {
      requireOwner(token);
      return state.members.map(publicMember);
    },
    me(token) {
      return publicMember(requireMember(token));
    },
    addMember,
    removeMember,
    append,
    read,
  };
}
