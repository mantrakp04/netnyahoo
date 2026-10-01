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
void TabMoved(NNBrowserView *view);
// Tab strips (NNTabStrip): the id of the Chrome window that holds the tab as far as the app knows (0 when it's not
// a hosted tab); a strip's profile and app window (the strips of one app window share it); the tab is in that
// strip now (an extension moved it).
int StripOf(CefRefPtr<CefBrowser> browser);
bool StripInfo(int strip, NSString **profile, int *window);
void NoteStrip(int browserId, int strip);
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
