/**
 * Одна команда: командный сервер в Yandex Cloud.
 *
 *   node server/yc-up.mjs
 *   node server/yc-up.mjs --domain sync.example.com
 *
 * Нужны установленный `yc` (`yc init`, выбран каталог) и запущенный Docker.
 * Повторный запуск печатает адрес уже работающей машины и не создаёт вторую.
 * `node server/yc-up.mjs --recreate` удаляет машину и поднимает пустую:
 * новый токен владельца, журнал сбрасывается.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const recreate = args.includes('--recreate');
const preemptible = args.includes('--preemptible');
const zoneFlag = args.indexOf('--zone');
const zone = zoneFlag === -1 ? 'ru-central1-a' : args[zoneFlag + 1];
const domain = flagValue('--domain').toLowerCase();
const origin = flagValue('--origin');

const VM = 'task-tracker-hub';
const REGISTRY = 'task-tracker';
const ACCOUNT = 'task-tracker-hub';
const GROUP = 'task-tracker-hub';

if (args.includes('--help') || args.includes('-h') || !zone) {
  console.log(`node server/yc-up.mjs [--domain sync.example.com] [--origin https://user.github.io] [--recreate] [--preemptible] [--zone ru-central1-a]

Поднимает командный сервер в текущем каталоге Yandex Cloud.
Без --domain адрес будет http://<ip>:8787 — его откроет только локальный npm start.
С --domain перед сервером встаёт Caddy и получает сертификат. Этот https-адрес
вставляется в настройках сайта на GitHub Pages.
Нужны yc init и запущенный Docker.`);
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
  die('--domain — это имя вроде sync.example.com, без https:// и без пути.');
}
if (origin && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) {
  die('--origin — адрес сайта без пути, например https://user.github.io.');
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

function run(command, commandArgs, { allowFail = false, input } = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', input, cwd: serverDir });
  if (result.error) {
    die(
      command === 'yc'
        ? 'Не найден yc. Установите CLI (https://yandex.cloud/ru/docs/cli/quickstart) и выполните yc init.'
        : `Не найдена команда ${command}.`,
    );
  }
  if (result.status !== 0 && !allowFail) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim();
    die(detail || `${command} завершился с кодом ${result.status}`);
  }
  return result;
}

function yc(commandArgs, options) {
  return run('yc', commandArgs, options);
}

function ycJson(commandArgs, options) {
  const result = yc([...commandArgs, '--format', 'json'], options);
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  const start = text.search(/[[{]/);
  if (start === -1) die(`yc не вернул JSON:\n${text}`);
  return JSON.parse(text.slice(start));
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of Object.keys(value)) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function idOf(resource) {
  return resource?.id ?? '';
}

function publicIp(instance) {
  const interfaces = instance?.network_interfaces ?? instance?.networkInterfaces ?? [];
  for (const item of interfaces) {
    const address = item.primary_v4_address ?? item.primaryV4Address;
    const nat = address?.one_to_one_nat ?? address?.oneToOneNat;
    if (nat?.address) return nat.address;
  }
  return '';
}

function ensureSshKey() {
  const homeKeys = [join(homedir(), '.ssh', 'id_ed25519'), join(homedir(), '.ssh', 'id_rsa')];
  for (const key of homeKeys) {
    if (existsSync(key) && existsSync(`${key}.pub`)) return { privateKey: key, publicKey: `${key}.pub` };
  }
  const dir = join(serverDir, '.deploy');
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'yc_ed25519');
  if (!existsSync(key)) {
    const created = run('ssh-keygen', ['-t', 'ed25519', '-f', key, '-N', '', '-q', '-C', 'task-tracker-hub']);
    if (created.status !== 0) die('Не удалось создать SSH-ключ. Установите клиент OpenSSH.');
  }
  return { privateKey: key, publicKey: `${key}.pub` };
}

function ensureRegistry() {
  return (
    ycJson(['container', 'registry', 'get', '--name', REGISTRY], { allowFail: true }) ??
    ycJson(['container', 'registry', 'create', '--name', REGISTRY])
  );
}

function ensureAccount() {
  return (
    ycJson(['iam', 'service-account', 'get', '--name', ACCOUNT], { allowFail: true }) ??
    ycJson(['iam', 'service-account', 'create', '--name', ACCOUNT])
  );
}

function ensurePuller(registryId, accountId) {
  const bindings = listOf(
    ycJson(['container', 'registry', 'list-access-bindings', '--id', registryId], { allowFail: true }),
  );
  const already = bindings.some((binding) => {
    const role = binding.role_id ?? binding.roleId;
    const subject = binding.subject?.id;
    return role === 'container-registry.images.puller' && subject === accountId;
  });
  if (already) return;
  yc([
    'container',
    'registry',
    'add-access-binding',
    '--id',
    registryId,
    '--role',
    'container-registry.images.puller',
    '--subject',
    `serviceAccount:${accountId}`,
  ]);
}

function pickSubnet() {
  const subnets = listOf(ycJson(['vpc', 'subnet', 'list']));
  const inZone = subnets.filter((subnet) => (subnet.zone_id ?? subnet.zoneId) === zone);
  if (!inZone.length) {
    const zones = [...new Set(subnets.map((subnet) => subnet.zone_id ?? subnet.zoneId).filter(Boolean))];
    die(
      zones.length
        ? `В зоне ${zone} нет подсети. Есть: ${zones.join(', ')}. Повторите с --zone <зона>.`
        : 'В каталоге нет сети. В консоли откройте Virtual Private Cloud и создайте сеть, затем повторите команду.',
    );
  }
  return inZone.find((subnet) => String(subnet.name ?? '').startsWith('default')) ?? inZone[0];
}

function openPorts() {
  return domain ? [80, 443, 22] : [8787, 22];
}

function hasIngress(group, port) {
  const rules = group?.rules ?? [];
  return rules.some((rule) => {
    const direction = String(rule.direction ?? '').toLowerCase();
    const from = String(rule.ports?.from_port ?? rule.ports?.fromPort ?? '');
    return direction === 'ingress' && from === String(port);
  });
}

function ensureGroup(networkId) {
  let group = ycJson(['vpc', 'security-group', 'get', '--name', GROUP], { allowFail: true });
  if (!group) {
    const command = [
      'vpc',
      'security-group',
      'create',
      '--name',
      GROUP,
      '--network-id',
      networkId,
      '--rule',
      'direction=egress,protocol=any,v4-cidrs=[0.0.0.0/0]',
    ];
    for (const port of openPorts()) {
      command.push('--rule', `direction=ingress,port=${port},protocol=tcp,v4-cidrs=[0.0.0.0/0]`);
    }
    return ycJson(command);
  }
  for (const port of openPorts()) {
    if (hasIngress(group, port)) continue;
    group = ycJson([
      'vpc',
      'security-group',
      'update-rules',
      '--id',
      idOf(group),
      '--add-rule',
      `direction=ingress,port=${port},protocol=tcp,v4-cidrs=[0.0.0.0/0]`,
    ]);
  }
  return group;
}

function writeCompose(image) {
  const dir = join(serverDir, '.deploy');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'docker-compose.yaml');
  const originLine = origin ? `\n      ORIGIN: ${JSON.stringify(origin)}` : '';
  writeFileSync(
    path,
    `version: "3.7"
services:
  hub:
    container_name: task-tracker
    image: ${image}
    environment:
      HOST: 0.0.0.0
      PORT: "8787"
      DATA_DIR: /data
      PRINT_OWNER_TOKEN: "1"${originLine}
    volumes:
      - hub-data:/data
    restart: always
  caddy:
    container_name: task-tracker-caddy
    image: caddy:2
    command:
      - reverse-proxy
      - --from
      - ${domain}
      - --to
      - hub:8787
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    restart: always
volumes:
  hub-data:
  caddy-data:
  caddy-config:
`,
  );
  return path;
}

function buildAndPush(image) {
  console.log('Собираю образ…');
  const built = spawnSync('docker', ['build', '-t', image, '.'], { cwd: serverDir, stdio: 'inherit' });
  if (built.error) die('Не найден Docker. Запустите Docker Desktop и повторите команду.');
  if (built.status !== 0) process.exit(built.status ?? 1);
  console.log('Загружаю образ в Container Registry…');
  yc(['container', 'registry', 'configure-docker']);
  const pushed = spawnSync('docker', ['push', image], { stdio: 'inherit' });
  if (pushed.status !== 0) process.exit(pushed.status ?? 1);
}

function createVm(subnetId, groupId, image, publicKey) {
  const command = [
    'compute',
    'instance',
    'create-with-container',
    '--name',
    VM,
    '--zone',
    zone,
    '--cores',
    '2',
    '--core-fraction',
    '20',
    '--memory',
    '1',
    '--create-boot-disk',
    'size=30,auto-delete=true',
    '--network-interface',
    `subnet-id=${subnetId},nat-ip-version=ipv4,security-group-ids=${groupId}`,
    '--service-account-name',
    ACCOUNT,
    '--ssh-key',
    publicKey,
  ];
  if (domain) {
    command.push('--description', domain, '--docker-compose-file', writeCompose(image));
  } else {
    command.push(
      '--container-name',
      'task-tracker',
      '--container-image',
      image,
      '--container-env',
      'HOST=0.0.0.0,PORT=8787,DATA_DIR=/data,PRINT_OWNER_TOKEN=1',
    );
  }
  if (preemptible) command.push('--preemptible');
  console.log('Создаю виртуальную машину…');
  return ycJson(command);
}

async function waitHealth(ip) {
  const url = `http://${ip}:8787/health`;
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (response.ok) return;
    } catch {
      // Образ ещё скачивается.
    }
    console.log(`Жду, пока сервер откроется… (${attempt}/36)`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  die(`Сервер не ответил на ${url}. Логи: yc compute instance get-serial-port-output --name ${VM}`);
}

function readToken(ip, privateKey, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(
      'ssh',
      [
        '-i',
        privateKey,
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        `yc-user@${ip}`,
        'sudo docker exec task-tracker cat /data/owner-token.txt',
      ],
      { encoding: 'utf8' },
    );
    const token = result.stdout?.trim();
    if (result.status === 0 && token) return token;
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'ignore' });
  }
  const serial = yc(['compute', 'instance', 'get-serial-port-output', '--name', VM], { allowFail: true });
  const match = /OWNER_TOKEN=(\S+)/.exec(`${serial.stdout ?? ''}\n${serial.stderr ?? ''}`);
  return match?.[1] ?? '';
}

const folder = yc(['config', 'get', 'folder-id']);
if (!folder.stdout.trim()) die('В профиле yc не выбран каталог. Выполните yc init.');

console.log(`Каталог ${folder.stdout.trim()}, зона ${zone}.`);
const registry = ensureRegistry();
const account = ensureAccount();
ensurePuller(idOf(registry), idOf(account));

let instance = ycJson(['compute', 'instance', 'get', '--name', VM], { allowFail: true });
if (instance && recreate) {
  console.log('Удаляю прежнюю машину…');
  yc(['compute', 'instance', 'delete', '--name', VM]);
  instance = null;
}

const subnet = pickSubnet();
const image = `cr.yandex/${idOf(registry)}/task-tracker-server:latest`;
if (!instance) {
  const keys = ensureSshKey();
  buildAndPush(image);
  const group = ensureGroup(subnet.network_id ?? subnet.networkId);
  instance = createVm(idOf(subnet), idOf(group), image, keys.publicKey);
  const ip = publicIp(instance);
  if (!ip) die('Машина создана, но публичный адрес ещё не виден. Повторите команду через минуту.');
  if (!domain) await waitHealth(ip);
  const token = readToken(ip, keys.privateKey, domain ? 30 : 6);
  report(ip, token, domain);
} else {
  const runningDomain = instance.description ?? '';
  if (domain && runningDomain !== domain) {
    die(
      `Машина уже запущена${runningDomain ? ` для ${runningDomain}` : ' без HTTPS'}. Чтобы заменить: node server/yc-up.mjs --domain ${domain} --recreate`,
    );
  }
  const httpsName = domain || runningDomain;
  const ip = publicIp(instance);
  if (!ip) die('Машина есть, но без публичного адреса.');
  const keys = ensureSshKey();
  if (!httpsName) await waitHealth(ip);
  const token = readToken(ip, keys.privateKey, httpsName ? 12 : 6);
  console.log('Машина уже запущена. Новый образ на неё не ставился.');
  console.log(
    `Чтобы заменить её пустой: node server/yc-up.mjs${httpsName ? ` --domain ${httpsName}` : ''} --recreate`,
  );
  report(ip, token, httpsName);
}

function report(ip, token, httpsName) {
  console.log('');
  if (httpsName) {
    console.log(`Адрес для GitHub Pages: https://${httpsName}`);
    console.log(`A-запись у регистратора: ${httpsName} → ${ip}`);
    console.log('Когда запись обновится, Caddy сам получит сертификат. Обычно это несколько минут.');
  } else {
    console.log(`Адрес: http://${ip}:8787`);
    console.log('Его откроет локальный npm start. Сайт на GitHub Pages сюда не пойдёт: страница по https.');
    console.log('Для сайта: node server/yc-up.mjs --domain sync.example.com --recreate');
  }
  if (token) console.log(`Токен владельца: ${token}`);
  else console.log(`Токен не прочитан. Команда: yc compute instance get-serial-port-output --name ${VM}`);
  console.log('В приложении: Настройки → Сервер, этот адрес, токен и парольная фраза команды.');
}
