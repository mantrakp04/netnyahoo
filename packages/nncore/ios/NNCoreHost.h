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
