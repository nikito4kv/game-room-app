#!/usr/bin/env bash
# Включить журнал Redis (AOF) на РАБОТАЮЩЕМ Redis до того, как up.sh пересоздаст
# контейнер с `--appendonly yes`. Иначе новый контейнер стартует с пустым журналом,
# НЕ прочитает dump.rdb — и все комнаты, заявки и ключи пропадут.
#
# Порядок: Redis не запущен (первый запуск) — делать нечего. CONFIG GET appendonly
# = yes — журнал уже есть. = no — CONFIG SET appendonly yes (Redis строит журнал
# из памяти), ждём конца перезаписи (aof_rewrite_in_progress:0, перезапись не
# запланирована, aof_last_bgrewrite_status:ok) не дольше AOF_WAIT_SEC. Не дождались
# или ошибка — выходим с кодом 1, up.sh прерывает обновление.
#
# Зовёт up.sh из каталога deploy/. Отдельный файл — чтобы проверить его тестом
# (src/lib/platform/redisAof.test.ts, docker там подменён).
set -euo pipefail

WAIT_SEC="${AOF_WAIT_SEC:-300}"
POLL_SEC="${AOF_POLL_SEC:-1}"

cid=$(docker compose ps -q redis 2>/dev/null || true)
if [ -z "$cid" ]; then
  echo "Redis ещё не запущен — журнал включится сам при первом запуске."
  exit 0
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || true)" != "true" ]; then
  echo "Контейнер Redis не работает — включать журнал не на чем." >&2
  echo "Если в томе redis-data есть данные, запустите Redis старой командой и повторите up.sh." >&2
  exit 1
fi

rcli() { docker exec "$cid" redis-cli "$@" | tr -d '\r'; }

mode=$(rcli CONFIG GET appendonly | sed -n 2p)
case "$mode" in
  yes) exit 0 ;;
  no) ;;
  *)
    echo "Не удалось узнать, включён ли журнал Redis (CONFIG GET appendonly → «$mode»). Обновление прервано." >&2
    exit 1
    ;;
esac

echo "Включаю журнал Redis (AOF) на работающем Redis…"
if [ "$(rcli CONFIG SET appendonly yes)" != "OK" ]; then
  echo "CONFIG SET appendonly yes не прошёл. Обновление прервано: без журнала новый Redis потерял бы данные." >&2
  exit 1
fi

waited=0
while :; do
  info=$(rcli INFO persistence)
  field() { printf '%s\n' "$info" | sed -n "s/^$1://p"; }
  if [ "$(field aof_rewrite_in_progress)" = 0 ] && [ "$(field aof_rewrite_scheduled)" = 0 ]; then
    status=$(field aof_last_bgrewrite_status)
    if [ "$status" = ok ]; then
      echo "Журнал Redis записан."
      exit 0
    fi
    echo "Перезапись журнала Redis закончилась ошибкой (aof_last_bgrewrite_status:$status). Обновление прервано." >&2
    exit 1
  fi
  if [ "$waited" -ge "$WAIT_SEC" ]; then
    echo "Журнал Redis не дописался за $WAIT_SEC с. Обновление прервано — повторите up.sh позже." >&2
    exit 1
  fi
  sleep "$POLL_SEC"
  waited=$((waited + 1))
done
