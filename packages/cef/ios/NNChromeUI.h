#pragma once

#import "NNCefInternal.h"

#if NN_CHROME_TABS && defined(CEF_NN_CHROME_UI)
#define NN_CHROME_UI 1
#include "include/cef_chrome_ui.h"
#include "include/cef_media_router.h"
#else
#define NN_CHROME_UI 0
#endif

namespace nn {
class Client;
}

namespace nn::chromeui {

NSDictionary *PasswordPrompt(CefRefPtr<CefBrowser> browser);
bool ShowPasswordPrompt(Client *client, CefRefPtr<CefBrowser> browser);
void ResolvePasswordPrompt(CefRefPtr<CefBrowser> browser, NSString *action, NSString *username,
                           NSString *password);

NSString *ExecuteExtensionAction(CefRefPtr<CefBrowser> browser, NSString *extensionId);

void ReleaseRouteWatches();

}
