import { engineInfo } from "@netnyahoo/cef";
import { launchEnvironment, readDocument, systemInfo, writeDocument, type SystemInfo } from "@netnyahoo/shell";
import { create } from "zustand";
import { BATCH_URL, DEV_SEND_ENV, LOGS_URL, POSTHOG } from "./config";
import { cleanProperties } from "./sanitize";

/**
 * Opt-in telemetry's core: the user's choice, the install id, the queue and the only code that
 * talks to PostHog. Nothing is captured, queued or sent unless the user turned sharing on
 * (Settings › Privacy & Security, onboarding, or the one-time ask); turning it off drops the
 * queue on the spot. The choice is this Mac's alone: it lives in its own document, which sync
 * never reads.
 *
 * Events carry no person: a random install id (replaced whenever sharing is turned back on),
 * `$process_person_profile: false`, and `$geoip_disable`.
 */

const STATE_DOC = "telemetry.json";
const QUEUE_DOC = "telemetry-queue.json";
/** DEV: every request this module makes, one JSON line each. */
const REQUEST_LOG_DOC = "telemetry-requests.log";

const MAX_EVENTS = 1000;
const MAX_LOGS = 200;
const BATCH_SIZE = 100;
const FLUSH_DELAY_MS = 30_000;
const URGENT_FLUSH_DELAY_MS = 3_000;
const MAX_BACKOFF_MS = 30 * 60_000;

type Saved = {
  version: 1;
  sharing: boolean;
  /** When the user last made a choice (null: never asked or answered). */
  decidedAt: number | null;
  /** The one-time ask for existing users was answered or dismissed. */
  askDoneAt: number | null;
  /** Random, made when sharing turns on and forgotten when it turns off. */
  installId: string | null;
  /** Crash reports written after this (epoch ms) are still to be looked at. */
  crashCursor: number;
  /** The version that last ran with sharing on (to tell an update). */
  lastVersion: string | null;
  /** Set while a session runs with sharing on; still set at launch means it didn't end cleanly. */
  sessionOpen: boolean;
};

const DEFAULT: Saved = {
  version: 1,
  sharing: false,
  decidedAt: null,
  askDoneAt: null,
  installId: null,
  crashCursor: 0,
  lastVersion: null,
  sessionOpen: false,
};

function readJson<T>(name: string): T | null {
  try {
    const json = readDocument(name);
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

let saved: Saved = { ...DEFAULT };

function save(patch: Partial<Saved>) {
  saved = { ...saved, ...patch };
  try {
    writeDocument(STATE_DOC, JSON.stringify(saved));
  } catch {}
  useTelemetry.setState({ sharing: saved.sharing, decided: saved.decidedAt !== null, askDone: saved.askDoneAt !== null });
}

/** What the UI needs: the switch, and whether the user has ever answered. */
export const useTelemetry = create<{ sharing: boolean; decided: boolean; askDone: boolean }>(() => ({
  sharing: false,
  decided: false,
  askDone: false,
}));

export const isSharing = () => saved.sharing;

// MARK: Context sent with every event

let app: SystemInfo | null = null;
export const appInfo = () => (app ??= systemInfo());
let engineVersion: string | null = null;
/** A new id per launch (UUIDv7, as PostHog wants for `$session_id`). */
export const sessionId = uuidv7();

/** "dev" (Debug builds), "test" (a hidden test instance of a release build) or "production". */
export const environment = (): "dev" | "test" | "production" =>
  __DEV__ ? "dev" : appInfo().isolatedInstance ? "test" : "production";

/** DEV builds only send with NETNYAHOO_TELEMETRY=1; otherwise their requests are dry runs. */
const devSendAllowed = () => launchEnvironment(DEV_SEND_ENV) === "1";
const canSend = () => !__DEV__ || devSendAllowed();

function context(): Record<string, unknown> {
  const info = appInfo();
  return {
    $lib: "netnyahoo-telemetry",
    $lib_version: "1",
    $app_name: "Netnyahoo",
    $app_version: info.appVersion,
    $app_build: info.appBuild,
    $os: "macOS",
    $os_version: info.osVersion,
    arch: info.arch,
    engine_version: engineVersion,
    $environment: environment(),
    $session_id: sessionId,
    $process_person_profile: false,
    $geoip_disable: true,
  };
}

// MARK: Queue

type QueuedEvent = { uuid: string; event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> };
type OtlpAttribute = { key: string; value: { stringValue?: string; intValue?: number; boolValue?: boolean } };
type QueuedLog = {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
};
type Queue = { version: 1; events: QueuedEvent[]; logs: QueuedLog[] };

let queue: Queue = { version: 1, events: [], logs: [] };
/** Bumped whenever sharing turns off (or on): replies to older requests are ignored. */
let generation = 0;

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistQueue(now = false) {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const write = () => {
    try {
      writeDocument(QUEUE_DOC, JSON.stringify(queue));
    } catch {}
  };
  if (now) write();
  else persistTimer = setTimeout(write, 2000);
}

function clearQueue() {
  queue = { version: 1, events: [], logs: [] };
  clearTimeout(flushTimer);
  flushTimer = undefined;
  persistQueue(true);
}

/** Captures that arrived while sharing was off (DEV: shows they were dropped, not sent). */
let droppedWhileOff = 0;

export type CaptureOptions = {
  /** Structured, already-sanitized properties (an exception's `$exception_list`). */
  raw?: Record<string, unknown>;
  /** Send within seconds (exceptions). */
  urgent?: boolean;
  /** Write the queue to disk before returning (a fatal error is about to end the process). */
  persist?: boolean;
};

/**
 * Queues an event. A no-op unless sharing is on. `props` must be flat and content-free; they're
 * cleaned all the same (numbers, booleans and short scrubbed strings only).
 */
export function capture(event: string, props: Record<string, unknown> = {}, options: CaptureOptions = {}) {
  if (!saved.sharing || !saved.installId) {
    droppedWhileOff++;
    return;
  }
  try {
    queue.events.push({
      uuid: uuidv7(),
      event,
      distinct_id: saved.installId,
      timestamp: new Date().toISOString(),
      properties: { ...context(), ...cleanProperties(props), ...options.raw },
    });
    if (queue.events.length > MAX_EVENTS) queue.events.splice(0, queue.events.length - MAX_EVENTS);
    persistQueue(options.persist);
    scheduleFlush(options.urgent ? URGENT_FLUSH_DELAY_MS : FLUSH_DELAY_MS);
  } catch {}
}

/** Queues one log line (already scrubbed by logs.ts). A no-op unless sharing is on. */
export function queueLog(level: "warn" | "error", message: string, attributes: Record<string, string | number | boolean>) {
  if (!saved.sharing) return;
  try {
    queue.logs.push({
      timeUnixNano: `${Date.now()}000000`,
      severityNumber: level === "error" ? 17 : 13,
      severityText: level === "error" ? "ERROR" : "WARN",
      body: { stringValue: message },
      attributes: Object.entries(attributes).map(([key, v]) => ({
        key,
        value: typeof v === "number" ? { intValue: Math.round(v) } : typeof v === "boolean" ? { boolValue: v } : { stringValue: v },
      })),
    });
    if (queue.logs.length > MAX_LOGS) queue.logs.splice(0, queue.logs.length - MAX_LOGS);
    persistQueue();
    scheduleFlush(FLUSH_DELAY_MS);
  } catch {}
}

// MARK: Sending

let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushDueAt = 0;
let flushing = false;
let failures = 0;
/** After a failed send (offline, server trouble): nothing goes before this. */
let retryAt = 0;

function scheduleFlush(delay: number) {
  if (!saved.sharing) return;
  const due = Math.max(Date.now() + delay, retryAt);
  if (flushTimer && flushDueAt <= due) return;
  clearTimeout(flushTimer);
  flushDueAt = due;
  flushTimer = setTimeout(() => void flush(), due - Date.now());
}

export type RequestLogEntry = {
  at: string;
  kind: "events" | "logs";
  url: string;
  count: number;
  bytes: number;
  /** HTTP status; 0 = network error (offline); null = not sent (DEV dry run). */
  status: number | null;
  dryRun?: boolean;
};

const requests: RequestLogEntry[] = [];

/** Every request this module made (or would have, in a DEV dry run) this launch. */
export const requestLog = (): readonly RequestLogEntry[] => requests;

function logRequest(entry: RequestLogEntry, body: string) {
  requests.push(entry);
  if (requests.length > 200) requests.shift();
  // DEV: the file has the bodies too, to check exactly what went out.
  if (__DEV__) {
    try {
      const line = JSON.stringify({ ...entry, body: JSON.parse(body) });
      writeDocument(REQUEST_LOG_DOC, (readDocument(REQUEST_LOG_DOC) ?? "").slice(-400_000) + `${line}\n`);
    } catch {}
  }
  if (__DEV__) console.log(`[telemetry] ${entry.dryRun ? "dry run" : "POST"} ${entry.url} ${entry.kind}×${entry.count} → ${entry.status}`);
}

/** The one place requests leave the app. */
async function post(kind: RequestLogEntry["kind"], url: string, body: string, count: number, headers: Record<string, string>) {
  const entry: RequestLogEntry = { at: new Date().toISOString(), kind, url, count, bytes: body.length, status: null };
  if (!canSend()) {
    logRequest({ ...entry, dryRun: true }, body);
    return 200;
  }
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
    entry.status = response.status;
  } catch {
    entry.status = 0;
  }
  logRequest(entry, body);
  return entry.status;
}

/** Whether a batch is done with: sent, or refused for good (malformed or too large). */
const settled = (status: number) => (status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 429);

function otlpBody(logs: QueuedLog[]) {
  const info = appInfo();
  const attr = (key: string, value: string): OtlpAttribute => ({ key, value: { stringValue: value } });
  return JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: [
            attr("service.name", "netnyahoo"),
            attr("service.version", info.appVersion),
            attr("deployment.environment", environment()),
            attr("os.type", "darwin"),
            attr("os.version", info.osVersion),
            attr("host.arch", info.arch),
            ...(engineVersion ? [attr("engine.version", engineVersion)] : []),
          ],
        },
        scopeLogs: [{ scope: { name: "netnyahoo.app" }, logRecords: logs }],
      },
    ],
  });
}

/** Sends what's queued, in batches, in the background. Offline or failing: backs off and keeps it. */
export async function flush() {
  flushTimer = undefined;
  if (!saved.sharing || flushing) return;
  flushing = true;
  const gen = generation;
  let failed = false;
  try {
    while (queue.events.length && !failed) {
      const batch = queue.events.slice(0, BATCH_SIZE);
      // The engine's version arrives just after launch; events captured before it get it here.
      const body = batch.map((e) => (e.properties.engine_version == null && engineVersion ? { ...e, properties: { ...e.properties, engine_version: engineVersion } } : e));
      const status = await post("events", BATCH_URL, JSON.stringify({ api_key: POSTHOG.key, batch: body }), batch.length, {});
      if (gen !== generation) return;
      if (settled(status)) queue.events = queue.events.filter((e) => !batch.includes(e));
      else failed = true;
    }
    while (queue.logs.length && !failed) {
      const batch = queue.logs.slice(0, BATCH_SIZE);
      const status = await post("logs", LOGS_URL, otlpBody(batch), batch.length, { Authorization: `Bearer ${POSTHOG.key}` });
      if (gen !== generation) return;
      if (settled(status)) queue.logs = queue.logs.filter((l) => !batch.includes(l));
      else failed = true;
    }
  } finally {
    flushing = false;
  }
  if (gen !== generation) return;
  persistQueue(true);
  if (failed) {
    failures++;
    retryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** (failures - 1));
    scheduleFlush(0);
  } else {
    failures = 0;
    retryAt = 0;
  }
}

// MARK: The user's choice

export type SharingSource = "settings" | "onboarding" | "ask";

/**
 * Turns sharing on or off. On: a fresh install id, and crash reports from now on. Off: stops at
 * once, drops everything queued (memory and disk) and forgets the install id.
 */
export function setSharing(on: boolean, source: SharingSource) {
  const now = Date.now();
  if (on === saved.sharing) return save({ decidedAt: now, askDoneAt: saved.askDoneAt ?? now });
  generation++;
  failures = 0;
  retryAt = 0;
  if (!on) {
    save({ sharing: false, installId: null, sessionOpen: false, decidedAt: now, askDoneAt: saved.askDoneAt ?? now });
    clearQueue();
    return;
  }
  save({
    sharing: true,
    installId: uuidv4(),
    crashCursor: now,
    lastVersion: appInfo().appVersion,
    sessionOpen: true,
    decidedAt: now,
    askDoneAt: saved.askDoneAt ?? now,
  });
  capture("sharing_turned_on", { source });
}

/** The one-time ask was dismissed with "Not now" (or its close button): it doesn't come back. */
export const dismissAsk = () => save({ askDoneAt: Date.now() });

// MARK: Lifecycle

export type PreviousSession = "clean" | "unclean" | "none";

/**
 * Loads the saved choice and queue. With sharing on, starts this session and reports how the
 * last one ended and whether the app was updated since.
 */
let loaded = false;

/** Reads the user's choice (once). Error reporting calls it first thing, before startClient. */
export function loadChoice() {
  if (loaded) return;
  loaded = true;
  saved = { ...DEFAULT, ...readJson<Partial<Saved>>(STATE_DOC) };
  useTelemetry.setState({ sharing: saved.sharing, decided: saved.decidedAt !== null, askDone: saved.askDoneAt !== null });
}

export function startClient(): { previous: PreviousSession; updatedFrom: string | null } | null {
  loadChoice();
  void engineInfo()
    .then((e) => (engineVersion = `CEF ${e.cefVersion} / Chromium ${e.chromiumVersion}`))
    .catch(() => {});
  if (!saved.sharing) {
    // Nothing may linger from a session that turned sharing off.
    const stale = readJson<Queue>(QUEUE_DOC);
    if (stale?.events?.length || stale?.logs?.length) clearQueue();
    return null;
  }
  const stored = readJson<Queue>(QUEUE_DOC);
  // Before what this launch captured already (errors while starting up).
  if (stored?.version === 1) queue = { version: 1, events: [...(stored.events ?? []), ...queue.events], logs: [...(stored.logs ?? []), ...queue.logs] };
  const previous: PreviousSession = saved.lastVersion === null ? "none" : saved.sessionOpen ? "unclean" : "clean";
  const version = appInfo().appVersion;
  const updatedFrom = saved.lastVersion && saved.lastVersion !== version ? saved.lastVersion : null;
  save({ sessionOpen: true, lastVersion: version });
  scheduleFlush(10_000);
  return { previous, updatedFrom };
}

/** The app is quitting: the session ended cleanly, and what's queued waits on disk for next time. */
export function endSession() {
  if (!saved.sharing) return;
  save({ sessionOpen: false });
  persistQueue(true);
}

export const crashCursor = () => saved.crashCursor;
export const advanceCrashCursor = (to: number) => to > saved.crashCursor && save({ crashCursor: to });

// DEV: `nnTelemetry.client` in the dev harness.
export const devState = () => ({ saved, queued: { events: queue.events.length, logs: queue.logs.length }, droppedWhileOff, canSend: canSend() });

// MARK: Ids

// Function declarations: `sessionId` is made while this module loads.
function hex(n: number) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function variant() {
  return (8 + Math.floor(Math.random() * 4)).toString(16);
}

export function uuidv4() {
  const h = hex(29);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-${variant()}${h.slice(15, 18)}-${h.slice(18, 29)}${hex(1)}`;
}

/** Time-ordered (PostHog's `$session_id` must be a UUIDv7). */
export function uuidv7() {
  const ms = Date.now().toString(16).padStart(12, "0");
  const h = hex(18);
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${h.slice(0, 3)}-${variant()}${h.slice(3, 6)}-${h.slice(6, 18)}`;
}
