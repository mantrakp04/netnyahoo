import { iconTheme, type IconTheme } from "@arcadia/shell";
import { useEffect, useState } from "react";
import { useAppearanceDark, useFavicon, useFaviconTheme } from "./favicons";

export type TileTheme = { theme: IconTheme; image?: string; emoji?: string };

const emojiThemes = new Map<string, Promise<IconTheme | null>>();

export function useTileTheme(url: string, favicon: string | null | undefined, customIcon: string | null | undefined, profileId: string): TileTheme | null {
  const emoji = customIcon && !customIcon.startsWith("symbol:") ? customIcon : null;
  useAppearanceDark();
  const resolved = useFavicon(customIcon ? "" : url, favicon, profileId);
  const pageTheme = useFaviconTheme(customIcon ? "" : url, favicon, profileId);
  const [emojiTheme, setEmojiTheme] = useState<{ emoji: string; theme: IconTheme | null } | null>(null);
  useEffect(() => {
    if (!emoji) return;
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
