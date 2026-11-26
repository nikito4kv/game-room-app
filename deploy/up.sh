#!/usr/bin/env bash
# Собрать и (пере)запустить всё. Запуск: deploy/up.sh (после git pull).
# Пока в комнатах есть люди, ничего не делает: сборка съедает процессор, а
# перезапуск LiveKit или Caddy рвёт звонки. Обновить всё равно: FORCE=1 deploy/up.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Нет deploy/.env — скопируйте .env.example и заполните." >&2
  exit 1
fi
# Секреты читает только владелец. Не вышло (файл создан через sudo) — не повод срывать
# обновление: bootstrap.sh поправит права от root.
chmod 600 .env 2>/dev/null || echo "Не удалось закрыть deploy/.env от чужих: sudo deploy/bootstrap.sh" >&2
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# Порт TURN/UDP: 3478 или 443 (deploy/README.md, «TURN/UDP на 443»).
export TURN_UDP_PORT="${TURN_UDP_PORT:-3478}"
case "$TURN_UDP_PORT" in
  3478 | 443) ;;
  *)
    echo "TURN_UDP_PORT в deploy/.env: 3478 или 443, а сейчас «$TURN_UDP_PORT»." >&2
    exit 1
    ;;
esac

LK_HTTP=http://127.0.0.1:7880
LK_METRICS=http://127.0.0.1:6789/metrics

# Base64url без «=» — для JWT.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Сколько людей сейчас в комнатах; пусто — узнать не удалось.
# Основной источник — метрика livekit_participant_total. Запасной — API LiveKit
# (ListRooms с минутным токеном): метрик нет у LiveKit со старым конфигом, то есть
# при первом обновлении на эту версию.
count_participants() {
  local metrics now head body sig rooms
  if metrics=$(curl -fsS --max-time 3 "$LK_METRICS" 2>/dev/null); then
    printf '%s\n' "$metrics" | awk '/^livekit_participant_total[{ ]/ { n += $NF } END { print n + 0 }'
    return 0
  fi
  now=$(date +%s)
  head=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  body=$(printf '{"iss":"gameroom","nbf":%d,"exp":%d,"video":{"roomList":true}}' \
    $((now - 10)) $((now + 60)) | b64url)
  sig=$(printf '%s.%s' "$head" "$body" |
    openssl dgst -sha256 -hmac "${LIVEKIT_API_SECRET:-}" -binary | b64url)
  if rooms=$(curl -fsS --max-time 5 -X POST -H "Authorization: Bearer $head.$body.$sig" \
    -H 'Content-Type: application/json' -d '{}' \
    "$LK_HTTP/twirp/livekit.RoomService/ListRooms" 2>/dev/null); then
    # Пустой список комнат — тоже ответ: grep ничего не найдёт, awk напечатает 0.
    printf '%s\n' "$rooms" | { grep -oE '"num_participants": *[0-9]+' || true; } |
      awk -F: '{ n += $2 } END { print n + 0 }'
  fi
}

# LiveKit не отвечает вовсе (первый запуск, контейнер лежит) — звонков нет, беречь нечего.
livekit_up() {
  [ "$(curl -s -o /dev/null --max-time 3 -w '%{http_code}' "$LK_HTTP/" 2>/dev/null || true)" != 000 ]
}

if [ "${FORCE:-0}" != 1 ] && livekit_up; then
  people=$(count_participants || true)
  if [ -z "$people" ]; then
    echo "LiveKit работает, но узнать, есть ли кто-то в комнатах, не удалось." >&2
    echo "Убедитесь, что звонков нет, и запустите: FORCE=1 deploy/up.sh" >&2
    exit 1
  fi
  if [ "$people" -gt 0 ]; then
    echo "Сейчас в комнатах: $people. Обновление отложено: сборка и перезапуск помешают звонку." >&2
    echo "Обновить всё равно: FORCE=1 deploy/up.sh" >&2
    exit 1
  fi
fi

# Версия сборки — в образ сайта (/api/internal/health показывает её).
GIT_COMMIT=$(git -C .. rev-parse --short HEAD 2>/dev/null || echo "")
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export GIT_COMMIT BUILT_AT

# envsubst с явным списком — чтобы не тронуть другие $ в шаблоне.
# shellcheck disable=SC2016 # одинарные кавычки нарочно: envsubst ждёт буквальные ${…}
envsubst '${TURN_DOMAIN} ${TURN_UDP_PORT}' < livekit.yaml.template > livekit.yaml

# Хэши конфигов уходят в окружение контейнеров (CONFIG_SHA в compose.yaml): compose
# пересоздаёт LiveKit и Caddy, только когда их конфиг правда поменялся.
LIVEKIT_CONFIG_SHA=$(sha256sum livekit.yaml | cut -c1-12)
CADDY_CONFIG_SHA=$(sha256sum Caddyfile | cut -c1-12)
export LIVEKIT_CONFIG_SHA CADDY_CONFIG_SHA

# nice понижает приоритет самого docker compose (обход файлов, отправка контекста).
# Шаги сборки выполняет демон Docker, и звонки от них берегут проверка выше и
# cpu_shares в compose.yaml.
nice -n 10 docker compose build
# Журнал Redis включаем на живом Redis ДО пересоздания контейнера с --appendonly yes:
# иначе новый Redis не прочитает dump.rdb и данные пропадут (deploy/redis-aof.sh).
bash ./redis-aof.sh
docker compose up -d --remove-orphans

# Чистка: образы, оставшиеся без тега после пересборки, и кэш сборки старше недели.
# Образы с тегом (например, ночного теста) не трогаем.
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
docker compose ps
