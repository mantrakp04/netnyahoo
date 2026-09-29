import { Cef } from "./native";

export type FaviconImage = { uri: string; width: number; height: number };

export const fetchFavicon = (url: string, profile: string, name?: string): Promise<FaviconImage | null> =>
  Cef.fetchFavicon(url, profile, name ?? null);

export const pruneFavicons = (profile: string, keep: string[]) => Cef.pruneFavicons(profile, keep);
