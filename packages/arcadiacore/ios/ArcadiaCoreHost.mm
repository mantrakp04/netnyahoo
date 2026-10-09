// The app on ArcadiaCore: Chromium owns the process and the run loop (ChromeMain → MessagePumpNSApplication →
// [NSApp run]); the React Native host starts inside it once the engine is up. There is no external pump and no
// second Chromium: NSApp is Chrome's BrowserCrApplication, and ArcadiaCore makes -terminate: follow Cocoa's
// applicationShouldTerminate: contract, so the app's own quit flow (ShellApp.shouldTerminate) runs as on CEF.
#import <Security/Security.h>
#import <objc/runtime.h>

#import "ArcadiaCoreInternal.h"
#import "ArcadiaCoreServices.h"
#import "ArcadiaCoreNavigationDownloads.h"
#import "ArcadiaCoreStartup.h"
#import "ArcadiaCoreWebView.h"

#include <cctype>
#include <cstring>
#include <string>
#include <vector>

namespace {

id<NSApplicationDelegate> (^gMakeDelegate)(void);
id<NSApplicationDelegate> gAppDelegate;
BOOL gStarted;
NSString *gDataDirectory;

NSMutableDictionary<NSString *, ArcadiaCoreProfile *> *Profiles() {
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

// Private windows' names released (their window closed): a window's name is never used again, so a late request for
// one (a service still finishing for the window) gets no profile, never one that keeps its session alive.
NSMutableSet<NSString *> *ReleasedPrivateNames() {
  static NSMutableSet *released = [NSMutableSet set];
  return released;
}

// A deletion asked for while the profile was still loading: run once Chrome has it, through Chrome's deletion.
NSMutableDictionary<NSString *, void (^)(ArcadiaCoreProfile *)> *DeletionsAfterLoad() {
  static NSMutableDictionary *deletions = [NSMutableDictionary dictionary];
  return deletions;
}

NSString *DirectoryName(NSString *name) {
  return name.length ? [@"Profile " stringByAppendingString:name] : @"Default";
}

// The installed app's Chrome user data dir, the one the CEF releases (0.2.21 and earlier) used, so an update from one
// opens the same data in place. Nothing is copied or converted: both are Chromium 154.0.8037.58 with the same
// profile layout ("Default", "Profile <id>") and the same Safe Storage keychain item ("Arcadia Safe Storage"), and
// the app's documents stay in the folder above (ShellModule.documentURL). The release smoke test's carryover check
// (.claude/skills/release/scripts/carryover.sh) opens a previous release's data this way.
NSString *InstalledDataDirectory() {
  NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.arcadia.browser";
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

// NSApp's delegate from the start of -[NSApp finishLaunching] (inside Chromium's loop, before the engine is up) until
// the app's own is made: a cold launch's open-URL events arrive then, and are handed on once it exists. Being there
// when AppKit registers its Apple event handlers is also what makes AppKit handle GURL events at all (runWithArgc).
@interface ArcadiaCoreBootstrapDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, readonly) NSMutableArray<NSURL *> *urls;
@end

@implementation ArcadiaCoreBootstrapDelegate
- (instancetype)init {
  if ((self = [super init])) _urls = [NSMutableArray array];
  return self;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
  [_urls addObjectsFromArray:urls];
}
@end

namespace {
ArcadiaCoreBootstrapDelegate *gBootstrap;
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

// session.json's hint of the page the app's focused window will show (store/launchTab.ts), from the app's documents
// folder (ShellModule.documentURL): its load starts now, before the app has hydrated (ArcadiaCoreWebView startLaunchTab:).
static void StartLaunchTab() {
  NSString *dir = gScratchDataDir ? [gDataDirectory stringByDeletingLastPathComponent] : nil;
  if (!dir) {
    NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
    dir = [support URLByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier ?: @"Arcadia"].path;
  }
  NSData *data = dir ? [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"session.json"]] : nil;
  NSDictionary *session = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  NSDictionary *hint = [session isKindOfClass:NSDictionary.class] ? session[@"launchTab"] : nil;
  if (![hint isKindOfClass:NSDictionary.class]) return;
  NSString *key = hint[@"id"], *url = hint[@"url"], *profile = hint[@"profile"];
  if (![key isKindOfClass:NSString.class] || ![url isKindOfClass:NSString.class] || ![profile isKindOfClass:NSString.class]) return;
  [ArcadiaCoreWebView startLaunchTab:key url:url profile:profile];
}

// MARK: - Engine delegate

@interface ArcadiaCoreHostEngineDelegate : NSObject <ArcadiaCoreEngineDelegate>
@end

@implementation ArcadiaCoreHostEngineDelegate

- (void)engineDidStart {
  NSLog(@"[arcadiacore] engine started (Chromium %@)", ArcadiaCoreEngine.sharedEngine.chromiumVersion);
  gStarted = YES;
  arcadiacore_host::InstallActivationGuardsLate();
  // Again, over any handlers Chrome installed while it started.
  if (gScratchDataDir && arcadiacore_host::Background())
    arcadiacore_host::InstallTestCrashGuard([gDataDirectory stringByDeletingLastPathComponent]);
  ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
  // Personal ("") is always Chrome's Default profile directory, whichever profile Chrome used last.
  if (ArcadiaCoreProfile *profile = arcadiacore_host::PersonalIfLoaded(engine)) Profiles()[@""] = profile;
  arcadiacore_host::LoadContentBlocker(@"");
  [ArcadiaCoreWebView installScrollZoom];
  [ArcadiaCoreServices watchDownloads:@""];

  // The page script CEF's renderer ran (packages/cef/helper/page_script.js), now ArcadiaCore's.
  NSBundle *bundle = [NSBundle bundleForClass:ArcadiaCoreHostEngineDelegate.class];
  NSString *path = [bundle pathForResource:@"page_script" ofType:@"js"];
  NSString *script = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
  if (script && [engine respondsToSelector:@selector(setPageScript:)]) engine.pageScript = script;

  // React Native starts when the loop first goes idle: Chrome's startup burst holds the main thread right after
  // engineDidStart, and RN's main-queue module setup (Expo's bridge module installing into the JS runtime) must
  // not wait behind it while the JS thread already runs that runtime (RN's debug ReentrancyCheck traps on it).
  CFRunLoopObserverRef idle = CFRunLoopObserverCreateWithHandler(
      nullptr, kCFRunLoopBeforeWaiting, false, 0, ^(CFRunLoopObserverRef observer, CFRunLoopActivity) {
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
        // Once React Native's main-queue setup is done and its thread runs the bundle (the main thread is free until the
        // app opens its windows): started right after launchApp, the page's creation held that setup up ~100 ms.
        __block id started = [NSNotificationCenter.defaultCenter
            addObserverForName:@"RCTJavaScriptWillStartExecutingNotification"
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *) {
                      [NSNotificationCenter.defaultCenter removeObserver:started];
                      started = nil;
                      // On the main queue ahead of anything the bundle asks of it (the app's claim).
                      dispatch_async(dispatch_get_main_queue(), ^{ StartLaunchTab(); });
                    }];
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
    NSLog(@"[arcadiacore] app delegate %@ set before AppKit finished launching", NSStringFromClass([gAppDelegate class]));
    // AppKit sends it the launch callbacks; the URLs the bootstrap delegate held follow them (the
    // DidFinishLaunching observer).
    gPendingLaunchURLs = launchURLs;
    return;
  }
  note = [NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp];
  if ([gAppDelegate respondsToSelector:@selector(applicationDidFinishLaunching:)])
    [gAppDelegate applicationDidFinishLaunching:note];
  NSLog(@"[arcadiacore] app delegate %@ launched", NSStringFromClass([gAppDelegate class]));
  if (launchURLs.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
    [gAppDelegate application:NSApp openURLs:launchURLs];
}

- (void)engineWillShutDown {
  gStarted = NO;
}

// The app's quit flow (ShellApp, packages/shell) hears it as this notification, in a pod that doesn't link this one.
- (void)engineQuitCancelled {
  NSLog(@"[arcadiacore] quit cancelled");
  [NSNotificationCenter.defaultCenter postNotificationName:@"ArcadiaCoreQuitCancelled" object:nil];
}

- (void)engine:(ArcadiaCoreEngine *)engine permissionRequest:(NSDictionary *)request tab:(ArcadiaCoreTab *)tab {
  NSMutableDictionary *payload = [request mutableCopy];
  payload[@"browserId"] = @(tab ? arcadiacore_host::BrowserId(tab) : 0);
  if (gEventHandler) gEventHandler(@"permission", payload);
}

// A page's WebUSB/WebHID/Serial/Bluetooth chooser: the app's sheet (onDeviceChooser), as CEF's ACChromeSurfaces sent
// it; sent again on every change, the last with open NO.
- (void)engine:(ArcadiaCoreEngine *)engine deviceChooser:(NSDictionary *)chooser tab:(ArcadiaCoreTab *)tab {
  NSMutableDictionary *payload = [chooser mutableCopy];
  payload[@"browserId"] = @(tab ? arcadiacore_host::BrowserId(tab) : 0);
  if (auto handler = ArcadiaCoreHost.chromeUIHandler) handler(@"deviceChooser", payload);
  else if ([payload[@"open"] boolValue] && [ArcadiaCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [ArcadiaCoreEngine cancelDeviceChooser:[payload[@"id"] intValue]];
}

// Chrome's Cast dialog for a tab: the app's popover (onCastDialog), as CEF's ACChromeSurfaces sent it.
- (void)engine:(ArcadiaCoreEngine *)engine castDialog:(NSDictionary *)dialog tab:(ArcadiaCoreTab *)tab {
  NSMutableDictionary *payload = [dialog mutableCopy];
  payload[@"browserId"] = @(tab ? arcadiacore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"castDialog", payload);
  else if ([payload[@"open"] boolValue] && [ArcadiaCoreEngine respondsToSelector:@selector(closeCastDialog:)])
    [ArcadiaCoreEngine closeCastDialog:[payload[@"id"] intValue]];
}

- (void)engine:(ArcadiaCoreEngine *)engine castRoutes:(NSArray *)routes profile:(ArcadiaCoreProfile *)profile {
  if (!gChromeUIHandler) return;
  // A private session's routes go to each of its windows' names (the app asks per window).
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  if (profile.offTheRecord)
    for (NSString *name in arcadiacore_host::LoadedProfileNames())
      if (arcadiacore_host::LoadedProfile(name) == profile) [names addObject:name];
  if (!names.count) [names addObject:arcadiacore_host::ProfileName(profile)];
  for (NSString *name in names) gChromeUIHandler(@"castRoutes", @{@"profile" : name, @"routes" : routes ?: @[]});
}

- (void)engine:(ArcadiaCoreEngine *)engine extensionSidePanel:(NSDictionary *)panel tab:(ArcadiaCoreTab *)tab {
  NSMutableDictionary *payload = [panel mutableCopy];
  payload[@"browserId"] = @(tab ? arcadiacore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"sidePanel", payload);
}

// chrome.action.openPopup(): the app shows the popup over that tab's window, as its toolbar button would.
- (BOOL)engine:(ArcadiaCoreEngine *)engine extensionActionPopup:(NSDictionary *)popup tab:(ArcadiaCoreTab *)tab {
  if (!gChromeUIHandler || !tab) {
    NSLog(@"[arcadiacore] action.openPopup for %@: %@", popup[@"extensionId"], tab ? @"the app isn't listening yet" : @"no tab");
    return NO;
  }
  NSMutableDictionary *payload = [popup mutableCopy];
  payload[@"browserId"] = @(arcadiacore_host::BrowserId(tab));
  gChromeUIHandler(@"actionPopup", payload);
  return YES;
}

- (void)engine:(ArcadiaCoreEngine *)engine extensionInstallPrompt:(NSDictionary *)prompt tab:(ArcadiaCoreTab *)tab {
  NSMutableDictionary *payload = [prompt mutableCopy];
  payload[@"browserId"] = @(tab ? arcadiacore_host::BrowserId(tab) : 0);
  // Answered or not, it waits in the engine; the JS asks again after a reload (it listens from launch).
  gInstallPrompts[payload[@"requestId"] ?: @""] = payload;
  if (gExtensionsEventHandler) gExtensionsEventHandler(@"installPrompt", payload);
}

- (void)engine:(ArcadiaCoreEngine *)engine permissionRequestDismissed:(NSString *)requestId {
  if (gEventHandler) gEventHandler(@"permissionDismissed", @{@"id" : requestId ?: @""});
}

- (ArcadiaCoreWindow *)engineWindowForNewBrowserOfProfile:(ArcadiaCoreProfile *)profile type:(NSString *)type {
  // Normal and popup windows Chrome makes (chrome.windows.create): a hidden window of ours holds the Browser, and its
  // tabs go to the app's windows as tabs Chrome made (tab:<id>), live, as the app places them. Undocked DevTools and
  // Picture in Picture keep Chrome's own windows.
  if (![type isEqualToString:@"normal"] && ![type isEqualToString:@"popup"]) return nil;
  return [ArcadiaCoreWindowController strayWindowForProfile:profile].coreWindow;
}

@end

// MARK: - ArcadiaCoreHost

@implementation ArcadiaCoreHost

+ (int)runWithArgc:(int)argc argv:(char **)argv delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate {
  const char *dataDir = getenv("ARCADIA_DATA_DIR");
  // A data dir from the environment is a test or development instance's scratch one: it keeps off the login
  // keychain too. Without one, a release build uses the installed app's (InstalledDataDirectory), and a development
  // build refuses (it never falls back to a real profile). The environment stays as it is: the app's other modules
  // read ARCADIA_DATA_DIR as "a test instance" (documents, sync keys, telemetry, the update feed).
  gScratchDataDir = dataDir && *dataDir;
#if DEBUG
  if (!gScratchDataDir) {
    fprintf(stderr, "[arcadiacore] set ARCADIA_DATA_DIR to a scratch directory\n");
    return 1;
  }
#endif
  gMakeDelegate = [makeDelegate copy];
  NSString *scratch = gScratchDataDir ? @(dataDir) : nil;
  // A relative data dir is the launcher's working directory's (launchd starts the app in "/"), as ACIsolation reads it.
  if (scratch && !scratch.absolutePath)
    scratch = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:scratch];
  gDataDirectory = scratch ? [scratch.stringByStandardizingPath stringByAppendingPathComponent:@"Chromium"] : InstalledDataDirectory();
  NSError *dirError;
  if (![NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    // Chrome would abort on it (a crash report, and macOS's dialog): say why and stop.
    fprintf(stderr, "[arcadiacore] can't use the data dir %s: %s\n", gDataDirectory.fileSystemRepresentation,
            dirError.localizedDescription.UTF8String ?: "");
    return 1;
  }
  arcadiacore_host::InstallTestCrashGuard(scratch && arcadiacore_host::Background() ? scratch.stringByStandardizingPath : nil);
  arcadiacore_host::InstallActivationGuardsEarly();
  arcadiacore_host::PrepareContentBlocker();
  // The bootstrap delegate goes in at the start of -[NSApp finishLaunching], before AppKit registers its Apple event
  // handlers there: AppKit installs its open-URL (GURL) handler only when NSApp.delegate answers
  // application:openURLs: at that moment, and never later. Set from the WillFinishLaunching notification (posted after
  // the registration), it left no GURL handler: 0.2.22 and 0.2.23 dropped every link from other apps. Not earlier:
  // Chrome's startup (ChromeBrowserMainPartsMac::PreCreateThreads) expects no delegate before the loop runs.
  Method finishLaunching = class_getInstanceMethod(NSApplication.class, @selector(finishLaunching));
  IMP appKitFinishLaunching = method_getImplementation(finishLaunching);
  method_setImplementation(finishLaunching, imp_implementationWithBlock(^(NSApplication *app) {
    if (!gAppDelegate && !app.delegate) {
      gBootstrap = [ArcadiaCoreBootstrapDelegate new];
      app.delegate = gBootstrap;
    }
    ((void (*)(id, SEL))appKitFinishLaunching)(app, @selector(finishLaunching));
  }));
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitWillFinish = true;
                                              }];
  if (getenv("ARCADIA_TRACE_VISIBILITY")) {
    // What can hide every page at once: a window's occlusion (macOS's or Chrome's own checker), displays asleep, the
    // session going inactive (screen locked).
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidChangeOcclusionStateNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *note) {
                                                  NSWindow *w = note.object;
                                                  id chrome = [w respondsToSelector:NSSelectorFromString(@"isOccluded")]
                                                                  ? [w valueForKey:@"occluded"] : nil;
                                                  NSLog(@"[arcadiacore-vis] window %ld occlusion macOSVisible=%d chromeOccluded=%@ fromChecker=%d",
                                                        (long)w.windowNumber, (w.occlusionState & NSWindowOcclusionStateVisible) != 0,
                                                        chrome, note.userInfo.count > 0);
                                                }];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[ NSWorkspaceScreensDidSleepNotification, NSWorkspaceScreensDidWakeNotification,
                                        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceSessionDidBecomeActiveNotification ])
      [workspace addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
        NSLog(@"[arcadiacore-vis] workspace %@", note.name);
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
  arcadiacore_host::PrepareStartup(gDataDirectory, extra);
  // A background (test) instance shares the screen with the owner's windows: when one of theirs covers it, Chrome
  // marks its pages hidden (WebContentsOcclusionCheckerMac / macOS occlusion) and drops their input, so a run's
  // results would depend on what the owner has open. Chrome's own browser tests use this switch for the same
  // reason. ARCADIA_ALLOW_OCCLUSION=1 keeps Chrome's behaviour (the acceptance run's occlusion check uses it).
  if (getenv("ARCADIA_BACKGROUND") && !getenv("ARCADIA_ALLOW_OCCLUSION")) {
    extra.push_back("--disable-backgrounding-occluded-windows");
    // The switch makes an occluded page visible, but only once Chrome marks it occluded, and WebContentsViewCocoa
    // waits a second to do that: in a covered window, every tab shown (a switch, a new tab) stayed hidden for a
    // second (the 0.2.22 perf gate's 1031 ms switches). Chrome's occlusion flag (-[NSWindow isOccluded], set by
    // WebContentsOcclusionCheckerMac) is read only there; a test instance's windows are never occluded to it.
    if (Method occluded = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(@"isOccluded")))
      method_setImplementation(occluded, imp_implementationWithBlock(^BOOL(id) { return NO; }));
  }
  // Nor may it make a sound on the owner's Mac (a test page's media, a video it plays). ARCADIA_ALLOW_AUDIO=1 keeps
  // the sound for a test that needs to hear it.
  if (getenv("ARCADIA_BACKGROUND") && !getenv("ARCADIA_ALLOW_AUDIO")) extra.push_back("--mute-audio");
  // Nor use the Mac's camera or microphone, or make macOS ask the owner for them: capture comes from Chrome's fake
  // devices, which macOS never gates (the engine keeps the microphone on a fake input, ac_fake_media.mm).
  if (getenv("ARCADIA_BACKGROUND")) extra.push_back("--use-fake-device-for-media-stream");
  // Nor animate a tab-modal dialog's close: Chrome closes one when its NSAnimation ends, and with the screen locked
  // AppKit never advances it, so the dialog stayed on screen for the rest of a run (a print preview after its page
  // navigated; the tab-capture picker after Chrome picked the tab, and Chrome's autofill dropdown refuses to open over
  // a visible dialog). Chrome's own tests of both dialogs use the switch for the same reason.
  if (getenv("ARCADIA_BACKGROUND")) extra.push_back("--disable-modal-animations");
  // Chrome's switches that answer capture prompts by themselves pick the fake list's "default" microphone, which is the
  // Mac's real one: a test instance never takes them.
  auto autoAccepts = [](const char *sw) {
    return getenv("ARCADIA_BACKGROUND") && (!strncmp(sw, "--use-fake-ui-for-media-stream", 30) ||
                                              !strncmp(sw, "--auto-accept-camera-and-microphone-capture", 43));
  };
  if (const char *port = getenv("ARCADIA_REMOTE_DEBUGGING_PORT")) {
    extra.push_back(std::string("--remote-debugging-port=") + port);
    extra.push_back("--remote-allow-origins=*");
  }
  if (const char *switches = getenv("ARCADIA_CHROMIUM_SWITCHES")) {
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
  std::vector<const char *> args = {argc > 0 && argv[0] ? argv[0] : "Arcadia"};
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
  static ArcadiaCoreHostEngineDelegate *engineDelegate = [ArcadiaCoreHostEngineDelegate new];
  return [ArcadiaCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:engineDelegate];
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
  if ([ArcadiaCoreEngine respondsToSelector:@selector(resolveExtensionInstallPrompt:accepted:)])
    [ArcadiaCoreEngine resolveExtensionInstallPrompt:requestId accepted:accepted];
}

+ (void)beginTracing:(void (^)(BOOL))completion {
  if (![ArcadiaCoreEngine respondsToSelector:@selector(beginTracing:)]) return completion(NO);
  [ArcadiaCoreEngine beginTracing:completion];
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  if (![ArcadiaCoreEngine respondsToSelector:@selector(endTracing:completion:)]) return completion(nil);
  [ArcadiaCoreEngine endTracing:keep completion:completion];
}

+ (BOOL)isTracing {
  return [ArcadiaCoreEngine respondsToSelector:@selector(isTracing)] && ArcadiaCoreEngine.isTracing;
}

+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *))completion {
  // The default profile can't go (it backs private windows): as packages/cef, its data is cleared through Chrome's
  // own stores instead; that sequence lives in packages/cef's ProfileData for now.
  if (arcadiacore_host::IsIncognito(profile)) return completion(@[]);
  ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
  ArcadiaCoreProfile *p = arcadiacore_host::LoadedProfile(profile);
  if (!profile.length || ![engine respondsToSelector:@selector(deleteProfile:completion:)]) return completion(@[ @"data" ]);
  [DeletedProfiles() addObject:profile];
  void (^remove)(ArcadiaCoreProfile *) = ^(ArcadiaCoreProfile *loaded) {
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
  ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
  ArcadiaCoreProfile *p = arcadiacore_host::LoadedProfile(profile);
  if (arcadiacore_host::IsIncognito(profile)) {
    if (profile) [ReleasedPrivateNames() addObject:profile];
    [Profiles() removeObjectForKey:profile];
    // Still being asked for (WithPrivateProfile): whoever waits gets none.
    NSArray *waiting = ProfileWaiters()[profile];
    [ProfileWaiters() removeObjectForKey:profile];
    for (void (^waiter)(ArcadiaCoreProfile *) in waiting) waiter(nil);
    arcadiacore_host::ForgetPrivateNavigationDownloads(profile);
    // A profile's private windows share its off-the-record profile: it goes only once no other private window of the
    // app holds it, even one whose window isn't made yet.
    if ([Profiles().allValues containsObject:p]) return;
  }
  if (p && [engine respondsToSelector:@selector(releaseProfile:)]) [engine releaseProfile:p];
}

+ (BOOL)stopCapture:(int)browserId {
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(stopCapture)] && [tab stopCapture];
}

+ (BOOL)showAutofillSuggestions:(int)browserId passwords:(BOOL)passwords {
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showAutofillSuggestions:)] && [tab showAutofillSuggestions:passwords];
}

+ (void (^)(NSString *, NSDictionary *))chromeUIHandler {
  return gChromeUIHandler;
}

+ (void)setChromeUIHandler:(void (^)(NSString *, NSDictionary *))handler {
  gChromeUIHandler = [handler copy];
}

+ (void)deviceChooser:(int)chooserId select:(int)index {
  if ([ArcadiaCoreEngine respondsToSelector:@selector(selectDevice:index:)]) [ArcadiaCoreEngine selectDevice:chooserId index:index];
}

+ (void)deviceChooser:(int)chooserId action:(NSString *)action {
  if ([action isEqualToString:@"cancel"] && [ArcadiaCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [ArcadiaCoreEngine cancelDeviceChooser:chooserId];
  else if ([action isEqualToString:@"refresh"] && [ArcadiaCoreEngine respondsToSelector:@selector(refreshDeviceChooser:)])
    [ArcadiaCoreEngine refreshDeviceChooser:chooserId];
  else if ([action isEqualToString:@"settings"] && [ArcadiaCoreEngine respondsToSelector:@selector(openDeviceChooserSettings:)])
    [ArcadiaCoreEngine openDeviceChooserSettings:chooserId];
}

// Tests (--arcadia-test-external-protocol-no-launch): the app links Chrome recorded instead of launching them.
+ (NSArray<NSDictionary *> *)testExternalLaunches {
  return ArcadiaCoreEngine.testExternalLaunches ?: @[];
}

// Tests (--arcadia-test-bluetooth-chooser): Chrome's Bluetooth chooser with no adapter, and its recorded choices.
+ (BOOL)devShowBluetoothChooser:(int)browserId unauthorized:(BOOL)unauthorized {
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(devShowBluetoothChooser:)] && [tab devShowBluetoothChooser:unauthorized];
}

+ (NSArray<NSDictionary *> *)testChooserEvents {
  return [ArcadiaCoreEngine respondsToSelector:@selector(testChooserEvents)] ? ArcadiaCoreEngine.testChooserEvents ?: @[] : @[];
}

// "Share this tab instead": the capturer's capture (and no other share's) moves to the target tab (Chrome's tab-sharing
// infobar's own action, on that share's bar).
+ (BOOL)shareTabInstead:(int)capturerBrowserId target:(int)targetBrowserId {
  ArcadiaCoreTab *capturer = arcadiacore_host::TabWithBrowserId(capturerBrowserId);
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(targetBrowserId);
  return capturer && [tab respondsToSelector:@selector(shareThisTabInsteadFor:)] && [tab shareThisTabInsteadFor:capturer];
}

+ (BOOL)showCastDialog:(int)browserId {
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showCastDialog)] && [tab showCastDialog];
}

+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode {
  if ([ArcadiaCoreEngine respondsToSelector:@selector(startCasting:sink:mode:)]) [ArcadiaCoreEngine startCasting:dialogId sink:sink mode:mode];
}

+ (void)castDialog:(int)dialogId stop:(NSString *)route {
  if ([ArcadiaCoreEngine respondsToSelector:@selector(stopCasting:route:)]) [ArcadiaCoreEngine stopCasting:dialogId route:route];
}

+ (void)closeCastDialog:(int)dialogId {
  if ([ArcadiaCoreEngine respondsToSelector:@selector(closeCastDialog:)]) [ArcadiaCoreEngine closeCastDialog:dialogId];
}

+ (void)watchCastRoutes:(NSString *)profileName {
  arcadiacore_host::WithProfile(profileName, ^(ArcadiaCoreProfile *profile) {
    if ([profile respondsToSelector:@selector(watchCastRoutes)]) [profile watchCastRoutes];
  });
}

+ (void)terminateCastRoute:(NSString *)route {
  if ([ArcadiaCoreEngine respondsToSelector:@selector(terminateCastRoute:)]) [ArcadiaCoreEngine terminateCastRoute:route];
}

+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  if ([ArcadiaCoreEngine respondsToSelector:@selector(resolveExternalApp:open:remember:)])
    [ArcadiaCoreEngine resolveExternalApp:requestId open:open remember:remember];
}

+ (NSDictionary *)actionStates:(int)browserId extensions:(NSArray<NSString *> *)ids {
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(actionStatesForExtensions:)] ? [tab actionStatesForExtensions:ids] ?: @{} : @{};
}

+ (NSString *)sidePanelURL:(int)browserId extension:(NSString *)extensionId {
  ArcadiaCoreTab *tab = arcadiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(sidePanelURLForExtension:)] ? [tab sidePanelURLForExtension:extensionId] : nil;
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
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
  ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
  NSInteger chromeWindows = 0;
  for (ArcadiaCoreWindowController *c in ArcadiaCoreWindowController.all) chromeWindows += c.coreWindow ? 1 : 0;
  return @{
    @"pid" : @(NSProcessInfo.processInfo.processIdentifier),
    @"dataDirectory" : gDataDirectory ?: @"",
    @"cefVersion" : @"arcadiacore",
    @"engine" : @"arcadiacore",
    @"chromiumVersion" : engine.chromiumVersion ?: @"",
    @"liveBrowsers" : @0,
    @"popupWindows" : @(arcadiacore_host::PopupWindowCount()),
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
    // Chrome's last-used profile (what tab sharing and Chrome-made windows follow), by directory.
    @"lastUsedProfile" : engine.defaultProfile.name ?: @"",
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)chromeWindows {
  NSMutableArray *list = [NSMutableArray array];
  for (ArcadiaCoreWindowController *c in ArcadiaCoreWindowController.all) {
    NSWindow *w = c.coreWindow.window;
    if (!w) continue;
    ArcadiaCoreProfile *active = c.coreWindow.activeProfile;
    [list addObject:@{
      @"profile" : arcadiacore_host::ProfileName(active),
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

namespace arcadiacore_host {

// Profiles Chrome destroyed (a private profile once its last window closed, a deleted one) leave the cache: a
// window or tab never gets one (WindowHost::BrowserFor crashed on its null Profile in the 0.2.22 RC).
void ForgetDestroyedProfiles() {
  for (NSString *name in Profiles().allKeys)
    if (Profiles()[name].destroyed) [Profiles() removeObjectForKey:name];
}

NSArray<NSString *> *LoadedProfileNames() {
  ForgetDestroyedProfiles();
  return Profiles().allKeys;
}

NSArray<ArcadiaCoreProfile *> *LoadedProfiles() {
  ForgetDestroyedProfiles();
  NSMutableArray *profiles = [NSMutableArray array];
  for (ArcadiaCoreProfile *profile in Profiles().allValues)
    if (![profiles containsObject:profile]) [profiles addObject:profile];
  return profiles;
}

bool IsIncognito(NSString *name) {
  return [name hasPrefix:@"incognito"];
}

NSString *OriginalProfileName(NSString *name) {
  if (!IsIncognito(name)) return name ?: @"";
  NSRange at = [name rangeOfString:@"@"];
  return at.location == NSNotFound ? @"" : [name substringFromIndex:NSMaxRange(at)];
}

NSString *OriginalProfileNameOf(ArcadiaCoreProfile *profile) {
  if (!profile.offTheRecord) return ProfileName(profile);
  // Named after its original's directory ("Default", "Profile <id>").
  NSString *dir = profile.name;
  return [dir hasPrefix:@"Profile "] ? [dir substringFromIndex:8] : @"";
}

bool IsOffTheRecordOf(ArcadiaCoreProfile *profile, NSString *name) {
  return profile.offTheRecord && IsIncognito(name) &&
         [profile.name isEqualToString:DirectoryName(OriginalProfileName(name))];
}

bool IsDeletedProfile(NSString *name) {
  return [DeletedProfiles() containsObject:name ?: @""];
}

ArcadiaCoreProfile *LoadedProfile(NSString *name) {
  ArcadiaCoreProfile *profile = Profiles()[name ?: @""];
  if (!profile.destroyed) return profile;
  [Profiles() removeObjectForKey:name ?: @""];
  return nil;
}

namespace {

// A private window's profile: the off-the-record one of the regular profile it was opened from (its name says which,
// OriginalProfileName), as Chrome's GetPrimaryOTRProfile, never that profile itself. Private windows of one profile
// share it; another profile's are another. While its last one is still being destroyed the engine answers once it has
// gone, with a new one. Asked once per name at a time; when the name is released meanwhile (its window closed,
// +releaseProfile:), a profile nobody holds goes again.
void WithPrivateProfile(NSString *name, void (^completion)(ArcadiaCoreProfile *)) {
  if ([ReleasedPrivateNames() containsObject:name]) return completion(nil);
  if (NSMutableArray *waiters = ProfileWaiters()[name]) return (void)[waiters addObject:completion];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:completion];
  NSString *original = OriginalProfileName(name);
  WithProfile(original, ^(ArcadiaCoreProfile *base) {
    ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
    void (^answer)(ArcadiaCoreProfile *, NSString *) = ^(ArcadiaCoreProfile *otr, NSString *error) {
      NSArray *pending = ProfileWaiters()[name];
      [ProfileWaiters() removeObjectForKey:name];
      // Its profile was deleted while the engine answered (it waited for the last session to go): none.
      if (IsDeletedProfile(original)) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        if (pending) NSLog(@"[arcadiacore] no private profile for %@: its profile was deleted", name);
        for (void (^waiter)(ArcadiaCoreProfile *) in pending) waiter(nil);
        return;
      }
      if (!pending) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        return;
      }
      if (otr && !otr.destroyed) Profiles()[name] = otr;
      else NSLog(@"[arcadiacore] no private profile for %@: %@", name, error ?: @"it went");
      for (void (^waiter)(ArcadiaCoreProfile *) in pending) waiter(Profiles()[name]);
    };
    if (!base) return answer(nil, [NSString stringWithFormat:@"profile \"%@\" isn't loaded", original]);
    if (![engine respondsToSelector:@selector(offTheRecordProfileFor:completion:)]) return answer(nil, @"the engine is too old");
    [engine offTheRecordProfileFor:base completion:answer];
  });
}

}  // namespace

void WithProfile(NSString *name, void (^completion)(ArcadiaCoreProfile *)) {
  name = name ?: @"";
  if ([DeletedProfiles() containsObject:name]) return completion(nil);
  if (ArcadiaCoreProfile *profile = LoadedProfile(name)) return completion(profile);
  ArcadiaCoreEngine *engine = ArcadiaCoreEngine.sharedEngine;
  if (!engine) return completion(nil);
  if (IsIncognito(name)) return WithPrivateProfile(name, [completion copy]);
  if (name.length == 0) {
    if (ArcadiaCoreProfile *personal = PersonalIfLoaded(engine)) {
      Profiles()[@""] = personal;
      return completion(personal);
    }
  }
  NSMutableArray *waiters = ProfileWaiters()[name];
  if (waiters) return (void)[waiters addObject:[completion copy]];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:[completion copy]];
  [engine loadProfile:DirectoryName(name)
           completion:^(ArcadiaCoreProfile *loaded) {
             NSArray *pending = ProfileWaiters()[name];
             [ProfileWaiters() removeObjectForKey:name];
             // Deleted while it loaded: it goes now, and nobody waiting gets it.
             if (void (^deletion)(ArcadiaCoreProfile *) = DeletionsAfterLoad()[name]) {
               [DeletionsAfterLoad() removeObjectForKey:name];
               deletion(loaded);
             }
             ArcadiaCoreProfile *profile = [DeletedProfiles() containsObject:name] ? nil : loaded;
             if (profile) Profiles()[name] = profile;
             if (profile) arcadiacore_host::LoadContentBlocker(name);
             if (profile) [ArcadiaCoreServices watchDownloads:name];
             for (void (^waiter)(ArcadiaCoreProfile *) in pending) waiter(profile);
           }];
}

// Chrome's Default profile, if it's the one Chrome has loaded as its "last used" (Chrome starts with
// --profile-directory=Default, so normally yes); else WithProfile loads it by its directory.
ArcadiaCoreProfile *PersonalIfLoaded(ArcadiaCoreEngine *engine) {
  ArcadiaCoreProfile *profile = engine.defaultProfile;
  return [profile.name isEqualToString:@"Default"] ? profile : nil;
}

NSString *ProfileName(ArcadiaCoreProfile *profile) {
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

}  // namespace arcadiacore_host
