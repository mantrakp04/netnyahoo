// The sender: who the visitor is, which session they're in, and the batches of events and logs it posts to
// our own collector as OTLP/HTTP JSON (the contract: infra/telemetry; settings: src/data/telemetry.ts).
// Event and property names are PostHog's, so old and new data read the same.
import { VERSION } from "../../data/release";
import {
  DEV_OPT_IN,
  FLUSH_MS,
  LEGACY_POSTHOG_TOKEN,
  LOGS_PATH,
  PRODUCTION_HOSTS,
  SERVICE_NAME,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
} from "../../data/telemetry";
import { parseUserAgent } from "./ua";

export type Value = string | number | boolean | null | undefined | object;
export type Props = Record<string, Value>;
export interface CaptureOptions {
  /** Post now, with sendBeacon, because the page is about to go (an outbound link). */
  send_instantly?: boolean;
  /** When it happened (ms epoch), if not now. */
  timestamp?: number;
  uuid?: string;
}

const LIB_VERSION = "1.0.0";

// ---------------------------------------------------------------- storage

function read(key: string, store: "local" | "session" = "local"): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
export function write(key: string, value: string, store: "local" | "session" = "local") {
  try {
    (store === "local" ? localStorage : sessionStorage).setItem(key, value);
  } catch {}
}
export function readJSON<T>(key: string): T | null {
  try {
    return JSON.parse(read(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- switch

const production = PRODUCTION_HOSTS.includes(location.hostname);
/** Only netnyahoo.com reports; anything else only after `localStorage.setItem("nn:telemetry", "dev")`. */
export const enabled = production || DEV_OPT_IN.some((key) => read(key) === "dev");
const environment = production ? "production" : "development";

// ---------------------------------------------------------------- ids

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A UUIDv7: 48 bits of ms time, then random; sorts by time. */
export function uuidv7(ms = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 5, t = ms; i >= 0; i--, t = Math.floor(t / 256)) b[i] = t % 256;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The id posthog-js kept for this browser, so a returning visitor stays the same visitor. */
function posthogId(): string | null {
  const key = `ph_${LEGACY_POSTHOG_TOKEN}_posthog`;
  const pick = (json: string | null | undefined) => {
    try {
      const id = json ? (JSON.parse(json) as { distinct_id?: unknown }).distinct_id : null;
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  };
  const fromStorage = pick(read(key));
  if (fromStorage) return fromStorage;
  try {
    const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${key}=`));
    return pick(cookie && decodeURIComponent(cookie.slice(key.length + 1)));
  } catch {
    return null;
  }
}

function visitorId(): string {
  const stored = read("nn:id");
  if (stored) return stored;
  const id = posthogId() ?? uuidv7();
  write("nn:id", id);
  return id;
}

export const distinctId = visitorId();

/** One per tab. */
export const windowId: string = read("nn:window", "session") ?? uuidv7();
write("nn:window", windowId, "session");

// ---------------------------------------------------------------- page facts

const CAMPAIGN_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "gad_source", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id",
  "mc_cid", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx",
];

function campaign(): Props {
  const out: Props = {};
  const params = new URLSearchParams(location.search);
  for (const key of CAMPAIGN_PARAMS) {
    const v = params.get(key);
    if (v !== null) out[key] = v;
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const referrer = document.referrer || "$direct";
const referringDomain = (document.referrer && hostOf(document.referrer)) || "$direct";

function searchEngine(host: string): string | null {
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/(^|\.)bing\.com$/.test(host)) return "bing";
  if (/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.co(m|\.[a-z]+)$/.test(host)) return "yahoo";
  if (/(^|\.)duckduckgo\.com$/.test(host)) return "duckduckgo";
  return null;
}

const device = parseUserAgent(navigator.userAgent, "brave" in navigator);
const language = navigator.language || "";

/** What every event carries about the browser; the URL parts are read when the event happens. */
const constant: Props = {
  $lib: "netnyahoo-web",
  $lib_version: LIB_VERSION,
  ...device,
  $raw_user_agent: navigator.userAgent,
  $browser_language: language,
  $browser_language_prefix: language.split("-")[0] || null,
  $screen_width: screen.width,
  $screen_height: screen.height,
  $timezone: (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  })(),
  $timezone_offset: new Date().getTimezoneOffset(),
  $referrer: referrer,
  $referring_domain: referringDomain,
  $search_engine: referringDomain === "$direct" ? null : searchEngine(referringDomain),
  environment,
  release_version: VERSION,
};

// Reduced Android UAs say "K"; Chromium tells the model through client hints.
if (device.$os === "Android" && !device.$device_model) {
  const cached = read("nn:model", "session");
  if (cached) constant.$device_model = cached;
  else
    (navigator as Navigator & { userAgentData?: { getHighEntropyValues?(h: string[]): Promise<{ model?: string }> } }).userAgentData
      ?.getHighEntropyValues?.(["model"])
      .then(({ model }) => {
        if (!model) return;
        constant.$device_model = model;
        write("nn:model", model, "session");
      })
      .catch(() => {});
}

/** Properties registered for every later event (environment, release_version and the flags). */
const registered: Props = {};
export function register(props: Props) {
  Object.assign(registered, props);
}

// The flags' super properties from the last page (flags.ts), so this page view carries them too, as with posthog-js.
const cachedFlags = readJSON<{ id: string; props: Props }>("nn:flags");
if (cachedFlags?.id === distinctId && cachedFlags.props) register(cachedFlags.props);

// ---------------------------------------------------------------- session

interface Session {
  id: string;
  start: number;
  last: number;
  entry: Props;
}

function entryProps(): Props {
  const out: Props = {
    $session_entry_url: location.href,
    $session_entry_host: location.host,
    $session_entry_pathname: location.pathname,
    $session_entry_referrer: referrer,
    $session_entry_referring_domain: referringDomain,
  };
  for (const [k, v] of Object.entries(campaign())) out[`$session_entry_${k}`] = v;
  return out;
}

let session: Session | null = null;
const sessionListeners: ((id: string, previous: string) => void)[] = [];

/** Calls back when this page's session ends (30 min idle, 24 h) and a new one starts. */
export function onSessionChange(fn: (id: string, previous: string) => void) {
  sessionListeners.push(fn);
}

/** The current session, renewed if it has lapsed; activity keeps it going. Shared by the tabs of the browser. */
function touchSession(now = Date.now()): Session {
  const stored = readJSON<Session>("nn:session");
  let s = stored && typeof stored.id === "string" ? stored : session;
  const lapsed = !s || now - s.last > SESSION_IDLE_MS || now - s.start > SESSION_MAX_MS;
  const previous = session?.id;
  if (lapsed) s = { id: uuidv7(now), start: now, last: now, entry: entryProps() };
  else s!.last = Math.max(s!.last, now);
  session = s!;
  write("nn:session", JSON.stringify(session));
  if (previous && previous !== session.id) for (const fn of sessionListeners) fn(session.id, previous);
  return session;
}

export const sessionId = () => (session ?? touchSession()).id;
export const sessionStart = () => (session ?? touchSession()).start;

// Activity: anything the visitor does keeps the session alive (checked at most every 5 s).
let lastTouch = 0;
const activity = () => {
  const now = Date.now();
  if (now - lastTouch < 5000) return;
  lastTouch = now;
  touchSession(now);
};

// ---------------------------------------------------------------- OTLP

interface AnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}
interface KeyValue {
  key: string;
  value: AnyValue;
}
interface LogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: AnyValue;
  attributes: KeyValue[];
}

function toValue(v: Value): AnyValue | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Number.isSafeInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  try {
    return { stringValue: JSON.stringify(v) };
  } catch {
    return null;
  }
}

function attributes(props: Props): KeyValue[] {
  const out: KeyValue[] = [];
  for (const [key, v] of Object.entries(props)) {
    const value = toValue(v);
    if (value) out.push({ key, value });
  }
  return out;
}

const nanos = (ms: number) => `${Math.round(ms)}000000`;

const resource = {
  attributes: attributes({
    "service.name": SERVICE_NAME,
    "service.version": VERSION,
    "deployment.environment": environment,
  }),
};

// ---------------------------------------------------------------- queue

type Scope = "netnyahoo.analytics" | "netnyahoo.site";
interface Queued {
  scope: Scope;
  record: LogRecord;
  size: number;
  retried?: boolean;
}

const queue: Queued[] = [];
let timer = 0;
/** Beacons and keepalive fetches carry at most 64 KB. */
const MAX_BODY = 60_000;

function body(items: Queued[]): string {
  const scopes = new Map<Scope, LogRecord[]>();
  for (const i of items) {
    const list = scopes.get(i.scope) ?? [];
    list.push(i.record);
    scopes.set(i.scope, list);
  }
  return JSON.stringify({
    resourceLogs: [
      { resource, scopeLogs: [...scopes].map(([name, logRecords]) => ({ scope: { name }, logRecords })) },
    ],
  });
}

function post(items: Queued[], beacon: boolean) {
  const payload = body(items);
  if (beacon && typeof navigator.sendBeacon === "function") {
    try {
      if (navigator.sendBeacon(LOGS_PATH, new Blob([payload], { type: "application/json" }))) return;
    } catch {}
  }
  const retry = () => {
    // One more try on the next flush, then they're dropped.
    const again = items.filter((i) => !i.retried);
    for (const i of again) i.retried = true;
    if (again.length) {
      queue.unshift(...again);
      schedule();
    }
  };
  fetch(LOGS_PATH, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: payload.length < MAX_BODY,
    credentials: "omit",
  })
    .then((r) => {
      if (r.status === 429 || r.status >= 500) retry();
    })
    .catch(retry);
}

/** Posts everything queued, in bodies small enough for a beacon. */
export function flush(beacon = false) {
  clearTimeout(timer);
  timer = 0;
  while (queue.length) {
    const batch: Queued[] = [];
    let size = 200;
    while (queue.length && (batch.length === 0 || size + queue[0].size < MAX_BODY)) {
      const next = queue.shift()!;
      size += next.size;
      batch.push(next);
    }
    post(batch, beacon);
  }
}

function schedule() {
  if (!timer && queue.length) timer = window.setTimeout(() => flush(), FLUSH_MS);
}

function enqueue(scope: Scope, record: LogRecord, instantly = false) {
  queue.push({ scope, record, size: JSON.stringify(record).length });
  if (instantly || queue.length >= 100) flush(instantly);
  else schedule();
}

// ---------------------------------------------------------------- capture

let pageviewId: string | undefined;

/** Records an event with PostHog's name and property names. Returns its uuid (undefined when silent). */
export function capture(event: string, props: Props = {}, options: CaptureOptions = {}): string | undefined {
  if (!enabled) return;
  try {
    const now = Date.now();
    const s = touchSession(now);
    const uuid = options.uuid ?? uuidv7(now);
    const all: Props = {
      ...constant,
      $current_url: location.href,
      $host: location.host,
      $pathname: location.pathname,
      $viewport_width: window.innerWidth,
      $viewport_height: window.innerHeight,
      ...campaign(),
      ...s.entry,
      ...registered,
      $session_id: s.id,
      $window_id: windowId,
      $pageview_id: pageviewId,
      ...props,
    };
    enqueue(
      "netnyahoo.analytics",
      {
        timeUnixNano: nanos(options.timestamp ?? now),
        severityNumber: 9,
        severityText: "INFO",
        body: { stringValue: event },
        attributes: [
          { key: "event", value: { stringValue: event } },
          { key: "uuid", value: { stringValue: uuid } },
          { key: "distinct_id", value: { stringValue: distinctId } },
          ...attributes(all),
        ],
      },
      options.send_instantly,
    );
    return uuid;
  } catch {
    return;
  }
}

const SEVERITY = { warn: [13, "WARN"], error: [17, "ERROR"] } as const;

/** A plain log line (not an event): the site's console warnings and errors. */
export function log(level: keyof typeof SEVERITY, message: string, props: Props = {}) {
  if (!enabled) return;
  try {
    const [severityNumber, severityText] = SEVERITY[level];
    enqueue("netnyahoo.site", {
      timeUnixNano: nanos(Date.now()),
      severityNumber,
      severityText,
      body: { stringValue: message },
      attributes: attributes({
        distinct_id: distinctId,
        $session_id: session?.id,
        $window_id: windowId,
        $current_url: location.href,
        $pathname: location.pathname,
        $browser: device.$browser,
        $browser_version: device.$browser_version,
        $os: device.$os,
        $device_type: device.$device_type,
        release_version: VERSION,
        ...props,
      }),
    });
  } catch {}
}

// ---------------------------------------------------------------- leaving

const hideHooks: (() => void)[] = [];
/** Runs just before the queue goes out when the page is hidden or unloaded (web vitals, replay). */
export function onHide(fn: () => void) {
  hideHooks.push(fn);
}

// Scroll depth for $pageleave, as posthog-js measures it.
let lastScroll = 0;
let maxScroll = 0;
let lastContent = 0;
let maxContent = 0;
let measuring = 0;
function measure() {
  measuring = 0;
  const el = document.scrollingElement ?? document.documentElement;
  lastScroll = Math.round(el.scrollTop);
  lastContent = Math.round(el.scrollTop + el.clientHeight);
  maxScroll = Math.max(maxScroll, lastScroll);
  maxContent = Math.max(maxContent, lastContent);
}

const ratio = (part: number, whole: number) => (whole <= 0 ? 1 : Math.min(1, Math.max(0, part / whole)));

let pageviewAt = 0;
let pageviewPath = "";
let left = false;
function pageleave() {
  if (left || !pageviewId) return;
  left = true;
  measure();
  const el = document.scrollingElement ?? document.documentElement;
  const contentHeight = el.scrollHeight;
  const scrollHeight = Math.max(0, contentHeight - el.clientHeight);
  capture("$pageleave", {
    $prev_pageview_id: pageviewId,
    $prev_pageview_pathname: pageviewPath,
    $prev_pageview_duration: (Date.now() - pageviewAt) / 1000,
    $prev_pageview_last_scroll: lastScroll,
    $prev_pageview_last_scroll_percentage: ratio(lastScroll, scrollHeight),
    $prev_pageview_max_scroll: maxScroll,
    $prev_pageview_max_scroll_percentage: ratio(maxScroll, scrollHeight),
    $prev_pageview_last_content: lastContent,
    $prev_pageview_last_content_percentage: ratio(lastContent, contentHeight),
    $prev_pageview_max_content: maxContent,
    $prev_pageview_max_content_percentage: ratio(maxContent, contentHeight),
  });
}

function hidden(unloading: boolean) {
  for (const fn of hideHooks) {
    try {
      fn();
    } catch {}
  }
  if (unloading) pageleave();
  flush(true);
}

// ---------------------------------------------------------------- start

if (enabled) {
  touchSession();
  pageviewId = uuidv7();
  pageviewAt = Date.now();
  pageviewPath = location.pathname;
  capture("$pageview", { title: document.title }, { uuid: pageviewId });
  measure();

  addEventListener("scroll", () => (measuring ||= requestAnimationFrame(measure)), { passive: true });
  for (const type of ["click", "keydown", "scroll", "touchstart", "mousemove"])
    addEventListener(type, activity, { passive: true, capture: true });
  addEventListener("pagehide", () => hidden(true));
  // Bubbles up from document, so it runs after web-vitals' own listeners have reported.
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hidden(false);
  });
  // Back from the bfcache: the same page view carries on.
  addEventListener("pageshow", (e) => {
    if (e.persisted) left = false;
  });
}
