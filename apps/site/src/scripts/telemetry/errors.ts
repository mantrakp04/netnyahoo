// Uncaught errors and unhandled rejections become $exception events shaped like posthog-js's
// ($exception_list with type, value, mechanism and raw stack frames, plus the $exception_types/_values/
// _sources/_functions lists PostHog added), at most once per distinct error per page and 20 per page.
// console.warn and console.error go out as plain logs (not events), at most 50 per page.
import { capture, log, type Props } from "./core";

interface Frame {
  platform: "web:javascript";
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}
interface Exception {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: boolean; type: "generic" };
  stacktrace?: { type: "raw"; frames: Frame[] };
}

const CHROME = /^\s*at (?:(.+?) \()?((?:[a-z-]+:|\/|<anonymous>)[^\s)]*?|[^\s()]+?):(\d+):(\d+)\)?\s*$/i;
const GECKO = /^\s*(.*?)(?:\(.*?\))?@(.*?):(\d+):(\d+)\s*$/;

function frames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const line of stack.split("\n")) {
    const m = CHROME.exec(line) ?? GECKO.exec(line);
    if (!m) continue;
    const filename = m[2] || "<anonymous>";
    out.push({
      platform: "web:javascript",
      filename,
      function: m[1] || "?",
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/^(chrome|moz|safari(-web)?)-extension:/.test(filename),
    });
    if (out.length >= 50) break;
  }
  // Oldest call first, the throwing frame last (PostHog's order).
  return out.reverse();
}

type ErrorLike = { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
const isErrorLike = (v: unknown): v is ErrorLike =>
  v instanceof Error || (typeof v === "object" && v !== null && typeof (v as ErrorLike).message === "string" && "stack" in v);

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function exceptionList(error: unknown, fallback: { message?: string; filename?: string; lineno?: number; colno?: number }, rejection: boolean): Exception[] {
  const list: Exception[] = [];
  let current: unknown = error;
  for (let depth = 0; isErrorLike(current) && depth < 4; depth++, current = current.cause) {
    const f = frames(typeof current.stack === "string" ? current.stack : undefined);
    list.push({
      type: typeof current.name === "string" && current.name ? current.name : "Error",
      value: String(current.message ?? ""),
      mechanism: { handled: false, synthetic: false, type: "generic" },
      ...(f.length ? { stacktrace: { type: "raw", frames: f } } : {}),
    });
  }
  if (list.length) return list;
  // No Error object: a cross-origin "Script error.", or a promise rejected with something else.
  const frame: Frame[] = fallback.filename
    ? [{ platform: "web:javascript", filename: fallback.filename, function: "?", lineno: fallback.lineno, colno: fallback.colno, in_app: true }]
    : [];
  return [
    {
      type: rejection ? "UnhandledRejection" : "Error",
      value: rejection ? `Non-Error promise rejection captured with value: ${describe(error)}` : fallback.message || describe(error),
      mechanism: { handled: false, synthetic: true, type: "generic" },
      ...(frame.length ? { stacktrace: { type: "raw", frames: frame } } : {}),
    },
  ];
}

/** cyrb53, as hex: a short, stable id for "the same error". */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

const seen = new Set<string>();
let reported = 0;

function report(list: Exception[]) {
  const top = list[0];
  const lastFrame = top.stacktrace?.frames.at(-1);
  const fingerprint = hash(`${top.type}\n${top.value}\n${lastFrame?.filename ?? ""}:${lastFrame?.function ?? ""}`);
  if (seen.has(fingerprint) || reported >= 20) return;
  seen.add(fingerprint);
  reported++;
  const all = list.flatMap((e) => e.stacktrace?.frames ?? []);
  const props: Props = {
    $exception_list: list,
    $exception_level: "error",
    $exception_handled: false,
    $exception_types: list.map((e) => e.type),
    $exception_values: list.map((e) => e.value),
    $exception_sources: [...new Set(all.map((f) => f.filename))],
    $exception_functions: [...new Set(all.map((f) => f.function).filter((f) => f !== "?"))],
    $exception_fingerprint: fingerprint,
  };
  capture("$exception", props);
}

// ---------------------------------------------------------------- console

let logged = 0;
const perMessage = new Map<string, number>();
let forwarding = false;

function text(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (isErrorLike(a)) return typeof a.stack === "string" && a.stack ? a.stack : `${String(a.name)}: ${String(a.message)}`;
      const s = describe(a);
      return s.length > 1000 ? `${s.slice(0, 1000)}…` : s;
    })
    .join(" ")
    .slice(0, 4000);
}

export function startErrors() {
  addEventListener("error", (e: ErrorEvent) => {
    try {
      report(exceptionList(e.error, { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }, false));
    } catch {}
  });
  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    try {
      report(exceptionList(e.reason, {}, true));
    } catch {}
  });

  for (const level of ["warn", "error"] as const) {
    const original = console[level];
    console[level] = function (this: Console, ...args: unknown[]) {
      if (!forwarding && logged < 50) {
        forwarding = true;
        try {
          const message = text(args);
          const count = (perMessage.get(message) ?? 0) + 1;
          perMessage.set(message, count);
          if (count <= 5) {
            logged++;
            log(level, message, { "log.source": "console" });
          }
        } catch {}
        forwarding = false;
      }
      return original.apply(this, args);
    };
  }
}
