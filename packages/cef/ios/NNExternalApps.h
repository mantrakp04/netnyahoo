#pragma once

#import "NNCefInternal.h"

#include <string>

#include "include/cef_resource_request_handler.h"

namespace nn {
class Client;
}

// Links that leave the browser for another app (codex:, zoommtg:, mailto:…).
// Chromium hands these to CEF, which drops them unless the client allows OS
// execution, and allowing it would run Chrome's own dialog. We cancel the
// navigation instead and ask with our own prompt, following Chrome's policy.
namespace nn::external {

// Whether a navigation to |url| goes to an app rather than the engine. Any thread.
bool IsAppLink(const CefString &url);

// Cancels the navigation quietly (ERR_ABORTED, no error page). IO thread.
CefRefPtr<CefResourceRequestHandler> Canceller();

struct Navigation {
  NSString *url;
  // Serialized initiator origin; empty for the app's own navigations, "null" for opaque origins.
  NSString *initiator;
  std::string frameId;
  // The tab's own (main-frame) navigation: a tab opened just for it closes once the app opens.
  bool ownsTab = true;
  bool typed = false;
  // -1: look it up from OnBeforeBrowse.
  int userGesture = -1;
};

// OnBeforeBrowse: remembers the gesture of a navigation that may turn out to be an app link.
void NoteNavigation(int browserId, const std::string &frameId, NSString *url, bool userGesture);
// Input to a page lifts the flood block, as Chrome's ExternalProtocolObserver does.
void NoteUserInput();
void WatchUserInput();
void Handle(CefRefPtr<Client> client, const Navigation &navigation);
void Resolve(NSString *requestId, bool open, bool remember);
void BrowserClosed(int browserId);
// The prompt as a sheet, for windows without the app's UI (sized popups).
void ShowSheet(NSWindow *window, NSDictionary *request);

}
