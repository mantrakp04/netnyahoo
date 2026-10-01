// Chrome's page context menu in the host's tabs, plus the host's own items (CEF added them
// through CefContextMenuHandler): "Search <engine> for “…”" and the like, for a selection.

#ifndef NETNYAHOO_CORE_NN_CONTEXT_MENU_H_
#define NETNYAHOO_CORE_NN_CONTEXT_MENU_H_

#include <memory>

namespace content {
class WebContents;
class WebContentsViewDelegate;
}  // namespace content

namespace nncore {

// Chrome's own view delegate for tabs Chrome hosts; ours (with the host's items) for the
// host's.
std::unique_ptr<content::WebContentsViewDelegate> CreateViewDelegate(
    content::WebContents* contents);

// In background mode (NETNYAHOO_BACKGROUND, as the app's hidden test runs) a menu is
// reported to the host (tab:didShowContextMenu:) instead of shown.
void InstallContextMenuShowHandler();

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_CONTEXT_MENU_H_
