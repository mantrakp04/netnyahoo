#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^NNCoreResult)(NSDictionary<NSString *, id> *result);

// The app's profile services on NNCore, over //chrome/browser/netnyahoo's C exports (the same code CEF's
// framework exports; packages/cef/ios/NNPasswords.mm, NNAutofill.mm, NNExtensions.mm, NNZoom.mm are the CEF
// app's side of them). Results are in the shapes packages/cef/src expects; failures are {error}.
@interface NNCoreServices : NSObject

+ (void)call:(NSString *)name
       profile:(NSString *)profile
          args:(nullable NSDictionary<NSString *, id> *)args
    completion:(NNCoreResult)completion NS_SWIFT_NAME(call(_:profile:args:completion:));

// Passwords (nn_passwords_*).
+ (void)listPasswords:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(listPasswords(profile:completion:));
+ (void)unlockPasswords:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(unlockPasswords(profile:completion:));
+ (void)password:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(NNCoreResult)completion
    NS_SWIFT_NAME(password(profile:origin:username:completion:));
+ (void)savePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
          completion:(NNCoreResult)completion NS_SWIFT_NAME(savePassword(profile:origin:username:password:completion:));
+ (void)updatePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
           newUsername:(nullable NSString *)newUsername newPassword:(nullable NSString *)newPassword completion:(NNCoreResult)completion
    NS_SWIFT_NAME(updatePassword(profile:origin:username:newUsername:newPassword:completion:));
+ (void)deletePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(NNCoreResult)completion
    NS_SWIFT_NAME(deletePassword(profile:origin:username:completion:));
+ (void)neverSaveOrigins:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(neverSaveOrigins(profile:completion:));
+ (void)allowSaving:(NSString *)profile origin:(NSString *)origin completion:(NNCoreResult)completion
    NS_SWIFT_NAME(allowSaving(profile:origin:completion:));
+ (void)exportPasswords:(NSString *)profile path:(NSString *)path completion:(NNCoreResult)completion
    NS_SWIFT_NAME(exportPasswords(profile:path:completion:));

// Chrome's own preferences the settings panes switch (credentials_enable_service, autofill.*).
+ (BOOL)boolPreference:(NSString *)name profile:(NSString *)profile NS_SWIFT_NAME(boolPreference(_:profile:));
+ (void)setBoolPreference:(NSString *)name value:(BOOL)value profile:(NSString *)profile NS_SWIFT_NAME(setBoolPreference(_:value:profile:));

// Autofill (nn_autofill_*).
+ (void)addresses:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(addresses(profile:completion:));
+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(saveAddress(_:profile:completion:));
+ (void)cards:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(cards(profile:completion:));
+ (void)saveCard:(NSDictionary<NSString *, id> *)card number:(nullable NSString *)number profile:(NSString *)profile
      completion:(NNCoreResult)completion NS_SWIFT_NAME(saveCard(_:number:profile:completion:));
+ (void)deleteAutofillEntry:(NSString *)entryId profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(deleteAutofillEntry(_:profile:completion:));
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(revealCardNumber(_:profile:completion:));

// Zoom (nn_zoom_*), as zoom factors by host.
+ (void)zoomLevels:(NSString *)profile completion:(void (^)(NSDictionary<NSString *, NSNumber *> *levels))completion
    NS_SWIFT_NAME(zoomLevels(profile:completion:));
+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host NS_SWIFT_NAME(setZoom(_:profile:host:));

// Extensions (nn_extensions_*, nn_search_engines_list).
@property(class, nonatomic, copy, nullable) void (^extensionsHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)listExtensions:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(listExtensions(profile:completion:));
+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path;
+ (void)installExtension:(NSString *)path profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(installExtension(path:profile:completion:));
+ (void)setExtension:(NSString *)extensionId enabled:(BOOL)enabled profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(setExtension(_:enabled:profile:completion:));
+ (void)uninstallExtension:(NSString *)extensionId profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(uninstallExtension(_:profile:completion:));
+ (void)reloadExtension:(NSString *)extensionId profile:(NSString *)profile completion:(NNCoreResult)completion
    NS_SWIFT_NAME(reloadExtension(_:profile:completion:));
+ (void)configureExtension:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary<NSString *, id> *)options
                completion:(NNCoreResult)completion NS_SWIFT_NAME(configureExtension(_:profile:options:completion:));
+ (void)searchEngineList:(NSString *)profile completion:(NNCoreResult)completion NS_SWIFT_NAME(searchEngineList(profile:completion:));

// Browsing data (nn_browsing_data_clear and Chrome's remover).
+ (void)clearBrowsingData:(NSString *)profile types:(NSArray<NSString *> *)types since:(double)sinceMs completion:(void (^)(void))completion
    NS_SWIFT_NAME(clearBrowsingData(profile:types:since:completion:));

@end

NS_ASSUME_NONNULL_END
