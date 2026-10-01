// Copyright 2026 Netnyahoo. Apache-2.0.
//
// The host's screen-share picker: the source it approved for a page, granted once.

#ifndef NETNYAHOO_CORE_NN_DESKTOP_CAPTURE_H_
#define NETNYAHOO_CORE_NN_DESKTOP_CAPTURE_H_

#include <string>

namespace content {
struct MediaStreamRequest;
class WebContents;
}  // namespace content

namespace nncore {

// The host picked `source` ("screen:<id>:0", "window:<id>:0", a tab's
// "web-contents-media-stream://…") for the frame `frame_id` (PageChannel::FrameId; empty:
// any frame of the tab) of `origin` (empty: any). Replaces an earlier grant of the tab.
void AllowDesktopCapture(content::WebContents* contents,
                         const std::string& source,
                         const std::string& frame_id,
                         const std::string& origin);

// A getUserMedia({chromeMediaSource: "desktop", chromeMediaSourceId}) request. Takes the
// tab's grant (one request per approval); when the request is for the approved source, from
// that frame and origin, within 15 s, rewrites its device id to a stream id registered with
// Chrome's DesktopStreamsRegistry, which Chrome's desktop-capture handler then accepts.
// Any other request is left as it is (Chrome accepts only registered ids).
void ApplyDesktopCaptureGrant(content::WebContents* contents,
                              content::MediaStreamRequest& request);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_DESKTOP_CAPTURE_H_
