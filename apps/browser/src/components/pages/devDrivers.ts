import { applyResult, applySafari, importArcSpace, importBookmarks, importTabs } from "../import/apply";
import { importModule } from "../import/module";
import { openImport, openSettings, useSettingsNav } from "../settings/windows";
import { useBookmarkDialog } from "../bookmarks/actions";
import { useBookmarkEditor } from "../bookmarks/edit";
import { useClearDataRequest } from "./ClearDataDialog";
import { openInternalPage } from "./urls";

/** DEV: the internal pages / settings / import pieces, for lib/devHarness (`nn.pages`). */
export const pagesDrivers = {
  openInternalPage,
  openSettings,
  openImport,
  settingsNav: useSettingsNav,
  importModule,
  bookmarkDialog: useBookmarkDialog,
  bookmarkEditor: useBookmarkEditor,
  clearDataRequest: useClearDataRequest,
  applyResult,
  applySafari,
  importArcSpace,
  importBookmarks,
  importTabs,
};
