import { crashReports, systemInfo } from "@netnyahoo/shell";
import { advanceCrashCursor, capture, crashCursor, isSharing, loadChoice } from "./client";
import { recordLog } from "./logs";
import { errorMessage, errorType, nativeFrames, parseStack, type ExceptionFrame } from "./sanitize";

/**
 * Error tracking: uncaught JS errors, unhandled promise rejections and React render errors
 * become PostHog `$exception` events (type, scrubbed message, function and bundle names); on
 * the next launch, this install's own crash reports do too. Only while sharing is on.
 */

type Mechanism = "onerror" | "onunhandledrejection" | "react" | "console" | "native_crash";

const MAX_PER_SESSION = 25;
const reported = new WeakSet<object>();
const seen = new Set<string>();

function exceptionList(type: string, value: string, mechanism: Mechanism, handled: boolean, frames: ExceptionFrame[]) {
  return [{ type, value, mechanism: { type: mechanism, handled, synthetic: false }, stacktrace: { type: "raw", frames } }];
}

/** Reports an error once per session (the same type, message and top frame count as one). */
export function captureException(error: unknown, mechanism: Mechanism, { fatal = false, handled = false } = {}) {
  if (!isSharing()) return;
  try {
    if (error && typeof error === "object") {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const type = errorType(error);
    const value = errorMessage(error) || type;
    const frames = parseStack(error && typeof error === "object" ? (error as { stack?: unknown }).stack : undefined);
    const key = `${type}|${value}|${frames.at(-1)?.function ?? ""}`;
    if (seen.has(key) || seen.size >= MAX_PER_SESSION) return;
    seen.add(key);
    capture(
      "$exception",
      { $exception_level: fatal ? "fatal" : "error", source: mechanism },
      // A fatal error ends the process right after this: the queue goes to disk first.
      { urgent: true, persist: fatal, raw: { $exception_list: exceptionList(type, value, mechanism, handled, frames) } },
    );
  } catch {}
}

type ErrorUtilsType = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};
type HermesInternalType = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

let installed = false;

/**
 * Hooks the JS runtime's error paths. Call first thing at startup (it only reports while
 * sharing is on, so it's cheap to install unconditionally). Each hook passes the error on to
 * what was there before (React Native's handler, the console).
 */
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  loadChoice();
  const g = globalThis as { ErrorUtils?: ErrorUtilsType; HermesInternal?: HermesInternalType };

  const previous = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    captureException(error, "onerror", { fatal: !!isFatal });
    previous?.(error, isFatal);
  });

  // React Native only turns Hermes' rejection tracker on in DEV (to warn); this keeps the warning.
  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id, rejection) => {
      captureException(rejection, "onunhandledrejection");
      if (__DEV__) console.warn(`Possible unhandled promise rejection (id: ${id})`, rejection);
    },
    onHandled: () => {},
  });

  // React render errors reach the console as the Error itself (React Native's handleException);
  // other warnings and errors are log lines (logs.ts).
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    let busy = false;
    console[level] = (...args: unknown[]) => {
      if (!busy) {
        busy = true;
        try {
          const first = args[0];
          if (level === "error" && first instanceof Error) {
            captureException(first, (first as { isComponentError?: boolean }).isComponentError ? "react" : "console");
          } else recordLog(level, args);
        } catch {}
        busy = false;
      }
      original.apply(console, args);
    };
  }
}

const SYSTEM_NAME = /^[A-Z][A-Z0-9_ ()]{1,40}$/;

/**
 * This install's crash reports since the last look (only ones from this version), as fatal
 * `$exception`s: the exception type and the crashing thread's frames, nothing else.
 */
export async function reportNativeCrashes() {
  if (!isSharing()) return;
  const since = crashCursor();
  const reports = await crashReports(since).catch(() => []);
  const version = systemInfo().appVersion;
  let latest = since;
  for (const report of reports) {
    latest = Math.max(latest, report.time);
    if (report.appVersion && report.appVersion !== version) continue;
    const type = report.exceptionType && SYSTEM_NAME.test(report.exceptionType) ? report.exceptionType : "Crash";
    const signal = report.signal && SYSTEM_NAME.test(report.signal) ? report.signal : null;
    capture(
      "$exception",
      { $exception_level: "fatal", source: "native_crash", crash_signal: signal, crashed_minutes_ago: Math.round((Date.now() - report.time) / 60_000) },
      {
        urgent: true,
        raw: { $exception_list: exceptionList(type, signal ? `${type} (${signal})` : type, "native_crash", false, nativeFrames(report.frames)) },
      },
    );
  }
  advanceCrashCursor(latest);
}
