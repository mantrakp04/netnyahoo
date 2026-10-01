// The app on NNCore: Chromium owns the process and the run loop (ChromeMain → MessagePumpNSApplication →
// [NSApp run]); the React Native host starts inside it once the engine is up. There is no external pump and no
// second Chromium: NSApp is Chrome's BrowserCrApplication, and NNCore makes -terminate: follow Cocoa's
// applicationShouldTerminate: contract, so the app's own quit flow (ShellApp.shouldTerminate) runs as on CEF.
#import "NNCoreInternal.h"

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
  if (NNCoreProfile *profile = engine.defaultProfile) Profiles()[@""] = profile;

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

// NSApp's delegate as NSApplicationMain would set it, but in Chromium's loop: [NSApp run] already finished
// launching, so the launch callbacks are called here.
- (void)launchApp {
  NSArray<NSURL *> *launchURLs = gBootstrap.urls.copy;
  gAppDelegate = gMakeDelegate();
  NSApp.delegate = gAppDelegate;
  gBootstrap = nil;
  NSNotification *note = [NSNotification notificationWithName:NSApplicationWillFinishLaunchingNotification object:NSApp];
  if ([gAppDelegate respondsToSelector:@selector(applicationWillFinishLaunching:)])
    [gAppDelegate applicationWillFinishLaunching:note];
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

- (NNCoreWindow *)engineWindowForNewBrowserOfProfile:(NNCoreProfile *)profile type:(NSString *)type {
  // Windows Chrome makes itself (chrome.windows.create, an incognito window, undocked DevTools, PiP) keep
  // Chrome's own for now; stage 2 routes normal and popup ones through the app's window manager.
  return nil;
}

@end

// MARK: - NNCoreHost

@implementation NNCoreHost

+ (int)runWithArgc:(int)argc argv:(char **)argv delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate {
  const char *dataDir = getenv("NETNYAHOO_DATA_DIR");
  if (!dataDir || !*dataDir) {
    // A development build: never fall back to a real profile.
    fprintf(stderr, "[nncore] set NETNYAHOO_DATA_DIR to a scratch directory\n");
    return 1;
  }
  gMakeDelegate = [makeDelegate copy];
  gDataDirectory = [@(dataDir) stringByAppendingPathComponent:@"Chromium"];
  [NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:nil];
  nncore_host::InstallActivationGuardsEarly();
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                if (gAppDelegate || NSApp.delegate) return;
                                                gBootstrap = [NNCoreBootstrapDelegate new];
                                                NSApp.delegate = gBootstrap;
                                              }];

  std::vector<std::string> extra = {
      "--user-data-dir=" + std::string(gDataDirectory.UTF8String),
      "--enable-smooth-scrolling",
      "--disable-stack-profiler",
      "--disable-features=MacAppCodeSignClone",
      "--enable-features=WebContentsDiscard",
      // Test instances keep off the login keychain (as packages/cef does with a data dir).
      "--use-mock-keychain",
  };
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
    NNCoreProfile *base = Profiles()[@""] ?: engine.defaultProfile;
    NNCoreProfile *otr = base && [engine respondsToSelector:@selector(offTheRecordProfileFor:)]
                             ? [engine offTheRecordProfileFor:base]
                             : nil;
    if (otr) Profiles()[name] = otr;
    return completion(otr);
  }
  if (name.length == 0 && engine.defaultProfile) {
    Profiles()[@""] = engine.defaultProfile;
    return completion(engine.defaultProfile);
  }
  NSMutableArray *waiters = ProfileWaiters()[name];
  if (waiters) return (void)[waiters addObject:[completion copy]];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:[completion copy]];
  [engine loadProfile:DirectoryName(name)
           completion:^(NNCoreProfile *profile) {
             if (profile) Profiles()[name] = profile;
             NSArray *pending = ProfileWaiters()[name];
             [ProfileWaiters() removeObjectForKey:name];
             for (void (^waiter)(NNCoreProfile *) in pending) waiter(profile);
           }];
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
