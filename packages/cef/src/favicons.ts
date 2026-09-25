import { Cef } from "./native";

/**
 * A favicon fetched through the engine, as PNG: a file: URI in the profile's
 * "Netnyahoo Favicons" directory when a `name` was given (persistent profiles
 * only), else a data: URI. Incognito profiles never write to disk.
 */
export type FaviconImage = { uri: string; width: number; height: number };

/**
 * Fetches an icon URL (http/https) through a persistent profile's request
 * context, without cookies — for pages that have no live tab. A tab's own icon
 * should go through `WebViewHandle.downloadFavicon` instead. `profile` is the
 * engine profile ("" = default).
 */
export const fetchFavicon = (url: string, profile: string, name?: string): Promise<FaviconImage | null> =>
  Cef.fetchFavicon(url, profile, name ?? null);

/** Deletes the profile's cached icons except `keep` (names as passed to the fetches); `[]` clears them all. */
export const pruneFavicons = (profile: string, keep: string[]) => Cef.pruneFavicons(profile, keep);
