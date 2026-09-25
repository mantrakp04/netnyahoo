import { hasDockSelection, iconTheme, type IconTheme } from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { useFavicon, useFaviconTheme } from "./favicons";

export type TileTheme = { theme: IconTheme; image?: string; emoji?: string };

/** Emoji themes, per process: they're cheap and there are few. */
const emojiThemes = new Map<string, Promise<IconTheme | null>>();

/**
 * The theme Dia gives a selected pinned tile (DockSelection): from its custom
 * emoji, else its favicon (kept with the icon in lib/favicons). Null when the
 * icon has none (an SF Symbol, no favicon) or it isn't known yet.
 */
export function useTileTheme(url: string, favicon: string | null | undefined, customIcon: string | null | undefined, profileId: string): TileTheme | null {
  const emoji = customIcon && !customIcon.startsWith("symbol:") ? customIcon : null;
  const resolved = useFavicon(customIcon ? "" : url, favicon, profileId);
  const pageTheme = useFaviconTheme(customIcon ? "" : url, favicon, profileId);
  const [emojiTheme, setEmojiTheme] = useState<{ emoji: string; theme: IconTheme | null } | null>(null);
  useEffect(() => {
    if (!emoji || !hasDockSelection) return;
    let live = true;
    let pending = emojiThemes.get(emoji);
    if (!pending) emojiThemes.set(emoji, (pending = iconTheme({ emoji }).catch(() => null)));
    void pending.then((theme) => live && setEmojiTheme({ emoji, theme }));
    return () => {
      live = false;
    };
  }, [emoji]);
  if (emoji) return emojiTheme?.emoji === emoji && emojiTheme.theme ? { theme: emojiTheme.theme, emoji } : null;
  if (customIcon || !resolved || !pageTheme) return null;
  return { theme: pageTheme, image: resolved.uri };
}
