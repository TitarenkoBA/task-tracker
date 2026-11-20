#!/bin/bash
# Ставит командный сервер на VPS. Запускается от root на самой машине.
# Файлы сервера лежат в каталоге --src.
set -euo pipefail

DOMAIN=""
ORIGIN=""
SRC=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --origin)
      ORIGIN="${2:-}"
      shift 2
      ;;
    --src)
      SRC="${2:-}"
      shift 2
      ;;
    *)
      echo "Неизвестный аргумент: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Нужны права root." >&2
  exit 1
fi
if [[ -z "$SRC" || ! -f "$SRC/index.mjs" || ! -f "$SRC/package-lock.json" ]]; then
  echo "В --src нет файлов сервера." >&2
  exit 1
fi
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
  echo "--domain — это имя вроде sync.example.com, без https://." >&2
  exit 1
fi
if [[ -n "$ORIGIN" && ! "$ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "--origin — адрес сайта без пути, например https://user.github.io." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null; then
  echo "На машине нет systemd." >&2
  exit 1
fi

echo "Ставлю пакеты…"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl xz-utils tar
elif command -v dnf >/dev/null; then
  dnf install -y ca-certificates curl xz tar
elif command -v yum >/dev/null; then
  yum install -y ca-certificates curl xz tar
elif command -v apk >/dev/null; then
  apk add --no-cache ca-certificates curl xz tar
else
  echo "Подходит apt, dnf, yum или apk." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64) NODE_ARCH="x64" ; CADDY_ARCH="amd64" ;;
  aarch64 | arm64) NODE_ARCH="arm64" ; CADDY_ARCH="arm64" ;;
  *)
    echo "Архитектура $(uname -m) не поддерживается." >&2
    exit 1
    ;;
esac

if ! /usr/local/bin/node -v 2>/dev/null | grep -q '^v22\.'; then
  echo "Ставлю Node.js 22…"
  archive="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-'"$NODE_ARCH"'\.tar\.xz$/ { print $2; exit }')"
  if [[ -z "$archive" ]]; then
    echo "Не удалось узнать сборку Node.js." >&2
    exit 1
  fi
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/${archive}" -o "$tmp/node.tar.xz"
  tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
  rm -rf "$tmp"
fi

if ! id tasktracker >/dev/null 2>&1; then
  login_shell="/bin/false"
  if [ -x /usr/sbin/nologin ]; then login_shell="/usr/sbin/nologin"; fi
  if command -v useradd >/dev/null; then
    useradd --system --home-dir /var/lib/task-tracker --create-home --shell "$login_shell" tasktracker
  else
    adduser -S -D -h /var/lib/task-tracker -s "$login_shell" tasktracker
  fi
fi
install -d -o tasktracker -g tasktracker /opt/task-tracker /var/lib/task-tracker
cp "$SRC/index.mjs" "$SRC/lib.mjs" "$SRC/package.json" "$SRC/package-lock.json" /opt/task-tracker/
chown -R tasktracker:tasktracker /opt/task-tracker /var/lib/task-tracker
echo "Ставлю зависимости сервера…"
sudo -u tasktracker /usr/local/bin/npm ci --omit=dev --prefix /opt/task-tracker

if [[ -n "$DOMAIN" ]]; then
  listen_host="127.0.0.1"
else
  listen_host="0.0.0.0"
fi
umask 077
cat > /etc/task-tracker.env <<EOF
HOST=${listen_host}
PORT=8787
DATA_DIR=/var/lib/task-tracker
PRINT_OWNER_TOKEN=1
EOF
if [[ -n "$ORIGIN" ]]; then
  printf 'ORIGIN=%s\n' "$ORIGIN" >> /etc/task-tracker.env
fi
chmod 600 /etc/task-tracker.env

cat > /etc/systemd/system/task-tracker.service <<'EOF'
[Unit]
Description=Task Tracker team server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tasktracker
Group=tasktracker
WorkingDirectory=/opt/task-tracker
EnvironmentFile=/etc/task-tracker.env
ExecStart=/usr/local/bin/node /opt/task-tracker/index.mjs
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable task-tracker
systemctl restart task-tracker

if [[ -n "$DOMAIN" ]]; then
  if [[ ! -x /usr/local/bin/caddy ]]; then
    echo "Ставлю Caddy…"
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}" -o /usr/local/bin/caddy
    chmod 755 /usr/local/bin/caddy
  fi
  install -d /etc/caddy
  cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	reverse_proxy 127.0.0.1:8787
}
EOF
  cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy
After=network-online.target task-tracker.service
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --environ
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable caddy
  systemctl restart caddy
elif systemctl is-enabled caddy >/dev/null 2>&1; then
  systemctl disable --now caddy || true
fi

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  if [[ -n "$DOMAIN" ]]; then
    ufw allow 80/tcp
    ufw allow 443/tcp
  else
    ufw allow 8787/tcp
  fi
fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  if [[ -n "$DOMAIN" ]]; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
  else
    firewall-cmd --permanent --add-port=8787/tcp
  fi
  firewall-cmd --reload
fi

echo "Жду, пока сервер откроется…"
ready=""
attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null; then
    ready="yes"
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [[ -z "$ready" ]]; then
  echo "Сервер не ответил. Журнал: journalctl -u task-tracker -n 50 --no-pager" >&2
  exit 1
fi

token="$(tr -d '\r\n' < /var/lib/task-tracker/owner-token.txt || true)"
address="$(curl -fsS --max-time 5 https://ifconfig.me || true)"
if [[ -z "$address" ]]; then
  address="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
fi
echo
if [[ -n "$DOMAIN" ]]; then
  echo "Адрес для GitHub Pages: https://${DOMAIN}"
  echo "A-запись у регистратора: ${DOMAIN} → ${address}"
  echo "Когда запись обновится, Caddy сам получит сертификат. Обычно это несколько минут."
else
  echo "Адрес: http://${address}:8787"
  echo "Его откроет локальный npm start. Для сайта на GitHub Pages повторите команду с --domain."
fi
if [[ -n "$token" ]]; then
  echo "Токен владельца: ${token}"
else
  echo "Токен не прочитан. Журнал: journalctl -u task-tracker --no-pager | grep OWNER_TOKEN"
fi
echo "В приложении: Настройки → Сервер, этот адрес, токен и парольная фраза команды."
