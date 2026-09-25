// Extension folders: reading manifests for the install dialog (Load Unpacked)
// and the toolbar. Objective-C++ only.
#pragma once

#import <Foundation/Foundation.h>

namespace nn::ext {

/// "abcdefghijklmnopabcdefghijklmnop" (32 letters a–p).
bool IsExtensionId(NSString *s);

/// Manifest facts for UI: {id?, name, version, description, manifestVersion, icon (data URL),
/// permissions, optionalPermissions, hostPermissions (incl. content script matches), popup,
/// actionTitle, actionIcon (data URL), optionsPage, sidePanel, homepageUrl} or {error}.
NSDictionary *ReadManifest(NSString *folder);

/// The extension id Chrome derives from a manifest `key` (nil without one).
NSString *IdForKey(NSString *base64Key);

/// A file inside `folder` as a data URL (nil if missing / not an image).
NSString *DataURL(NSString *folder, NSString *relativePath);

}  // namespace nn::ext
