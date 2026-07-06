#!/usr/bin/env bash
# Starts the local user-level MariaDB instance (port 3307, no sudo needed).
# Data lives in ~/finance-db. Safe to run repeatedly — exits if already up.

DB_DIR="$HOME/finance-db"

if mysql -h 127.0.0.1 -P 3307 -u finance -pfinance_dev_2026 -e "SELECT 1" finance_planner >/dev/null 2>&1; then
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
  if mysql -h 127.0.0.1 -P 3307 -u finance -pfinance_dev_2026 -e "SELECT 1" finance_planner >/dev/null 2>&1; then
    echo "MariaDB (3307) started ✔"
    exit 0
  fi
  sleep 1
done

echo "MariaDB failed to start — check $DB_DIR/mariadb.log"
exit 1
