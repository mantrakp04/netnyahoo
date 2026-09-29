/**
 * Telemetry's content filter. Everything that leaves the app as text (error messages, log lines,
 * stack frames, property values) goes through here first, so a message keeps its shape
 * ("Couldn't read <file>") and loses its content: web addresses, hosts, file paths and names,
 * emails, quoted text, ids and long numbers become placeholders.
 *
 * Pure and dependency-free (unit tested in sanitize.test.mjs).
 */

const FILE_EXTENSIONS =
  "json|jsonl|js|mjs|cjs|jsx|ts|tsx|map|bundle|jsbundle|hbc|html?|css|txt|md|rtf|csv|log|ips|plist|xml|ya?ml|pdf|docx?|xlsx?|pptx?|key|pages|numbers|png|jpe?g|gif|webp|heic|svg|ico|icns|mp[34]|m4[av]|mov|avi|mkv|webm|wav|aac|flac|zip|gz|tgz|tar|7z|rar|dmg|pkg|app|crx|xpi|db|sqlite|sqlite3|ldb|sst";

/** [pattern, placeholder]; order matters (quoted text and addresses before the tokens inside them). */
const RULES: [RegExp, string][] = [
  // Quoted text can hold anything: typed text, titles, code. Single quotes only count as quotes
  // around a word boundary, so "couldn't" and "can't" survive.
  [/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`/g, "<text>"],
  [/(^|[\s(\[{=:,])'[^'\n]*'(?=$|[\s)\]},.:;!?])/g, "$1<text>"],
  // Anything with a scheme: https://…, file://…, chrome://…, blob:…, data:…, mailto:…
  [/\b(?:about|data|blob|javascript|mailto|file|chrome|netnyahoo|chrome-extension|devtools|view-source):\S+/gi, "<url>"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]}]*/gi, "<url>"],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>"],
  // Paths: ~/…, /Users/…, and any token with two or more slash-separated parts (a/b, /a/b).
  [/(^|[\s(\[{=:,"'])~?\/?(?:[^\s/"'<>()\[\]{}]+\/)+[^\s"'<>()\[\]{},;]*/g, "$1<path>"],
  [/(^|[\s(\[{=:,])~(?=$|[\s)\]},;])/g, "$1<path>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>"],
  [/\[[0-9a-f:]*:[0-9a-f:]*\]/gi, "<ip>"],
  // file.ext, then any other dotted name (example.com, localhost.test): a host.
  [new RegExp(`(^|[^\\w.<])[\\w-]+(?:[\\w.-]*)\\.(?:${FILE_EXTENSIONS})\\b`, "gi"), "$1<file>"],
  [/\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]+)\b(?::\d+)?/gi, "<host>"],
  [/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "<host>"],
  [/\b\d{5,}\b/g, "<n>"],
  [/\b(?:0x)?[0-9a-f]{12,}\b/gi, "<hex>"],
];

/**
 * A message with its content removed: one line, placeholders for addresses, paths, names and
 * ids, at most `max` characters.
 */
export function scrubText(input: unknown, max = 200): string {
  if (typeof input !== "string") return "";
  let text = input.split(/\r?\n/, 1)[0] ?? "";
  for (const [pattern, placeholder] of RULES) text = text.replace(pattern, placeholder);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,60}$/;

/** An error's class name ("TypeError"), never its message. */
export function errorType(error: unknown): string {
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && IDENTIFIER.test(name)) return name;
    const ctor = (error as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof ctor === "string" && IDENTIFIER.test(ctor)) return ctor;
    return "Error";
  }
  if (typeof error === "string") return "Error";
  return typeof error === "undefined" ? "Undefined" : error === null ? "Null" : "NonError";
}

/** An error's message, scrubbed. */
export function errorMessage(error: unknown): string {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : error;
  return scrubText(typeof message === "string" ? message : "", 300);
}

/** PostHog's "custom" stack frame (its error tracking's language-agnostic format). */
export type ExceptionFrame = {
  platform: "custom";
  lang: string;
  function: string;
  module: string;
  filename: string;
  lineno: number | null;
  colno: number | null;
  resolved: boolean;
  in_app: boolean;
};

/** A frame's function name: code identifiers only (no slashes or quotes, so never an address or a path). */
function frameFunction(name: string | undefined): string {
  const fn = (name ?? "").trim();
  if (!fn || fn === "?" || fn === "anonymous" || fn === "<anonymous>") return "<anonymous>";
  return /^[\w$.<>\[\]# :-]{1,100}$/.test(fn) ? fn : "<anonymous>";
}

/** A frame's file: the bundle's base name, no directories, no query (Metro's has the dev host in it). */
export function frameFile(location: string | undefined): string {
  const raw = (location ?? "").replace(/^address at /, "").trim();
  if (!raw || raw === "native") return raw || "<unknown>";
  // Metro's bundle URL puts its options after "//&" instead of a query.
  const base = raw.split(/[?#]|\/\/&/, 1)[0]!.split("/").filter(Boolean).at(-1) ?? "";
  return /^[\w.-]{1,80}$/.test(base) ? base : "<unknown>";
}

const V8_FRAME = /^\s*at (?:(.*?) \((.*?)\)|(.*?))\s*$/;
const JSC_FRAME = /^\s*(.*?)@(.*?)\s*$/;
const LOCATION = /^(.*?)(?::(\d+))?(?::(\d+))?$/;

/**
 * Hermes / JSC / V8 stack text → frames, outermost first and the throwing frame last (the order
 * PostHog expects). Function names and bundle names only: no directories, hosts or queries.
 */
export function parseStack(stack: unknown, limit = 50): ExceptionFrame[] {
  if (typeof stack !== "string") return [];
  const frames: ExceptionFrame[] = [];
  for (const line of stack.split("\n")) {
    let fn: string | undefined;
    let location: string | undefined;
    const v8 = V8_FRAME.exec(line);
    if (v8) {
      if (v8[2] !== undefined) [fn, location] = [v8[1], v8[2]];
      else location = v8[3];
    } else {
      const jsc = JSC_FRAME.exec(line);
      if (!jsc || !jsc[2]) continue;
      [fn, location] = [jsc[1], jsc[2]];
    }
    const loc = LOCATION.exec((location ?? "").replace(/^address at /, "")) ?? [];
    const filename = frameFile(loc[1]);
    frames.push({
      platform: "custom",
      lang: "javascript",
      function: frameFunction(fn),
      module: filename,
      filename,
      lineno: loc[2] ? Number(loc[2]) : null,
      colno: loc[3] ? Number(loc[3]) : null,
      resolved: false,
      in_app: filename !== "native" && filename !== "<unknown>" && !/^InternalBytecode/.test(filename),
    });
    if (frames.length >= limit) break;
  }
  return frames.reverse();
}

export type NativeFrame = { image: string; symbol?: string; offset?: number };

/** Images that are Netnyahoo's own code (the app, its frameworks, the engine we build). */
const OUR_IMAGES = /^(Netnyahoo|NetnyahooCEF|NetnyahooShell|Chromium Embedded Framework|Expo|ExpoModulesCore|React|hermes|RCT)/;

/** A crash report's frames (innermost first, as the report lists them) → PostHog frames, outermost first. */
export function nativeFrames(frames: NativeFrame[], limit = 64): ExceptionFrame[] {
  return frames.slice(0, limit).map((f): ExceptionFrame => {
    const image = frameFile(f.image.replace(/\s/g, "_")).replace(/_/g, " ");
    // Symbols are code names; drop anything path-like all the same, and quoted text.
    const symbol =
      typeof f.symbol === "string" && f.symbol
        ? f.symbol.replace(/\S*\/\S*/g, "<path>").replace(/"[^"]*"/g, "<text>").slice(0, 200)
        : null;
    return {
      platform: "custom",
      lang: "native",
      function: symbol ?? `${image} + 0x${(f.offset ?? 0).toString(16)}`,
      module: image,
      filename: image,
      lineno: null,
      colno: null,
      resolved: !!symbol,
      in_app: OUR_IMAGES.test(image),
    };
  }).reverse();
}

/** Property values telemetry may send: numbers, booleans, and short scrubbed strings. */
export type PropertyValue = string | number | boolean | null;

/**
 * Keeps only plain values: finite numbers, booleans, null, and strings scrubbed to 64 characters.
 * Objects, arrays and functions are dropped (events are built from fixed, flat fields).
 */
export function cleanProperties(props: Record<string, unknown>): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!/^\$?[a-z][a-z0-9_]{0,48}$/i.test(key)) continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "string") out[key] = scrubText(value, 64);
  }
  return out;
}
