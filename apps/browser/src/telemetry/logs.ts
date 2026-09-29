import { isSharing, queueLog } from "./client";
import { errorType, scrubText } from "./sanitize";

/**
 * Warning and error log lines for PostHog Logs (OTLP), while sharing is on. Only a line's fixed
 * message goes: the first argument when it's a string, scrubbed (addresses, paths, file names,
 * quoted text and ids become placeholders), plus the type of an Error passed with it. Other
 * arguments (the error's message, objects) stay here. Each distinct message goes once a session.
 */

const MAX_DISTINCT = 40;
const seen = new Set<string>();

export function recordLog(level: "warn" | "error", args: unknown[]) {
  if (!isSharing()) return;
  const first = args[0];
  if (typeof first !== "string") return;
  const message = scrubText(first, 160);
  if (!message || seen.has(message) || seen.size >= MAX_DISTINCT) return;
  seen.add(message);
  const error = args.slice(1).find((a) => a instanceof Error);
  queueLog(level, message, { error_type: error ? errorType(error) : "none" });
}
