import { extensionActionStates } from "@arcadia/arcadiacore";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { browserIdOf, useExtensions, windowExtensions } from "./store";

// The toolbar's action states (icon, badge, title) for each window's active tab. One pass at a time: asking while one
// runs runs another right after it, so a tab switch mid-pass is never dropped and the last pass sees the latest tabs.
let running: Promise<void> | null = null;
let again = false;

export function refreshActionStates(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await pass();
      } while (again);
    } finally {
      running = null; // in the same turn as the last check of `again`: no request falls between
    }
  })();
  return running;
}

async function pass() {
  const s = useBrowser.getState();
  const { popup } = useExtensions.getState();
  await Promise.all(
    s.windowOrder.map(async (windowId) => {
      const ids = windowExtensions(s, windowId)
        .filter((x) => x.hasAction !== false && (x.pinned || popup?.extensionId === x.id))
        .map((x) => x.id);
      const browserId = browserIdOf(activeTabId(s, windowId));
      if (!ids.length || !browserId) return;
      const states = await extensionActionStates(browserId, ids).catch(() => null);
      const previous = useExtensions.getState().actions[browserId];
      if (!states || (previous && JSON.stringify(previous) === JSON.stringify(states))) return;
      useExtensions.setState((e) => ({ actions: { ...e.actions, [browserId]: states } }));
    }),
  );
}
