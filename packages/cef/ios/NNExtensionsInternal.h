// Hooks other files of the pod call into the extensions module. Objective-C++ only.
#pragma once

#import "NNCefInternal.h"

namespace nn::ext {

/// A page Chrome opened outside our windows (a stray Chrome window, an extension's
/// tabs.create while no ghost Browser takes it): the app opens it as a tab
/// ("tabs" event, action "open").
void EmitOpenTab(NSString *url, NSString *profile);

}  // namespace nn::ext
