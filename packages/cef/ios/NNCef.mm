#import "NNCefInternal.h"

#import "NNChromePages.h"
#import "NNContentBlocker.h"
#import "NNExtensionsInternal.h"
#import "NNPopupWindow.h"
#import "NNSiteSettings.h"
#import "NNWindowHost.h"
#import "NNZoom.h"

#import <Security/Security.h>

#include <map>
#include <set>
#include <vector>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/cef_browser_process_handler.h"
#include "include/cef_command_line.h"
#include "include/cef_cookie.h"
#include "include/cef_version.h"
#include "include/wrapper/cef_library_loader.h"

using namespace nn;

// MARK: - NSApplication subclass

@interface NNApplication () <CefAppProtocol> {
  BOOL _handlingSendEvent;
}
@end

@implementation NNApplication

- (BOOL)isHandlingSendEvent {
  return _handlingSendEvent;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  _handlingSendEvent = handlingSendEvent;
}

- (void)sendEvent:(NSEvent *)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}

// Only the user activates the app: never a test instance (NETNYAHOO_BACKGROUND),
// never Chromium on its own (NNActivation.mm).
- (void)activateIgnoringOtherApps:(BOOL)flag {
  if (nn::activation::Allow(@"activateIgnoringOtherApps:")) [super activateIgnoringOtherApps:flag];
}

- (void)activate {
  if (nn::activation::Allow(@"activate")) [super activate];
}

@end

// MARK: - External message pump
//
// CEF runs inside AppKit's run loop: CEF asks for work via
// OnScheduleMessagePumpWork and we call CefDoMessageLoopWork on the main thread,
// with a ~30 Hz fallback timer (same scheme as cefclient's external pump).

namespace {

constexpr double kMaxTimerDelay = 1.0 / 30.0;

class MessagePump {
 public:
  static MessagePump &Get() {
    static MessagePump pump;
    return pump;
  }

  void Schedule(int64_t delay_ms) {
    dispatch_async(dispatch_get_main_queue(), ^{ this->OnSchedule(delay_ms); });
  }

  void Stop() {
    stopped_ = true;
    KillTimer();
  }

 private:
  void OnSchedule(int64_t delay_ms) {
    if (stopped_) return;
    if (delay_ms <= 0) {
      DoWork();
    } else {
      SetTimer(std::min(delay_ms / 1000.0, kMaxTimerDelay));
    }
  }

  void DoWork() {
    KillTimer();
    bool reentrant = PerformWork();
    if (reentrant) {
      Schedule(0);
    } else if (!timer_) {
      SetTimer(kMaxTimerDelay);
    }
  }

  bool PerformWork() {
    if (active_) {
      reentrancy_ = true;
      return false;
    }
    reentrancy_ = false;
    active_ = true;
    CefDoMessageLoopWork();
    active_ = false;
    return reentrancy_;
  }

  void SetTimer(double seconds) {
    KillTimer();
    timer_ = [NSTimer timerWithTimeInterval:seconds
                                    repeats:NO
                                      block:^(NSTimer *) {
                                        this->timer_ = nil;
                                        this->DoWork();
                                      }];
    // Common modes so pages keep running during menu tracking and live resize.
    [[NSRunLoop mainRunLoop] addTimer:timer_ forMode:NSRunLoopCommonModes];
  }

  void KillTimer() {
    [timer_ invalidate];
    timer_ = nil;
  }

  NSTimer *timer_ = nil;
  bool active_ = false;
  bool reentrancy_ = false;
  bool stopped_ = false;
};

#if defined(CEF_NN_SAFE_STORAGE)
/// Signed by a team (Apple Development / Developer ID), not ad hoc: the
/// signature, and so Keychain access, stays the same across rebuilds.
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
#endif

// MARK: - CefApp (browser process)

class BrowserApp : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }

  void OnBeforeCommandLineProcessing(const CefString &process_type,
                                     CefRefPtr<CefCommandLine> command_line) override {
    if (!process_type.empty()) return;
    // Smooth scrolling and overlay scrollbars like Chrome on macOS.
    command_line->AppendSwitch("enable-smooth-scrolling");
    // Built-in extensions (the content blocker, uBlock Origin Lite), in every profile.
    // With Chrome tabs it's a component extension instead (blocker::LoadIntoProfile).
    if (NSString *builtIn = NN_CHROME_TABS ? nil : nn::blocker::ExtensionPath()) {
      std::string load = command_line->GetSwitchValue("load-extension").ToString();
      command_line->AppendSwitchWithValue("load-extension", (load.empty() ? "" : load + ",") + builtIn.UTF8String);
    }
    // Our pop-up blocker (OnBeforePopup + the POPUPS content setting) replaces
    // Chromium's, which drops popups silently where the UI can't offer "allow".
    command_line->AppendSwitch("disable-popup-blocking");
    // Chrome clones the whole app bundle at launch (to survive in-place updates)
    // and quitting waits for that copy to finish: with our bundle that held quit
    // up for ~10 s until Chrome's teardown watchdog killed the process.
    std::string disabled = command_line->GetSwitchValue("disable-features").ToString();
    command_line->AppendSwitchWithValue("disable-features",
                                        (disabled.empty() ? "" : disabled + ",") + "MacAppCodeSignClone");
#if NN_CHROME_TABS
    // Chrome discards a tab (ours through DiscardTab, its own under memory pressure, extensions'
    // chrome.tabs.discard) in place: without this it swaps in a new WebContents, and so a new
    // browser, behind the view hosting the tab.
    std::string enabled = command_line->GetSwitchValue("enable-features").ToString();
    command_line->AppendSwitchWithValue("enable-features",
                                        (enabled.empty() ? "" : enabled + ",") + "WebContentsDiscard");
#endif
    // NETNYAHOO_REMOTE_DEBUGGING_PORT=9222 exposes DevTools/CDP for local testing.
    if (const char *port = getenv("NETNYAHOO_REMOTE_DEBUGGING_PORT")) {
      command_line->AppendSwitchWithValue("remote-debugging-port", port);
      command_line->AppendSwitchWithValue("remote-allow-origins", "*");
    }
    // Isolated dev/test instances (NETNYAHOO_DATA_DIR) don't touch the login
    // Keychain: every ad-hoc-signed rebuild would otherwise raise a Keychain
    // prompt for the Safe Storage item (the cookie encryption key) and block
    // cookie loading until someone answers it.
#if defined(CEF_NN_SAFE_STORAGE)
    // Our CEF keeps that key in its own "Netnyahoo Safe Storage" item, whose
    // access follows our Team ID: team-signed builds, Debug included, use the
    // real Keychain without prompts. Only ad-hoc builds need the mock.
    if (getenv("NETNYAHOO_DATA_DIR") || !IsTeamSigned()) command_line->AppendSwitch("use-mock-keychain");
#elif defined(DEBUG) || defined(POD_CONFIGURATION_DEBUG)
    command_line->AppendSwitch("use-mock-keychain");
#else
    if (getenv("NETNYAHOO_DATA_DIR")) command_line->AppendSwitch("use-mock-keychain");
#endif
    // NETNYAHOO_CHROMIUM_SWITCHES="--use-fake-device-for-media-stream --host-resolver-rules=MAP *.test 127.0.0.1"
    // for local testing.
    if (const char *extra = getenv("NETNYAHOO_CHROMIUM_SWITCHES")) {
      NSString *all = [@" " stringByAppendingString:@(extra)];
      for (NSString *item in [all componentsSeparatedByString:@" --"]) {
        NSString *sw = [item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if (!sw.length) continue;
        NSRange eq = [sw rangeOfString:@"="];
        if (eq.location == NSNotFound) command_line->AppendSwitch(sw.UTF8String);
        else
          command_line->AppendSwitchWithValue([sw substringToIndex:eq.location].UTF8String,
                                              [sw substringFromIndex:eq.location + 1].UTF8String);
      }
    }
  }

  void OnScheduleMessagePumpWork(int64_t delay_ms) override { MessagePump::Get().Schedule(delay_ms); }

  bool OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                   const CefString &current_directory) override {
    // A second launch just focuses us (the default would open a Chrome-style window).
    dispatch_async(dispatch_get_main_queue(), ^{ [NSApp activateIgnoringOtherApps:YES]; });
    return true;
  }

  // Windows Chrome opens by itself (extension pages, uninstall surveys) become our tabs.
  CefRefPtr<CefClient> GetDefaultClient() override { return nn::host::DefaultClient(); }
  CefRefPtr<CefRequestContextHandler> GetDefaultRequestContextHandler() override { return nn::ext::ContextHandler(@""); }

 private:
  IMPLEMENT_REFCOUNTING(BrowserApp);
};

// MARK: - State

CefScopedLibraryLoader *gLoader = nullptr;
BOOL gStarted = NO;
bool gShuttingDown = false;
NNEventHandler gEventHandler = nil;
std::map<std::string, CefRefPtr<CefRequestContext>> gContexts;
std::set<int> gLiveBrowsers;
NSWindow *gParkingWindow = nil;
NSHashTable<NNBrowserView *> *gViews = nil;

struct DownloadEntry {
  CefRefPtr<CefDownloadItemCallback> callback;
  std::string path;
  /// The profile that started it, so incognito downloads stay with their window.
  NSString *profile;
};
std::map<uint32_t, DownloadEntry> gDownloads;
std::map<uint32_t, CFTimeInterval> gDownloadLastEmit;

struct PendingPermission {
  int browserId;
  CefRefPtr<CefPermissionPromptCallback> prompt;
  CefRefPtr<CefMediaAccessCallback> media;
  uint32_t mediaPermissions = 0;
  NSString *profile;
  NSString *origin;
  std::vector<cef_content_setting_types_t> types;
};
std::map<std::string, PendingPermission> gPermissions;
uint64_t gPermissionSeq = 0;

NSString *AppSupportRoot() {
  // NETNYAHOO_DATA_DIR lets several dev instances run side by side (CEF allows
  // one process per root_cache_path).
  if (const char *dir = getenv("NETNYAHOO_DATA_DIR"))
    return [[NSString stringWithUTF8String:dir] stringByAppendingPathComponent:@"Chromium"];
  NSURL *base = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                                      inDomains:NSUserDomainMask].firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.netnyahoo.browser";
  return [[base.path stringByAppendingPathComponent:bundleId] stringByAppendingPathComponent:@"Chromium"];
}

/// The system's preferred languages as Chrome writes its language list ("de-DE,de,en-US,en"),
/// for Accept-Language and `navigator.languages`. Chrome takes its locale from the app bundle's
/// localizations, and ours only has English, so without this every page (and uBlock Origin
/// Lite, which turns on the regional lists for these languages) sees "en-US,en".
std::string AcceptLanguages() {
  NSMutableOrderedSet<NSString *> *list = [NSMutableOrderedSet orderedSet];
  for (NSString *identifier in NSLocale.preferredLanguages) {
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:identifier];
    NSString *language = locale.languageCode, *region = locale.regionCode, *script = locale.scriptCode;
    if (!language.length) continue;
    // Chrome names Chinese by region: zh-CN (Simplified), zh-TW / zh-HK (Traditional).
    if ([language isEqualToString:@"zh"] && !region.length) region = [script isEqualToString:@"Hant"] ? @"TW" : @"CN";
    if (region.length) [list addObject:[NSString stringWithFormat:@"%@-%@", language, region]];
    [list addObject:language];
  }
  return [list.array componentsJoinedByString:@","].UTF8String;
}

NSString *ProfilePath(NSString *profile) {
  NSString *root = AppSupportRoot();
  if (profile.length == 0) return [root stringByAppendingPathComponent:@"Default"];
  // Chrome only creates profiles that are direct children of the user data dir
  // (root_cache_path); anything deeper silently becomes an in-memory profile.
  return [root stringByAppendingPathComponent:[@"Profile " stringByAppendingString:profile]];
}

NSArray<NSString *> *PermissionNames(uint32_t permissions) {
  static const std::pair<uint32_t, NSString *> kNames[] = {
      {CEF_PERMISSION_TYPE_CAMERA_STREAM, @"camera"},
      {CEF_PERMISSION_TYPE_MIC_STREAM, @"microphone"},
      {CEF_PERMISSION_TYPE_CAMERA_PAN_TILT_ZOOM, @"cameraPanTiltZoom"},
      {CEF_PERMISSION_TYPE_GEOLOCATION, @"location"},
      {CEF_PERMISSION_TYPE_NOTIFICATIONS, @"notifications"},
      {CEF_PERMISSION_TYPE_CLIPBOARD, @"clipboard"},
      {CEF_PERMISSION_TYPE_MIDI_SYSEX, @"midi"},
      {CEF_PERMISSION_TYPE_MULTIPLE_DOWNLOADS, @"multipleDownloads"},
      {CEF_PERMISSION_TYPE_LOCAL_FONTS, @"localFonts"},
      {CEF_PERMISSION_TYPE_IDLE_DETECTION, @"idleDetection"},
      {CEF_PERMISSION_TYPE_STORAGE_ACCESS, @"storageAccess"},
      {CEF_PERMISSION_TYPE_TOP_LEVEL_STORAGE_ACCESS, @"storageAccess"},
      {CEF_PERMISSION_TYPE_WINDOW_MANAGEMENT, @"windowManagement"},
      {CEF_PERMISSION_TYPE_FILE_SYSTEM_ACCESS, @"fileSystem"},
      {CEF_PERMISSION_TYPE_KEYBOARD_LOCK, @"keyboardLock"},
      {CEF_PERMISSION_TYPE_POINTER_LOCK, @"pointerLock"},
      {CEF_PERMISSION_TYPE_PROTECTED_MEDIA_IDENTIFIER, @"protectedMedia"},
      {CEF_PERMISSION_TYPE_REGISTER_PROTOCOL_HANDLER, @"protocolHandler"},
      {CEF_PERMISSION_TYPE_SENSORS, @"sensors"},
      {CEF_PERMISSION_TYPE_LOCAL_NETWORK, @"localNetwork"},
      {CEF_PERMISSION_TYPE_LOOPBACK_NETWORK, @"localNetwork"},
      {CEF_PERMISSION_TYPE_VR_SESSION, @"vr"},
      {CEF_PERMISSION_TYPE_AR_SESSION, @"ar"},
      {CEF_PERMISSION_TYPE_HAND_TRACKING, @"handTracking"},
      {CEF_PERMISSION_TYPE_IDENTITY_PROVIDER, @"identityProvider"},
      {CEF_PERMISSION_TYPE_WEB_APP_INSTALLATION, @"webAppInstallation"},
      {CEF_PERMISSION_TYPE_CAPTURED_SURFACE_CONTROL, @"capturedSurfaceControl"},
      {CEF_PERMISSION_TYPE_DISK_QUOTA, @"diskQuota"},
  };
  NSMutableOrderedSet<NSString *> *names = [NSMutableOrderedSet orderedSet];
  for (const auto &[bit, name] : kNames) {
    if (permissions & bit) [names addObject:name];
  }
  return names.array;
}

NSString *UniqueDownloadPath(NSString *suggested) {
  // NETNYAHOO_DOWNLOADS_DIR keeps test instances out of the user's Downloads folder.
  const char *override = getenv("NETNYAHOO_DOWNLOADS_DIR");
  NSString *folder = override ? @(override)
                              : [[NSFileManager defaultManager] URLsForDirectory:NSDownloadsDirectory
                                                                       inDomains:NSUserDomainMask].firstObject.path;
  [[NSFileManager defaultManager] createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *name = suggested.length ? suggested.lastPathComponent : @"download";
  NSString *base = name.stringByDeletingPathExtension;
  NSString *ext = name.pathExtension;
  NSString *candidate = [folder stringByAppendingPathComponent:name];
  // Also avoid names Chromium is still writing (".crdownload" is renamed at the end).
  for (int n = 1; [[NSFileManager defaultManager] fileExistsAtPath:candidate] ||
                  [[NSFileManager defaultManager] fileExistsAtPath:[candidate stringByAppendingString:@".crdownload"]];
       n++) {
    NSString *numbered = [NSString stringWithFormat:@"%@ (%d)", base, n];
    if (ext.length) numbered = [numbered stringByAppendingPathExtension:ext];
    candidate = [folder stringByAppendingPathComponent:numbered];
  }
  return candidate;
}

class DoneCallback : public CefCompletionCallback, public CefDeleteCookiesCallback {
 public:
  explicit DoneCallback(void (^block)(void)) : block_([block copy]) {}
  void OnComplete() override { dispatch_async(dispatch_get_main_queue(), block_); }
  void OnComplete(int) override { dispatch_async(dispatch_get_main_queue(), block_); }

 private:
  void (^block_)(void);
  IMPLEMENT_REFCOUNTING(DoneCallback);
};

}  // namespace

// MARK: - nn:: internals

namespace nn {

NSString *ToJSON(id object) {
  if (!object) return @"null";
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

id FromJSON(NSString *json) {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
}

NSString *OriginOf(NSString *url) {
  NSURLComponents *c = url.length ? [NSURLComponents componentsWithString:url] : nil;
  NSString *scheme = c.scheme.lowercaseString;
  if (!c.host.length || !([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) return nil;
  NSString *origin = [NSString stringWithFormat:@"%@://%@", scheme, c.host.lowercaseString];
  if (c.port) origin = [origin stringByAppendingFormat:@":%@", c.port];
  return origin;
}

NSString *HostOf(NSString *url) {
  NSURLComponents *c = url.length ? [NSURLComponents componentsWithString:url] : nil;
  return c.host.lowercaseString ?: @"";
}

NSString *DataRoot() { return AppSupportRoot(); }
NSString *ProfileDirectory(NSString *profile) { return ProfilePath(profile); }

bool ShuttingDown() { return gShuttingDown; }

static bool gDisplayMediaPicker = false;
bool DisplayMediaPickerEnabled() { return gDisplayMediaPicker; }

void EmitGlobal(NSString *name, NSDictionary *payload) {
  if (gEventHandler) gEventHandler(name, payload);
}

NSString *ProfileForContext(CefRefPtr<CefRequestContext> context) {
  if (!context || context->IsGlobal()) return @"";
  for (const auto &[key, c] : gContexts)
    if (c->IsSame(context)) return @(key.c_str());
  return nil;
}

CefRefPtr<CefRequestContext> ContextForProfile(NSString *profile) {
  if (profile.length == 0) return CefRequestContext::GetGlobalContext();
  std::string key = profile.UTF8String;
  auto it = gContexts.find(key);
  if (it != gContexts.end()) return it->second;

  CefRequestContextSettings settings;
  if (![profile hasPrefix:@"incognito"]) {
    NSString *path = ProfilePath(profile);
    [[NSFileManager defaultManager] createDirectoryAtPath:path withIntermediateDirectories:YES attributes:nil error:nil];
    CefString(&settings.cache_path) = path.UTF8String;
    settings.persist_session_cookies = true;
  }
  // Empty cache_path = in-memory ("off the record") context.
  CefRefPtr<CefRequestContext> context = CefRequestContext::CreateContext(settings, ext::ContextHandler(profile));
  gContexts[key] = context;
  return context;
}

bool OnBeforeDownload(CefRefPtr<CefDownloadItem> item, const CefString &suggested_name,
                      CefRefPtr<CefBeforeDownloadCallback> callback) {
  NSString *path = UniqueDownloadPath(ToNS(suggested_name));
  gDownloads[item->GetId()].path = path.UTF8String;
  callback->Continue(ToCef(path), false);
  return true;
}

namespace {
NSMutableDictionary<NSString *, NSNumber *> *gNavigationDownloads;  // url → seconds since 1970
NSMutableDictionary<NSString *, NSNumber *> *gUserNavigations;      // url → CACurrentMediaTime()
constexpr NSTimeInterval kNavigationDownloadTTL = 7 * 86400;

NSString *NavigationDownloadsPath() { return [AppSupportRoot() stringByAppendingPathComponent:@"NavigationDownloads.json"]; }

NSMutableDictionary *NavigationDownloads() {
  if (!gNavigationDownloads) {
    NSData *data = [NSData dataWithContentsOfFile:NavigationDownloadsPath()];
    id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
    gNavigationDownloads = [saved isKindOfClass:NSMutableDictionary.class] ? saved : [NSMutableDictionary dictionary];
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    for (NSString *url in gNavigationDownloads.allKeys)
      if (now - gNavigationDownloads[url].doubleValue > kNavigationDownloadTTL) [gNavigationDownloads removeObjectForKey:url];
  }
  return gNavigationDownloads;
}
}  // namespace

void NoteNavigationDownload(NSString *url, bool persist) {
  if (!url.length) return;
  NavigationDownloads()[url] = @(NSDate.date.timeIntervalSince1970);
  if (!persist) return;
  NSMutableDictionary *entries = NavigationDownloads();
  // Keep the file small: newest 200.
  if (entries.count > 200) {
    NSArray *oldest = [entries keysSortedByValueUsingSelector:@selector(compare:)];
    [entries removeObjectsForKeys:[oldest subarrayWithRange:NSMakeRange(0, entries.count - 200)]];
  }
  [[NSJSONSerialization dataWithJSONObject:entries options:0 error:nil] writeToFile:NavigationDownloadsPath() atomically:YES];
}

bool WasNavigationDownload(NSString *url) {
  NSNumber *when = url.length ? NavigationDownloads()[url] : nil;
  return when && NSDate.date.timeIntervalSince1970 - when.doubleValue < kNavigationDownloadTTL;
}

void AllowUserNavigation(NSString *url) {
  if (!url.length) return;
  if (!gUserNavigations) gUserNavigations = [NSMutableDictionary dictionary];
  gUserNavigations[url] = @(CACurrentMediaTime());
}

bool ConsumeUserNavigation(NSString *url) {
  NSNumber *when = url.length ? gUserNavigations[url] : nil;
  if (!when) return false;
  [gUserNavigations removeObjectForKey:url];
  return CACurrentMediaTime() - when.doubleValue < 30;
}

void OnDownloadUpdated(CefRefPtr<CefDownloadItem> item, CefRefPtr<CefDownloadItemCallback> callback, NSString *profile) {
  uint32_t id = item->GetId();
  DownloadEntry &entry = gDownloads[id];
  entry.callback = callback;
  if (profile && !entry.profile) entry.profile = [profile copy];
  if (!item->GetFullPath().empty()) entry.path = item->GetFullPath().ToString();

  NSString *state = @"downloading";
  if (item->IsComplete()) state = @"finished";
  else if (item->IsCanceled()) state = @"cancelled";
  else if (item->IsInterrupted()) state = @"failed";

  // Progress ticks are throttled to 10/s; state changes always go through.
  CFTimeInterval now = CACurrentMediaTime();
  if ([state isEqualToString:@"downloading"] && now - gDownloadLastEmit[id] < 0.1) return;
  gDownloadLastEmit[id] = now;

  NSString *path = [NSString stringWithUTF8String:entry.path.c_str()];
  EmitGlobal(@"download", @{
    @"id" : [NSString stringWithFormat:@"%u", id],
    @"url" : ToNS(item->GetOriginalUrl()),
    @"filename" : path.lastPathComponent ?: @"",
    @"path" : path ?: @"",
    @"state" : state,
    @"paused" : @(item->IsPaused()),
    @"received" : @(item->GetReceivedBytes()),
    @"total" : @(item->GetTotalBytes() > 0 ? item->GetTotalBytes() : -1),
    @"speed" : @(item->GetCurrentSpeed()),
    @"mimeType" : ToNS(item->GetMimeType()),
    @"profile" : entry.profile ?: @"",
  });
}

bool RequestPermission(CefRefPtr<CefBrowser> browser, const CefString &origin, uint32_t permissions,
                       CefRefPtr<CefPermissionPromptCallback> callback) {
  if (!gEventHandler) return false;
  NSString *profile = ProfileForContext(browser->GetHost()->GetRequestContext()) ?: @"";
  auto types = site::TypesForPermissions(permissions);
  switch (site::Decision(profile, ToNS(origin), types)) {
    case CEF_CONTENT_SETTING_VALUE_ALLOW:
      callback->Continue(CEF_PERMISSION_RESULT_ACCEPT);
      return true;
    case CEF_CONTENT_SETTING_VALUE_BLOCK:
      callback->Continue(CEF_PERMISSION_RESULT_DENY);
      return true;
    default:
      break;
  }
  std::string id = "p" + std::to_string(++gPermissionSeq);
  gPermissions[id] = {browser->GetIdentifier(), callback, nullptr, 0, profile, ToNS(origin), types};
  EmitGlobal(@"permission", @{
    @"id" : @(id.c_str()),
    @"browserId" : @(browser->GetIdentifier()),
    @"origin" : ToNS(origin),
    @"permissions" : PermissionNames(permissions),
  });
  return true;
}

bool RequestMediaAccess(CefRefPtr<CefBrowser> browser, const CefString &origin, uint32_t permissions,
                        CefRefPtr<CefMediaAccessCallback> callback) {
  if (!gEventHandler) return false;
  NSMutableArray *names = [NSMutableArray array];
  if (permissions & CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE) [names addObject:@"microphone"];
  if (permissions & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE) [names addObject:@"camera"];
  if (permissions & (CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE))
    [names addObject:@"screen"];
  // Camera/microphone decisions can be remembered; screen capture always asks.
  NSString *profile = ProfileForContext(browser->GetHost()->GetRequestContext()) ?: @"";
  auto types = site::TypesForMedia(permissions);
  bool desktop = permissions & (CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE);
  if (desktop && site::ConsumeDesktopCapture(browser->GetIdentifier())) {
    site::NoteGrantedMedia(browser->GetIdentifier(), permissions);
    callback->Continue(permissions);  // the user picked the source in the app's picker
    return true;
  }
  if (!desktop && !types.empty()) {
    cef_content_setting_values_t decision = site::Decision(profile, ToNS(origin), types);
    if (decision == CEF_CONTENT_SETTING_VALUE_ALLOW) {
      site::NoteGrantedMedia(browser->GetIdentifier(), permissions);
      callback->Continue(permissions);
      return true;
    }
    if (decision == CEF_CONTENT_SETTING_VALUE_BLOCK) {
      callback->Cancel();
      return true;
    }
  }
  std::string id = "m" + std::to_string(++gPermissionSeq);
  gPermissions[id] = {browser->GetIdentifier(), nullptr, callback, permissions, profile, ToNS(origin),
                      desktop ? std::vector<cef_content_setting_types_t>() : types};
  EmitGlobal(@"permission", @{
    @"id" : @(id.c_str()),
    @"browserId" : @(browser->GetIdentifier()),
    @"origin" : ToNS(origin),
    @"permissions" : names,
  });
  return true;
}

void DismissPermissions(CefRefPtr<CefBrowser> browser) {
  int bid = browser->GetIdentifier();
  for (auto it = gPermissions.begin(); it != gPermissions.end();) {
    if (it->second.browserId == bid) {
      EmitGlobal(@"permissionDismissed", @{@"id" : @(it->first.c_str())});
      it = gPermissions.erase(it);
    } else {
      ++it;
    }
  }
}

void BrowserCreated(CefRefPtr<CefBrowser> browser) { gLiveBrowsers.insert(browser->GetIdentifier()); }

size_t LiveBrowserCount() { return gLiveBrowsers.size(); }

void RegisterView(NNBrowserView *view) {
  if (!gViews) gViews = [NSHashTable weakObjectsHashTable];
  [gViews addObject:view];
}

NSArray<NNBrowserView *> *LiveViews() {
  NSMutableArray *views = [NSMutableArray array];
  for (NNBrowserView *view in gViews)
    if (view.browserId) [views addObject:view];
  return views;
}

void CallPage(CefRefPtr<CefFrame> frame, NSString *kind, id payload) {
  if (!frame || !frame->IsValid()) return;
  CefRefPtr<CefProcessMessage> message = CefProcessMessage::Create("nn-call");
  message->GetArgumentList()->SetString(0, ToCef(kind));
  message->GetArgumentList()->SetString(1, ToCef(ToJSON(payload)));
  frame->SendProcessMessage(PID_RENDERER, message);
}

void BrowserClosed(CefRefPtr<CefBrowser> browser) {
  gLiveBrowsers.erase(browser->GetIdentifier());
  DevToolsForget(browser->GetIdentifier());
  DismissPermissions(browser);
}

NSView *ParkingView() {
  if (!gParkingWindow) {
    gParkingWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 800, 600)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
    gParkingWindow.releasedWhenClosed = NO;
    gParkingWindow.excludedFromWindowsMenu = YES;
  }
  return gParkingWindow.contentView;
}

}  // namespace nn

// MARK: - Public API

@implementation NNCef

+ (BOOL)startWithArgc:(int)argc argv:(char *_Nullable *_Nonnull)argv {
  if (gStarted) return YES;
  nn::activation::Install();
  gLoader = new CefScopedLibraryLoader();
  if (!gLoader->LoadInMain()) {
    NSLog(@"[cef] failed to load Chromium Embedded Framework");
    return NO;
  }

  CefMainArgs mainArgs(argc, argv);
  CefSettings settings;
  settings.external_message_pump = true;
  settings.no_sandbox = false;
  settings.persist_session_cookies = true;
  settings.log_severity = getenv("NETNYAHOO_VERBOSE_LOG") ? LOGSEVERITY_VERBOSE : LOGSEVERITY_WARNING;
  NSString *root = AppSupportRoot();
  [[NSFileManager defaultManager] createDirectoryAtPath:ProfilePath(@"") withIntermediateDirectories:YES attributes:nil error:nil];
  CefString(&settings.root_cache_path) = root.UTF8String;
  CefString(&settings.cache_path) = ProfilePath(@"").UTF8String;
  CefString(&settings.log_file) = [root stringByAppendingPathComponent:@"debug.log"].UTF8String;
  CefString(&settings.accept_language_list) = AcceptLanguages();
  NSString *helper = [NSBundle.mainBundle.privateFrameworksPath
      stringByAppendingPathComponent:[NSString stringWithFormat:@"%@ Helper.app/Contents/MacOS/%@ Helper",
                                                                NSBundle.mainBundle.infoDictionary[@"CFBundleName"],
                                                                NSBundle.mainBundle.infoDictionary[@"CFBundleName"]]];
  CefString(&settings.browser_subprocess_path) = helper.UTF8String;

  CefRefPtr<BrowserApp> app(new BrowserApp());
  if (!CefInitialize(mainArgs, settings, app, nullptr)) {
    NSLog(@"[cef] CefInitialize failed (code %d)", CefGetExitCode());
    return NO;
  }
  gStarted = YES;
  zoom::InstallScrollMonitor();
  // Shut down once termination is certain (after the delegate agreed), not in
  // -terminate: where a delegate could still cancel it.
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) { [NNCef shutdown]; }];
  return YES;
}

+ (void)shutdown {
  if (!gStarted) return;
  gStarted = NO;
  gShuttingDown = true;
  pages::CloseAll();
  host::CloseAll();
  // Force-close every browser (tabs, parked popups, little windows), then pump
  // until they're gone (bounded).
  for (int bid : std::set<int>(gLiveBrowsers)) {
    if (CefRefPtr<CefBrowser> b = CefBrowserHost::GetBrowserByIdentifier(bid)) b->GetHost()->CloseBrowser(true);
  }
  CFTimeInterval deadline = CACurrentMediaTime() + 3;
  while (!gLiveBrowsers.empty() && CACurrentMediaTime() < deadline) {
    CefDoMessageLoopWork();
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  ReleaseDiagnostics();
  MessagePump::Get().Stop();
  gContexts.clear();
  gDownloads.clear();
  gPermissions.clear();
  CefShutdown();
  delete gLoader;
  gLoader = nullptr;
}

+ (BOOL)isStarted {
  return gStarted;
}

+ (BOOL)displayMediaPicker {
  return gDisplayMediaPicker;
}

+ (void)setDisplayMediaPicker:(BOOL)enabled {
  gDisplayMediaPicker = enabled;
}

+ (NSArray<NSDictionary *> *)displayMediaSources {
  return site::DesktopCaptureSources();
}

+ (NSDictionary *)engineInfo {
  return @{
    @"pid" : @(getpid()),
    @"dataDirectory" : AppSupportRoot(),
    @"cefVersion" : @CEF_VERSION,
    @"chromiumVersion" : [NSString stringWithFormat:@"%d.%d.%d.%d", CHROME_VERSION_MAJOR, CHROME_VERSION_MINOR,
                                                    CHROME_VERSION_BUILD, CHROME_VERSION_PATCH],
    @"liveBrowsers" : @(gLiveBrowsers.size()),
    @"popupWindows" : @(PopupWindowCount()),
    @"chromeWindows" : @(host::WindowCount()),
    @"chromeTabs" : @(host::ChromeTabs()),
    @"tabCapture" : @(kTabCaptureSupported),
  };
}

+ (NSArray<NSDictionary *> *)chromeWindows {
  return host::WindowStates();
}

+ (NSString *)devWindow:(NSInteger)windowNumber action:(NSString *)action {
#if defined(DEBUG) || defined(POD_CONFIGURATION_DEBUG)
  return host::DevWindowAction(windowNumber, action);
#else
  return @"";
#endif
}

+ (NNEventHandler)eventHandler {
  return gEventHandler;
}

+ (void)setEventHandler:(NNEventHandler)eventHandler {
  gEventHandler = [eventHandler copy];
}

static DownloadEntry *FindDownload(NSString *downloadId) {
  auto it = gDownloads.find((uint32_t)downloadId.longLongValue);
  return it == gDownloads.end() ? nullptr : &it->second;
}

+ (void)cancelDownload:(NSString *)downloadId {
  if (DownloadEntry *e = FindDownload(downloadId); e && e->callback) e->callback->Cancel();
}

+ (void)pauseDownload:(NSString *)downloadId {
  if (DownloadEntry *e = FindDownload(downloadId); e && e->callback) e->callback->Pause();
}

+ (void)resumeDownload:(NSString *)downloadId {
  if (DownloadEntry *e = FindDownload(downloadId); e && e->callback) e->callback->Resume();
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  auto it = gPermissions.find(requestId.UTF8String);
  if (it == gPermissions.end()) return;
  PendingPermission p = it->second;
  gPermissions.erase(it);
  BOOL accept = [result isEqualToString:@"accept"];
  BOOL deny = [result isEqualToString:@"deny"];
  if (p.prompt) {
    p.prompt->Continue(accept ? CEF_PERMISSION_RESULT_ACCEPT : deny ? CEF_PERMISSION_RESULT_DENY : CEF_PERMISSION_RESULT_DISMISS);
  } else if (p.media) {
    if (accept) {
      site::NoteGrantedMedia(p.browserId, p.mediaPermissions);
      p.media->Continue(p.mediaPermissions);
    } else {
      p.media->Cancel();
    }
  }
  // Chromium stores accept/deny for the origin; "this time only" is undone when
  // the tab leaves the origin.
  if ((accept || deny) && !p.types.empty() && p.origin.length && !IsIncognito(p.profile)) {
    site::Remember(p.profile, p.origin, p.types, accept ? CEF_CONTENT_SETTING_VALUE_ALLOW : CEF_CONTENT_SETTING_VALUE_BLOCK,
                   remember ? 0 : p.browserId);
  }
}

+ (void)clearBrowsingDataForProfile:(NSString *)profile
                              types:(NSArray<NSString *> *)types
                              since:(double)sinceMs
                         completion:(void (^)(void))completion {
  CefRefPtr<CefRequestContext> context = ContextForProfile(profile);
#if NN_BROWSING_DATA
  // Chrome's BrowsingDataRemover, as its "Delete browsing data" does it: history is Chrome's
  // history database (what chrome.history shows), site data every kind of site storage, live.
  static NSDictionary<NSString *, NSNumber *> *kTypes = @{
    @"history" : @(CEF_NN_BROWSING_DATA_HISTORY),
    @"siteData" : @(CEF_NN_BROWSING_DATA_SITE_DATA),
    @"cache" : @(CEF_NN_BROWSING_DATA_CACHE),
    @"downloads" : @(CEF_NN_BROWSING_DATA_DOWNLOADS),
  };
  int mask = 0;
  for (NSString *type in types) mask |= kTypes[type].intValue;
  CefBaseTime begin;
  if (sinceMs > 0) begin = CefBaseTime(cef_basetime_t{(int64_t)((sinceMs / 1000 + 11644473600.0) * 1000000)});
  context->ClearBrowsingData(mask, begin, CefBaseTime(), new DoneCallback(completion ?: ^{}));
#else
  // Stock CEF: all cookies (for a range too) and the whole HTTP cache; site storage stays.
  __block int pending = 1;
  void (^done)(void) = ^{
    if (--pending == 0 && completion) completion();
  };
  if ([types containsObject:@"siteData"]) {
    pending++;
    context->GetCookieManager(nullptr)->DeleteCookies("", "", new DoneCallback(done));
  }
  if ([types containsObject:@"cache"]) {
    pending++;
    context->ClearHttpCache(new DoneCallback(done));
  }
  done();
#endif
}

+ (void)releaseProfile:(NSString *)profile {
  gContexts.erase(profile.UTF8String);
}

+ (NSString *)rootCachePath {
  return AppSupportRoot();
}

@end
