#!/bin/bash
# Starts ClickHouse and applies schema.sql (idempotent) once it answers.
set -u

# The volume first served a trial PostHog install (2026-09-30) under /data/clickhouse; nothing there
# is ours to keep.
rm -rf /data/clickhouse
mkdir -p /data/ch

# ClickHouse keeps a file open per column file of every part a query reads, per reading thread, and FINAL
# reads all parts at once. The platform's default limit ran out under four parallel stats queries
# (errno 24, 2026-10-01). Raise soft and hard as far as the kernel allows, or at least soft to hard.
ulimit -n 1048576 2>/dev/null || ulimit -Sn "$(ulimit -Hn)"
echo "[ac] open files: $(ulimit -Sn) (hard $(ulimit -Hn))"

/entrypoint.sh &
server=$!
trap 'kill -TERM $server 2>/dev/null' TERM INT

for _ in $(seq 1 120); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
if clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" --multiquery < /etc/ac/schema.sql; then
  echo "[ac] schema applied"
else
  echo "[ac] schema FAILED" >&2
fi

# Parts written before schema.sql made them compact stay wide until they merge again, and a finished
# month never does. Merge each table that still has a small wide part once; afterwards this is a no-op.
for table in $(clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "
  SELECT DISTINCT table FROM system.parts
  WHERE active AND database = 'telemetry' AND part_type = 'Wide' AND bytes_on_disk < 1073741824"); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "OPTIMIZE TABLE telemetry.$table FINAL" \
    && echo "[ac] telemetry.$table merged into compact parts"
done

wait $server
