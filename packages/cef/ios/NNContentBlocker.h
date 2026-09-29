#pragma once

#import "NNCefInternal.h"

namespace nn::blocker {

NSString *_Nullable ExtensionPath();
NSString *ExtensionId();
void LoadIntoProfile(NSString *profile, CefRefPtr<CefRequestContext> context);

}
