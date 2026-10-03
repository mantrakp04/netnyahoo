// The app on NNCore: Chromium owns the process and the run loop (ChromeMain → MessagePumpNSApplication →
// [NSApp run]); the React Native host starts inside it once the engine is up. There is no external pump and no
// second Chromium: NSApp is Chrome's BrowserCrApplication, and NNCore makes -terminate: follow Cocoa's
// applicationShouldTerminate: contract, so the app's own quit flow (ShellApp.shouldTerminate) runs as on CEF.
#import <Security/Security.h>
#import <objc/runtime.h>

#import "NNCoreInternal.h"
#import "NNCoreServices.h"
#import "NNCoreNavigationDownloads.h"
#import "NNCoreStartup.h"
#import "NNCoreWebView.h"

#include <cctype>
#include <cstring>
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

// Profiles deleted this session: never loaded again. A background service still working for one (the content
// blocker's per-profile messages) would otherwise load it right back, keeping it from being deleted or making its
// folder again. The app never reuses a profile's id.
NSMutableSet<NSString *> *DeletedProfiles() {
  static NSMutableSet *deleted = [NSMutableSet set];
  return deleted;
}

// A deletion asked for while the profile was still loading: run once Chrome has it, through Chrome's deletion.
NSMutableDictionary<NSString *, void (^)(NNCoreProfile *)> *DeletionsAfterLoad() {
  static NSMutableDictionary *deletions = [NSMutableDictionary dictionary];
  return deletions;
}

NSString *DirectoryName(NSString *name) {
  return name.length ? [@"Profile " stringByAppendingString:name] : @"Default";
}

// The installed app's Chrome user data dir, the one the CEF releases (0.2.21 and earlier) used, so an update from one
// opens the same data in place. Nothing is copied or converted: both are Chromium 154.0.8037.58 with the same
// profile layout ("Default", "Profile <id>") and the same Safe Storage keychain item ("Netnyahoo Safe Storage"), and
// the app's documents stay in the folder above (ShellModule.documentURL). The release smoke test's carryover check
// (.claude/skills/release/scripts/carryover.sh) opens a previous release's data this way.
NSString *InstalledDataDirectory() {
  NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.netnyahoo.browser";
  return [[support stringByAppendingPathComponent:bundleId] stringByAppendingPathComponent:@"Chromium"];
}

// Signed by a team (a Developer ID release): only those use the login keychain, as the CEF releases did. The Safe
// Storage item trusts the signed app, so an ad hoc build reading it would make macOS ask for the password.
bool IsTeamSigned() {
  SecCodeRef code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return false;
  CFDictionaryRef info = nullptr;
  OSStatus status = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) return false;
  bool team = CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier) != nullptr;
  CFRelease(info);
  return team;
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
  // Again, over any handlers Chrome installed while it started.
  if (gScratchDataDir && nncore_host::Background())
    nncore_host::InstallTestCrashGuard([gDataDirectory stringByDeletingLastPathComponent]);
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

// The app's quit flow (ShellApp, packages/shell) hears it as this notification, in a pod that doesn't link this one.
- (void)engineQuitCancelled {
  NSLog(@"[nncore] quit cancelled");
  [NSNotificationCenter.defaultCenter postNotificationName:@"NNCoreQuitCancelled" object:nil];
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
  // keychain too. Without one, a release build uses the installed app's (InstalledDataDirectory), and a development
  // build refuses (it never falls back to a real profile). The environment stays as it is: the app's other modules
  // read NETNYAHOO_DATA_DIR as "a test instance" (documents, sync keys, telemetry, the update feed).
  gScratchDataDir = dataDir && *dataDir;
#if DEBUG
  if (!gScratchDataDir) {
    fprintf(stderr, "[nncore] set NETNYAHOO_DATA_DIR to a scratch directory\n");
    return 1;
  }
#endif
  gMakeDelegate = [makeDelegate copy];
  NSString *scratch = gScratchDataDir ? @(dataDir) : nil;
  // A relative data dir is the launcher's working directory's (launchd starts the app in "/"), as NNIsolation reads it.
  if (scratch && !scratch.absolutePath)
    scratch = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:scratch];
  gDataDirectory = scratch ? [scratch.stringByStandardizingPath stringByAppendingPathComponent:@"Chromium"] : InstalledDataDirectory();
  NSError *dirError;
  if (![NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    // Chrome would abort on it (a crash report, and macOS's dialog): say why and stop.
    fprintf(stderr, "[nncore] can't use the data dir %s: %s\n", gDataDirectory.fileSystemRepresentation,
            dirError.localizedDescription.UTF8String ?: "");
    return 1;
  }
  nncore_host::InstallTestCrashGuard(scratch && nncore_host::Background() ? scratch.stringByStandardizingPath : nil);
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
      // Chrome holds its BEST_EFFORT tasks (the UI thread's queues and the thread pool's) until startup is complete,
      // which waits for a visible tab to load, else 3 minutes. The app's own New Tab page is no tab, so a launch on it
      // held them that long (a trace was never written: endTracing didn't answer). ImprovedStartupBestEffortDelay stops
      // waiting 5 s after launch when no tab shows (Chrome's fix for the Mac's zero-window mode), and still waits for a
      // restored page to load; StartupDelayStopOnLoadingTimedOut keeps the default's end for a page that never loads.
      "--enable-features=WebContentsDiscard,ImprovedStartupBestEffortDelay:StartupDelayStopOnLoadingTimedOut/true",
      // Chrome otherwise starts in the profile last used (Local State), and Personal is the Default directory
      // (packages/cef does the same, a4ffd530).
      "--profile-directory=Default",
  };
  // Test instances (a scratch data dir) and ad hoc builds keep off the login keychain, as the CEF releases did. Never
  // anything else: the installed data's cookies and passwords are encrypted with the real key, and Chrome drops what
  // it can't decrypt. (The release's carryover check runs the installed-data path on ad hoc copies.)
  if (gScratchDataDir || !IsTeamSigned()) extra.push_back("--use-mock-keychain");
  nncore_host::PrepareStartup(gDataDirectory, extra);
  // A background (test) instance shares the screen with the owner's windows: when one of theirs covers it, Chrome
  // marks its pages hidden (WebContentsOcclusionCheckerMac / macOS occlusion) and drops their input, so a run's
  // results would depend on what the owner has open. Chrome's own browser tests use this switch for the same
  // reason. NETNYAHOO_ALLOW_OCCLUSION=1 keeps Chrome's behaviour (the acceptance run's occlusion check uses it).
  if (getenv("NETNYAHOO_BACKGROUND") && !getenv("NETNYAHOO_ALLOW_OCCLUSION")) {
    extra.push_back("--disable-backgrounding-occluded-windows");
    // The switch makes an occluded page visible, but only once Chrome marks it occluded, and WebContentsViewCocoa
    // waits a second to do that: in a covered window, every tab shown (a switch, a new tab) stayed hidden for a
    // second (the 0.2.22 perf gate's 1031 ms switches). Chrome's occlusion flag (-[NSWindow isOccluded], set by
    // WebContentsOcclusionCheckerMac) is read only there; a test instance's windows are never occluded to it.
    if (Method occluded = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(@"isOccluded")))
      method_setImplementation(occluded, imp_implementationWithBlock(^BOOL(id) { return NO; }));
  }
  // Nor may it make a sound on the owner's Mac (a test page's media, a video it plays). NETNYAHOO_ALLOW_AUDIO=1 keeps
  // the sound for a test that needs to hear it.
  if (getenv("NETNYAHOO_BACKGROUND") && !getenv("NETNYAHOO_ALLOW_AUDIO")) extra.push_back("--mute-audio");
  // Nor use the Mac's camera or microphone, or make macOS ask the owner for them: capture comes from Chrome's fake
  // devices, which macOS never gates (the engine keeps the microphone on a fake input, nn_fake_media.mm).
  if (getenv("NETNYAHOO_BACKGROUND")) extra.push_back("--use-fake-device-for-media-stream");
  // Nor animate a tab-modal dialog's close: Chrome closes one when its NSAnimation ends, and with the screen locked
  // AppKit never advances it, so the dialog stayed on screen for the rest of a run (a print preview after its page
  // navigated; the tab-capture picker after Chrome picked the tab, and Chrome's autofill dropdown refuses to open over
  // a visible dialog). Chrome's own tests of both dialogs use the switch for the same reason.
  if (getenv("NETNYAHOO_BACKGROUND")) extra.push_back("--disable-modal-animations");
  // Chrome's switches that answer capture prompts by themselves pick the fake list's "default" microphone, which is the
  // Mac's real one: a test instance never takes them.
  auto autoAccepts = [](const char *sw) {
    return getenv("NETNYAHOO_BACKGROUND") && (!strncmp(sw, "--use-fake-ui-for-media-stream", 30) ||
                                              !strncmp(sw, "--auto-accept-camera-and-microphone-capture", 43));
  };
  if (const char *port = getenv("NETNYAHOO_REMOTE_DEBUGGING_PORT")) {
    extra.push_back(std::string("--remote-debugging-port=") + port);
    extra.push_back("--remote-allow-origins=*");
  }
  if (const char *switches = getenv("NETNYAHOO_CHROMIUM_SWITCHES")) {
    NSString *all = [@" " stringByAppendingString:@(switches)];
    for (NSString *item in [all componentsSeparatedByString:@" --"]) {
      NSString *sw = [item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      std::string full = std::string("--") + sw.UTF8String;
      if (sw.length && !autoAccepts(full.c_str())) extra.push_back(full);
    }
  }
  // Cocoa's argument-domain defaults ("-NSAppSleepDisabled YES", as the perf bench passes) are AppKit's, read from the
  // process's own arguments: Chrome would take the value for a URL to open, so its command line goes without them.
  // The host's switches go first, right after the program: Chrome stops reading switches at a "--", and the data dir
  // must never be lost to one (PreSandboxStartup CHECKs that Chrome has it).
  std::vector<const char *> args = {argc > 0 && argv[0] ? argv[0] : "Netnyahoo"};
  for (const std::string &s : extra) args.push_back(s.c_str());
  for (int i = 1; i < argc; i++) {
    const char *arg = argv[i];
    if (!arg) break;
    const bool cocoaDefault = arg[0] == '-' && arg[1] != '-' && isalpha((unsigned char)arg[1]) &&
                              strncmp(arg, "-psn_", 5) != 0 && i + 1 < argc;
    if (cocoaDefault) {
      i++;
      continue;
    }
    if (autoAccepts(arg)) continue;
    args.push_back(arg);
  }
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
  [DeletedProfiles() addObject:profile];
  void (^remove)(NNCoreProfile *) = ^(NNCoreProfile *loaded) {
    if (!loaded) {
      // Never loaded this session: its folder alone.
      NSString *path = [gDataDirectory stringByAppendingPathComponent:[@"Profile " stringByAppendingString:profile]];
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      return completion([NSFileManager.defaultManager fileExistsAtPath:path] ? @[ @"files" ] : @[]);
    }
    [engine deleteProfile:loaded completion:^(BOOL deleted) {
      if (deleted) [Profiles() removeObjectForKey:profile];
      else [DeletedProfiles() removeObject:profile];
      completion(deleted ? @[] : @[ @"data" ]);
    }];
  };
  // Still loading: deleted once Chrome has it (deleting its folder now would race Chrome making it).
  if (!p && ProfileWaiters()[profile]) {
    DeletionsAfterLoad()[profile] = [remove copy];
    return;
  }
  // Loading a profile only to delete it would create it (and race Chrome writing its folder): one this session never
  // loaded is its folder alone.
  remove(p);
}

+ (void)releaseProfile:(NSString *)profile {
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  NNCoreProfile *p = nncore_host::LoadedProfile(profile);
  if (nncore_host::IsIncognito(profile)) {
    [Profiles() removeObjectForKey:profile];
    // Still being asked for (WithPrivateProfile): whoever waits gets none.
    NSArray *waiting = ProfileWaiters()[profile];
    [ProfileWaiters() removeObjectForKey:profile];
    for (void (^waiter)(NNCoreProfile *) in waiting) waiter(nil);
    nncore_host::ForgetPrivateNavigationDownloads(profile);
    // Every private window shares the one off-the-record profile: it goes only once no other private window of the
    // app holds it, even one whose window isn't made yet.
    if ([Profiles().allValues containsObject:p]) return;
  }
  if (p && [engine respondsToSelector:@selector(releaseProfile:)]) [engine releaseProfile:p];
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

// Tests (--netnyahoo-test-external-protocol-no-launch): the app links Chrome recorded instead of launching them.
+ (NSArray<NSDictionary *> *)testExternalLaunches {
  return NNCoreEngine.testExternalLaunches ?: @[];
}

// Tests (--netnyahoo-test-bluetooth-chooser): Chrome's Bluetooth chooser with no adapter, and its recorded choices.
+ (BOOL)devShowBluetoothChooser:(int)browserId unauthorized:(BOOL)unauthorized {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(devShowBluetoothChooser:)] && [tab devShowBluetoothChooser:unauthorized];
}

+ (NSArray<NSDictionary *> *)testChooserEvents {
  return [NNCoreEngine respondsToSelector:@selector(testChooserEvents)] ? NNCoreEngine.testChooserEvents ?: @[] : @[];
}

// "Share this tab instead": the capturer's capture (and no other share's) moves to the target tab (Chrome's tab-sharing
// infobar's own action, on that share's bar).
+ (BOOL)shareTabInstead:(int)capturerBrowserId target:(int)targetBrowserId {
  NNCoreTab *capturer = nncore_host::TabWithBrowserId(capturerBrowserId);
  NNCoreTab *tab = nncore_host::TabWithBrowserId(targetBrowserId);
  return capturer && [tab respondsToSelector:@selector(shareThisTabInsteadFor:)] && [tab shareThisTabInsteadFor:capturer];
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
    @"popupWindows" : @(nncore_host::PopupWindowCount()),
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
    // Chrome's last-used profile (what tab sharing and Chrome-made windows follow), by directory.
    @"lastUsedProfile" : engine.defaultProfile.name ?: @"",
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

// Profiles Chrome destroyed (a private profile once its last window closed, a deleted one) leave the cache: a
// window or tab never gets one (WindowHost::BrowserFor crashed on its null Profile in the 0.2.22 RC).
void ForgetDestroyedProfiles() {
  for (NSString *name in Profiles().allKeys)
    if (Profiles()[name].destroyed) [Profiles() removeObjectForKey:name];
}

NSArray<NNCoreProfile *> *LoadedProfiles() {
  ForgetDestroyedProfiles();
  NSMutableArray *profiles = [NSMutableArray array];
  for (NNCoreProfile *profile in Profiles().allValues)
    if (![profiles containsObject:profile]) [profiles addObject:profile];
  return profiles;
}

bool IsIncognito(NSString *name) {
  return [name hasPrefix:@"incognito"];
}

NNCoreProfile *LoadedProfile(NSString *name) {
  NNCoreProfile *profile = Profiles()[name ?: @""];
  if (!profile.destroyed) return profile;
  [Profiles() removeObjectForKey:name ?: @""];
  return nil;
}

namespace {

// A private window's profile: Personal's off-the-record one, never Personal itself. While the last one is still
// being destroyed the engine answers once it has gone, with a new one. Asked once per name at a time; when the name is
// released meanwhile (its window closed, +releaseProfile:), a profile nobody holds goes again.
void WithPrivateProfile(NSString *name, void (^completion)(NNCoreProfile *)) {
  if (NSMutableArray *waiters = ProfileWaiters()[name]) return (void)[waiters addObject:completion];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:completion];
  WithProfile(@"", ^(NNCoreProfile *base) {
    NNCoreEngine *engine = NNCoreEngine.sharedEngine;
    void (^answer)(NNCoreProfile *, NSString *) = ^(NNCoreProfile *otr, NSString *error) {
      NSArray *pending = ProfileWaiters()[name];
      [ProfileWaiters() removeObjectForKey:name];
      if (!pending) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        return;
      }
      if (otr && !otr.destroyed) Profiles()[name] = otr;
      else NSLog(@"[nncore] no private profile for %@: %@", name, error ?: @"it went");
      for (void (^waiter)(NNCoreProfile *) in pending) waiter(Profiles()[name]);
    };
    if (!base) return answer(nil, @"Personal isn't loaded");
    if (![engine respondsToSelector:@selector(offTheRecordProfileFor:completion:)]) return answer(nil, @"the engine is too old");
    [engine offTheRecordProfileFor:base completion:answer];
  });
}

}  // namespace

void WithProfile(NSString *name, void (^completion)(NNCoreProfile *)) {
  name = name ?: @"";
  if ([DeletedProfiles() containsObject:name]) return completion(nil);
  if (NNCoreProfile *profile = LoadedProfile(name)) return completion(profile);
  NNCoreEngine *engine = NNCoreEngine.sharedEngine;
  if (!engine) return completion(nil);
  if (IsIncognito(name)) return WithPrivateProfile(name, [completion copy]);
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
           completion:^(NNCoreProfile *loaded) {
             NSArray *pending = ProfileWaiters()[name];
             [ProfileWaiters() removeObjectForKey:name];
             // Deleted while it loaded: it goes now, and nobody waiting gets it.
             if (void (^deletion)(NNCoreProfile *) = DeletionsAfterLoad()[name]) {
               [DeletionsAfterLoad() removeObjectForKey:name];
               deletion(loaded);
             }
             NNCoreProfile *profile = [DeletedProfiles() containsObject:name] ? nil : loaded;
             if (profile) Profiles()[name] = profile;
             if (profile) nncore_host::LoadContentBlocker(name);
             if (profile) [NNCoreServices watchDownloads:name];
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
