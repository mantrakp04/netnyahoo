// Extension packages: Chrome Web Store CRX downloads (CRX3 parsing and
// signature checks), unpacking, and reading manifests for the install dialog
// and the toolbar. Objective-C++ only.
#pragma once

#import <Foundation/Foundation.h>

namespace nn::ext {

/// "abcdefghijklmnopabcdefghijklmnop" (32 letters a–p).
bool IsExtensionId(NSString *s);

/// Downloads the store's current CRX for `extensionId`, verifies it and unpacks
/// it into a fresh folder under `stagingRoot`. The manifest gets the CRX's
/// public key as `key`, so the unpacked extension keeps the store id.
/// Completion (main queue): the folder, or nil and an error message.
void DownloadFromWebStore(NSString *extensionId, NSString *chromiumVersion, NSString *stagingRoot,
                          void (^completion)(NSString *folder, NSString *error));

/// Manifest facts for UI: {id?, name, version, description, manifestVersion, icon (data URL),
/// permissions, optionalPermissions, hostPermissions (incl. content script matches), popup,
/// actionTitle, actionIcon (data URL), optionsPage, sidePanel, homepageUrl} or {error}.
NSDictionary *ReadManifest(NSString *folder);

/// The extension id Chrome derives from a manifest `key` (nil without one).
NSString *IdForKey(NSString *base64Key);

/// A file inside `folder` as a data URL (nil if missing / not an image).
NSString *DataURL(NSString *folder, NSString *relativePath);

}  // namespace nn::ext
