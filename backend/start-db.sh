#!/usr/bin/env bash
set -euo pipefail
# Starts the local user-level MariaDB instance (port 3307, no sudo needed).
# Data lives in ~/finance-db. Safe to run repeatedly — exits if already up.

DB_DIR="$HOME/finance-db"

# Credentials come from backend/.env — never hard-coded here, since this file is
# committed. DATABASE_URL is the single source (mysql://user:password@host:port/db).
ENV_FILE="$(dirname "$0")/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "backend/.env not found — copy .env.example and set DATABASE_URL" >&2
  exit 1
fi
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"
DB_USER="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://([^:]+):.*|\1|')"
DB_PASS="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://[^:]+:([^@]*)@.*|\1|')"
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')"

if mysql -h 127.0.0.1 -P 3307 -u "$DB_USER" -p"$DB_PASS" -e "SELECT 1" "$DB_NAME" >/dev/null 2>&1; then
  echo "MariaDB (3307) already running ✔"
  exit 0
fi

/usr/sbin/mariadbd \
  --datadir="$DB_DIR/data" \
  --port=3307 \
  --socket="$DB_DIR/mariadb.sock" \
  --pid-file="$DB_DIR/mariadb.pid" \
  --bind-address=127.0.0.1 \
  >> "$DB_DIR/mariadb.log" 2>&1 &

for i in $(seq 1 30); do
  if mysql -h 127.0.0.1 -P 3307 -u "$DB_USER" -p"$DB_PASS" -e "SELECT 1" "$DB_NAME" >/dev/null 2>&1; then
    echo "MariaDB (3307) started ✔"
    exit 0
  fi
  sleep 1
done

echo "MariaDB failed to start — check $DB_DIR/mariadb.log"
exit 1
