// Copyright 2026 Netnyahoo. Apache-2.0.

#include "netnyahoo/core/nn_host_visibility.h"

#include "components/permissions/permission_request_manager.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"
#include "netnyahoo/core/nn_picture_in_picture.h"

// The hooks (engine/nncore/apply.sh): 1 shown, 0 hidden, -1 the host never said.
extern int (*g_netnyahoo_tab_shown_by_host)(content::WebContents*);
extern int (*g_netnyahoo_permission_tab_shown)(content::WebContents*);
// Chrome's automatic Picture in Picture reads the tab's state again (apply.sh).
void NetnyahooAutoPictureInPictureHostVisibilityChanged(content::WebContents* contents);

namespace nncore {

namespace {

class HostVisibility : public content::WebContentsUserData<HostVisibility> {
 public:
  bool shown() const { return shown_; }
  void set_shown(bool shown) { shown_ = shown; }

 private:
  explicit HostVisibility(content::WebContents* contents)
      : content::WebContentsUserData<HostVisibility>(*contents) {}
  friend class content::WebContentsUserData<HostVisibility>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  bool shown_ = false;
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(HostVisibility);

int Answer(content::WebContents* contents) {
  std::optional<bool> shown = ShownByHost(contents);
  return shown ? *shown : -1;
}

}  // namespace

std::optional<bool> ShownByHost(content::WebContents* contents) {
  HostVisibility* state = contents ? HostVisibility::FromWebContents(contents) : nullptr;
  return state ? std::optional<bool>(state->shown()) : std::nullopt;
}

void NoteTabShownByHost(content::WebContents* contents, bool shown) {
  if (!contents || ShownByHost(contents) == shown) {
    return;
  }
  HostVisibility::CreateForWebContents(contents);
  HostVisibility::FromWebContents(contents)->set_shown(shown);
  TraceAutoPictureInPictureInputs(contents, shown ? "host shows tab" : "host hides tab");
  // Chrome's reading changed only for the consumers that follow the host's: each reads it again
  // (a call shown no more pops out, shown again its window closes; a prompt waiting for its page
  // comes up).
  NetnyahooAutoPictureInPictureHostVisibilityChanged(contents);
  if (auto* prompts = permissions::PermissionRequestManager::FromWebContents(contents)) {
    prompts->OnVisibilityChanged(contents->GetVisibility());
  }
}

void StartHostVisibility() {
  g_netnyahoo_tab_shown_by_host = &Answer;
  g_netnyahoo_permission_tab_shown = &Answer;
}

}  // namespace nncore
