// Copyright 2026 Netnyahoo. Apache-2.0.
//
// What the host shows, as Chrome's tab-activation consumers should see it.
//
// Chrome reads "this tab is in front" from its tab strip: one active tab per Browser. The host
// draws more and less than that: both panes of a split are on screen (one of them the strip's
// active tab), and its own pages (New Tab, History…) or another Space can cover the strip's
// active tab without the strip changing. The host says, per tab, whether it shows it
// (-[NNCoreTab noteShownByHost:]); a tab the host never reported keeps Chrome's reading.
//
// Consumers that follow the host's reading (hooks in engine/nncore/apply.sh):
// - automatic Picture in Picture (a call's own window): a shown tab counts as the active one, so
//   focusing a split's other pane never pops the call out, and leaving a page for one of the
//   host's own pops it out once;
// - permission prompts: a shown tab can prompt (a split's other pane too), a hidden one waits
//   for its page to show again (an open prompt stays with its page).
// - Chrome's tab-modal dialogs (TabDialogManager: FedCM, Ask before HTTP): up exactly while
//   their page is shown, so none stays over the host's own pages.
// Chrome's strip selection itself (extensions' active tab, keyboard commands, lifecycle focus)
// stays the strip's: a Browser always has an active tab, and the host's own pages aren't tabs.

#ifndef NETNYAHOO_CORE_NN_HOST_VISIBILITY_H_
#define NETNYAHOO_CORE_NN_HOST_VISIBILITY_H_

#include <optional>

namespace content {
class WebContents;
}

namespace nncore {

// The host shows (or stopped showing) `contents`. Consumers that changed their reading act at
// once (Chrome's automatic Picture in Picture, a permission prompt waiting for its page).
void NoteTabShownByHost(content::WebContents* contents, bool shown);

// The host's reading of `contents`, if it gave one.
std::optional<bool> ShownByHost(content::WebContents* contents);

// Installs the hooks' answers (once, at engine start).
void StartHostVisibility();

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_HOST_VISIBILITY_H_
