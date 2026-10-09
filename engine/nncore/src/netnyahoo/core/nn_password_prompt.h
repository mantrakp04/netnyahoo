// Chrome's password bubble, for the host's own UI: what it would show (JS PasswordPrompt,
// packages/cef/src/WebView.tsx) and the host's answer, as CEF's GetPasswordPrompt and
// ResolvePasswordPrompt (CEF's chrome_browser_host_impl.cc).

#ifndef NETNYAHOO_CORE_NN_PASSWORD_PROMPT_H_
#define NETNYAHOO_CORE_NN_PASSWORD_PROMPT_H_

#import <Foundation/Foundation.h>

namespace content {
class WebContents;
}

namespace nncore {

// {state: "save" | "update" | "saved", origin, username, passwordLength, federation,
// usernames}, or nil when the bubble would show nothing the host offers (no pending
// password, Chrome's other bubbles).
NSDictionary<NSString*, id>* PasswordPrompt(content::WebContents* contents);

// Chrome's bubble opening (OnBubbleShown), once the host took it.
void PasswordPromptShown(content::WebContents* contents);
// After the host heard of a "saved" confirmation: closed at once (it asks nothing).
void PasswordConfirmationShown(content::WebContents* contents);

// "save" / "update" (with the host's edits, empty: Chrome's), "never" (this site),
// "nope" (keep the old password), "dismiss"; each then closes the prompt as Chrome's
// bubble does. Anything else is ignored.
void ResolvePasswordPrompt(content::WebContents* contents,
                           NSString* action,
                           NSString* username,
                           NSString* password);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_PASSWORD_PROMPT_H_
