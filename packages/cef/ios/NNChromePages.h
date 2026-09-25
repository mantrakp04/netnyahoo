// Hidden pages we script to reach Chrome's own stores and APIs:
// - chrome:// WebUI pages (chrome://extensions → developerPrivate / management,
//   chrome://password-manager → passwordsPrivate, chrome://settings →
//   autofillPrivate / settingsPrivate), each in a Chrome-style browser in a CEF
//   Views window that is never shown;
// - an extension's own context (chrome-extension://<id>/manifest.json in a
//   hidden Alloy browser), which runs none of its code but has its chrome.* APIs
//   (action state, runtime.sendMessage to its service worker, uninstallSelf).
// Both close themselves after a while without work. Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

namespace nn::pages {

typedef void (^EvalCompletion)(id _Nullable value, NSString *_Nullable error);

/// Incognito windows share their extensions and saved data with the default profile.
NSString *DataProfile(NSString *profile);

/// `format` with %@ placeholders filled by JSON-encoded arguments.
NSString *Script(NSString *format, NSArray *args);

/// Runs `expression` (a promise is awaited; the result comes back by value) in the
/// profile's hidden `url` page ("chrome://extensions/", "chrome://password-manager/"…).
void WebUIEval(NSString *profile, NSString *url, NSString *expression, EvalCompletion completion);
/// The next file dialog the profile's `url` page opens picks `path` (developerPrivate.loadUnpacked).
void SetWebUIDialogPath(NSString *profile, NSString *url, NSString *path);

/// Runs `expression` in the extension's own context page.
void ExtensionEval(NSString *profile, NSString *extensionId, NSString *expression, EvalCompletion completion);
/// Drops a cached extension context (after the extension was disabled, reloaded…).
void CloseExtensionContext(NSString *profile, NSString *extensionId);

/// Closes every hidden page (shutdown).
void CloseAll();

/// Calls `ready` (main queue) once the profile's request context has loaded: Chrome-style
/// browser views in windows that aren't shown are only created right away after that.
/// It also stops Chrome's session restore from reopening our hidden windows.
void WhenProfileReady(NSString *profile, void (^ready)(CefRefPtr<CefRequestContext> context));

}  // namespace nn::pages
