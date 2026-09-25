// Dia's extras on Chrome's own video Picture-in-Picture window (an NSWindow of
// this process, VideoOverlayWindowViews): a host pill on hover (click: back to
// the tab), a menu with Back to Tab and Keep Window on Top (right-click
// anywhere on the window), and the edge stash: dragged mostly past a screen's
// left or right edge, the window tucks in with a 28 pt peek and a chevron
// handle that brings it back. Chrome's own controls stay as they are.
// Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

namespace nn::pip {

/// A video in `frame` of `view`'s page entered (`active`) or left Picture in Picture; `host`
/// is the tab's host. Finds Chrome's PiP window and puts the extras on it.
void VideoChanged(NNBrowserView *view, NSString *host, CefRefPtr<CefFrame> frame, bool active);

}  // namespace nn::pip
