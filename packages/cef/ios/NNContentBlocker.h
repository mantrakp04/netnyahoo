#pragma once

#import "NNCefInternal.h"

namespace nn::blocker {

// Checks (and, after an update, refreshes) the writable copy of the bundled blocker on a background queue;
// ExtensionPath() waits for it.
void StartPreparing();
NSString *_Nullable ExtensionPath();
NSString *ExtensionId();
void LoadIntoProfile(NSString *profile, CefRefPtr<CefRequestContext> context);
// Loads it again unless it's already running with its rulesets: a new profile's extension system can finish
// setting up after the first load.
void LoadAgainIfNeeded(NSString *profile, CefRefPtr<CefRequestContext> context);

}
