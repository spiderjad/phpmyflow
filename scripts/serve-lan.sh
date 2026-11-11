#!/usr/bin/env bash
# Serve phpMyFlow on the local network with PHP's built-in server (macOS/Linux).
#
#   scripts/serve-lan.sh [--ip 192.168.1.10] [--port 8090] [--rebuild] [--dry-run]
#
# Checks PHP (8.1+, pdo_mysql, openssl), builds the UI when server/index.html is
# missing, checks that the port is free, then serves server/ on the LAN address
# and on 127.0.0.1. It never changes the firewall: it only prints a suggestion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP=""
PORT=8090
REBUILD=0
DRY=0

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --rebuild) REBUILD=1; shift ;;
    --dry-run|--whatif) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  C_STEP=$'\e[36m'; C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_DIM=$'\e[2m'; C_OFF=$'\e[0m'
else
  C_STEP=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi
step() { printf '%s> %s%s\n' "$C_STEP" "$1" "$C_OFF"; }
ok()   { printf '  %sok%s  %s\n' "$C_OK" "$C_OFF" "$1"; }
warn() { printf '  %s%s%s\n' "$C_WARN" "$1" "$C_OFF"; }
dry()  { printf '  %s[dry-run] would %s%s\n' "$C_DIM" "$1" "$C_OFF"; }
die()  { printf '\n%s%s%s\n' "$C_ERR" "$1" "$C_OFF" >&2; exit 1; }

case "$PORT" in ''|*[!0-9]*) die "--port must be a number." ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be between 1 and 65535."

# ------------------------------------------------------------- IP address

step "Network address"
OS="$(uname -s)"
PREFIX=""
if [ -z "$IP" ]; then
  if [ "$OS" = "Darwin" ]; then
    IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    [ -n "$IFACE" ] && IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
  elif command -v ip >/dev/null 2>&1; then
    IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i+1); exit}}')"
  fi
  [ -n "$IP" ] || die "No interface with a default gateway was found. Pass the address with --ip."
fi
case "$IP" in
  *[!0-9.]*|'') die "--ip '$IP' is not an IPv4 address." ;;
esac
if [ "$OS" = "Darwin" ]; then
  MASK="$(ifconfig 2>/dev/null | awk -v ip="$IP" '$1 == "inet" && $2 == ip {print $4; exit}')"
  if [ -n "$MASK" ]; then
    # netmask is printed as hex (0xffffff00): count the bits.
    m=$((MASK)); PREFIX=0
    while [ $m -gt 0 ]; do PREFIX=$((PREFIX + (m & 1))); m=$((m >> 1)); done
  fi
elif command -v ip >/dev/null 2>&1; then
  PREFIX="$(ip -4 -o addr show 2>/dev/null | awk -v ip="$IP" '{split($4, a, "/"); if (a[1] == ip) {print a[2]; exit}}')"
fi
[ -n "$PREFIX" ] || die "$IP is not an address of this computer."
IFS=. read -r o1 o2 o3 o4 <<<"$IP"
n=$(( (o1 << 24) | (o2 << 16) | (o3 << 8) | o4 ))
mask=$(( PREFIX == 0 ? 0 : (0xFFFFFFFF << (32 - PREFIX)) & 0xFFFFFFFF ))
n=$(( n & mask ))
SUBNET="$(( (n >> 24) & 255 )).$(( (n >> 16) & 255 )).$(( (n >> 8) & 255 )).$(( n & 255 ))/$PREFIX"
ok "$IP (subnet $SUBNET)"

# -------------------------------------------------------------------- PHP

step "PHP"
command -v php >/dev/null 2>&1 || die "php is not in the PATH.
  Install PHP 8.1+ (macOS: brew install php; Debian/Ubuntu: sudo apt install php-cli php-mysql)."
PHP="$(command -v php)"
PHP_VERSION="$("$PHP" -r 'echo PHP_VERSION;')"
"$PHP" -r 'exit(version_compare(PHP_VERSION, "8.1.0", ">=") ? 0 : 1);' \
  || die "PHP $PHP_VERSION found at $PHP; phpMyFlow needs 8.1 or newer."
MODULES="$("$PHP" -m | tr '[:upper:]' '[:lower:]')"
MISSING=""
for m in pdo_mysql openssl; do
  printf '%s\n' "$MODULES" | grep -qx "$m" || MISSING="$MISSING $m"
done
if [ -n "$MISSING" ]; then
  INI="$("$PHP" -r 'echo php_ini_loaded_file() ?: "";')"
  die "PHP $PHP_VERSION is missing:$MISSING.
  Debian/Ubuntu: sudo apt install php-mysql (openssl is built in).
  Otherwise edit ${INI:-your php.ini (php --ini shows where)} and enable:$(for m in $MISSING; do printf '\n      extension=%s' "$m"; done)"
fi
ok "PHP $PHP_VERSION ($PHP) with pdo_mysql and openssl"

# --------------------------------------------------------------------- UI

step "User interface"
if [ -f "$ROOT/server/index.html" ] && [ "$REBUILD" -eq 0 ]; then
  ok "server/index.html exists (use --rebuild to build again)"
else
  if [ "$REBUILD" -eq 1 ]; then echo "  Building the UI: --rebuild was given."; else echo "  Building the UI: server/index.html is missing."; fi
  { command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; } || die "Node.js is needed to build the UI (only once; the server does not need it).
  Install the LTS version from https://nodejs.org/ (macOS: brew install node), then run this script again."
  ok "node $(node --version)"
  if [ "$DRY" -eq 1 ]; then
    [ -d "$ROOT/web/node_modules" ] || dry "run: npm ci (in web/)"
    dry "run: npm run build (in web/)"
  else
    if [ ! -d "$ROOT/web/node_modules" ]; then (cd "$ROOT/web" && npm ci) || die "npm ci failed (see above)."; fi
    (cd "$ROOT/web" && npm run build) || die "npm run build failed (see above)."
    ok "UI built into server/"
  fi
fi

# ------------------------------------------------------------------- port

step "Port $PORT"
BUSY=""
if command -v lsof >/dev/null 2>&1; then
  BUSY="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 {print $1 " (PID " $2 ")"}' | sort -u | paste -sd, - || true)"
elif command -v ss >/dev/null 2>&1; then
  BUSY="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | head -n1 || true)"
  [ -n "$BUSY" ] && BUSY="$(printf '%s' "$BUSY" | grep -o 'users:(([^)]*' | sed 's/users:((//' || echo 'another process')"
fi
if [ -n "$BUSY" ]; then
  [ "$DRY" -eq 1 ] || die "Port $PORT is already in use by: $BUSY.
  Stop it or choose another port with --port."
  warn "Port $PORT is already in use by: $BUSY. A real run would stop here."
else
  ok "free"
fi

# --------------------------------------------------------------- firewall

step "Firewall"
echo "  Not changed by this script. If other computers cannot connect, allow TCP $PORT from $SUBNET only, e.g.:"
if [ "$OS" = "Darwin" ]; then
  echo "    macOS asks to allow incoming connections for php the first time: answer Allow."
elif command -v ufw >/dev/null 2>&1; then
  echo "    sudo ufw allow from $SUBNET to any port $PORT proto tcp"
elif command -v firewall-cmd >/dev/null 2>&1; then
  echo "    sudo firewall-cmd --add-rich-rule='rule family=ipv4 source address=$SUBNET port port=$PORT protocol=tcp accept'"
else
  echo "    sudo iptables -I INPUT -p tcp -s $SUBNET --dport $PORT -j ACCEPT"
fi

# ------------------------------------------------------------------ start

LISTEN=("$IP:$PORT")
[ "$IP" = "127.0.0.1" ] || LISTEN+=("127.0.0.1:$PORT")

echo
echo "phpMyFlow"
echo "  This computer:    http://127.0.0.1:$PORT"
echo "  Other computers:  http://$IP:$PORT"
echo
printf '%s%s%s\n\n' "$C_WARN" "Development server without HTTPS: passwords travel unencrypted over the network. Use it only on trusted networks." "$C_OFF"

if [ "$DRY" -eq 1 ]; then
  for l in "${LISTEN[@]}"; do dry "run: php -S $l -t server scripts/lan-router.php (in $ROOT)"; done
  echo "Dry run: nothing was started."
  exit 0
fi

printf '%sPress Ctrl+C to stop.%s\n\n' "$C_DIM" "$C_OFF"

# One php -S per address (the LAN IP and loopback): binding 0.0.0.0 would also
# listen on every other interface (VPN, docker bridges...).
PIDS=()
cleanup() {
  trap - INT TERM EXIT
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo "Stopped."
}
trap cleanup INT TERM EXIT

cd "$ROOT"
for l in "${LISTEN[@]}"; do
  "$PHP" -S "$l" -t server scripts/lan-router.php &
  PIDS+=("$!")
done
# Return as soon as one of them exits (or on Ctrl+C); cleanup stops the other.
while :; do
  for p in "${PIDS[@]}"; do
    kill -0 "$p" 2>/dev/null || { echo "php exited." >&2; exit 1; }
  done
  sleep 1
done
