#!/usr/bin/env python3
"""Loads events exported from PostHog Cloud into telemetry.posthog_events (clickhouse/schema.sql).

    python3 infra/telemetry/import-posthog.py events.jsonl [more.jsonl ...]

Input: JSONL, one PostHog event per line: {"uuid", "event", "distinct_id", "timestamp", "properties",
["person_id"], ["elements_chain"]} (the export made with PostHog's MCP, docs/growth.md "Telemetry").
Credentials: ~/.config/netnyahoo/telemetry.env (CLICKHOUSE_URL and CLICKHOUSE_IMPORTER_PASSWORD); the
"importer" user can only add rows to telemetry.posthog_events.

Safe to re-run and to feed overlapping exports: rows keep PostHog's uuid, and the table collapses rows
with the same event, day and uuid (count with FINAL, or query the telemetry.events view, which does).
Property values become strings, as the collector stores them: strings as they are, anything else as its
JSON text (true, 12, ["a"]). Python 3 standard library only.
"""
import gzip
import json
import os
import sys
import urllib.request

ENV = os.path.expanduser("~/.config/netnyahoo/telemetry.env")
BATCH = 5000


def load_env():
    env = {}
    with open(ENV) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def value(v):
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def row(e):
    ts = e["timestamp"].replace("T", " ").rstrip("Z")
    if "+" in ts[10:]:
        ts = ts[:10] + ts[10:].split("+")[0]
    props = {k: value(v) for k, v in (e.get("properties") or {}).items() if v is not None}
    return {
        "uuid": e["uuid"],
        "event": e["event"],
        "distinct_id": str(e["distinct_id"]),
        "timestamp": ts,
        "properties": props,
        "elements_chain": e.get("elements_chain") or "",
        "person_id": str(e.get("person_id") or ""),
    }


def post(env, rows):
    body = gzip.compress("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows).encode())
    query = ("INSERT INTO telemetry.posthog_events (uuid, event, distinct_id, timestamp, properties, "
             "elements_chain, person_id) FORMAT JSONEachRow")
    req = urllib.request.Request(
        env["CLICKHOUSE_URL"] + "?query=" + urllib.parse.quote(query) + "&date_time_input_format=best_effort",
        data=body, method="POST",
        headers={"X-ClickHouse-User": "importer", "X-ClickHouse-Key": env["CLICKHOUSE_IMPORTER_PASSWORD"],
                 "Content-Encoding": "gzip", "Content-Type": "application/octet-stream"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                res.read()
                return
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:500]
            if err.code < 500 and err.code != 429:
                raise SystemExit(f"ClickHouse refused a batch ({err.code}): {detail}")
            print(f"  retry {attempt + 1}: {err.code} {detail[:120]}", file=sys.stderr)
        except urllib.error.URLError as err:
            print(f"  retry {attempt + 1}: {err}", file=sys.stderr)
        import time
        time.sleep(2 ** attempt)
    raise SystemExit("ClickHouse kept failing; re-run to continue (rows already sent are deduplicated)")


def main(paths):
    if not paths:
        raise SystemExit(__doc__)
    env = load_env()
    total = 0
    for path in paths:
        batch = []
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    batch.append(row(json.loads(line)))
                if len(batch) >= BATCH:
                    post(env, batch)
                    total += len(batch)
                    print(f"{path}: {total} rows", file=sys.stderr)
                    batch = []
        if batch:
            post(env, batch)
            total += len(batch)
        print(f"{path}: done, {total} rows so far", file=sys.stderr)


if __name__ == "__main__":
    import urllib.parse
    import urllib.error
    main(sys.argv[1:])
