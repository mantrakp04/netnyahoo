// Chrome's own UI surfaces that the app draws instead (WP4 of
// docs/research/chromium-ui-layer.md): the password save/update prompt and
// extension toolbar actions. Chrome would anchor these to its toolbar, which the
// ghost window hides. Each needs a hook of our CEF build (NNCefInternal.h); without
// it Chrome's own bubble shows, or the action isn't available.
// Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::chromeui {

/// What Chrome's password bubble would show for `browser`'s page now (the "passwordPrompt"
/// payload), nil if nothing (or a state the app leaves to Chrome).
NSDictionary *PasswordPrompt(CefRefPtr<CefBrowser> browser);
/// Chrome is about to show its password bubble for `browser`'s page
/// (IDC_MANAGE_PASSWORDS_FOR_PAGE): emits "passwordPrompt" and returns true when the
/// app's prompt shows instead.
bool ShowPasswordPrompt(Client *client, CefRefPtr<CefBrowser> browser);
/// The user answered the app's prompt. `action`: "save" | "update" | "never" | "nope" | "dismiss";
/// `username` / `password` (optional) replace what Chrome captured (the prompt lets you edit them).
void ResolvePasswordPrompt(CefRefPtr<CefBrowser> browser, NSString *action, NSString *username,
                           NSString *password);

/// Clicks an extension's toolbar button on `browser`'s tab, as Chrome's toolbar does
/// (grants activeTab, runs action.onClicked, or blocked content scripts). Returns what
/// the app should show: "none", "popup" or "sidePanel"; nil if this engine can't.
NSString *ExecuteExtensionAction(CefRefPtr<CefBrowser> browser, NSString *extensionId);

}  // namespace nn::chromeui
