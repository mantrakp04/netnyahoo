// Copyright 2026 Arcadia. Apache-2.0.

#include "arcadia/core/ac_desktop_capture.h"

#include "base/logging.h"
#include "base/time/time.h"
#include "content/public/browser/desktop_media_id.h"
#include "content/public/browser/desktop_streams_registry.h"
#include "content/public/browser/media_stream_request.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"
#include "arcadia/core/ac_page_channel.h"
#include "third_party/blink/public/common/mediastream/media_stream_request.h"
#include "url/origin.h"

namespace arcadiacore {

namespace {

constexpr base::TimeDelta kGrantLifetime = base::Seconds(15);

class DesktopCaptureGrant : public content::WebContentsUserData<DesktopCaptureGrant> {
 public:
  ~DesktopCaptureGrant() override = default;

  std::string source;
  std::string frame_id;
  std::string origin;
  base::TimeTicks granted_at;

 private:
  friend class content::WebContentsUserData<DesktopCaptureGrant>;
  explicit DesktopCaptureGrant(content::WebContents* contents)
      : content::WebContentsUserData<DesktopCaptureGrant>(*contents) {}
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(DesktopCaptureGrant);

}  // namespace

void AllowDesktopCapture(content::WebContents* contents,
                         const std::string& source,
                         const std::string& frame_id,
                         const std::string& origin) {
  if (!contents || source.empty()) {
    return;
  }
  DesktopCaptureGrant::CreateForWebContents(contents);
  DesktopCaptureGrant* grant = DesktopCaptureGrant::FromWebContents(contents);
  grant->source = source;
  grant->frame_id = frame_id;
  grant->origin = origin;
  grant->granted_at = base::TimeTicks::Now();
}

void ApplyDesktopCaptureGrant(content::WebContents* contents,
                              content::MediaStreamRequest& request) {
  if (request.video_type != blink::mojom::MediaStreamType::GUM_DESKTOP_VIDEO_CAPTURE ||
      request.request_type == blink::MEDIA_DEVICE_UPDATE ||
      request.requested_video_device_ids.empty() ||
      request.requested_video_device_ids.front().empty()) {
    return;
  }
  DesktopCaptureGrant* found = DesktopCaptureGrant::FromWebContents(contents);
  if (!found) {
    return;
  }
  // One request per approval, whether or not it matches.
  const std::string source = found->source;
  const std::string frame_id = found->frame_id;
  const std::string origin = found->origin;
  const base::TimeTicks granted_at = found->granted_at;
  contents->RemoveUserData(DesktopCaptureGrant::UserDataKey());

  const std::string& requested = request.requested_video_device_ids.front();
  content::RenderFrameHost* frame =
      content::RenderFrameHost::FromID(request.render_process_id, request.render_frame_id);
  const url::Origin request_origin = url::Origin::Create(request.security_origin);
  const bool allowed =
      frame && content::WebContents::FromRenderFrameHost(frame) == contents &&
      requested == source && base::TimeTicks::Now() - granted_at < kGrantLifetime &&
      (frame_id.empty() || PageChannel::FrameId(frame) == frame_id) &&
      (origin.empty() || request_origin.Serialize() == origin);
  const content::DesktopMediaID media_id = content::DesktopMediaID::Parse(source);
  if (!allowed || media_id.is_null()) {
    LOG(WARNING) << "ArcadiaCore: refused desktop capture of " << requested
                 << " (approved " << source << ")";
    return;
  }
  // As chrome.desktopCapture's chooseDesktopMedia: a stream id for the tab's main frame and
  // the page's origin, which Chrome's DesktopCaptureAccessHandler resolves and accepts.
  content::RenderFrameHost* main_frame = contents->GetPrimaryMainFrame();
  request.requested_video_device_ids = {
      content::DesktopStreamsRegistry::GetInstance()->RegisterStream(
          main_frame->GetProcess()->GetDeprecatedID(), main_frame->GetRoutingID(),
          request_origin, media_id, content::kRegistryStreamTypeDesktop)};
}

}  // namespace arcadiacore
