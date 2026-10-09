#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ArcadiaCoreResult)(NSDictionary<NSString *, id> *result);

// The app's profile services on ArcadiaCore, over //chrome/browser/arcadia's C exports (the same code CEF's
// framework exports; packages/cef/ios/ACPasswords.mm, ACAutofill.mm, ACExtensions.mm, ACZoom.mm are the CEF
// app's side of them). Results are in the shapes packages/cef/src expects; failures are {error}.
@interface ArcadiaCoreServices : NSObject

+ (void)call:(NSString *)name
       profile:(NSString *)profile
          args:(nullable NSDictionary<NSString *, id> *)args
    completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(call(_:profile:args:completion:));

// Passwords (ac_passwords_*).
+ (void)listPasswords:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(listPasswords(profile:completion:));
+ (void)unlockPasswords:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(unlockPasswords(profile:completion:));
+ (void)password:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(password(profile:origin:username:completion:));
+ (void)savePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
          completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(savePassword(profile:origin:username:password:completion:));
+ (void)updatePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
           newUsername:(nullable NSString *)newUsername newPassword:(nullable NSString *)newPassword completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(updatePassword(profile:origin:username:newUsername:newPassword:completion:));
+ (void)deletePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(deletePassword(profile:origin:username:completion:));
+ (void)neverSaveOrigins:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(neverSaveOrigins(profile:completion:));
+ (void)allowSaving:(NSString *)profile origin:(NSString *)origin completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(allowSaving(profile:origin:completion:));
+ (void)exportPasswords:(NSString *)profile path:(nullable NSString *)path completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(exportPasswords(profile:path:completion:));

// Chrome's own preferences the settings panes switch (credentials_enable_service, autofill.*).
+ (BOOL)boolPreference:(NSString *)name profile:(NSString *)profile NS_SWIFT_NAME(boolPreference(_:profile:));
+ (void)setBoolPreference:(NSString *)name value:(BOOL)value profile:(NSString *)profile NS_SWIFT_NAME(setBoolPreference(_:value:profile:));

// Autofill (ac_autofill_*).
+ (void)addresses:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(addresses(profile:completion:));
+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(saveAddress(_:profile:completion:));
+ (void)cards:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(cards(profile:completion:));
+ (void)saveCard:(NSDictionary<NSString *, id> *)card number:(nullable NSString *)number profile:(NSString *)profile
      completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(saveCard(_:number:profile:completion:));
+ (void)deleteAutofillEntry:(NSString *)entryId profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(deleteAutofillEntry(_:profile:completion:));
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(revealCardNumber(_:profile:completion:));

// Zoom (ac_zoom_*), as zoom factors by host.
+ (void)zoomLevels:(NSString *)profile completion:(void (^)(NSDictionary<NSString *, NSNumber *> *levels))completion
    NS_SWIFT_NAME(zoomLevels(profile:completion:));
+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host NS_SWIFT_NAME(setZoom(_:profile:host:));

// Extensions (ac_extensions_*, ac_search_engines_list).
@property(class, nonatomic, copy, nullable) void (^extensionsHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)listExtensions:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(listExtensions(profile:completion:));
+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path;
+ (void)installExtension:(NSString *)path profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(installExtension(path:profile:completion:));
// A .crx file, as one dropped on chrome://extensions: the app's install prompt, then Chrome's "added" bubble.
+ (void)installCrx:(NSString *)path profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(installCrx(path:profile:completion:));
+ (void)setExtension:(NSString *)extensionId enabled:(BOOL)enabled profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(setExtension(_:enabled:profile:completion:));
+ (void)uninstallExtension:(NSString *)extensionId profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(uninstallExtension(_:profile:completion:));
+ (void)reloadExtension:(NSString *)extensionId profile:(NSString *)profile completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(reloadExtension(_:profile:completion:));
+ (void)configureExtension:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary<NSString *, id> *)options
                completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(configureExtension(_:profile:options:completion:));
+ (void)searchEngineList:(NSString *)profile completion:(ArcadiaCoreResult)completion NS_SWIFT_NAME(searchEngineList(profile:completion:));

// Downloads (ac_downloads_*): the app's Download dictionaries; every change goes to the handler.
@property(class, nonatomic, copy, nullable) void (^downloadsHandler)(NSDictionary<NSString *, id> *download);
+ (void)watchDownloads:(NSString *)profile NS_SWIFT_NAME(watchDownloads(profile:));
+ (void)downloadCommand:(NSString *)command id:(NSString *)downloadId NS_SWIFT_NAME(downloadCommand(_:id:));

// Site settings (ac_site_settings_*, ac_site_data_clear).
+ (void)siteSettings:(NSString *)profile origin:(NSString *)origin completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(siteSettings(profile:origin:completion:));
+ (void)setSiteSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setSiteSetting(_:profile:origin:type:));
+ (void)siteSettingsOrigins:(NSString *)profile completion:(void (^)(NSArray<NSString *> *origins))completion
    NS_SWIFT_NAME(siteSettingsOrigins(profile:completion:));
+ (void)resetSiteSettings:(NSString *)profile origin:(NSString *)origin NS_SWIFT_NAME(resetSiteSettings(profile:origin:));
+ (void)clearSiteData:(NSString *)profile origin:(NSString *)origin completion:(ArcadiaCoreResult)completion
    NS_SWIFT_NAME(clearSiteData(profile:origin:completion:));

// External apps' "always allow" choices (ac_external_apps_*).
+ (void)externalAppAllowances:(NSString *)profile completion:(void (^)(NSArray *allowances))completion
    NS_SWIFT_NAME(externalAppAllowances(profile:completion:));
+ (void)removeExternalAppAllowance:(NSString *)profile origin:(NSString *)origin scheme:(NSString *)scheme
    NS_SWIFT_NAME(removeExternalAppAllowance(profile:origin:scheme:));

// Process-wide: the task manager and the component updater (ac_tasks_*, ac_components_list).
+ (void)tasks:(void (^)(NSArray *tasks))completion NS_SWIFT_NAME(tasks(_:));
+ (void)killTask:(long long)taskId completion:(void (^)(BOOL killed))completion NS_SWIFT_NAME(killTask(_:completion:));
+ (void)components:(void (^)(NSArray *components))completion NS_SWIFT_NAME(components(_:));

// Browsing data (ac_browsing_data_clear and Chrome's remover).
+ (void)clearBrowsingData:(NSString *)profile types:(NSArray<NSString *> *)types since:(double)sinceMs completion:(void (^)(void))completion
    NS_SWIFT_NAME(clearBrowsingData(profile:types:since:completion:));

@end

// The built-in content blocker (uBlock Origin Lite). A change that fails (error) changed nothing.
@interface ArcadiaCoreContentBlocker : NSObject
+ (void)state:(void (^)(NSDictionary<NSString *, id> *state))completion NS_SWIFT_NAME(state(_:));
+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setEnabled(_:completion:));
+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setList(_:enabled:completion:));
+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL allowed))completion NS_SWIFT_NAME(isAllowed(host:completion:));
+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *_Nullable error))completion NS_SWIFT_NAME(setAllowed(_:host:completion:));
// Tests: the next call's first message to the extension fails.
+ (void)devFailNextMessage;
// Tests: the next profile's load of the extension waits `ms`, its pages held meanwhile.
+ (void)devDelayNextLoad:(double)ms;
@end

NS_ASSUME_NONNULL_END
