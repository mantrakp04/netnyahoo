import * as permissions from "../site/permissions";
import { usePages } from "./pageState";
import * as splitActions from "./splitActions";
import * as tabDrag from "./tabDrag";
import { devPeeks, useDockMotion } from "./dockMotion";
import { useUrlAnchors } from "./windowLayout";

if (__DEV__) {
  (globalThis as { acLayout?: unknown }).acLayout = { pages: usePages, anchors: useUrlAnchors, toasts: splitActions.useToasts, splitActions, tabDrag, permissions, peek: devPeeks, dockMotion: useDockMotion };
}
