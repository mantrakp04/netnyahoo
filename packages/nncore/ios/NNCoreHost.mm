// The app on NNCore: Chromium owns the process and the run loop (ChromeMain → MessagePumpNSApplication →
// [NSApp run]); the React Native host starts inside it once the engine is up. There is no external pump and no
// second Chromium: NSApp is Chrome's BrowserCrApplication, and NNCore makes -terminate: follow Cocoa's
// applicationShouldTerminate: contract, so the app's own quit flow (ShellApp.shouldTerminate) runs as on CEF.
#import "NNCoreInternal.h"
#import "NNCoreServices.h"
#import "NNCoreWebView.h"

#include <string>
#include <vector>

namespace {

id<NSApplicationDelegate> (^gMakeDelegate)(void);
id<NSApplicationDelegate> gAppDelegate;
BOOL gStarted;
NSString *gDataDirectory;

NSMutableDictionary<NSString *, NNCoreProfile *> *Profiles() {
  static NSMutableDictionary *profiles = [NSMutableDictionary dictionary];
  return profiles;
}

NSMutableDictionary<NSString *, NSMutableArray *> *ProfileWaiters() {
  static NSMutableDictionary *waiters = [NSMutableDictionary dictionary];
  return waiters;
}

NSString *DirectoryName(NSString *name) {
  return name.length ? [@"Profile " stringByAppendingString:name] : @"Default";
}

}  // namespace

// NSApp's delegate from the moment AppKit finishes launching (inside Chromium's loop, before the engine is up) until
// the app's own is made: a cold launch's open-URL events arrive then, and are handed on once it exists.
@interface NNCoreBootstrapDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, readonly) NSMutableArray<NSURL *> *urls;
@end

@implementation NNCoreBootstrapDelegate
- (instancetype)init {
  if ((self = [super init])) _urls = [NSMutableArray array];
  return self;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
  [_urls addObjectsFromArray:urls];
}
@end

namespace {
NNCoreBootstrapDelegate *gBootstrap;
// How far AppKit's own launch got ([NSApp finishLaunching], inside Chromium's loop): the app delegate gets each
// launch callback exactly once, from AppKit if it hasn't sent it yet, else from launchApp.
bool gScratchDataDir = false;
bool gAppKitWillFinish = false;
bool gAppKitDidFinish = false;
NSArray<NSURL *> *gPendingLaunchURLs;
void (^gEventHandler)(NSString *, NSDictionary *);
void (^gChromeUIHandler)(NSString *, NSDictionary *);
void (^gExtensionsEventHandler)(NSString *, NSDictionary *);
NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts = [NSMutableDictionary dictionary];
}  // namespace

// MARK: - Engine delegate

@interface NNCoreHostEngineDelegate : NSObject <NNCoreEngineDelegate>
@end

@implementation NNCoreHostEngineDelegate

- (void)engineDidStart {
  NSLog(@"[nncore] engine started (Chromium %@)", NNCoreEngine.sharedEngine.chromiumVersion);
  gStarted = YES;
  nncore_host::InstallActivationGuardsLate();
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  // Personal ("") is always Chrome's Default profile directory, whichever profile Chrome used last.
  if (NNCoreProfile *profile = nncore_host::PersonalIfLoaded(engine)) Profiles()[@""] = profile;
  nncore_host::LoadContentBlocker(@"");
  [NNCoreWebView installScrollZoom];
  [NNCoreServices watchDownloads:@""];

  // The page script CEF's renderer ran (packages/cef/helper/page_script.js), now NNCore's.
  NSBundle *bundle = [NSBundle bundleForClass:NNCoreHostEngineDelegate.class];
  NSString *path = [bundle pathForResource:@"page_script" ofType:@"js"];
  NSString *script = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
  if (script && [engine respondsToSelector:@selector(setPageScript:)]) engine.pageScript = script;

  // React Native starts when the loop first goes idle: Chrome's startup burst holds the main thread right after
  // engineDidStart, and RN's main-queue module setup (Expo's bridge module installing into the JS runtime) must
  // not wait behind it while the JS thread already runs that runtime (RN's debug ReentrancyCheck traps on it).
  CFRunLoopObserverRef idle = CFRunLoopObserverCreateWithHandler(
      nullptr, kCFRunLoopBeforeWaiting, false, 0, ^(CFRunLoopObserverRef observer, CFRunLoopActivity) {
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
        [self launchApp];
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), idle, kCFRunLoopCommonModes);
  CFRelease(idle);
}

// NSApp's delegate as NSApplicationMain would set it, but in Chromium's loop: the launch callbacks AppKit already
// sent (to the bootstrap delegate) are called here.
- (void)launchApp {
  NSArray<NSURL *> *launchURLs = gBootstrap.urls.copy;
  gAppDelegate = gMakeDelegate();
  NSApp.delegate = gAppDelegate;
  gBootstrap = nil;
  // The loop can go idle before [NSApp run] finished launching; AppKit then sends the delegate's launch callbacks
  // itself, and sending them here too made a second React Native factory (two JS runtimes, two stores).
  NSNotification *note = [NSNotification notificationWithName:NSApplicationWillFinishLaunchingNotification object:NSApp];
  if (gAppKitWillFinish && [gAppDelegate respondsToSelector:@selector(applicationWillFinishLaunching:)])
    [gAppDelegate applicationWillFinishLaunching:note];
  if (!gAppKitDidFinish) {
    NSLog(@"[nncore] app delegate %@ set before AppKit finished launching", NSStringFromClass([gAppDelegate class]));
    // AppKit sends it the launch callbacks; the URLs the bootstrap delegate held follow them (the
    // DidFinishLaunching observer).
    gPendingLaunchURLs = launchURLs;
    return;
  }
  note = [NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp];
  if ([gAppDelegate respondsToSelector:@selector(applicationDidFinishLaunching:)])
    [gAppDelegate applicationDidFinishLaunching:note];
  NSLog(@"[nncore] app delegate %@ launched", NSStringFromClass([gAppDelegate class]));
  if (launchURLs.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
    [gAppDelegate application:NSApp openURLs:launchURLs];
}

- (void)engineWillShutDown {
  gStarted = NO;
}

- (void)engineQuitCancelled {
  NSLog(@"[nncore] quit cancelled");
}

- (void)engine:(NNCoreEngine *)engine permissionRequest:(NSDictionary *)request tab:(NNCoreTab *)tab {
  NSMutableDictionary *payload = [request mutableCopy];
  payload[@"browserId"] = @(tab ? nncore_host::BrowserId(tab) : 0);
  if (gEventHandler) gEventHandler(@"permission", payload);
}

// A page's WebUSB/WebHID/Serial/Bluetooth chooser: the app's sheet (onDeviceChooser), as CEF's NNChromeSurfaces sent
// it; sent again on every change, the last with open NO.
- (void)engine:(NNCoreEngine *)engine deviceChooser:(NSDictionary *)chooser tab:(NNCoreTab *)tab {
  NSMutableDictionary *payload = [chooser mutableCopy];
  payload[@"browserId"] = @(tab ? nncore_host::BrowserId(tab) : 0);
  if (auto handler = NNCoreHost.chromeUIHandler) handler(@"deviceChooser", payload);
  else if ([payload[@"open"] boolValue] && [NNCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [NNCoreEngine cancelDeviceChooser:[payload[@"id"] intValue]];
}

// Chrome's Cast dialog for a tab: the app's popover (onCastDialog), as CEF's NNChromeSurfaces sent it.
- (void)engine:(NNCoreEngine *)engine castDialog:(NSDictionary *)dialog tab:(NNCoreTab *)tab {
  NSMutableDictionary *payload = [dialog mutableCopy];
  payload[@"browserId"] = @(tab ? nncore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"castDialog", payload);
  else if ([payload[@"open"] boolValue] && [NNCoreEngine respondsToSelector:@selector(closeCastDialog:)])
    [NNCoreEngine closeCastDialog:[payload[@"id"] intValue]];
}

- (void)engine:(NNCoreEngine *)engine castRoutes:(NSArray *)routes profile:(NNCoreProfile *)profile {
  if (gChromeUIHandler)
    gChromeUIHandler(@"castRoutes", @{@"profile" : nncore_host::ProfileName(profile), @"routes" : routes ?: @[]});
}

- (void)engine:(NNCoreEngine *)engine extensionSidePanel:(NSDictionary *)panel tab:(NNCoreTab *)tab {
  NSMutableDictionary *payload = [panel mutableCopy];
  payload[@"browserId"] = @(tab ? nncore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"sidePanel", payload);
}

- (void)engine:(NNCoreEngine *)engine extensionInstallPrompt:(NSDictionary *)prompt tab:(NNCoreTab *)tab {
  NSMutableDictionary *payload = [prompt mutableCopy];
  payload[@"browserId"] = @(tab ? nncore_host::BrowserId(tab) : 0);
  // Answered or not, it waits in the engine; the JS asks again after a reload (it listens from launch).
  gInstallPrompts[payload[@"requestId"] ?: @""] = payload;
  if (gExtensionsEventHandler) gExtensionsEventHandler(@"installPrompt", payload);
}

- (void)engine:(NNCoreEngine *)engine permissionRequestDismissed:(NSString *)requestId {
  if (gEventHandler) gEventHandler(@"permissionDismissed", @{@"id" : requestId ?: @""});
}

- (NNCoreWindow *)engineWindowForNewBrowserOfProfile:(NNCoreProfile *)profile type:(NSString *)type {
  // Normal and popup windows Chrome makes (chrome.windows.create): a hidden window of ours holds the Browser, and its
  // tabs go to the app's windows as tabs Chrome made (tab:<id>), live, as the app places them. Undocked DevTools and
  // Picture in Picture keep Chrome's own windows.
  if (![type isEqualToString:@"normal"] && ![type isEqualToString:@"popup"]) return nil;
  return [NNCoreWindowController strayWindowForProfile:profile].coreWindow;
}

@end

// MARK: - NNCoreHost

@implementation NNCoreHost

+ (int)runWithArgc:(int)argc argv:(char **)argv delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate {
  const char *dataDir = getenv("NETNYAHOO_DATA_DIR");
  // A data dir from the environment is a test or development instance's scratch one: it keeps off the login
  // keychain too. Without one, a release build has its own folder, apart from the CEF build's (the two can run side
  // by side); a development build refuses (it never falls back to a real profile).
  gScratchDataDir = dataDir && *dataDir;
  if (!gScratchDataDir) {
#if DEBUG
    fprintf(stderr, "[nncore] set NETNYAHOO_DATA_DIR to a scratch directory\n");
    return 1;
#else
    NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    NSString *own = [support stringByAppendingPathComponent:@"Netnyahoo NNCore"];
    setenv("NETNYAHOO_DATA_DIR", own.fileSystemRepresentation, 1);
    dataDir = getenv("NETNYAHOO_DATA_DIR");
#endif
  }
  gMakeDelegate = [makeDelegate copy];
  gDataDirectory = [@(dataDir) stringByAppendingPathComponent:@"Chromium"];
  [NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:nil];
  nncore_host::InstallActivationGuardsEarly();
  nncore_host::PrepareContentBlocker();
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitWillFinish = true;
                                                if (gAppDelegate || NSApp.delegate) return;
                                                gBootstrap = [NNCoreBootstrapDelegate new];
                                                NSApp.delegate = gBootstrap;
                                              }];
  if (getenv("NETNYAHOO_TRACE_VISIBILITY")) {
    // What can hide every page at once: a window's occlusion (macOS's or Chrome's own checker), displays asleep, the
    // session going inactive (screen locked).
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidChangeOcclusionStateNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *note) {
                                                  NSWindow *w = note.object;
                                                  id chrome = [w respondsToSelector:NSSelectorFromString(@"isOccluded")]
                                                                  ? [w valueForKey:@"occluded"] : nil;
                                                  NSLog(@"[nncore-vis] window %ld occlusion macOSVisible=%d chromeOccluded=%@ fromChecker=%d",
                                                        (long)w.windowNumber, (w.occlusionState & NSWindowOcclusionStateVisible) != 0,
                                                        chrome, note.userInfo.count > 0);
                                                }];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[ NSWorkspaceScreensDidSleepNotification, NSWorkspaceScreensDidWakeNotification,
                                        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceSessionDidBecomeActiveNotification ])
      [workspace addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
        NSLog(@"[nncore-vis] workspace %@", note.name);
      }];
  }
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitDidFinish = true;
                                                // After the delegate's own applicationDidFinishLaunching: (AppKit
                                                // calls it from this same notification, in no set order).
                                                if (!gPendingLaunchURLs.count) return;
                                                dispatch_async(dispatch_get_main_queue(), ^{
                                                  NSArray<NSURL *> *urls = gPendingLaunchURLs;
                                                  gPendingLaunchURLs = nil;
                                                  if (urls.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
                                                    [gAppDelegate application:NSApp openURLs:urls];
                                                });
                                              }];

  std::vector<std::string> extra = {
      "--user-data-dir=" + std::string(gDataDirectory.UTF8String),
      "--enable-smooth-scrolling",
      "--disable-stack-profiler",
      "--disable-features=MacAppCodeSignClone",
      "--enable-features=WebContentsDiscard",
      // Chrome otherwise starts in the profile last used (Local State), and Personal is the Default directory
      // (packages/cef does the same, a4ffd530).
      "--profile-directory=Default",
  };
  // Test instances keep off the login keychain (as packages/cef does with a data dir).
  if (gScratchDataDir) extra.push_back("--use-mock-keychain");
  // A background (test) instance shares the screen with the owner's windows: when one of theirs covers it, Chrome
  // marks its pages hidden (WebContentsOcclusionCheckerMac / macOS occlusion) and drops their input, so a run's
  // results would depend on what the owner has open. Chrome's own browser tests use this switch for the same
  // reason. NETNYAHOO_ALLOW_OCCLUSION=1 keeps Chrome's behaviour (the acceptance run's occlusion check uses it).
  if (getenv("NETNYAHOO_BACKGROUND") && !getenv("NETNYAHOO_ALLOW_OCCLUSION"))
    extra.push_back("--disable-backgrounding-occluded-windows");
  if (const char *port = getenv("NETNYAHOO_REMOTE_DEBUGGING_PORT")) {
    extra.push_back(std::string("--remote-debugging-port=") + port);
    extra.push_back("--remote-allow-origins=*");
  }
  if (const char *switches = getenv("NETNYAHOO_CHROMIUM_SWITCHES")) {
    NSString *all = [@" " stringByAppendingString:@(switches)];
    for (NSString *item in [all componentsSeparatedByString:@" --"]) {
      NSString *sw = [item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      if (sw.length) extra.push_back(std::string("--") + sw.UTF8String);
    }
  }
  std::vector<const char *> args(argv, argv + argc);
  for (const std::string &s : extra) args.push_back(s.c_str());
  static NNCoreHostEngineDelegate *engineDelegate = [NNCoreHostEngineDelegate new];
  return [NNCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:engineDelegate];
}

+ (void (^)(NSString *, NSDictionary *))eventHandler {
  return gEventHandler;
}

+ (void)setEventHandler:(void (^)(NSString *, NSDictionary *))handler {
  gEventHandler = [handler copy];
}

+ (void (^)(NSString *, NSDictionary *))extensionsEventHandler {
  return gExtensionsEventHandler;
}

+ (void)setExtensionsEventHandler:(void (^)(NSString *, NSDictionary *))handler {
  gExtensionsEventHandler = [handler copy];
  // Prompts still waiting (the JS reloaded, or listened late) come again.
  if (handler)
    for (NSDictionary *prompt in gInstallPrompts.allValues) handler(@"installPrompt", prompt);
}

+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
  [gInstallPrompts removeObjectForKey:requestId ?: @""];
  if ([NNCoreEngine respondsToSelector:@selector(resolveExtensionInstallPrompt:accepted:)])
    [NNCoreEngine resolveExtensionInstallPrompt:requestId accepted:accepted];
}

+ (void)beginTracing:(void (^)(BOOL))completion {
  if (![NNCoreEngine respondsToSelector:@selector(beginTracing:)]) return completion(NO);
  [NNCoreEngine beginTracing:completion];
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  if (![NNCoreEngine respondsToSelector:@selector(endTracing:completion:)]) return completion(nil);
  [NNCoreEngine endTracing:keep completion:completion];
}

+ (BOOL)isTracing {
  return [NNCoreEngine respondsToSelector:@selector(isTracing)] && NNCoreEngine.isTracing;
}

+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *))completion {
  // The default profile can't go (it backs private windows): as packages/cef, its data is cleared through Chrome's
  // own stores instead; that sequence lives in packages/cef's ProfileData for now.
  if (nncore_host::IsIncognito(profile)) return completion(@[]);
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  NNCoreProfile *p = nncore_host::LoadedProfile(profile);
  if (!profile.length || ![engine respondsToSelector:@selector(deleteProfile:completion:)]) return completion(@[ @"data" ]);
  void (^remove)(NNCoreProfile *) = ^(NNCoreProfile *loaded) {
    if (!loaded) {
      // Never loaded this session: its folder alone.
      NSString *path = [gDataDirectory stringByAppendingPathComponent:[@"Profile " stringByAppendingString:profile]];
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      return completion([NSFileManager.defaultManager fileExistsAtPath:path] ? @[ @"files" ] : @[]);
    }
    [engine deleteProfile:loaded completion:^(BOOL deleted) {
      if (deleted) [Profiles() removeObjectForKey:profile];
      completion(deleted ? @[] : @[ @"data" ]);
    }];
  };
  // Loading a profile only to delete it would create it (and race Chrome writing its folder): one this session never
  // loaded is its folder alone.
  remove(p);
}

+ (void)releaseProfile:(NSString *)profile {
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  NNCoreProfile *p = nncore_host::LoadedProfile(profile);
  if (p && [engine respondsToSelector:@selector(releaseProfile:)]) [engine releaseProfile:p];
  if (nncore_host::IsIncognito(profile)) [Profiles() removeObjectForKey:profile];
}

+ (BOOL)stopCapture:(int)browserId {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(stopCapture)] && [tab stopCapture];
}

+ (BOOL)showAutofillSuggestions:(int)browserId passwords:(BOOL)passwords {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showAutofillSuggestions:)] && [tab showAutofillSuggestions:passwords];
}

+ (void (^)(NSString *, NSDictionary *))chromeUIHandler {
  return gChromeUIHandler;
}

+ (void)setChromeUIHandler:(void (^)(NSString *, NSDictionary *))handler {
  gChromeUIHandler = [handler copy];
}

+ (void)deviceChooser:(int)chooserId select:(int)index {
  if ([NNCoreEngine respondsToSelector:@selector(selectDevice:index:)]) [NNCoreEngine selectDevice:chooserId index:index];
}

+ (void)deviceChooser:(int)chooserId action:(NSString *)action {
  if ([action isEqualToString:@"cancel"] && [NNCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [NNCoreEngine cancelDeviceChooser:chooserId];
  else if ([action isEqualToString:@"refresh"] && [NNCoreEngine respondsToSelector:@selector(refreshDeviceChooser:)])
    [NNCoreEngine refreshDeviceChooser:chooserId];
  else if ([action isEqualToString:@"settings"] && [NNCoreEngine respondsToSelector:@selector(openDeviceChooserSettings:)])
    [NNCoreEngine openDeviceChooserSettings:chooserId];
}

// "Share this tab instead": the capture moves to the target tab (Chrome's tab-sharing infobar's own action).
+ (BOOL)shareTabInstead:(int)targetBrowserId {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(targetBrowserId);
  return [tab respondsToSelector:@selector(shareThisTabInstead)] && tab.canShareThisTabInstead && [tab shareThisTabInstead];
}

+ (BOOL)showCastDialog:(int)browserId {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showCastDialog)] && [tab showCastDialog];
}

+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode {
  if ([NNCoreEngine respondsToSelector:@selector(startCasting:sink:mode:)]) [NNCoreEngine startCasting:dialogId sink:sink mode:mode];
}

+ (void)castDialog:(int)dialogId stop:(NSString *)route {
  if ([NNCoreEngine respondsToSelector:@selector(stopCasting:route:)]) [NNCoreEngine stopCasting:dialogId route:route];
}

+ (void)closeCastDialog:(int)dialogId {
  if ([NNCoreEngine respondsToSelector:@selector(closeCastDialog:)]) [NNCoreEngine closeCastDialog:dialogId];
}

+ (void)watchCastRoutes:(NSString *)profileName {
  nncore_host::WithProfile(profileName, ^(NNCoreProfile *profile) {
    if ([profile respondsToSelector:@selector(watchCastRoutes)]) [profile watchCastRoutes];
  });
}

+ (void)terminateCastRoute:(NSString *)route {
  if ([NNCoreEngine respondsToSelector:@selector(terminateCastRoute:)]) [NNCoreEngine terminateCastRoute:route];
}

+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  if ([NNCoreEngine respondsToSelector:@selector(resolveExternalApp:open:remember:)])
    [NNCoreEngine resolveExternalApp:requestId open:open remember:remember];
}

+ (NSDictionary *)actionStates:(int)browserId extensions:(NSArray<NSString *> *)ids {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(actionStatesForExtensions:)] ? [tab actionStatesForExtensions:ids] ?: @{} : @{};
}

+ (NSString *)sidePanelURL:(int)browserId extension:(NSString *)extensionId {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(sidePanelURLForExtension:)] ? [tab sidePanelURLForExtension:extensionId] : nil;
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  if ([engine respondsToSelector:@selector(resolvePermission:result:remember:)])
    [engine resolvePermission:requestId result:result remember:remember];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)displayMediaSources {
  NSMutableArray *sources = [NSMutableArray array];
  NSUInteger index = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    index++;
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"screen:%u:0", display.unsignedIntValue],
      @"kind" : @"screen",
      @"name" : screen.localizedName ?: [NSString stringWithFormat:@"Screen %lu", (unsigned long)index],
      @"width" : @(screen.frame.size.width),
      @"height" : @(screen.frame.size.height),
    }];
  }
  NSArray *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  const pid_t me = getpid();
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowOwnerPID] intValue] == me) continue;
    NSDictionary *bounds = w[(id)kCGWindowBounds];
    const CGFloat width = [bounds[@"Width"] doubleValue], height = [bounds[@"Height"] doubleValue];
    if (width < 50 || height < 50) continue;
    NSString *app = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = w[(id)kCGWindowName];
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"window:%u:0", [w[(id)kCGWindowNumber] unsignedIntValue]],
      @"kind" : @"window",
      @"name" : title.length ? title : app,
      @"app" : app,
      @"pid" : w[(id)kCGWindowOwnerPID] ?: @0,
      @"width" : @(width),
      @"height" : @(height),
    }];
  }
  return sources;
}

+ (BOOL)isStarted {
  return gStarted;
}

+ (NSString *)dataDirectory {
  return gDataDirectory ?: @"";
}

+ (NSDictionary<NSString *, id> *)engineInfo {
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  NSInteger chromeWindows = 0;
  for (NNCoreWindowController *c in NNCoreWindowController.all) chromeWindows += c.coreWindow ? 1 : 0;
  return @{
    @"pid" : @(NSProcessInfo.processInfo.processIdentifier),
    @"dataDirectory" : gDataDirectory ?: @"",
    @"cefVersion" : @"nncore",
    @"engine" : @"nncore",
    @"chromiumVersion" : engine.chromiumVersion ?: @"",
    @"liveBrowsers" : @0,
    @"popupWindows" : @0,
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)chromeWindows {
  NSMutableArray *list = [NSMutableArray array];
  for (NNCoreWindowController *c in NNCoreWindowController.all) {
    NSWindow *w = c.coreWindow.window;
    if (!w) continue;
    NNCoreProfile *active = c.coreWindow.activeProfile;
    [list addObject:@{
      @"profile" : nncore_host::ProfileName(active),
      @"window" : @(w.windowNumber),
      @"frame" : NSStringFromRect(w.frame),
      @"alpha" : @(w.alphaValue),
      @"key" : @(w.isKeyWindow),
      @"canBecomeKey" : @(w.canBecomeKeyWindow),
      @"visible" : @(w.isVisible),
      // How Chrome sees it: macOS's occlusion state, and Chrome's own occlusion checker (pages of an occluded
      // window are hidden).
      @"occlusionVisible" : @((w.occlusionState & NSWindowOcclusionStateVisible) != 0),
      @"chromeOccluded" : [w respondsToSelector:NSSelectorFromString(@"isOccluded")] ? [w valueForKey:@"occluded"] : NSNull.null,
      @"parentWindow" : @(w.parentWindow.windowNumber),
      @"chromeWindows" : @1,
      @"anchorBrowserId" : @0,
      @"anyTabBrowserId" : @0,
      @"ready" : @YES,
      @"active" : @(w.isMainWindow),
      @"pageInsets" : @[ @0, @0, @0, @0 ],
      @"hosting" : @(c.root != nil),
      @"group" : @"",
      @"hasRoot" : @(c.root != nil),
      @"translucent" : @(!w.opaque),
    }];
  }
  return list;
}

@end

// MARK: - Profiles

namespace nncore_host {

NSArray<NNCoreProfile *> *LoadedProfiles() {
  NSMutableArray *profiles = [NSMutableArray array];
  for (NNCoreProfile *profile in Profiles().allValues)
    if (![profiles containsObject:profile]) [profiles addObject:profile];
  return profiles;
}

bool IsIncognito(NSString *name) {
  return [name hasPrefix:@"incognito"];
}

NNCoreProfile *LoadedProfile(NSString *name) {
  return Profiles()[name ?: @""];
}

void WithProfile(NSString *name, void (^completion)(NNCoreProfile *)) {
  name = name ?: @"";
  if (NNCoreProfile *profile = Profiles()[name]) return completion(profile);
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  if (!engine) return completion(nil);
  if (IsIncognito(name)) {
    // A private window's profile is Personal's off-the-record one.
    return WithProfile(@"", ^(NNCoreProfile *base) {
      if (NNCoreProfile *known = Profiles()[name]) return completion(known);
      NNCoreProfile *otr = base && [engine respondsToSelector:@selector(offTheRecordProfileFor:)]
                               ? [engine offTheRecordProfileFor:base]
                               : nil;
      if (otr) Profiles()[name] = otr;
      completion(otr);
    });
  }
  if (name.length == 0) {
    if (NNCoreProfile *personal = PersonalIfLoaded(engine)) {
      Profiles()[@""] = personal;
      return completion(personal);
    }
  }
  NSMutableArray *waiters = ProfileWaiters()[name];
  if (waiters) return (void)[waiters addObject:[completion copy]];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:[completion copy]];
  [engine loadProfile:DirectoryName(name)
           completion:^(NNCoreProfile *profile) {
             if (profile) Profiles()[name] = profile;
             if (profile) nncore_host::LoadContentBlocker(name);
             if (profile) [NNCoreServices watchDownloads:name];
             NSArray *pending = ProfileWaiters()[name];
             [ProfileWaiters() removeObjectForKey:name];
             for (void (^waiter)(NNCoreProfile *) in pending) waiter(profile);
           }];
}

// Chrome's Default profile, if it's the one Chrome has loaded as its "last used" (Chrome starts with
// --profile-directory=Default, so normally yes); else WithProfile loads it by its directory.
NNCoreProfile *PersonalIfLoaded(NNCoreEngine *engine) {
  NNCoreProfile *profile = engine.defaultProfile;
  return [profile.name isEqualToString:@"Default"] ? profile : nil;
}

NSString *ProfileName(NNCoreProfile *profile) {
  if (!profile) return @"";
  for (NSString *name in Profiles())
    if (Profiles()[name] == profile) return name;
  NSString *dir = profile.name;
  if ([dir hasPrefix:@"Profile "]) return [dir substringFromIndex:8];
  return @"";
}

NSString *AppDisposition(NSString *chrome) {
  static NSDictionary *map = @{
    @"foreground_tab" : @"foreground",
    @"background_tab" : @"background",
    @"popup" : @"popup",
    @"window" : @"window",
    @"off_the_record" : @"incognito",
    @"current_tab" : @"current",
    @"split_view" : @"split",
    @"singleton_tab" : @"foreground",
  };
  return map[chrome] ?: @"foreground";
}

}  // namespace nncore_host
