// OTLP/HTTP JSON log records for netnyahoo.com/otel/v1/logs.
// Events keep their PostHog names so old and new data query the same.

export type OtlpValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };
export type OtlpAttribute = { key: string; value: OtlpValue };
export type OtlpLogRecord = {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
};

export type QueuedEvent = { uuid: string; event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> };

export const EVENTS_SCOPE = "netnyahoo.analytics";
export const LOGS_SCOPE = "netnyahoo.app";

// OTLP JSON has no nested values here: objects and arrays go as JSON text, int64 as a decimal string.
export function otlpValue(value: unknown): OtlpValue | null {
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { boolValue: value };
    case "number":
      if (!Number.isFinite(value)) return null;
      return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
    case "object":
      return value === null ? null : { stringValue: JSON.stringify(value) };
    default:
      return null;
  }
}

export function otlpAttributes(values: Record<string, unknown>): OtlpAttribute[] {
  const out: OtlpAttribute[] = [];
  for (const [key, v] of Object.entries(values)) {
    const value = otlpValue(v);
    if (value) out.push({ key, value });
  }
  return out;
}

const nanos = (ms: number) => `${Math.round(ms)}000000`;

export function eventRecord(e: QueuedEvent): OtlpLogRecord {
  const ms = Date.parse(e.timestamp);
  return {
    timeUnixNano: nanos(Number.isFinite(ms) ? ms : Date.now()),
    severityNumber: 9,
    severityText: "INFO",
    body: { stringValue: e.event },
    attributes: otlpAttributes({ event: e.event, uuid: e.uuid, distinct_id: e.distinct_id, ...e.properties }),
  };
}

export function logRecord(level: "warn" | "error", message: string, attributes: Record<string, unknown>, at = Date.now()): OtlpLogRecord {
  return {
    timeUnixNano: nanos(at),
    severityNumber: level === "error" ? 17 : 13,
    severityText: level === "error" ? "ERROR" : "WARN",
    body: { stringValue: message },
    attributes: otlpAttributes(attributes),
  };
}

export function logsRequest(resource: Record<string, unknown>, scope: string, records: OtlpLogRecord[]): string {
  return JSON.stringify({
    resourceLogs: [{ resource: { attributes: otlpAttributes(resource) }, scopeLogs: [{ scope: { name: scope }, logRecords: records }] }],
  });
}

// 2xx: accepted. 400: the batch is bad, drop it. 413: halve it, or drop a lone record.
// Anything else (429, 5xx, offline, a misrouted endpoint): keep it and retry later.
export type Outcome = "sent" | "drop" | "split" | "retry";

export function outcome(status: number, count: number): Outcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 400) return "drop";
  if (status === 413) return count > 1 ? "split" : "drop";
  return "retry";
}
