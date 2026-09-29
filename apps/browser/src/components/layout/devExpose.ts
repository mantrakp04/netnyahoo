import * as permissions from "../site/permissions";
import { usePages } from "./pageState";
import * as splitActions from "./splitActions";
import * as tabDrag from "./tabDrag";
import { useUrlAnchors } from "./windowLayout";

if (__DEV__) {
  (globalThis as { nnLayout?: unknown }).nnLayout = { pages: usePages, anchors: useUrlAnchors, toasts: splitActions.useToasts, splitActions, tabDrag, permissions };
}
