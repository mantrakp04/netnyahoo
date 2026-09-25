// Every app window gets a hidden "ghost" Chrome window (one per profile shown in
// it) holding a real Chrome `Browser`: TabStripModel, the extensions tabs/windows
// APIs, Chrome's own dialogs and bubbles. The ghost is invisible (alpha 0,
// click-through, never key, never activates the app) and kept exactly behind the
// app window as a child window, so it follows moves, resizes, Spaces, full screen
// and minimising, and Chrome places its window-anchored UI over our window.
//
// Tabs are created and hosted through this file only. With stock CEF they are
// Alloy child browsers (the ghost's Browser can't host a tab in our views);
// with the patched CEF (NN_CHROME_TABS, packages/cef/patches) they're tabs of the
// ghost's Browser whose WebContents NSView NNBrowserView hosts. Then the ghost is
// made by its window's first tab of a profile (no placeholder tab for extensions
// to see) and closes with its last one, as a Chrome window does.
// Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::host {

/// Tabs are the ghost Browser's own Chrome tabs (patched CEF) instead of Alloy child browsers.
bool ChromeTabs();

/// The view joined a window. Stock CEF: makes sure the window has its ghost for the
/// view's profile. Chrome tabs: the first tab of a profile creates the ghost instead.
void Attach(NNBrowserView *view);
/// Whether `view` gets a tab of its window's ghost Browser (else a standalone Alloy browser:
/// extension popups, popup/PiP windows).
bool Hostable(NNBrowserView *view);
/// Creates `view`'s tab browser; `client` gets OnAfterCreated.
void CreateTab(NNBrowserView *view, CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings);
/// Creates `view`'s tab with a back/forward list: a copy of `source`'s tab (Duplicate), or the
/// list in `state` (a closed tab's GetNavigationState, for Reopen Closed Tab). A source in another
/// window or profile is restored from its list instead. Falls back to CreateTab with `url` when the
/// engine can't. False if neither is usable (nothing was started).
bool CreateTabWithHistory(NNBrowserView *view, CefRefPtr<Client> client, CefRefPtr<CefBrowser> source, NSString *state,
                          NSString *url, const CefBrowserSettings &settings);
/// Popup browsers the engine creates for window.open & co., before a view adopts them.
void ConfigurePopup(CefWindowInfo &info, NSSize size);
/// The NSView showing a tab browser's page, for its NNBrowserView to host.
NSView *ContentsView(CefRefPtr<CefBrowser> browser);

/// The view's page is the one its window shows (or was focused): Chrome's active tab
/// (extensions' activeTab and tabs.query), and where Chrome centers its tab dialogs.
void TabShown(NNBrowserView *view);
/// Inside TabShown's Chrome activation, which focuses the tab (not the user focusing it).
bool ActivatingTab();
/// The view's browser is now shown in another window: moves the Chrome tab to that
/// window's Browser (same browser, history and page).
void TabMoved(NNBrowserView *view);
/// Where pages sit in `window` changed (resize, split, sidebar): Chrome's tab-modal
/// dialogs and page-anchored bubbles follow the shown page.
void LayoutChanged(NSWindow *window);
/// Chrome's tab id (what chrome.tabs calls it), or 0 for Alloy browsers.
int TabId(CefRefPtr<CefBrowser> browser);
/// A tab of a ghost Browser (Chrome style). Chrome closes those without DoClose
/// (window.close(), chrome.tabs.remove, their Browser closing).
bool IsChromeTab(CefRefPtr<CefBrowser> browser);

/// The app window of a Chrome tab's Browser, while it's open and shows tabs: where a tab the app
/// closed can come back (ReadoptTab). nil otherwise.
NSWindow *OpenWindowOf(CefRefPtr<CefBrowser> browser);
/// Hands a Chrome tab whose view is gone back to the app, as a new tab of its window (Chrome kept
/// it: "Leave site?" was cancelled). False if its window can't take it.
bool ReadoptTab(CefRefPtr<CefBrowser> browser, CefRefPtr<Client> client);

/// Keys the page and our menus didn't handle: Chrome shortcuts extensions registered
/// (chrome.commands) run in the key window's ghost. YES if one did.
bool ForwardKeyEvent(NSEvent *event, NSString *profile);
/// Keybindings of enabled extensions changed (re-read lazily).
void InvalidateExtensionCommands(NSString *profile);

/// Chrome-hosted window spike (NETNYAHOO_CHROME_WINDOW, NNChromeWindow.mm): a visible Chrome
/// Browser window for the app to put its views in, whose tabs are the Browser's own (nil if the
/// engine isn't running).
NSWindow *MakeHostingWindow(NSString *profile);
/// `command_id` is one of Chrome's commands for its own (hidden) toolbar and tab strip UI, and
/// `browser` is a tab of a hosting window: Chrome mustn't run it there.
bool BlocksChromeCommand(CefRefPtr<CefBrowser> browser, int command_id);

/// Client for browsers Chrome creates without one of ours (new windows from extensions).
CefRefPtr<CefClient> DefaultClient();

/// Live ghost windows (for engineInfo / leak checks).
NSUInteger GhostCount();
/// {parentWindow, frame, parentFrame, alpha, key, visible, childOfParent, level} per ghost (DEV checks).
NSArray<NSDictionary *> *GhostStates();
/// DEV: moves / resizes / minimises an app window (by window number) to check its ghost follows:
/// "frame:x,y,w,h" (AppKit screen coordinates), "miniaturize", "deminiaturize", "active:1|0" (the key
/// state its ghosts report to Chrome); or sends it a key
/// the page didn't handle, "key:<modifier flags>:<character>".
NSString *DevWindowAction(NSInteger windowNumber, NSString *action);
/// Closes every ghost (shutdown).
void CloseAll();

}  // namespace nn::host
