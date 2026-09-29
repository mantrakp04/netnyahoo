#pragma once

#import "NNCefInternal.h"

#include "include/cef_request_context_handler.h"

namespace nn::ext {

void EmitOpenTab(NSString *url, NSString *profile);

CefRefPtr<CefRequestContextHandler> ContextHandler(NSString *profile);
#if NN_INSTALL_PROMPT
bool OnInstallPrompt(NSString *profile, CefRefPtr<CefBrowser> browser, const CefString &extensionId,
                     CefRefPtr<CefDictionaryValue> details, CefRefPtr<CefExtensionPromptCallback> callback);
#endif

}
