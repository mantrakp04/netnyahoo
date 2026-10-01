#pragma once

#import "NNCefInternal.h"

// Chrome's tab strips as the app sees them (docs/store-api.md › "Live tabs"). Chrome commits every change to a
// strip; this reports each to JS as one revisioned transaction that names its cause: the JS command that made it,
// the app's own engine call (`cmd` -1: a tab created, moved to another window, a page command), or none when
// Chrome did it on its own (an extension, a closing tab's successor, a focus request). JS never guesses.
namespace nn::strip {

// CefLifeSpanHandler::OnTabStripChanged, for every tab of every hosted Chrome window, from TabRouter and Client.
void Report(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned);
// The browser is gone (OnBeforeClose): its strip loses it, even if no other tab is left to report.
void Closed(CefRefPtr<CefBrowser> browser);
// A view shows the browser: its tab carries the view's transferKey (the app's tab id) from now on, also while
// the browser waits between views (a tab moving to another window).
void Bind(CefRefPtr<CefBrowser> browser, NSString *key);
// A hosted Chrome window closed.
void WindowClosed(int strip);

// Runs `block` as the app's own engine call: whatever Chrome does to strips inside it is attributed to the app.
void AsApp(void (^block)(void));
// Inside a command or an app call (focus that follows an activation the app asked for isn't the user's).
bool InCommand();

void RunCommand(NSInteger cmd, NSDictionary *command);
NSDictionary *Snapshot();

}
