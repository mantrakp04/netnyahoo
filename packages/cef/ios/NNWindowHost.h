// Every app window is Chrome's own Browser window: a Chrome-style CefWindow
// (CefBrowserSettings.client_window) with our React root laid over Chrome's
// views (NNChromeWindow.mm; docs/research/chrome-hosted-window.md). An app window
// that shows several profiles is a group of such windows, one per profile, with
// the root in the one on screen. Chrome's dialogs, bubbles and menus are that
// window's children, so they show over it as in Chrome.
//
// Tabs are created and hosted through this file only. With the patched CEF
// (NN_CHROME_TABS, packages/cef/patches) they're tabs of their window's Browser
// whose WebContents NSView NNBrowserView hosts. With stock CEF (no client windows)
// and outside the app's browser windows (popup and PiP windows, extension popups)
// they're Alloy child browsers.
// Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::host {

/// Tabs are their window's own Chrome tabs (patched CEF) instead of Alloy child browsers.
bool ChromeTabs();

/// Whether `view` gets a tab of its window's Browser (else a standalone Alloy browser: extension
/// popups, popup/PiP windows, stock CEF).
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
/// `browser` is a popup Chrome opened from the tab with `openerBrowserId`: a tab of that tab's
/// Browser (NN_POPUP_TABS), until it moves to where the app shows it.
void TabOpenedFrom(CefRefPtr<CefBrowser> browser, int openerBrowserId);
/// Where pages sit in `window` changed (resize, split, sidebar): Chrome's tab-modal
/// dialogs and page-anchored bubbles follow the shown page.
void LayoutChanged(NSWindow *window);
/// Chrome's tab id (what chrome.tabs calls it), or 0 for Alloy browsers.
int TabId(CefRefPtr<CefBrowser> browser);
/// A tab of a Chrome window's Browser (Chrome style). Chrome closes those without DoClose
/// (window.close(), chrome.tabs.remove, their Browser closing).
bool IsChromeTab(CefRefPtr<CefBrowser> browser);

/// The app window of a Chrome tab's Browser, while it's open and shows tabs: where a tab the app
/// closed can come back (ReadoptTab). nil otherwise.
NSWindow *OpenWindowOf(CefRefPtr<CefBrowser> browser);
/// Hands a Chrome tab whose view is gone back to the app, as a new tab of its window (Chrome kept
/// it: "Leave site?" was cancelled). False if its window can't take it.
bool ReadoptTab(CefRefPtr<CefBrowser> browser, CefRefPtr<Client> client);

/// A Chrome Browser window for the app to put its views in (NNChromeWindow.mm), whose tabs are the
/// Browser's own (nil if the engine can't: not running, or without CEF_NN_CLIENT_WINDOW). `popup`:
/// a sized popup's window (titled, opaque, not part of an app window).
NSWindow *MakeChromeWindow(NSString *profile, bool popup = false);
/// Chrome-hosted windows of one app window, one per profile it shows (docs/research/
/// chrome-hosted-window.md › Profiles). The group's window for `profile`, made (off screen) if
/// needed; nil if `window` isn't Chrome-hosted.
NSWindow *GroupWindowForProfile(NSWindow *window, NSString *profile);
/// The profile of the Chrome window `window` (nil: not one).
NSString *WindowProfile(NSWindow *window);
/// Every Chrome-hosted window of `window`'s app window.
NSArray<NSWindow *> *GroupWindows(NSWindow *window);
/// `window` just took our views over from another window of its group.
void WindowShown(NSWindow *window);
/// How a Chrome-hosted app window changes profile windows: "transparent" (the window leaving is
/// translucent, so it shows nothing once our views leave it; the default when the engine has
/// CEF_NN_TRANSLUCENT_WINDOW), "snapshot" (a picture of the window covers the swap) or "naive".
/// NETNYAHOO_PROFILE_SWAP picks one.
NSString *SwapStrategy();
/// The app closes a Chrome-hosted window (see ChromeWindow::CloseLater): every window of its
/// group. False if it isn't one.
bool CloseWindow(NSWindow *window);
/// DEV: "hide" / "show" / "close" a Chrome-hosted window through CEF (its widget).
NSString *ChromeWindowAction(NSWindow *window, NSString *action);
/// The one filter of Chrome's shortcuts in Chrome-hosted windows: `command_id` is one of Chrome's
/// commands for its own UI (profile and app menus, toolbar focus, tab groups…) and `browser` is a
/// tab of such a window, so Chrome mustn't run it.
bool BlocksChromeCommand(CefRefPtr<CefBrowser> browser, int command_id);

/// Client for browsers Chrome creates without one of ours (new windows from extensions).
CefRefPtr<CefClient> DefaultClient();

/// Live Chrome windows (for engineInfo / leak checks).
NSUInteger WindowCount();
/// {profile, window, frame, alpha, key, visible, group, hasRoot, pageInsets…} per Chrome window (DEV checks).
NSArray<NSDictionary *> *WindowStates();
/// DEV: NNChromeWindowHost's input actions, or moves / resizes / minimises an app window (by window
/// number): "frame:x,y,w,h" (AppKit screen coordinates), "miniaturize", "deminiaturize",
/// "active:1|0" (the key state Chrome hears of: test instances are never key).
NSString *DevWindowAction(NSInteger windowNumber, NSString *action);
/// Forgets every Chrome window (shutdown).
void CloseAll();

}  // namespace nn::host
