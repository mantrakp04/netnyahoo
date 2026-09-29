import { WindowProfile as NativeWindowProfile } from "@netnyahoo/shell";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { engineProfile } from "../../store/model";

/**
 * An app window is one Chrome window per profile (docs/research/chrome-hosted-window.md › Profiles):
 * the one of the profile shown takes the window over, and its neighbours in profile order are made
 * ahead. Rendered with the window's views, so the swap waits for the commit that lays the profile out
 * (lib/native does it from the store in builds without the native view).
 */
export function WindowProfile() {
  const windowId = useWindowId();
  const [profile, neighbours] = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      if (!w) return ["", "[]"];
      const at = w.incognito ? -1 : s.profileOrder.indexOf(w.profileId);
      const next = at < 0 ? [] : [s.profileOrder[at - 1], s.profileOrder[at + 1]].filter((p): p is string => !!p).map(engineProfile);
      // A string, so the selector's result compares by value (the default profile's name is "").
      return [engineProfile(w.profileId), JSON.stringify(next)];
    }),
  );
  if (!NativeWindowProfile) return null;
  return <NativeWindowProfile profile={profile} neighbours={JSON.parse(neighbours) as string[]} style={{ position: "absolute", width: 0, height: 0 }} />;
}
