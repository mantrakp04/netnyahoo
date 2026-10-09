// Extension popups and side panels the host shows in its own views: Chrome's
// ExtensionViewHost (the page's process, its extension APIs, Esc and window.close()), bound
// to the Browser of the app window they open in, as Chrome's ExtensionPopup is bound to its
// window's. So chrome.windows' current window is that window, and the active tab its tab.

#ifndef ARCADIA_CORE_AC_EXTENSION_VIEW_H_
#define ARCADIA_CORE_AC_EXTENSION_VIEW_H_

class Browser;
class GURL;

namespace content {
class WebContents;
}

namespace gfx {
class Size;
}

namespace arcadiacore {

enum class ExtensionViewKind { kPopup, kSidePanel };

// The view's page (its TabBridge's ArcadiaCoreTab is what the host attaches), or null: no such
// enabled extension, or one that can't run in the Browser's (private) profile. It lives
// until the host closes it (CloseExtensionView), Chrome closes it (the host hears
// tabWillClose:), or the Browser goes.
content::WebContents* OpenExtensionView(Browser* browser,
                                        const GURL& url,
                                        ExtensionViewKind kind);

// True if `contents` is one of these views: it closes soon after (never inside this call).
bool CloseExtensionView(content::WebContents* contents);

// Before Chrome tears profiles down (each view's host keeps its extension's renderer alive).
void CloseAllExtensionViews();

// A popup's own size, as Chrome's popup sizes itself (auto-resize, 25×25 to 800×600): empty
// until its page has laid out, and for side panels and other pages.
gfx::Size ExtensionPopupPreferredSize(content::WebContents* contents);

// chrome.action.openPopup() for the host's Browsers (the hook in Chrome's
// extension_action_api.cc, engine/arcadiacore/apply.sh): the host shows the popup
// (engine:extensionActionPopup:tab:) and Chrome answers the extension once its page loaded.
void InstallActionPopupHook();

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_EXTENSION_VIEW_H_
