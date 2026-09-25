// Chrome Web Store (MV3) extensions: Chrome's own extension system, per profile.
// Tabs are Chrome's (a ghost Browser per window, NNWindowHost.h), so
// extensions' tabs/windows APIs, popups and commands are Chrome's real ones.
// Management drives chrome://extensions (developerPrivate / management) in a
// hidden page (NNChromePages.h). Web Store installs download the CRX ourselves,
// verify its signatures, unpack it into the profile (with the manifest `key`, so
// the id matches the store's) and load it unpacked.
#pragma once

#import "NNCef.h"

NS_ASSUME_NONNULL_BEGIN

typedef void (^NNExtensionsCompletion)(NSDictionary<NSString *, id> *result);

@interface NNExtensions : NSObject

/// "changed" {profile, id, event} (installed / uninstalled / enabled / disabled / configured /
/// reloaded); "tabs" {action: "open", url, profile, active}: a page Chrome opened outside our
/// windows, to open as a tab.
@property (class, nonatomic, copy, nullable) NNEventHandler eventHandler;
/// Chrome's own install flow (Web Store "Add", re-enable, permission increases) asks through
/// an "installPrompt" event ({requestId, profile, id, name, version, type, icon, permissions,
/// browserId}) instead of showing its dialog. NO on engines without that hook.
@property (class, nonatomic, readonly) BOOL supportsInstallPrompt;
/// The user's answer to an "installPrompt".
+ (void)resolveInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted NS_SWIFT_NAME(resolveInstallPrompt(_:accepted:));

/// [{id, name, version, description, enabled, state, icon (data URL), permissions [message],
///   hostAccess, optionsUrl, popup, sidePanel, actionTitle, location, path, webStoreUrl,
///   homepageUrl, incognitoAccess, errors}] in `result[@"extensions"]`.
+ (void)listForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(list(profile:completion:));

/// Downloads, verifies and unpacks a Web Store extension without installing it:
/// {id, name, version, icon, permissions (manifest), hostPermissions, path} or {error}.
/// Pass the result's `path` to -installPrepared: after the user confirms.
+ (void)prepareWebStoreExtension:(NSString *)extensionId
                         profile:(NSString *)profile
                      completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(prepareWebStore(_:profile:completion:));
/// Reads an unpacked extension folder (developer install) like -prepareWebStoreExtension.
+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path NS_SWIFT_NAME(inspectUnpacked(_:));
/// Loads a prepared (or developer) folder into the profile: {id} or {error}.
+ (void)installPath:(NSString *)path profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(install(path:profile:completion:));
/// Throws away a prepared download the user declined.
+ (void)discardPrepared:(NSString *)path NS_SWIFT_NAME(discardPrepared(_:));

+ (void)setEnabled:(BOOL)enabled
         extension:(NSString *)extensionId
           profile:(NSString *)profile
        completion:(NNExtensionsCompletion)completion NS_SWIFT_NAME(setEnabled(_:extension:profile:completion:));
/// Removes the extension (and its files if we unpacked it): {ok} or {error}.
+ (void)uninstall:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(uninstall(_:profile:completion:));
/// Reloads an unpacked extension from disk (developer workflow).
+ (void)reload:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(reload(_:profile:completion:));
/// Allow in Incognito / site access ("onClick" | "specificSites" | "allSites").
+ (void)configure:(NSString *)extensionId
          profile:(NSString *)profile
          options:(NSDictionary<NSString *, id> *)options
       completion:(NNExtensionsCompletion)completion NS_SWIFT_NAME(configure(_:profile:options:completion:));

/// Toolbar action state per extension for a tab (browser id; 0 = defaults):
/// result[@"states"][id] = {badgeText, badgeColor, badgeTextColor, title, popup, enabled}.
+ (void)actionStateForProfile:(NSString *)profile
                   extensions:(NSArray<NSString *> *)extensionIds
                        tabId:(NSInteger)tabId
                   completion:(NNExtensionsCompletion)completion NS_SWIFT_NAME(actionState(profile:extensions:tabId:completion:));

/// {probes: {profile: extension id}}: an enabled extension per profile, whose context maps
/// our browser ids to Chrome's extension tab ids (for per-tab action state).
+ (void)setTabModel:(NSDictionary<NSString *, id> *)model NS_SWIFT_NAME(setTabModel(_:));

/// Development: evaluates `expression` in the profile's hidden `page` ("chrome://extensions/" when nil).
+ (void)evaluateInHost:(NSString *)expression
               profile:(NSString *)profile
                  page:(nullable NSString *)page
            completion:(void (^)(id _Nullable value))completion NS_SWIFT_NAME(evaluateInHost(_:profile:page:completion:));

@end

NS_ASSUME_NONNULL_END
