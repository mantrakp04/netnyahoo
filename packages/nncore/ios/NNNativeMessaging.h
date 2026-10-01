#pragma once

#import <Foundation/Foundation.h>

// Native messaging hosts (chrome.runtime.connectNative) for password manager extensions that talk
// to their Mac app: 1Password, Bitwarden, KeePassXC and Proton Pass.
//
// Chromium looks for host manifests in <user data dir>/NativeMessagingHosts and in its branding's
// system dir (/Library/Application Support/Chromium/NativeMessagingHosts for our build). The apps
// only install theirs for the browsers they know: system-wide in Chrome's dir, or into each known
// browser's own user data dir. So we write the manifests of the installed ones into ours, and remove
// them once their app is gone. Manifests someone else put there are left alone.
namespace nn::nativemessaging {

// Brings <userDataDir>/NativeMessagingHosts up to date. Cheap (a few stats and small files);
// call it before CefInitialize, and again whenever an app may have been installed.
void SyncHosts(NSString *userDataDir);

}  // namespace nn::nativemessaging
