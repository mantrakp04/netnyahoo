// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_zoom.h"

#include <cmath>

#include "base/callback_list.h"
#include "base/functional/bind.h"
#include "content/public/browser/host_zoom_map.h"
#include "third_party/blink/public/common/page/page_zoom.h"

namespace netnyahoo {
namespace {

content::HostZoomMap* ZoomMap(Profile* profile) {
  return content::HostZoomMap::GetDefaultForBrowserContext(profile);
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
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_zoom_list) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StateFor<netnyahoo::ZoomState>(call.profile());
  content::HostZoomMap* map = netnyahoo::ZoomMap(call.profile());
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

NN_ENGINE_CALL(nn_zoom_set) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StateFor<netnyahoo::ZoomState>(call.profile());
  const std::string host = call.String("host");
  const double level = call.Double("level");
  if (host.empty() || !std::isfinite(level)) {
    return call.TakeReply().Error("host and level required");
  }
  content::HostZoomMap* map = netnyahoo::ZoomMap(call.profile());
  // As chrome://settings removes a site's zoom: the default level erases it.
  map->SetZoomLevelForHost(
      host, blink::ZoomValuesEqual(level, 0) ? map->GetDefaultZoomLevel()
                                             : level);
  call.TakeReply().Ok();
}
