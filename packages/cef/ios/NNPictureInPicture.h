// Dia: 28pt peek.
#pragma once

#import "NNCefInternal.h"

namespace nn::pip {

void VideoChanged(NNBrowserView *view, NSString *host, CefRefPtr<CefFrame> frame, bool active);

}
