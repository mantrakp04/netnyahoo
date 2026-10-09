// Copyright 2026 Arcadia. Apache-2.0.

#include "chrome/browser/arcadia/ac_zoom.h"

#include <cmath>

#include "base/callback_list.h"
#include "base/functional/bind.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/host_zoom_map.h"
#include "third_party/blink/public/common/page/page_zoom.h"

namespace arcadia {
namespace {

content::HostZoomMap* ZoomMap(Profile* profile) {
  return content::HostZoomMap::GetDefaultForBrowserContext(profile);
}

// The profile whose zoom map a call means: the profile at |profile_dir|, or,
// with "tab", that tab's own profile (a private window's off-the-record
// profile, whose zoom map lives and dies with the private session, as in
// Chrome's incognito). Null if the tab is gone.
Profile* ZoomProfile(const Call& call) {
  std::optional<int> tab = call.args().FindInt("tab");
  if (!tab) {
    return call.profile();
  }
  // Every Browser's tabs, private ones included: CEF's private profiles are
  // off-the-record profiles of their own, which chrome.tabs' lookup (the
  // primary off-the-record profile only) doesn't search.
  Profile* found = nullptr;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [&](BrowserWindowInterface* window) {
        TabStripModel* strip = window->GetTabStripModel();
        for (int i = 0; strip && i < strip->count(); ++i) {
          content::WebContents* contents = strip->GetWebContentsAt(i);
          if (extensions::ExtensionTabUtil::GetTabId(contents) == *tab) {
            found = Profile::FromBrowserContext(contents->GetBrowserContext());
            return false;
          }
        }
        return true;
      });
  // Only a tab of the profile the call names, or of one of its private
  // profiles; a private session's call ("offTheRecord"), only its own tabs.
  if (!found) {
    return nullptr;
  }
  if (call.profile()->IsOffTheRecord()) {
    return found == call.profile() ? found : nullptr;
  }
  return found->GetOriginalProfile() == call.profile() ? found : nullptr;
}

// Tells the app about every host zoom change in the profile.
class ZoomState : public ProfileState {
 public:
  explicit ZoomState(Profile* profile) : ProfileState(profile) {
    subscription_ = ZoomMap(profile)->AddZoomLevelChangedCallback(
        base::BindRepeating(&ZoomState::Changed, base::Unretained(this)));
  }

 private:
  void Release() override { subscription_ = {}; }

  void Changed(const content::HostZoomMap::ZoomLevelChange& change) {
    if (change.mode != content::HostZoomMap::ZOOM_CHANGED_FOR_HOST) {
      return;
    }
    Emit("zoom.changed", profile(),
         base::DictValue()
             .Set("host", change.host)
             .Set("level", change.zoom_level));
  }

  base::CallbackListSubscription subscription_;
};

}  // namespace
}  // namespace arcadia

AC_ENGINE_CALL(ac_zoom_list) {
  arcadia::Call call(profile_dir, args_json, reply, context,
                       arcadia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  Profile* profile = arcadia::ZoomProfile(call);
  if (!profile) {
    return call.TakeReply().Error("no such tab");
  }
  arcadia::StateFor<arcadia::ZoomState>(profile);
  content::HostZoomMap* map = arcadia::ZoomMap(profile);
  const double fallback = map->GetDefaultZoomLevel();
  base::DictValue levels;
  for (const auto& entry : map->GetAllZoomLevels()) {
    if (entry.mode == content::HostZoomMap::ZOOM_CHANGED_FOR_HOST &&
        !blink::ZoomValuesEqual(entry.zoom_level, fallback)) {
      levels.Set(entry.host, entry.zoom_level);
    }
  }
  call.TakeReply().Send(base::DictValue().Set("levels", std::move(levels)));
}

AC_ENGINE_CALL(ac_zoom_set) {
  arcadia::Call call(profile_dir, args_json, reply, context,
                       arcadia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  Profile* profile = arcadia::ZoomProfile(call);
  if (!profile) {
    return call.TakeReply().Error("no such tab");
  }
  arcadia::StateFor<arcadia::ZoomState>(profile);
  const std::string host = call.String("host");
  const double level = call.Double("level");
  if (host.empty() || !std::isfinite(level)) {
    return call.TakeReply().Error("host and level required");
  }
  content::HostZoomMap* map = arcadia::ZoomMap(profile);
  // As chrome://settings removes a site's zoom: the default level erases it.
  map->SetZoomLevelForHost(
      host, blink::ZoomValuesEqual(level, 0) ? map->GetDefaultZoomLevel()
                                             : level);
  call.TakeReply().Ok();
}
