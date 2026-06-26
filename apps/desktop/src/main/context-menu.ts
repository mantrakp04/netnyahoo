import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  webContents,
} from "electron";
import type {
  ContextMenuParams,
  MenuItemConstructorOptions,
  WebContents,
} from "electron";
import {
  BROWSER_SAVE_PAGE_CHANNEL,
  BROWSER_VIEW_SOURCE_CHANNEL,
} from "../shared/browser-commands";

/**
 * Native right-click menus for web pages.
 *
 * A `<webview>` ships no context menu of its own, so right-clicking inside a
 * page does nothing until we listen for the `context-menu` event on its
 * `webContents` and pop a menu ourselves. We attach to every webview created in
 * the app (the React chrome keeps its own behavior).
 */
export function registerWebviewContextMenus() {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.on("context-menu", (_e, params) => {
      const menu = Menu.buildFromTemplate(buildTemplate(contents, params));
      const win = BrowserWindow.fromWebContents(contents) ?? undefined;
      menu.popup(win ? { window: win } : {});
    });
  });

  // The View Source keybind shares the context menu's source window — the
  // renderer holds the active tab's URL, so it asks main to open it here.
  ipcMain.on(BROWSER_VIEW_SOURCE_CHANNEL, (_event, url: unknown) => {
    if (typeof url === "string") openViewSource(url);
  });

  // The Save Page keybind reuses the context menu's Save As… flow. The renderer
  // sends the guest's webContents id (the <webview> tag can't savePage itself),
  // which main resolves back to the live contents to write the document.
  ipcMain.on(BROWSER_SAVE_PAGE_CHANNEL, (_event, webContentsId: unknown) => {
    if (typeof webContentsId !== "number") return;
    const contents = webContents.fromId(webContentsId);
    if (contents) void savePageAs(contents, contents.getURL());
  });
}

function buildTemplate(
  contents: WebContents,
  params: ContextMenuParams,
): MenuItemConstructorOptions[] {
  const nav = contents.navigationHistory;
  const items: MenuItemConstructorOptions[] = [
    { label: "Back", enabled: nav.canGoBack(), click: () => nav.goBack() },
    {
      label: "Forward",
      enabled: nav.canGoForward(),
      click: () => nav.goForward(),
    },
    { label: "Reload", click: () => contents.reload() },
  ];

  if (params.linkURL) {
    items.push(
      { type: "separator" },
      {
        label: "Open Link in Browser",
        click: () => shell.openExternal(params.linkURL),
      },
      {
        label: "Copy Link Address",
        click: () => clipboard.writeText(params.linkURL),
      },
    );
  }

  if (params.mediaType === "image" && params.srcURL) {
    items.push(
      { type: "separator" },
      { label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) },
      {
        label: "Copy Image Address",
        click: () => clipboard.writeText(params.srcURL),
      },
      {
        label: "Save Image As…",
        click: () => contents.downloadURL(params.srcURL),
      },
    );
  }

  if (params.isEditable) {
    items.push(
      { type: "separator" },
      { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
      { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
      { label: "Paste", role: "paste", enabled: params.editFlags.canPaste },
      { label: "Select All", role: "selectAll" },
    );
  } else if (params.selectionText) {
    items.push({ type: "separator" }, { label: "Copy", role: "copy" });
  }

  items.push(
    { type: "separator" },
    { label: "Save As…", click: () => void savePageAs(contents, params.pageURL) },
    { label: "Print…", click: () => contents.print() },
    { type: "separator" },
    {
      label: "View Page Source",
      click: () => openViewSource(params.pageURL),
    },
    {
      label: "Inspect Element",
      click: () => contents.inspectElement(params.x, params.y),
    },
  );

  return items;
}

async function savePageAs(contents: WebContents, pageURL: string) {
  const win = BrowserWindow.fromWebContents(contents) ?? undefined;
  const { canceled, filePath } = await dialog.showSaveDialog(
    win ?? BrowserWindow.getAllWindows()[0]!,
    { defaultPath: suggestFileName(pageURL) },
  );
  if (canceled || !filePath) return;
  await contents.savePage(filePath, "HTMLComplete");
}

function openViewSource(pageURL: string) {
  if (!pageURL) return;
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: "Source",
    backgroundColor: "#1a1a1e",
  });
  win.loadURL(`view-source:${pageURL}`);
}

function suggestFileName(pageURL: string) {
  try {
    const { hostname, pathname } = new URL(pageURL);
    const last = pathname.split("/").filter(Boolean).pop();
    const base = last && last.includes(".") ? last : `${hostname || "page"}.html`;
    return base;
  } catch {
    return "page.html";
  }
}
