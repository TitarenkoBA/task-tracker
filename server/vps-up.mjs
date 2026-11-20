/**
 * Одна команда с этого компьютера: командный сервер на любом VPS.
 *
 *   node server/vps-up.mjs root@203.0.113.10 --domain sync.example.com
 *
 * Копирует сервер по SSH и ставит Node. С --domain перед ним встаёт Caddy
 * и сам получает сертификат. Docker не нужен. Развёртывание в Yandex Cloud
 * этой командой не затрагивается.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const domain = flagValue('--domain').toLowerCase();
const origin = flagValue('--origin');
const sshKey = flagValue('--ssh-key');
const target = positional(args);

if (args.includes('--help') || args.includes('-h') || !target) {
  console.log(`node server/vps-up.mjs root@203.0.113.10 [--domain sync.example.com] [--origin https://user.github.io] [--ssh-key файл]

Копирует командный сервер на VPS по SSH и запускает его.
Без --domain адрес будет http://<ip>:8787 — его откроет только локальный npm start.
С --domain Caddy получает сертификат, и этот https-адрес вставляется в настройках сайта на GitHub Pages.
Docker не нужен.`);
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(target) && !/^[A-Za-z0-9.-]+$/.test(target)) {
  die('Адрес вида root@203.0.113.10.');
}
if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
  die('--domain — это имя вроде sync.example.com, без https:// и без пути.');
}
if (origin && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) {
  die('--origin — адрес сайта без пути, например https://user.github.io.');
}

function positional(list) {
  const valued = new Set(['--domain', '--origin', '--ssh-key']);
  for (let index = 0; index < list.length; index += 1) {
    if (valued.has(list[index])) {
      index += 1;
      continue;
    }
    if (list[index] === '--help' || list[index] === '-h' || list[index].startsWith('--')) continue;
    return list[index];
  }
  return '';
}

function flagValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) die(`${name} нуждается в значении.`);
  return value;
}

function die(message) {
  console.error(message);
  process.exit(1);
}

function quote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const sshArgs = ['-o', 'StrictHostKeyChecking=accept-new'];
if (sshKey) sshArgs.push('-i', sshKey);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.error) die(`Не найдена команда ${command}. На Windows нужен клиент OpenSSH.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const stage = mkdtempSync(join(tmpdir(), 'task-tracker-'));
for (const name of ['index.mjs', 'lib.mjs', 'package.json', 'package-lock.json', 'vps-install.sh']) {
  cpSync(join(serverDir, name), join(stage, name));
}
chmodSync(join(stage, 'vps-install.sh'), 0o755);

console.log(`Копирую сервер на ${target}…`);
run('ssh', [...sshArgs, target, 'rm -rf /tmp/task-tracker-src']);
run('scp', [...sshArgs, '-r', stage, `${target}:/tmp/task-tracker-src`]);

const user = target.includes('@') ? target.slice(0, target.indexOf('@')) : '';
const sudo = user === 'root' ? '' : 'sudo ';
const remote = [
  `${sudo}bash /tmp/task-tracker-src/vps-install.sh`,
  '--src /tmp/task-tracker-src',
  domain ? `--domain ${quote(domain)}` : '',
  origin ? `--origin ${quote(origin)}` : '',
]
  .filter(Boolean)
  .join(' ');
run('ssh', [...sshArgs, target, remote]);
