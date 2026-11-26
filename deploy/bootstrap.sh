#!/usr/bin/env bash
# Подготовка Ubuntu 24.04 (Oracle Cloud, ARM) под Game Room.
# Запуск: sudo deploy/bootstrap.sh
# Можно запускать повторно на работающей машине: порты добавляются точечно, чужие
# правила iptables (в том числе цепочки Docker) не трогаются.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Запускать через sudo: sudo deploy/bootstrap.sh" >&2
  exit 1
fi
cd "$(dirname "$0")"

# Порт TURN/UDP — из deploy/.env (3478 по умолчанию, 443 — по желанию, см. README).
TURN_UDP_PORT=3478
if [ -f .env ]; then
  port=$(sed -n "s/^TURN_UDP_PORT=[\"']\{0,1\}\([0-9][0-9]*\).*/\1/p" .env | tail -n 1)
  TURN_UDP_PORT=${port:-3478}
  chmod 600 .env # секреты: читает только владелец
fi

# 1. Порты. У образов Ubuntu в Oracle свой iptables с REJECT в конце INPUT — без
#    этого шага security list в консоли облака не поможет. Правило добавляется и
#    сразу (iptables -I), и в /etc/iptables/rules.v4 — строкой перед первым REJECT,
#    чтобы пережить перезагрузку. netfilter-persistent save не зовём: после установки
#    Docker он записал бы в файл и временные цепочки Docker.
RULES=/etc/iptables/rules.v4
open_port() {
  local proto=$1 port=$2
  iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null ||
    iptables -I INPUT 1 -p "$proto" --dport "$port" -j ACCEPT
  [ -f "$RULES" ] || return 0
  # Уже есть в файле (в любой записи) — не дублируем.
  grep -qE -- "^-A INPUT .*-p $proto .*--dport $port( |\$).*-j ACCEPT" "$RULES" && return 0
  # Нет REJECT в INPUT — порт и так открыт.
  grep -qE -- '^-A INPUT .*-j REJECT' "$RULES" || return 0
  awk -v rule="-A INPUT -p $proto -m $proto --dport $port -j ACCEPT" \
    '!done && /^-A INPUT .*-j REJECT/ { print rule; done = 1 } { print }' "$RULES" >"$RULES.new"
  cat "$RULES.new" >"$RULES" # cat, а не mv: права и владелец файла остаются прежними
  rm -f "$RULES.new"
}
open_port tcp 80                 # Let's Encrypt и редирект на https
open_port tcp 443                # сайт, сигналинг LiveKit, TURN/TLS
open_port tcp 7881               # ICE по TCP, когда UDP режут
open_port udp "$TURN_UDP_PORT"   # TURN/UDP
open_port udp 50000:60000        # медиа WebRTC

# 2. Docker из официального скрипта + envsubst для up.sh.
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
command -v envsubst >/dev/null || apt-get install -y gettext-base
usermod -aG docker "${SUDO_USER:-ubuntu}"

# 3. Буферы UDP. LiveKit просит у ядра 16 МБ на сокет и ругается, если получает
#    меньше; 25165824 (24 МиБ) — значение из рекомендаций LiveKit, с запасом на
#    ключевые кадры 1440p60. LiveKit берёт буферы при старте — после изменения его
#    нужно перезапустить (up.sh делает это, когда меняется livekit.yaml).
cat >/etc/sysctl.d/90-livekit.conf <<'SYSCTL'
net.core.rmem_max = 25165824
net.core.wmem_max = 25165824
SYSCTL
sysctl --system >/dev/null

echo "Готово. На новой машине: перелогиньтесь (группа docker), заполните deploy/.env и запустите deploy/up.sh"
