
const FILE_EXTENSIONS =
  "json|jsonl|js|mjs|cjs|jsx|ts|tsx|map|bundle|jsbundle|hbc|html?|css|txt|md|rtf|csv|log|ips|plist|xml|ya?ml|pdf|docx?|xlsx?|pptx?|key|pages|numbers|png|jpe?g|gif|webp|heic|svg|ico|icns|mp[34]|m4[av]|mov|avi|mkv|webm|wav|aac|flac|zip|gz|tgz|tar|7z|rar|dmg|pkg|app|crx|xpi|db|sqlite|sqlite3|ldb|sst";

// Match quoted text and URLs before tokens inside them.
const RULES: [RegExp, string][] = [
  [/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`/g, "<text>"],
  [/(^|[\s(\[{=:,])'[^'\n]*'(?=$|[\s)\]},.:;!?])/g, "$1<text>"],
  [/\b(?:about|data|blob|javascript|mailto|file|chrome|netnyahoo|chrome-extension|devtools|view-source):\S+/gi, "<url>"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]}]*/gi, "<url>"],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>"],
  [/(^|[\s(\[{=:,"'])~?\/?(?:[^\s/"'<>()\[\]{}]+\/)+[^\s"'<>()\[\]{},;]*/g, "$1<path>"],
  [/(^|[\s(\[{=:,])~(?=$|[\s)\]},;])/g, "$1<path>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>"],
  [/\[[0-9a-f:]*:[0-9a-f:]*\]/gi, "<ip>"],
  [new RegExp(`(^|[^\\w.<])[\\w-]+(?:[\\w.-]*)\\.(?:${FILE_EXTENSIONS})\\b`, "gi"), "$1<file>"],
  [/\b(?:[a-z0-9-]+\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]+)\b(?::\d+)?/gi, "<host>"],
  [/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "<host>"],
  [/\b\d{5,}\b/g, "<n>"],
  [/\b(?:0x)?[0-9a-f]{12,}\b/gi, "<hex>"],
];

export function scrubText(input: unknown, max = 200): string {
  if (typeof input !== "string") return "";
  let text = input.split(/\r?\n/, 1)[0] ?? "";
  for (const [pattern, placeholder] of RULES) text = text.replace(pattern, placeholder);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,60}$/;

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

// Expo's failed native call names the Swift function, a code identifier; the cause lines are dropped with the rest.
const NATIVE_CALL = /^Calling the '([A-Za-z_$][\w$]{0,60})' function has failed$/;

export function errorMessage(error: unknown): string {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : error;
  if (typeof message !== "string") return "";
  const call = NATIVE_CALL.exec(message.split(/\r?\n/, 1)[0]!.trim());
  if (call) return `Calling the '${call[1]}' function has failed`;
  return scrubText(message, 300);
}

// Expo's CodedError codes (ERR_…) and Node's (ENOENT) are constants, never user data.
export function errorCode(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? code : null;
}

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

function frameFunction(name: string | undefined): string {
  const fn = (name ?? "").trim();
  if (!fn || fn === "?" || fn === "anonymous" || fn === "<anonymous>") return "<anonymous>";
  return /^[\w$.<>\[\]# :-]{1,100}$/.test(fn) ? fn : "<anonymous>";
}

export function frameFile(location: string | undefined): string {
  const raw = (location ?? "").replace(/^address at /, "").trim();
  if (!raw || raw === "native") return raw || "<unknown>";
  // Metro puts bundle options after "//&".
  const base = raw.split(/[?#]|\/\/&/, 1)[0]!.split("/").filter(Boolean).at(-1) ?? "";
  return /^[\w.-]{1,80}$/.test(base) ? base : "<unknown>";
}

const V8_FRAME = /^\s*at (?:(.*?) \((.*?)\)|(.*?))\s*$/;
const JSC_FRAME = /^\s*(.*?)@(.*?)\s*$/;
const LOCATION = /^(.*?)(?::(\d+))?(?::(\d+))?$/;

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

const OUR_IMAGES = /^(Netnyahoo|NetnyahooNNCore|NetnyahooShell|Chromium Framework|Expo|ExpoModulesCore|React|hermes|RCT)/;

export function nativeFrames(frames: NativeFrame[], limit = 64): ExceptionFrame[] {
  return frames.slice(0, limit).map((f): ExceptionFrame => {
    const image = frameFile(f.image.replace(/\s/g, "_")).replace(/_/g, " ");
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

const SYSTEM_NAME = /^[A-Z][A-Z0-9_ ()]{1,40}$/;
// Framework-prefixed constants only (NSRangeException, CALayerInvalidGeometry, RCTFatalException).
const EXCEPTION_NAME = /^[A-Z]{2,4}[A-Z][a-z][A-Za-z0-9]{1,60}$/;

export type NativeCrash = {
  exceptionType?: string;
  signal?: string;
  exceptionName?: string;
  frames: NativeFrame[];
  exceptionFrames?: NativeFrame[];
};

/** A crash report as exceptions: the uncaught NSException's throw site first (when there is one),
 *  then the Mach exception with the crashed thread. Names only; never reasons. */
export function nativeCrashExceptions(report: NativeCrash) {
  const machType = report.exceptionType && SYSTEM_NAME.test(report.exceptionType) ? report.exceptionType : "Crash";
  const signal = report.signal && SYSTEM_NAME.test(report.signal) ? report.signal : null;
  const name = report.exceptionName && EXCEPTION_NAME.test(report.exceptionName) ? report.exceptionName : null;
  const crash = { type: machType, value: signal ? `${machType} (${signal})` : machType, frames: nativeFrames(report.frames) };
  if (!report.exceptionFrames?.length) return { name, signal, exceptions: [crash] };
  const thrown = { type: name ?? "NSException", value: `Uncaught ${name ?? "NSException"}`, frames: nativeFrames(report.exceptionFrames) };
  return { name, signal, exceptions: [thrown, crash] };
}

export type PropertyValue = string | number | boolean | null;

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
