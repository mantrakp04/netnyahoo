// Little native windows for sized popups (window.open with features, e.g.
// OAuth). The window adopts the popup browser, so window.opener keeps working,
// and closes when the page calls window.close().
#pragma once

#import "NNCefInternal.h"

namespace nn {

struct PopupRequest {
  NSString *adoptId;
  NSString *profile;
  NSString *url;
  NSSize size;  // content size (CSS px)
  bool hasOrigin = false;
  NSPoint origin;  // screen position requested by the page (top-left origin)
  __weak NNBrowserView *opener = nil;
};

void OpenPopupWindow(const PopupRequest &request);
/// Open little windows (for leak checks and shutdown).
NSUInteger PopupWindowCount();

}  // namespace nn
