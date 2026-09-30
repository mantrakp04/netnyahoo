// Feature flags without a server: PostHog's own bucketing (posthog/models/feature_flag/flag_matching.py), so
// every visitor keeps the variant PostHog gave them. hash = the first 15 hex digits of
// sha1("<key>.<distinct_id><salt>") over 0xfffffffffffffff; in the rollout if hash <= rollout %, and the
// variant is the first whose cumulative share passes hash (salt "variant"). Checked against every
// $feature_flag_called in the PostHog export (1,318 of 1,318).
import { FLAGS, type FlagKey } from "../../data/telemetry";
import { capture, distinctId, enabled, register, write } from "./core";

const SCALE = 0xfffffffffffffffn;

/** PostHog's hash as an exact fraction of SCALE (60-bit integers, so BigInt). */
async function hash(key: string, id: string, salt: string): Promise<bigint> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${key}.${id}${salt}`));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex.slice(0, 15)}`);
}

/** The variant PostHog would give this id, or null outside the rollout. */
export async function bucket(key: FlagKey, id: string): Promise<string | null> {
  const flag = FLAGS[key];
  if (flag.rollout < 100 && (await hash(key, id, "")) * 100n > BigInt(flag.rollout) * SCALE) return null;
  const h = (await hash(key, id, "variant")) * 100n;
  let cumulative = 0;
  for (const v of flag.variants) {
    cumulative += v.rollout;
    if (h < BigInt(cumulative) * SCALE) return v.key;
  }
  return null;
}

/** This visitor's variant, or null when there's none (silent build, no Web Crypto, outside the rollout). */
export async function flagVariant(key: FlagKey): Promise<string | null> {
  if (!enabled || !crypto?.subtle) return null;
  try {
    return await bucket(key, distinctId);
  } catch {
    return null;
  }
}

const REPORTED = "nn:flag_called";

/** Like posthog.getFeatureFlag: the variant, and the exposure ($feature_flag_called and
 * $experiment_exposure) the first time this visitor sees this variant. */
export async function getFeatureFlag(key: FlagKey): Promise<string | null> {
  const variant = await flagVariant(key);
  if (variant === null) return null;
  let reported: Record<string, string> = {};
  try {
    reported = JSON.parse(localStorage.getItem(REPORTED) ?? "{}") ?? {};
  } catch {}
  if (reported[key] !== variant) {
    const flag = FLAGS[key];
    const props = {
      $feature_flag: key,
      $feature_flag_response: variant,
      $feature_flag_id: flag.id,
      $feature_flag_version: flag.version,
      $feature_flag_reason: "Matched condition set 1",
      $feature_flag_has_experiment: flag.experiment,
      $feature_flag_evaluated_at: Date.now(),
      $used_bootstrap_value: false,
      [`$feature/${key}`]: variant,
    };
    capture("$feature_flag_called", props);
    if (flag.experiment) capture("$experiment_exposure", props);
    reported[key] = variant;
    try {
      localStorage.setItem(REPORTED, JSON.stringify(reported));
    } catch {}
  }
  return variant;
}

/** Every later event carries `$feature/<key>` and `$active_feature_flags`, as with posthog-js. */
export async function registerFlags() {
  const active: string[] = [];
  const props: Record<string, string> = {};
  for (const key of Object.keys(FLAGS) as FlagKey[]) {
    const v = await flagVariant(key);
    if (v === null) continue;
    active.push(key);
    props[`$feature/${key}`] = v;
  }
  const all = { ...props, $active_feature_flags: active };
  register(all);
  write("nn:flags", JSON.stringify({ id: distinctId, props: all }));
}
