import { searchEngineList } from "@netnyahoo/cef";
import { extensionEnginesFromChrome } from "@netnyahoo/core";
import { useBrowser } from "../../store/browser";
import { useExtensions } from "./state";

/**
 * Search engines extensions add (`chrome_settings_overrides.search_provider`, e.g. DuckDuckGo's
 * extension) come from Chrome's own search engine list, which also decides whether one of them
 * controls the default engine. They're re-read whenever a profile's extension list changes
 * (installs from the Web Store, enabling, disabling, removing) and kept in settings
 * (`extensionSearchEngines`), where Settings › Search Engine and the command bar find them.
 */
export function startExtensionSearchEngines() {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const read = new Set<string>();
  useExtensions.subscribe((e, prev) => {
    if (e.lists === prev.lists) return;
    for (const [profile, list] of Object.entries(e.lists)) {
      if (list === prev.lists[profile]) continue;
      // The list also changes optimistically before Chrome acts (enable / disable): read
      // Chrome's engines once the changes settle.
      clearTimeout(timers[profile]);
      timers[profile] = setTimeout(() => void refreshExtensionSearchEngines(profile), 400);
      // Chrome registers extension engines once its search engine service has loaded, which
      // can be after the first read at launch.
      if (!read.has(profile)) setTimeout(() => void refreshExtensionSearchEngines(profile), 3000);
      read.add(profile);
    }
  });
}

/** Reads the profile's extension engines from Chrome and stores them when they changed. */
export async function refreshExtensionSearchEngines(profile: string) {
  let list: unknown;
  try {
    list = await searchEngineList(profile);
  } catch (error) {
    console.warn("[extensions] search engines failed", error);
    return;
  }
  if (list == null) return;
  const engines = extensionEnginesFromChrome(profile, list);
  const s = useBrowser.getState();
  const current = s.settings.extensionSearchEngines ?? [];
  const next = [...current.filter((e) => e.profile !== profile), ...engines];
  if (JSON.stringify(next) !== JSON.stringify(current)) s.updateSettings({ extensionSearchEngines: next });
}
