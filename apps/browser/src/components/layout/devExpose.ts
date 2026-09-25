import * as permissions from "../site/permissions";
import { usePages } from "./pageState";
import * as splitActions from "./splitActions";
import * as tabDrag from "./tabDrag";
import { useUrlAnchors } from "./windowLayout";

/** DEV: the layout area's own stores and actions, for lib/devHarness scripts (`globalThis.nnLayout`). */
if (__DEV__) {
  (globalThis as { nnLayout?: unknown }).nnLayout = { pages: usePages, anchors: useUrlAnchors, toasts: splitActions.useToasts, splitActions, tabDrag, permissions };
}
