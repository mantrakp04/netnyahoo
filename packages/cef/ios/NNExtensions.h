// Chrome Web Store (MV3) extensions: Chrome's own extension system, per profile.
// Tabs are Chrome's (each app window is a Chrome Browser, NNWindowHost.h), so
// extensions' tabs/windows APIs, popups and commands are Chrome's real ones.
// Management drives chrome://extensions (developerPrivate / management) in a
// hidden page (NNChromePages.h). Web Store installs are Chrome's own (the store's
// button); its install dialog asks the app instead ("installPrompt"). Toolbar
// action state and side panels are in NNChromeSurfaces.h.
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
/// browserId}) instead of showing its dialog. The user's answer: 
+ (void)resolveInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted NS_SWIFT_NAME(resolveInstallPrompt(_:accepted:));

/// [{id, name, version, description, enabled, state, icon (data URL), permissions [message],
///   hostAccess, optionsUrl, popup, sidePanel, actionTitle, location, path, webStoreUrl,
///   homepageUrl, incognitoAccess, errors}] in `result[@"extensions"]`.
+ (void)listForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(list(profile:completion:));

/// Reads an unpacked extension folder (developer install) for the install dialog:
/// {id?, name, version, icon, permissions (manifest), hostPermissions, path} or {error}.
+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path NS_SWIFT_NAME(inspectUnpacked(_:));
/// Loads a developer's folder into the profile: {id} or {error}.
+ (void)installPath:(NSString *)path profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(install(path:profile:completion:));

+ (void)setEnabled:(BOOL)enabled
         extension:(NSString *)extensionId
           profile:(NSString *)profile
        completion:(NNExtensionsCompletion)completion NS_SWIFT_NAME(setEnabled(_:extension:profile:completion:));
/// Removes the extension (and our copy of a store extension from before Chrome installed them): {ok} or {error}.
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

/// Development: evaluates `expression` in the profile's hidden `page` ("chrome://extensions/" when nil).
+ (void)evaluateInHost:(NSString *)expression
               profile:(NSString *)profile
                  page:(nullable NSString *)page
            completion:(void (^)(id _Nullable value))completion NS_SWIFT_NAME(evaluateInHost(_:profile:page:completion:));

@end

/// Search engines extensions add (NNSearchEngines.mm).
@interface NNExtensions (SearchEngines)

/// Chrome's search engine list for the profile, as its settings page gets it
/// (`getSearchEnginesList`: {defaults, actives, others, extensions}, each engine with name,
/// keyword, url and suggestionsUrl with %s, default, and for extension engines
/// extension {id, name}) in `result[@"list"]`, or {error}.
+ (void)searchEngineListForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(searchEngineList(profile:completion:));

@end

NS_ASSUME_NONNULL_END
