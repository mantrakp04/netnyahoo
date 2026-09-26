// Hooks other files of the pod call into the extensions module. Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

#include "include/cef_request_context_handler.h"

namespace nn::ext {

/// A page Chrome opened outside our windows (a stray Chrome window, an extension's
/// tabs.create that no app window's Browser takes): the app opens it as a tab
/// ("tabs" event, action "open").
void EmitOpenTab(NSString *url, NSString *profile);

/// Request-context handler for `profile`'s contexts: Chrome's extension install prompts
/// (Web Store installs, re-enable, permission increases) go to the app's dialog
/// ("installPrompt" event, answered with +[NNExtensions resolveInstallPrompt:accepted:]).
CefRefPtr<CefRequestContextHandler> ContextHandler(NSString *profile);
#if NN_INSTALL_PROMPT
bool OnInstallPrompt(NSString *profile, CefRefPtr<CefBrowser> browser, const CefString &extensionId,
                     CefRefPtr<CefDictionaryValue> details, CefRefPtr<CefExtensionPromptCallback> callback);
#endif

}  // namespace nn::ext
