/**
 * LEGACY NAMES. Arcadia was called Netnyahoo until 0.2.32. This is the only TypeScript file that may spell the old
 * names: values other Macs (or an older build) still write under them. An updated install's own files are brought
 * across once at launch, natively (packages/sync/ios/Core/LegacyMigration.swift, which has the same tables).
 */

/** Hashed into the UUID of a bookmark saved before Chrome kept bookmarks (store/bookmarks.ts): every Mac must agree. */
export const LEGACY_BOOKMARK_SEED = "netnyahoo-bookmark:";

/** App URLs, at the start of a string; a host must end where the prefix does. */
export const LEGACY_URLS: [string, string][] = [
  ["netnyahoo://yahu", "arcadia://game"],
  ["chrome://yahu", "chrome://game"],
  ["netnyahoo://", "arcadia://"],
];

/** Object keys: settings, and settings.shortcuts' command ids. */
export const LEGACY_KEYS: Record<string, string> = {
  openLinksInSmallYahu: "openLinksInLittleArcadia",
  smallYahuSize: "littleArcadiaSize",
  newSmallYahu: "newLittleArcadia",
  toggleOpenLinksInSmallYahu: "toggleOpenLinksInLittleArcadia",
};

export function fromLegacyUrl(url: string): string {
  const lower = url.toLowerCase();
  for (const prefix of ["", "view-source:"]) {
    for (const [old, now] of LEGACY_URLS) {
      if (!lower.startsWith(prefix + old)) continue;
      const rest = url.slice(prefix.length + old.length);
      if (!old.endsWith("://") && rest && !"/?#".includes(rest[0]!)) continue;
      return url.slice(0, prefix.length) + now + rest;
    }
  }
  return url;
}

/** A synced record in today's names (the same value, untouched, when it has none of the old ones). */
export function fromLegacy<T>(value: T): T {
  if (typeof value === "string") return fromLegacyUrl(value) as T;
  if (Array.isArray(value)) {
    const out = value.map(fromLegacy);
    return (out.some((v, i) => v !== value[i]) ? out : value) as T;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(source)) {
      const name = LEGACY_KEYS[key] ?? key;
      // Both names: the new one's value wins.
      if (name !== key && name in source) {
        changed = true;
        continue;
      }
      out[name] = fromLegacy(v);
      if (name !== key || out[name] !== v) changed = true;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
