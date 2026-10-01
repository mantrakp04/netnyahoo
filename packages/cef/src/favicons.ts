import { engineCall } from "./engine";
import { Cef } from "./native";

export type FaviconImage = { uri: string; width: number; height: number };

// Chrome's FaviconService keeps icons: Chrome saves a page's icon when the page shows it and drops it with the
// page's history. `uri`s are data URIs.

/** Icons for pages (with Chrome's fallback to the host's) and for icon URLs, at about `size` pixels. */
export async function faviconsFor(profile: string, pages: string[], icons: string[] = [], size = 32) {
  const result = await engineCall<{ pages: Record<string, { png: string; icon: string }>; icons: Record<string, { png: string }> }>(
    "nn_favicons_get",
    profile,
    { pages, icons, size },
  );
  const uri = (png: string) => `data:image/png;base64,${png}`;
  return {
    pages: new Map(Object.entries(result.pages).map(([page, r]) => [page, { uri: uri(r.png), icon: r.icon }])),
    icons: new Map(Object.entries(result.icons).map(([icon, r]) => [icon, uri(r.png)])),
  };
}

/** Fetches an icon (no cookies) and, for a page Chrome has no icon for (a bookmark never visited), keeps it there. */
export async function fetchFavicon(url: string, profile: string, page?: string): Promise<FaviconImage | null> {
  const image = await Cef.fetchFavicon(url, profile);
  const png = image?.uri.startsWith("data:image/png;base64,") ? image.uri.slice(22) : null;
  if (page && png) await engineCall("nn_favicons_set", profile, { page, icon: url, png }).catch(() => null);
  return image;
}

/** Deletes the PNG folder the app kept icons in before Chrome's store did. */
export const removeLegacyFavicons = (profile: string) => Cef.removeLegacyFavicons(profile);
