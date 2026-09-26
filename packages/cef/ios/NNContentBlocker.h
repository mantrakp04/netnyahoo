// The content blocker is uBlock Origin Lite (MV3 declarativeNetRequest rules and
// its content scripts), bundled with the app and loaded as a built-in extension
// in every profile. Public controls are NNContentBlocker in NNCef.h; they talk
// to its service worker the way its own settings page does.
#pragma once

#import "NNCefInternal.h"

namespace nn::blocker {

/// The folder Chrome loads the extension from: a copy of the bundled one in the data directory,
/// because Chrome writes into it (nil if the app was built without it, or the copy failed).
NSString *_Nullable ExtensionPath();
/// Its extension id (fixed by the manifest key setup.sh adds).
NSString *ExtensionId();
/// Chrome tabs: loads it as a component (built-in) extension of the context's profile, which
/// also covers the profile's incognito windows and can't be turned off in chrome://extensions.
/// A profile other than the default then gets the default's settings. Stock CEF loads it
/// unpacked with --load-extension instead (regular profiles only).
void LoadIntoProfile(NSString *profile, CefRefPtr<CefRequestContext> context);

}  // namespace nn::blocker
