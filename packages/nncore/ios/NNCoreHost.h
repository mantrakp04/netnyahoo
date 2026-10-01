#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

// Starts the app on NNCore: Chromium runs the process and its run loop (ChromeMain), and the app's
// NSApplication delegate (the React Native host) is made once the engine is up, inside that loop.
// NSApp is Chrome's own NSApplication subclass, so nothing may touch NSApp before this runs.
@interface NNCoreHost : NSObject

+ (int)runWithArgc:(int)argc
              argv:(char *_Nullable *_Nonnull)argv
          delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate NS_SWIFT_NAME(run(argc:argv:delegate:));

@property(class, readonly) BOOL isStarted;
// $NETNYAHOO_DATA_DIR/Chromium: Chrome's user data dir (profiles are "Default" and "Profile <id>").
@property(class, readonly) NSString *dataDirectory;
@property(class, readonly) NSDictionary<NSString *, id> *engineInfo;
// The app windows' state (JS ChromeWindowState), for diagnostics and tests.
@property(class, readonly) NSArray<NSDictionary<NSString *, id> *> *chromeWindows;
// The NetnyahooCEF module's events that don't belong to one view ("permission", "permissionDismissed"…).
@property(class, nonatomic, copy, nullable) void (^eventHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
// Screens and other apps' windows the app's screen-share picker offers (as packages/cef's).
@property(class, readonly) NSArray<NSDictionary<NSString *, id> *> *displayMediaSources;
// The NetnyahooChromeUI module's events ("sidePanel"…).
@property(class, nonatomic, copy, nullable) void (^chromeUIHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember NS_SWIFT_NAME(resolveExternalApp(_:open:remember:));
// Device choosers: an option (or -1, a scanning prompt's OK); "cancel", "refresh" or "settings".
+ (void)deviceChooser:(int)chooserId select:(int)index NS_SWIFT_NAME(deviceChooser(_:select:));
+ (void)deviceChooser:(int)chooserId action:(NSString *)action NS_SWIFT_NAME(deviceChooser(_:action:));
// Tests (--netnyahoo-test-external-protocol-no-launch): the app links Chrome recorded instead of launching them.
+ (NSArray<NSDictionary *> *)testExternalLaunches;
// Tests (--netnyahoo-test-bluetooth-chooser): Chrome's Bluetooth chooser for a tab with no adapter behind it (NO
// without the switch), and what its choices told the page's side ({event, device}).
+ (BOOL)devShowBluetoothChooser:(int)browserId unauthorized:(BOOL)unauthorized NS_SWIFT_NAME(devShowBluetoothChooser(browserId:unauthorized:));
+ (NSArray<NSDictionary *> *)testChooserEvents;
// Cast: Chrome's dialog for a tab (NO when the media router is off), its answers, and a profile's routes.
+ (BOOL)shareTabInstead:(int)targetBrowserId NS_SWIFT_NAME(shareTabInstead(browserId:));
+ (BOOL)showCastDialog:(int)browserId NS_SWIFT_NAME(showCastDialog(browserId:));
+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode NS_SWIFT_NAME(castDialog(_:start:mode:));
+ (void)castDialog:(int)dialogId stop:(NSString *)route NS_SWIFT_NAME(castDialog(_:stop:));
+ (void)closeCastDialog:(int)dialogId NS_SWIFT_NAME(closeCastDialog(_:));
+ (void)watchCastRoutes:(NSString *)profile NS_SWIFT_NAME(watchCastRoutes(_:));
+ (void)terminateCastRoute:(NSString *)route NS_SWIFT_NAME(terminateCastRoute(_:));
+ (NSDictionary<NSString *, id> *)actionStates:(int)browserId extensions:(NSArray<NSString *> *)ids NS_SWIFT_NAME(actionStates(browserId:extensions:));
+ (nullable NSString *)sidePanelURL:(int)browserId extension:(NSString *)extensionId NS_SWIFT_NAME(sidePanelURL(browserId:extension:));
+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted
    NS_SWIFT_NAME(resolveExtensionInstallPrompt(_:accepted:));
// The NetnyahooExtensions module's events ("installPrompt").
@property(class, nonatomic, copy, nullable) void (^extensionsEventHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)beginTracing:(void (^)(BOOL started))completion;
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *_Nullable path))completion NS_SWIFT_NAME(endTracing(keep:completion:));
@property(class, readonly) BOOL isTracing;
// Deletes a profile's data through Chrome (its Browsers close, its folder goes): the kinds left, none when it all went.
+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *remaining))completion
    NS_SWIFT_NAME(deleteProfileData(_:completion:));
+ (void)releaseProfile:(NSString *)profile;
+ (BOOL)stopCapture:(int)browserId NS_SWIFT_NAME(stopCapture(browserId:));
+ (BOOL)showAutofillSuggestions:(int)browserId passwords:(BOOL)passwords NS_SWIFT_NAME(showAutofillSuggestions(browserId:passwords:));
+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember
    NS_SWIFT_NAME(resolvePermission(_:result:remember:));

@end

// Favicons the app keeps per profile (lib/favicons.ts), as packages/cef's NNFavicons: PNGs under the
// profile's "Netnyahoo Favicons" folder.
@interface NNCoreFavicons : NSObject
+ (void)fetch:(NSString *)url
       profile:(NSString *)profile
          name:(nullable NSString *)name
    completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(fetch(_:profile:name:completion:));
+ (void)pruneProfile:(NSString *)profile keeping:(NSArray<NSString *> *)names NS_SWIFT_NAME(prune(profile:keeping:));
@end

NS_ASSUME_NONNULL_END
