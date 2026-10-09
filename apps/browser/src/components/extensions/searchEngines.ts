import { searchEngineList } from "@arcadia/arcadiacore";
import { extensionEnginesFromChrome } from "@arcadia/core";
import { useBrowser } from "../../store/browser";
import { useExtensions } from "./state";

export function startExtensionSearchEngines() {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const read = new Set<string>();
  useExtensions.subscribe((e, prev) => {
    if (e.lists === prev.lists) return;
    for (const [profile, list] of Object.entries(e.lists)) {
      if (list === prev.lists[profile]) continue;
      clearTimeout(timers[profile]);
      timers[profile] = setTimeout(() => void refreshExtensionSearchEngines(profile), 400);
      if (!read.has(profile)) setTimeout(() => void refreshExtensionSearchEngines(profile), 3000);
      read.add(profile);
    }
  });
}

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
