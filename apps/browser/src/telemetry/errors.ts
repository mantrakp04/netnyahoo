import { crashReports, systemInfo } from "@netnyahoo/shell";
import { advanceCrashCursor, capture, crashCursor, isSharing, loadChoice } from "./client";
import { recordLog } from "./logs";
import { errorCode, errorMessage, errorType, nativeException, nativeFrames, parseStack, type ExceptionFrame } from "./sanitize";

type Mechanism = "onerror" | "onunhandledrejection" | "react" | "console" | "native_crash";

const MAX_PER_SESSION = 25;
const reported = new WeakSet<object>();
const seen = new Set<string>();

function exceptionList(type: string, value: string, mechanism: Mechanism, handled: boolean, frames: ExceptionFrame[]) {
  return [{ type, value, mechanism: { type: mechanism, handled, synthetic: false }, stacktrace: { type: "raw", frames } }];
}

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
    const code = errorCode(error);
    const key = `${type}|${value}|${code ?? ""}|${frames.at(-1)?.function ?? ""}`;
    if (seen.has(key) || seen.size >= MAX_PER_SESSION) return;
    seen.add(key);
    capture(
      "$exception",
      { $exception_level: fatal ? "fatal" : "error", source: mechanism, error_code: code },
      // Persist the telemetry queue before a fatal process exit.
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

  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id, rejection) => {
      captureException(rejection, "onunhandledrejection");
      if (__DEV__) console.warn(`Possible unhandled promise rejection (id: ${id})`, rejection);
    },
    onHandled: () => {},
  });

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

export async function reportNativeCrashes() {
  if (!isSharing()) return;
  const since = crashCursor();
  const reports = await crashReports(since).catch(() => []);
  const version = systemInfo().appVersion;
  let latest = since;
  for (const report of reports) {
    latest = Math.max(latest, report.time);
    if (report.appVersion && report.appVersion !== version) continue;
    const { kind, signal, type, value } = nativeException(report);
    capture(
      "$exception",
      {
        $exception_level: "fatal",
        source: "native_crash",
        crash_type: kind,
        crash_signal: signal,
        crash_frames: report.frameSource === "exception" ? "exception" : "thread",
        crashed_minutes_ago: Math.round((Date.now() - report.time) / 60_000),
      },
      { urgent: true, raw: { $exception_list: exceptionList(type, value, "native_crash", false, nativeFrames(report.frames)) } },
    );
  }
  advanceCrashCursor(latest);
}
