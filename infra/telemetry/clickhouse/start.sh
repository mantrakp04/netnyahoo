#!/bin/bash
# Starts ClickHouse and applies schema.sql (idempotent) once it answers.
set -u

# The volume first served a trial PostHog install (2026-09-30) under /data/clickhouse; nothing there
# is ours to keep.
rm -rf /data/clickhouse
mkdir -p /data/ch

/entrypoint.sh &
server=$!
trap 'kill -TERM $server 2>/dev/null' TERM INT

for _ in $(seq 1 120); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
if clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" --multiquery < /etc/nn/schema.sql; then
  echo "[nn] schema applied"
else
  echo "[nn] schema FAILED" >&2
fi

wait $server
