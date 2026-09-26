// A small ElevenLabs REST client for the launch video's audio scripts.
// The key comes from ELEVENLABS_API_KEY or apps/launch-video/.env (gitignored); it is never printed:
// every error message has it redacted.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const env = join(root, ".env");
  if (!existsSync(env)) return null;
  const line = readFileSync(env, "utf8").split("\n").find((l) => /^\s*ELEVENLABS_API_KEY\s*=/.test(l));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : null;
}

const KEY = loadKey();
export const hasKey = () => !!KEY;
const redact = (s) => (KEY ? String(s).split(KEY).join("[redacted]") : String(s));

/** fetch against api.elevenlabs.io; returns the Response, or throws with a redacted message. */
export async function eleven(path, { method = "GET", json, form, query, accept } = {}) {
  if (!KEY) throw new Error("No ELEVENLABS_API_KEY (environment or apps/launch-video/.env)");
  const url = new URL(`https://api.elevenlabs.io${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const headers = { "xi-api-key": KEY };
  if (accept) headers.accept = accept;
  let body;
  if (json) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) body = form;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (e) {
      throw new Error(redact(`${method} ${path}: ${e.message}`));
    }
    if (res.ok) return res;
    const text = redact(await res.text().catch(() => ""));
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 600)}`);
  }
}

export const elevenJson = async (path, opts) => (await eleven(path, opts)).json();
export const elevenBytes = async (path, opts) => Buffer.from(await (await eleven(path, opts)).arrayBuffer());
