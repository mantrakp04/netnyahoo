#pragma once

#import "NNCefInternal.h"

namespace nn {

struct PopupRequest {
  NSString *adoptId;
  NSString *profile;
  NSString *url;
  NSSize size;
  bool hasOrigin = false;
  NSPoint origin;
  __weak NNBrowserView *opener = nil;
};

void OpenPopupWindow(const PopupRequest &request);
NSUInteger PopupWindowCount();

}
