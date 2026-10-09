// Copyright 2026 Arcadia. Apache-2.0.
//
// Picture-in-picture windows (a video's, or a page's documentPictureInPicture) per tab.

#ifndef ARCADIA_CORE_AC_PICTURE_IN_PICTURE_H_
#define ARCADIA_CORE_AC_PICTURE_IN_PICTURE_H_

#include <string>

namespace content {
class WebContents;
}

namespace arcadiacore {

// Reports tab:didChangePictureInPicture: {active, kind: "video" | "document"} to the tab
// whose page opened the window, as Chrome's PictureInPictureWindowManager opens and
// closes it (once, at engine start).
void StartPictureInPictureObserver();

// ARCADIA_TRACE_PIP=1: one timestamped line appended to /tmp/ac-pip-trace.log (never the
// profile), for a real call's Picture in Picture the tests can't make.
bool PictureInPictureTracing();
void TracePictureInPicture(const std::string& line);

// Chrome's auto PiP inputs for `contents`, traced (a no-op unless tracing).
void TraceAutoPictureInPictureInputs(content::WebContents* contents, const char* when);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_PICTURE_IN_PICTURE_H_
