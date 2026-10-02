// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Picture-in-picture windows (a video's, or a page's documentPictureInPicture) per tab.

#ifndef NETNYAHOO_CORE_NN_PICTURE_IN_PICTURE_H_
#define NETNYAHOO_CORE_NN_PICTURE_IN_PICTURE_H_

#include <string>

namespace content {
class WebContents;
}

namespace nncore {

// Reports tab:didChangePictureInPicture: {active, kind: "video" | "document"} to the tab
// whose page opened the window, as Chrome's PictureInPictureWindowManager opens and
// closes it (once, at engine start).
void StartPictureInPictureObserver();

// NETNYAHOO_TRACE_PIP=1: one timestamped line appended to /tmp/nn-pip-trace.log (never the
// profile), for a real call's Picture in Picture the tests can't make.
bool PictureInPictureTracing();
void TracePictureInPicture(const std::string& line);

// The host hid (shown NO) or showed a tab without Chrome's tab strip changing (its own New Tab
// page or another page of the host took the window): Chrome's automatic Picture in Picture
// hears of it as a tab switch, as in Chrome, where a New Tab is a tab.
void NoteTabShownByHost(content::WebContents* contents, bool shown);
// Chrome's auto PiP inputs for `contents`, traced (a no-op unless tracing).
void TraceAutoPictureInPictureInputs(content::WebContents* contents, const char* when);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_PICTURE_IN_PICTURE_H_
