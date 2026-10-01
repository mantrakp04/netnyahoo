#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface NNApplication : NSApplication
@end

typedef void (^NNEventHandler)(NSString *name, NSDictionary<NSString *, id> *payload);

@interface NNCef : NSObject

+ (BOOL)startWithArgc:(int)argc argv:(char *_Nullable *_Nonnull)argv;
+ (void)shutdown;
@property (class, nonatomic, readonly) BOOL isStarted;

@property (class, nonatomic, copy, nullable) NNEventHandler eventHandler;

@property (class, nonatomic) BOOL displayMediaPicker;
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *displayMediaSources;

@property (class, nonatomic, readonly) NSDictionary<NSString *, id> *engineInfo;
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *chromeWindows;
+ (NSString *)devWindow:(NSInteger)windowNumber action:(NSString *)action NS_SWIFT_NAME(devWindow(_:action:));

+ (void)cancelDownload:(NSString *)downloadId;
+ (void)pauseDownload:(NSString *)downloadId;
+ (void)resumeDownload:(NSString *)downloadId;

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember
    NS_SWIFT_NAME(resolvePermission(_:result:remember:));

+ (void)clearBrowsingDataForProfile:(NSString *)profile
                              types:(NSArray<NSString *> *)types
                              since:(double)sinceMs
                         completion:(void (^)(void))completion
    NS_SWIFT_NAME(clearBrowsingData(profile:types:since:completion:));
+ (void)releaseProfile:(NSString *)profile;
@property (class, nonatomic, readonly) NSString *rootCachePath;

@end

@interface NNCef (ContextMenu)
@property (class, nonatomic, copy) NSString *searchEngineName;
/// Drops the navigation a tab opened behind was to load (it closed before it was shown).
+ (void)forgetOpenedURL:(NSInteger)openedId;
@end

/// Chrome's tab strips (NNTabStrip.mm, docs/store-api.md › "Live tabs"): runs one JS command, whose transaction
/// carries `cmd`; the strips as they are now, as a transaction with no command.
@interface NNCef (TabStrip)
+ (void)tabStripCommand:(NSInteger)cmd command:(NSDictionary<NSString *, id> *)command
    NS_SWIFT_NAME(tabStripCommand(_:command:));
@property (class, nonatomic, readonly) NSDictionary<NSString *, id> *tabStrips;
@end

@interface NNCef (Components)
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *components;
@end

@interface NNCef (Diagnostics)
+ (void)beginTracing:(void (^)(BOOL started))completion NS_SWIFT_NAME(beginTracing(_:));
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *_Nullable path))completion
    NS_SWIFT_NAME(endTracing(keep:completion:));
@property (class, nonatomic, readonly) BOOL isTracing;
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *tasks;
+ (BOOL)killTask:(int64_t)taskId NS_SWIFT_NAME(killTask(_:));
@end

typedef void (^NNResultCompletion)(NSDictionary<NSString *, id> *result);

@interface NNContentBlocker : NSObject
+ (void)state:(NNResultCompletion)completion;
+ (void)setEnabled:(BOOL)enabled completion:(void (^)(void))completion NS_SWIFT_NAME(setEnabled(_:completion:));
+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(void))completion
    NS_SWIFT_NAME(setList(_:enabled:completion:));
+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL allowed))completion
    NS_SWIFT_NAME(isAllowed(host:completion:));
+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(void))completion
    NS_SWIFT_NAME(setAllowed(_:host:completion:));
@end

@interface NNSiteSettings : NSObject
@property (class, nonatomic, readonly) NSArray<NSString *> *types;
+ (NSString *)settingForProfile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setting(profile:origin:type:));
+ (void)setSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setSetting(_:profile:origin:type:));
+ (NSDictionary<NSString *, id> *)settingsForProfile:(NSString *)profile origin:(NSString *)origin
    NS_SWIFT_NAME(settings(profile:origin:));
+ (NSArray<NSString *> *)originsForProfile:(NSString *)profile NS_SWIFT_NAME(origins(profile:));
+ (void)resetOrigin:(NSString *)origin profile:(NSString *)profile NS_SWIFT_NAME(reset(origin:profile:));
+ (void)clearSiteDataForProfile:(NSString *)profile
                         origin:(NSString *)origin
                     completion:(void (^)(NSDictionary<NSString *, id> *result))completion
    NS_SWIFT_NAME(clearSiteData(profile:origin:completion:));
@end

// Apps allowed to open links of a scheme from a site ("Always allow" in the open-app prompt).
@interface NNExternalApps : NSObject
+ (void)resolve:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember NS_SWIFT_NAME(resolve(_:open:remember:));
+ (NSArray<NSDictionary<NSString *, id> *> *)allowedForProfile:(NSString *)profile NS_SWIFT_NAME(allowed(profile:));
+ (void)removeAllowedForProfile:(NSString *)profile origin:(NSString *)origin scheme:(NSString *)scheme
    NS_SWIFT_NAME(removeAllowed(profile:origin:scheme:));
@end

@interface NNZoom : NSObject
+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host NS_SWIFT_NAME(setZoom(_:profile:host:));
+ (void)zoomLevelsForProfile:(NSString *)profile completion:(void (^)(NSDictionary<NSString *, NSNumber *> *levels))completion
    NS_SWIFT_NAME(zoomLevels(profile:completion:));
+ (NSArray<NSNumber *> *)devScroll:(NSArray<NSDictionary<NSString *, id> *> *)steps NS_SWIFT_NAME(devScroll(_:));
@end

@interface NNPasswords : NSObject
+ (BOOL)autofillEnabledForProfile:(NSString *)profile NS_SWIFT_NAME(autofillEnabled(profile:));
+ (void)setAutofillEnabled:(BOOL)enabled profile:(NSString *)profile NS_SWIFT_NAME(setAutofillEnabled(_:profile:));
+ (void)listForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(list(profile:completion:));
+ (void)unlockForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(unlock(profile:completion:));
+ (void)passwordForProfile:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
                completion:(NNResultCompletion)completion NS_SWIFT_NAME(password(profile:origin:username:completion:));
+ (void)saveForProfile:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
            completion:(NNResultCompletion)completion NS_SWIFT_NAME(save(profile:origin:username:password:completion:));
+ (void)updateForProfile:(NSString *)profile
                  origin:(NSString *)origin
                username:(NSString *)username
             newUsername:(nullable NSString *)newUsername
             newPassword:(nullable NSString *)newPassword
              completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(update(profile:origin:username:newUsername:newPassword:completion:));
+ (void)deleteForProfile:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
              completion:(NNResultCompletion)completion NS_SWIFT_NAME(delete(profile:origin:username:completion:));
+ (void)neverSaveOriginsForProfile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(neverSaveOrigins(profile:completion:));
+ (void)allowSavingForProfile:(NSString *)profile origin:(NSString *)origin completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(allowSaving(profile:origin:completion:));
// Chrome's export: a reauth every time, then the CSV at `path`. {status: succeeded | cancelled | writeFailed |
// reauthFailed | inProgress}.
+ (void)exportForProfile:(NSString *)profile path:(NSString *)path completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(export(profile:path:completion:));
@end

// //chrome/browser/netnyahoo's calls over Chrome's stores (NNEngineBridge.mm): JSON in, JSON out.
@interface NNEngineBridge : NSObject
+ (void)call:(NSString *)name profile:(NSString *)profile args:(nullable NSString *)args
    completion:(void (^)(NSString *json))completion NS_SWIFT_NAME(call(_:profile:args:completion:));
+ (void)setEventHandler:(void (^)(NSString *topic, NSString *json))handler NS_SWIFT_NAME(setEventHandler(_:));
@end

@interface NNFavicons : NSObject
+ (void)fetch:(NSString *)url profile:(NSString *)profile
    completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion NS_SWIFT_NAME(fetch(_:profile:completion:));
+ (void)removeLegacyFilesForProfile:(NSString *)profile NS_SWIFT_NAME(removeLegacyFiles(profile:));
@end

@interface NNBrowsingData : NSObject
+ (void)deleteCookiesForProfile:(NSString *)profile since:(double)sinceMs completion:(void (^)(NSInteger deleted))completion
    NS_SWIFT_NAME(deleteCookies(profile:since:completion:));
+ (void)clearCacheForProfile:(NSString *)profile completion:(void (^)(void))completion NS_SWIFT_NAME(clearCache(profile:completion:));
@end

@interface NNAutofill : NSObject
+ (NSDictionary<NSString *, NSNumber *> *)settingsForProfile:(NSString *)profile NS_SWIFT_NAME(settings(profile:));
+ (void)setSettings:(NSDictionary<NSString *, NSNumber *> *)settings profile:(NSString *)profile NS_SWIFT_NAME(setSettings(_:profile:));
+ (void)addressesForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(addresses(profile:completion:));
+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(saveAddress(_:profile:completion:));
+ (void)cardsForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(cards(profile:completion:));
+ (void)saveCard:(NSDictionary<NSString *, id> *)card number:(nullable NSString *)number profile:(NSString *)profile
      completion:(NNResultCompletion)completion NS_SWIFT_NAME(saveCard(_:number:profile:completion:));
+ (void)deleteEntry:(NSString *)entryId profile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(deleteEntry(_:profile:completion:));
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(revealCardNumber(_:profile:completion:));
// Autofill and autocomplete entries and every site's settings, as Chrome's Delete Browsing Data dialog deletes them.
+ (void)clearFormDataAndSiteSettingsForProfile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(clearFormDataAndSiteSettings(profile:completion:));
@end

@class NNBrowserView;

@protocol NNBrowserViewDelegate <NSObject>
- (void)browserView:(NNBrowserView *)view event:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
@end

@interface NNBrowserView : NSView

@property (nonatomic, weak, nullable) id<NNBrowserViewDelegate> delegate;
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, copy, nullable) NSString *initialURL;
@property (nonatomic, copy, nullable) NSString *adoptId;
@property (nonatomic, copy, nullable) NSString *transferKey;
@property (nonatomic) BOOL standalone;
@property (nonatomic, strong, nullable) NSColor *pageBackgroundColor;
@property (nonatomic) BOOL visible;
@property (nonatomic) BOOL warm;
@property (nonatomic) BOOL autoPictureInPicture;
@property (nonatomic, readonly) BOOL discarded;
@property (nonatomic) BOOL frozen;
@property (nonatomic, readonly) int browserId;
@property (nonatomic, readonly) int chromeTabId;

+ (void)prepareTransfer:(NSString *)transferKey;

- (void)loadURL:(NSString *)url;
- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated NS_SWIFT_NAME(loadURL(_:userInitiated:));
- (void)loadOpenedURL:(NSInteger)openedId url:(NSString *)url NS_SWIFT_NAME(loadOpenedURL(_:url:));
- (void)goBack;
- (void)goForward;
- (void)goToHistoryOffset:(NSInteger)offset;
- (void)reload;
- (void)reloadIgnoringCache;
- (void)stopLoading;
- (void)focusPage;
- (void)setMuted:(BOOL)muted;
- (void)setZoomFactor:(double)factor;
- (void)zoomStep:(NSInteger)direction NS_SWIFT_NAME(zoomStep(_:));
- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext;
- (void)stopFinding:(BOOL)clearSelection;
- (void)print;
- (void)showDevTools;
- (void)showDevToolsPanel:(nullable NSString *)panel NS_SWIFT_NAME(showDevTools(panel:));
- (void)runPageCommand:(NSString *)name NS_SWIFT_NAME(runPageCommand(_:));
- (void)executeJavaScript:(NSString *)code;
- (void)evaluate:(NSString *)code completion:(void (^)(NSString *_Nullable json))completion;
- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *entries))completion;
- (void)downloadFavicon:(NSString *)url completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadFavicon(_:completion:));
- (void)downloadImage:(NSString *)url
            maxPixels:(NSInteger)maxPixels
           completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadImage(_:maxPixels:completion:));

- (void)mediaCommand:(NSString *)action seconds:(double)seconds NS_SWIFT_NAME(mediaCommand(_:seconds:));
- (void)requestPictureInPicture:(void (^)(BOOL ok))completion NS_SWIFT_NAME(requestPictureInPicture(_:));
- (void)exitPictureInPicture;

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *info))completion NS_SWIFT_NAME(securityInfo(_:));
- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always NS_SWIFT_NAME(openBlockedPopup(_:always:));
- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *result))completion NS_SWIFT_NAME(clearSiteData(_:));

- (void)resolvePasswordPrompt:(NSString *)action username:(nullable NSString *)username password:(nullable NSString *)password
    NS_SWIFT_NAME(resolvePasswordPrompt(_:username:password:));
- (nullable NSString *)executeExtensionAction:(NSString *)extensionId NS_SWIFT_NAME(executeExtensionAction(_:));

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(nullable NSString *)sourceId
    NS_SWIFT_NAME(resolveDisplayMedia(_:sourceId:));
@property (nonatomic, readonly, nullable) NSString *mediaCaptureSourceId;

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action NS_SWIFT_NAME(notificationAction(_:action:));

- (void)resolveUnresponsive:(BOOL)terminate NS_SWIFT_NAME(resolveUnresponsive(terminate:));
- (BOOL)discard:(BOOL)unload NS_SWIFT_NAME(discard(unload:));
- (void)closeBrowser;

@end

NS_ASSUME_NONNULL_END
