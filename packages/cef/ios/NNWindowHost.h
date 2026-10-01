#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::host {

bool Hostable(NNBrowserView *view);
void CreateTab(NNBrowserView *view, CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings);
bool CreateTabWithHistory(NNBrowserView *view, CefRefPtr<Client> client, CefRefPtr<CefBrowser> source, NSString *state,
                          NSString *url, const CefBrowserSettings &settings);
// Where CEF makes a popup's browser: a hosted Chrome tab's popups become tabs of its Chrome window
// (CEF_NN_POPUP_TABS); any other opener's (an extension popup or side panel, Alloy) go to the parking view,
// or CEF would give each its own on-screen window, left behind if nothing adopts the browser.
void ConfigurePopup(CefWindowInfo &info, NSSize size, CefRefPtr<CefBrowser> opener);
NSView *ContentsView(CefRefPtr<CefBrowser> browser);

void TabShown(NNBrowserView *view);
// A Chrome tab that closes while it's its window's active tab makes Chrome pick another; the app has
// already picked the page it shows (store/openers.ts), so that pick must not reach it as a tab switch.
void NoteClosingTab(CefRefPtr<CefBrowser> browser);
void TabGone(CefRefPtr<CefBrowser> browser);
bool PickedByClose(CefRefPtr<CefBrowser> browser);
bool ActivatingTab();
void TabMoved(NNBrowserView *view);
void TabOpenedFrom(CefRefPtr<CefBrowser> browser, int openerBrowserId);
void LayoutChanged(NSWindow *window);
int TabId(CefRefPtr<CefBrowser> browser);
bool IsChromeTab(CefRefPtr<CefBrowser> browser);

NSWindow *OpenWindowOf(CefRefPtr<CefBrowser> browser);
bool ReadoptTab(CefRefPtr<CefBrowser> browser, CefRefPtr<Client> client);

NSWindow *MakeChromeWindow(NSString *profile, bool popup = false);
NSWindow *GroupWindowForProfile(NSWindow *window, NSString *profile);
NSString *WindowProfile(NSWindow *window);
void WindowShown(NSWindow *window);
NSString *SwapStrategy();
bool CloseWindow(NSWindow *window);
NSString *ChromeWindowAction(NSWindow *window, NSString *action);
bool BlocksChromeCommand(CefRefPtr<CefBrowser> browser, int command_id);

CefRefPtr<CefClient> DefaultClient();

NSUInteger WindowCount();
NSArray<NSDictionary *> *WindowStates();
NSString *DevWindowAction(NSInteger windowNumber, NSString *action);
void CloseAll();
NSWindow *FullScreenWindow(NSWindow *window);
// Between -windowWillEnter/ExitFullScreen: and the matching Did, when AppKit ignores -toggleFullScreen:.
bool InFullScreenTransition(NSWindow *window);

}
