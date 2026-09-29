#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::host {

bool ChromeTabs();

bool Hostable(NNBrowserView *view);
void CreateTab(NNBrowserView *view, CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings);
bool CreateTabWithHistory(NNBrowserView *view, CefRefPtr<Client> client, CefRefPtr<CefBrowser> source, NSString *state,
                          NSString *url, const CefBrowserSettings &settings);
void ConfigurePopup(CefWindowInfo &info, NSSize size);
NSView *ContentsView(CefRefPtr<CefBrowser> browser);

void TabShown(NNBrowserView *view);
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

}
