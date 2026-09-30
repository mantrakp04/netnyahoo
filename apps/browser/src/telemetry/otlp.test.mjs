// Run from apps/browser:  node --test src/telemetry/otlp.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENTS_SCOPE, eventRecord, LOGS_SCOPE, logRecord, logsRequest, otlpAttributes, outcome } from "./otlp.ts";

const attrs = (record) => Object.fromEntries(record.attributes.map((a) => [a.key, a.value]));

test("values follow OTLP JSON: int64 as text, nested values as JSON text, nulls left out", () => {
  assert.deepEqual(otlpAttributes({ s: "x", i: 42, d: 1.5, b: false, n: null, u: undefined, inf: Infinity, o: { a: [1] } }), [
    { key: "s", value: { stringValue: "x" } },
    { key: "i", value: { intValue: "42" } },
    { key: "d", value: { doubleValue: 1.5 } },
    { key: "b", value: { boolValue: false } },
    { key: "o", value: { stringValue: '{"a":[1]}' } },
  ]);
});

test("an event keeps its name, uuid, install id and every property under the PostHog names", () => {
  const list = [{ type: "TypeError", value: "x is <text>", mechanism: { type: "onerror", handled: false, synthetic: false }, stacktrace: { type: "raw", frames: [{ function: "go", lineno: 3 }] } }];
  const record = eventRecord({
    uuid: "0199a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b",
    event: "$exception",
    distinct_id: "install-1",
    timestamp: "2026-09-30T12:00:00.123Z",
    properties: { $app_version: "0.2.18", $environment: "production", $os: "macOS", $exception_level: "error", engine_version: null, $exception_list: list },
  });
  assert.equal(record.timeUnixNano, "1790769600123000000");
  assert.equal(record.severityNumber, 9);
  assert.equal(record.severityText, "INFO");
  assert.deepEqual(record.body, { stringValue: "$exception" });
  const a = attrs(record);
  assert.deepEqual(a.event, { stringValue: "$exception" });
  assert.deepEqual(a.uuid, { stringValue: "0199a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b" });
  assert.deepEqual(a.distinct_id, { stringValue: "install-1" });
  assert.deepEqual(a.$app_version, { stringValue: "0.2.18" });
  assert.deepEqual(JSON.parse(a.$exception_list.stringValue), list);
  assert.equal("engine_version" in a, false);
});

test("a log has a level and no event attribute", () => {
  const record = logRecord("warn", "Couldn't save <file>", { error_type: "none", n: 2 }, 1790769600123);
  assert.equal(record.timeUnixNano, "1790769600123000000");
  assert.equal(record.severityNumber, 13);
  assert.equal(record.severityText, "WARN");
  assert.equal("event" in attrs(record), false);
  assert.equal(logRecord("error", "x", {}).severityText, "ERROR");
});

test("a request wraps records in one resource and scope", () => {
  const body = JSON.parse(logsRequest({ "service.name": "netnyahoo-app", "engine.version": null }, EVENTS_SCOPE, []));
  assert.deepEqual(body, {
    resourceLogs: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "netnyahoo-app" } }] }, scopeLogs: [{ scope: { name: "netnyahoo.analytics" }, logRecords: [] }] }],
  });
  assert.equal(LOGS_SCOPE, "netnyahoo.app");
});

test("responses: 2xx sent, 400 dropped, 413 split then dropped, everything else retried", () => {
  assert.equal(outcome(200, 5), "sent");
  assert.equal(outcome(204, 5), "sent");
  assert.equal(outcome(400, 5), "drop");
  assert.equal(outcome(413, 5), "split");
  assert.equal(outcome(413, 1), "drop");
  for (const status of [0, 404, 408, 429, 500, 502, 503]) assert.equal(outcome(status, 5), "retry");
});
