#import "NNCefInternal.h"

#import "NNChromeUI.h"
#import "NNContentBlocker.h"
#import "NNExtensionPage.h"
#import "NNExtensionsInternal.h"
#import "NNNativeMessaging.h"
#import "NNPopupWindow.h"
#import "NNSiteSettings.h"
#import "NNWindowHost.h"
#import "NNZoom.h"

#import <CoreServices/CoreServices.h>
#import <Security/Security.h>
#include <sys/xattr.h>

#include <map>
#include <set>
#include <vector>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/cef_browser_process_handler.h"
#include "include/cef_command_line.h"
#include "include/cef_cookie.h"
#include "include/cef_pack_strings.h"
#include "include/cef_resource_bundle.h"
#include "include/cef_resource_bundle_handler.h"
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

- (void)activateIgnoringOtherApps:(BOOL)flag {
  if (nn::activation::Allow(@"activateIgnoringOtherApps:")) [super activateIgnoringOtherApps:flag];
}

- (void)activate {
  if (nn::activation::Allow(@"activate")) [super activate];
}

@end

// MARK: - External message pump

namespace {

// The engine asks for its next call itself (when its next delayed task is due, or at once when a time slice ran out
// with work left), so this poll is only a safety net.
constexpr double kMaxTimerDelay = 1;

class MessagePump {
 public:
  static MessagePump &Get() {
    static MessagePump pump;
    return pump;
  }

  // Any thread. The deadline is taken now: the main queue may be busy for a while before it runs the request.
  void Schedule(int64_t delay_ms) {
    const CFTimeInterval deadline = delay_ms > 0 ? CACurrentMediaTime() + delay_ms / 1000.0 : 0;
    dispatch_async(dispatch_get_main_queue(), ^{ this->OnSchedule(deadline); });
  }

  void Stop() {
    stopped_ = true;
    KillTimer();
  }

 private:
  void OnSchedule(CFTimeInterval deadline) {
    if (stopped_) return;
    if (deadline <= 0) return DoWork();
    // Keep an earlier wake that's still pending: requests from different threads can arrive out of order, and
    // an early call costs one pass that finds nothing due, while a late one delays every task behind it.
    const CFTimeInterval at = std::min(deadline, CACurrentMediaTime() + kMaxTimerDelay);
    if (!timer_ || at < timerAt_) SetTimer(at);
  }

  void DoWork() {
    if (stopped_) return;
    KillTimer();
    bool reentrant = PerformWork();
    if (stopped_) return;
    if (reentrant) {
      Schedule(0);
    } else if (!timer_) {
      SetTimer(CACurrentMediaTime() + kMaxTimerDelay);
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

  void SetTimer(CFTimeInterval at) {
    KillTimer();
    timerAt_ = at;
    timer_ = [NSTimer timerWithTimeInterval:std::max(at - CACurrentMediaTime(), 0.0)
                                    repeats:NO
                                      block:^(NSTimer *) {
                                        this->timer_ = nil;
                                        this->DoWork();
                                      }];
    [[NSRunLoop mainRunLoop] addTimer:timer_ forMode:NSRunLoopCommonModes];
  }

  void KillTimer() {
    [timer_ invalidate];
    timer_ = nil;
  }

  NSTimer *timer_ = nil;
  CFTimeInterval timerAt_ = 0;
  bool active_ = false;
  bool reentrancy_ = false;
  bool stopped_ = false;
};

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

// MARK: - Strings

// Chrome's own UI (bubbles, dialogs, its WebUI pages) names the product "Chromium", literally in every
// locale's strings, not through the branding file. Say Netnyahoo instead, as Chrome says Chrome.
class Strings : public CefResourceBundleHandler {
 public:
  bool GetLocalizedString(int string_id, CefString &string) override {
    // Chrome's post-install bubble points at a Window > Extensions item; ours is a menu of its own.
    if (string_id == IDS_EXTENSION_INSTALLED_MANAGE_INFO) {
      string = "Manage your extensions from the Extensions menu.";
      return true;
    }
    thread_local bool reading = false;
    if (reading) return false;
    reading = true;
    std::u16string text = CefResourceBundle::GetGlobal()->GetLocalizedString(string_id).ToString16();
    reading = false;
    if (!Rename(text)) return false;
    string = text;
    return true;
  }
  bool GetDataResource(int, void *&, size_t &) override { return false; }
  bool GetDataResourceForScale(int, ScaleFactor, void *&, size_t &) override { return false; }

 private:
  // Whole words only: "Chromium's" becomes "Netnyahoo's", "ChromiumOS" stays. Credits stay too: "The
  // Chromium Authors" in the copyright line, and "made possible by the Chromium open source project".
  static bool Rename(std::u16string &text) {
    static const std::u16string from = u"Chromium", to = u"Netnyahoo";
    static const std::u16string credits[] = {u" Authors", u" open source", u"</a> open source"};
    auto letter = [](char16_t c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); };
    auto credit = [&](size_t end) {
      for (const auto &after : credits)
        if (text.compare(end, after.size(), after) == 0) return true;
      return false;
    };
    bool renamed = false;
    for (size_t at = text.find(from); at != std::u16string::npos; at = text.find(from, at)) {
      const size_t end = at + from.size();
      if ((at > 0 && letter(text[at - 1])) || (end < text.size() && letter(text[end])) || credit(end)) {
        at = end;
        continue;
      }
      text.replace(at, from.size(), to);
      at += to.size();
      renamed = true;
    }
    return renamed;
  }

  IMPLEMENT_REFCOUNTING(Strings);
};

// MARK: - CefApp (browser process)

class BrowserApp : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  CefRefPtr<CefResourceBundleHandler> GetResourceBundleHandler() override { return strings_; }

  void OnBeforeCommandLineProcessing(const CefString &process_type,
                                     CefRefPtr<CefCommandLine> command_line) override {
    if (!process_type.empty()) return;
    command_line->AppendSwitch("enable-smooth-scrolling");
    command_line->AppendSwitch("disable-popup-blocking");
    // A non-official build counts as a developer build, so Chrome's UMA stack profiler samples the main and IO
    // threads of every process at 10 Hz for its first 30 s (each new tab's renderer too), then 2 % of the time.
    // Nothing reads the profiles; Chrome's stable channel runs it for a sliver of users.
    command_line->AppendSwitch("disable-stack-profiler");
    // The app's own profile ("", the global request context) is the Default directory (ProfilePath). Chrome starts
    // in its last-used profile (Local State's profile.last_used), which it moves to whichever profile's window was
    // last active; after quitting with another profile's window in front, Personal's tabs ran in that profile and
    // its history and bookmarks didn't load.
    command_line->AppendSwitchWithValue("profile-directory", "Default");
    std::string disabled = command_line->GetSwitchValue("disable-features").ToString();
    command_line->AppendSwitchWithValue("disable-features",
                                        (disabled.empty() ? "" : disabled + ",") + "MacAppCodeSignClone");
    std::string enabled = command_line->GetSwitchValue("enable-features").ToString();
    command_line->AppendSwitchWithValue("enable-features",
                                        (enabled.empty() ? "" : enabled + ",") + "WebContentsDiscard");
    if (const char *port = getenv("NETNYAHOO_REMOTE_DEBUGGING_PORT")) {
      command_line->AppendSwitchWithValue("remote-debugging-port", port);
      command_line->AppendSwitchWithValue("remote-allow-origins", "*");
    }
    if (getenv("NETNYAHOO_DATA_DIR") || !IsTeamSigned()) command_line->AppendSwitch("use-mock-keychain");
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
    dispatch_async(dispatch_get_main_queue(), ^{ [NSApp activateIgnoringOtherApps:YES]; });
    return true;
  }

  CefRefPtr<CefClient> GetDefaultClient() override { return nn::host::DefaultClient(); }
  CefRefPtr<CefRequestContextHandler> GetDefaultRequestContextHandler() override { return nn::ext::ContextHandler(@""); }

 private:
  CefRefPtr<Strings> strings_ = new Strings();
  IMPLEMENT_REFCOUNTING(BrowserApp);
};

// MARK: - State

CefScopedLibraryLoader *gLoader = nullptr;
BOOL gStarted = NO;
bool gShuttingDown = false;
NNEventHandler gEventHandler = nil;
std::map<std::string, CefRefPtr<CefRequestContext>> gContexts;
std::set<int> gLiveBrowsers;
std::vector<CefRefPtr<CefWindow>> gLiveWindows;
NSWindow *gParkingWindow = nil;
NSHashTable<NNBrowserView *> *gViews = nil;

struct DownloadEntry {
  CefRefPtr<CefDownloadItemCallback> callback;
  std::string path;
  NSString *profile;
  NSString *origin;
  CFTimeInterval lastEmit = 0;
  bool quarantined = false;
};
// Chromium numbers downloads per profile, so two profiles can both have a download 1. Controls, events
// and the JS records use an app-wide id instead, allocated the first time a (profile, engine id) shows up.
std::map<std::pair<std::string, uint32_t>, uint64_t> gDownloadIds;
std::map<uint64_t, DownloadEntry> gDownloads;
uint64_t gNextDownloadId = 1;
// Private profiles already released: late updates from their downloads are dropped.
std::set<std::string> gReleasedDownloadProfiles;

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
  if (const char *dir = getenv("NETNYAHOO_DATA_DIR"))
    return [[NSString stringWithUTF8String:dir] stringByAppendingPathComponent:@"Chromium"];
  NSURL *base = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                                      inDomains:NSUserDomainMask].firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.netnyahoo.browser";
  return [[base.path stringByAppendingPathComponent:bundleId] stringByAppendingPathComponent:@"Chromium"];
}

std::string AcceptLanguages() {
  NSMutableOrderedSet<NSString *> *list = [NSMutableOrderedSet orderedSet];
  for (NSString *identifier in NSLocale.preferredLanguages) {
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:identifier];
    NSString *language = locale.languageCode, *region = locale.regionCode, *script = locale.scriptCode;
    if (!language.length) continue;
    if ([language isEqualToString:@"zh"] && !region.length) region = [script isEqualToString:@"Hant"] ? @"TW" : @"CN";
    if (region.length) [list addObject:[NSString stringWithFormat:@"%@-%@", language, region]];
    [list addObject:language];
  }
  return [list.array componentsJoinedByString:@","].UTF8String;
}

NSString *ProfilePath(NSString *profile) {
  NSString *root = AppSupportRoot();
  if (profile.length == 0) return [root stringByAppendingPathComponent:@"Default"];
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
  const char *override = getenv("NETNYAHOO_DOWNLOADS_DIR");
  NSString *folder = override ? @(override)
                              : [[NSFileManager defaultManager] URLsForDirectory:NSDownloadsDirectory
                                                                       inDomains:NSUserDomainMask].firstObject.path;
  [[NSFileManager defaultManager] createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *name = suggested.length ? suggested.lastPathComponent : @"download";
  NSString *base = name.stringByDeletingPathExtension;
  NSString *ext = name.pathExtension;
  NSString *candidate = [folder stringByAppendingPathComponent:name];
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

}

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
  gReleasedDownloadProfiles.erase(key);

  CefRequestContextSettings settings;
  if (![profile hasPrefix:@"incognito"]) {
    NSString *path = ProfilePath(profile);
    [[NSFileManager defaultManager] createDirectoryAtPath:path withIntermediateDirectories:YES attributes:nil error:nil];
    CefString(&settings.cache_path) = path.UTF8String;
    settings.persist_session_cookies = true;
  }
  CefRefPtr<CefRequestContext> context = CefRequestContext::CreateContext(settings, ext::ContextHandler(profile));
  gContexts[key] = context;
  return context;
}

namespace {
DownloadEntry *EntryFor(NSString *profile, uint32_t engineId, uint64_t *outId = nullptr) {
  std::string key = (profile ?: @"").UTF8String;
  if (gReleasedDownloadProfiles.count(key)) return nullptr;
  auto [it, added] = gDownloadIds.try_emplace({key, engineId}, gNextDownloadId);
  if (added) {
    gNextDownloadId++;
    gDownloads[it->second].profile = [profile copy] ?: @"";
  }
  if (outId) *outId = it->second;
  return &gDownloads[it->second];
}

// Credentials never go into the quarantine record, and only web URLs do (a data: URL can be megabytes).
NSURL *QuarantineURL(NSString *url) {
  NSURLComponents *c = url.length ? [NSURLComponents componentsWithString:url] : nil;
  NSString *scheme = c.scheme.lowercaseString;
  if (!([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"] || [scheme isEqualToString:@"ftp"]))
    return nil;
  c.user = nil;
  c.password = nil;
  return c.URL;
}

constexpr char kQuarantineXattr[] = "com.apple.quarantine";

// LaunchServices writes com.apple.quarantine as "flags;timestamp;agent;event id" and puts the agent there only
// from the writing process's own quarantine state, which an app gets from LSFileQuarantineEnabled: from us it
// leaves "0081;<time>;;<id>", so Gatekeeper's first-open prompt can't name Netnyahoo. Fill the agent and flags in
// as the system writes them for Chrome ("0083;<time>;Google Chrome;<id>"), keeping the event id that ties the file
// to its row in the quarantine events database.
void StampQuarantineAgent(NSString *path, NSString *agent) {
  const char *fs = path.fileSystemRepresentation;
  char value[1024];
  ssize_t size = getxattr(fs, kQuarantineXattr, value, sizeof(value) - 1, 0, 0);
  if (size <= 0) return;
  value[size] = 0;
  NSMutableArray<NSString *> *fields = [[@(value) componentsSeparatedByString:@";"] mutableCopy];
  // The flags field is exactly four hex digits.
  NSCharacterSet *notHex = [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"].invertedSet;
  if (fields.count < 4 || fields[2].length || fields[0].length != 4 ||
      [fields[0] rangeOfCharacterFromSet:notHex].location != NSNotFound)
    return;
  unsigned long flags = strtoul(fields[0].UTF8String, nullptr, 16);
  fields[0] = [NSString stringWithFormat:@"%04lx", flags | 0x2];
  fields[2] = [agent stringByReplacingOccurrencesOfString:@";" withString:@""];
  NSData *stamped = [[fields componentsJoinedByString:@";"] dataUsingEncoding:NSUTF8StringEncoding];
  if (setxattr(fs, kQuarantineXattr, stamped.bytes, stamped.length, 0, 0))
    NSLog(@"[cef] quarantine agent %@: %s", path.lastPathComponent, strerror(errno));
}

// Spotlight's "Where from" (kMDItemWhereFroms): the download's URL, then the page it came from, as Chrome and
// Safari record them. It's where the URLs survive: the quarantine events database stopped keeping them in
// macOS 12.4.
void SetWhereFroms(NSString *path, NSArray<NSString *> *urls) {
  const char *fs = path.fileSystemRepresentation;
  constexpr char kName[] = "com.apple.metadata:kMDItemWhereFroms";
  if (!urls.count) {
    removexattr(fs, kName, 0);
    return;
  }
  NSData *plist = [NSPropertyListSerialization dataWithPropertyList:urls
                                                             format:NSPropertyListBinaryFormat_v1_0
                                                            options:0
                                                              error:nil];
  if (plist && setxattr(fs, kName, plist.bytes, plist.length, 0, 0))
    NSLog(@"[cef] where froms %@: %s", path.lastPathComponent, strerror(errno));
}

// The ungoogled patch set makes Chromium's own quarantine a no-op, so a finished download gets
// com.apple.quarantine here, before the "finished" event reaches JS (Open When Done): opening a downloaded
// app then goes through Gatekeeper. Private downloads are quarantined without their URLs, which the record
// and Spotlight's "Where from" would otherwise keep.
void Quarantine(NSString *path, NSString *dataURL, NSString *originURL, bool incognito) {
  NSURL *file = [NSURL fileURLWithPath:path];
  // A record the file already has keeps its event id; ours fills in the rest.
  NSDictionary *existing = nil;
  [file getResourceValue:&existing forKey:NSURLQuarantinePropertiesKey error:nil];
  NSMutableDictionary *props = [existing mutableCopy] ?: [NSMutableDictionary dictionary];
  NSString *agent = NSBundle.mainBundle.infoDictionary[@"CFBundleName"] ?: @"Netnyahoo";
  props[(__bridge NSString *)kLSQuarantineAgentNameKey] = agent;
  if (NSString *bundleId = NSBundle.mainBundle.bundleIdentifier)
    props[(__bridge NSString *)kLSQuarantineAgentBundleIdentifierKey] = bundleId;
  NSURL *data = incognito ? nil : QuarantineURL(dataURL);
  NSURL *origin = incognito ? nil : QuarantineURL(originURL);
  NSString *scheme = [NSURLComponents componentsWithString:dataURL ?: @""].scheme.lowercaseString;
  props[(__bridge NSString *)kLSQuarantineTypeKey] =
      [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]
          ? (__bridge NSString *)kLSQuarantineTypeWebDownload
          : (__bridge NSString *)kLSQuarantineTypeOtherDownload;
  props[(__bridge NSString *)kLSQuarantineDataURLKey] = data;
  props[(__bridge NSString *)kLSQuarantineOriginURLKey] = origin;
  NSError *error = nil;
  if (![file setResourceValue:props forKey:NSURLQuarantinePropertiesKey error:&error]) {
    NSLog(@"[cef] quarantine %@: %@", path.lastPathComponent, error.localizedDescription);
    return;
  }
  StampQuarantineAgent(path, agent);
  NSMutableArray<NSString *> *froms = [NSMutableArray array];
  if (data) [froms addObject:data.absoluteString];
  if (origin) [froms addObject:origin.absoluteString];
  SetWhereFroms(path, froms);
}
}

bool OnBeforeDownload(CefRefPtr<CefDownloadItem> item, const CefString &suggested_name,
                      CefRefPtr<CefBeforeDownloadCallback> callback, NSString *profile, NSString *origin) {
  DownloadEntry *entry = EntryFor(profile, item->GetId());
  if (!entry) return true;  // Its private context is gone; dropping the callback cancels the download.
  NSString *path = UniqueDownloadPath(ToNS(suggested_name));
  entry->path = path.UTF8String;
  entry->origin = [origin copy];
  callback->Continue(ToCef(path), false);
  return true;
}

namespace {
// Download URLs remembered so a restored or re-opened tab doesn't download again. Normal profiles' entries
// persist in NavigationDownloads.json; private ones live in memory, per private profile, and go with it.
NSMutableDictionary<NSString *, NSNumber *> *gNavigationDownloads;
NSMutableDictionary<NSString *, NSMutableDictionary<NSString *, NSNumber *> *> *gPrivateNavigationDownloads;
NSMutableDictionary<NSString *, NSNumber *> *gUserNavigations;
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

void ForgetPrivateDownloads(NSString *profile) {
  [gPrivateNavigationDownloads removeObjectForKey:profile];
  std::string key = profile.UTF8String;
  for (auto it = gDownloadIds.begin(); it != gDownloadIds.end();) {
    if (it->first.first != key) {
      ++it;
      continue;
    }
    auto entry = gDownloads.find(it->second);
    if (entry != gDownloads.end()) {
      if (entry->second.callback) entry->second.callback->Cancel();
      gDownloads.erase(entry);
    }
    it = gDownloadIds.erase(it);
  }
  gReleasedDownloadProfiles.insert(key);
}
}

void NoteNavigationDownload(NSString *url, NSString *profile) {
  if (!url.length) return;
  NSNumber *now = @(NSDate.date.timeIntervalSince1970);
  if (IsIncognito(profile)) {
    if (!gPrivateNavigationDownloads) gPrivateNavigationDownloads = [NSMutableDictionary dictionary];
    NSMutableDictionary *entries = gPrivateNavigationDownloads[profile];
    if (!entries) gPrivateNavigationDownloads[profile] = entries = [NSMutableDictionary dictionary];
    entries[url] = now;
    return;
  }
  NSMutableDictionary *entries = NavigationDownloads();
  entries[url] = now;
  if (entries.count > 200) {
    NSArray *oldest = [entries keysSortedByValueUsingSelector:@selector(compare:)];
    [entries removeObjectsForKeys:[oldest subarrayWithRange:NSMakeRange(0, entries.count - 200)]];
  }
  [[NSJSONSerialization dataWithJSONObject:entries options:0 error:nil] writeToFile:NavigationDownloadsPath() atomically:YES];
}

bool WasNavigationDownload(NSString *url, NSString *profile) {
  if (!url.length) return false;
  NSNumber *when = NavigationDownloads()[url];
  if (!when && IsIncognito(profile)) when = gPrivateNavigationDownloads[profile][url];
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
  uint64_t id = 0;
  DownloadEntry *entry = EntryFor(profile, item->GetId(), &id);
  if (!entry) return;
  entry->callback = callback;
  if (!item->GetFullPath().empty()) entry->path = item->GetFullPath().ToString();
  NSString *path = [NSString stringWithUTF8String:entry->path.c_str()];

  NSString *state = @"downloading";
  if (item->IsComplete()) state = @"finished";
  else if (item->IsCanceled()) state = @"cancelled";
  else if (item->IsInterrupted()) state = @"failed";

  if (item->IsComplete() && !entry->quarantined && path.length) {
    entry->quarantined = true;
    Quarantine(path, ToNS(item->GetURL()), entry->origin, IsIncognito(entry->profile));
  }

  CFTimeInterval now = CACurrentMediaTime();
  if ([state isEqualToString:@"downloading"] && now - entry->lastEmit < 0.1) return;
  entry->lastEmit = now;

  EmitGlobal(@"download", @{
    @"id" : [NSString stringWithFormat:@"%llu", id],
    @"url" : ToNS(item->GetOriginalUrl()),
    @"filename" : path.lastPathComponent ?: @"",
    @"path" : path ?: @"",
    @"state" : state,
    @"paused" : @(item->IsPaused()),
    @"received" : @(item->GetReceivedBytes()),
    @"total" : @(item->GetTotalBytes() > 0 ? item->GetTotalBytes() : -1),
    @"speed" : @(item->GetCurrentSpeed()),
    @"mimeType" : ToNS(item->GetMimeType()),
    @"profile" : entry->profile ?: @"",
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
  // Camera and microphone only: the tab's client answered screen sharing (Client::OnRequestMediaAccessPermission).
  if (permissions & (CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE)) {
    callback->Cancel();
    return true;
  }
  NSMutableArray *names = [NSMutableArray array];
  if (permissions & CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE) [names addObject:@"microphone"];
  if (permissions & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE) [names addObject:@"camera"];
  NSString *profile = ProfileForContext(browser->GetHost()->GetRequestContext()) ?: @"";
  auto types = site::TypesForMedia(permissions);
  if (!types.empty()) {
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
  gPermissions[id] = {browser->GetIdentifier(), nullptr, callback, permissions, profile, ToNS(origin), types};
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

void WindowCreated(CefRefPtr<CefWindow> window) { gLiveWindows.push_back(window); }

void WindowDestroyed(CefRefPtr<CefWindow> window) {
  std::erase_if(gLiveWindows, [&](const CefRefPtr<CefWindow> &w) { return w->IsSame(window); });
}

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

}

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
  nn::nativemessaging::SyncHosts(root);
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
  blocker::StartPreparing();
  zoom::InstallScrollMonitor();
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) { [NNCef shutdown]; }];
  // A password manager installed while we run connects once the user comes back to us.
  static dispatch_queue_t syncQueue = dispatch_queue_create("netnyahoo.native-messaging", DISPATCH_QUEUE_SERIAL);
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                dispatch_async(syncQueue, ^{ nn::nativemessaging::SyncHosts(root); });
                                              }];
  return YES;
}

+ (void)shutdown {
  if (!gStarted) return;
  gStarted = NO;
  gShuttingDown = true;
  extpage::CloseAll();
  host::CloseAll();
// Close Chrome browsers before CefShutdown or profile teardown crashes.
  for (int bid : std::set<int>(gLiveBrowsers)) {
    if (CefRefPtr<CefBrowser> b = CefBrowserHost::GetBrowserByIdentifier(bid)) b->GetHost()->CloseBrowser(true);
  }
  auto pumpWhile = [](CFTimeInterval seconds, bool (^busy)(void)) {
    CFTimeInterval deadline = CACurrentMediaTime() + seconds;
    while (busy() && CACurrentMediaTime() < deadline) {
      CefDoMessageLoopWork();
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
  };
  pumpWhile(3, ^{ return !gLiveBrowsers.empty(); });
  for (CefRefPtr<CefWindow> window : std::vector(gLiveWindows)) window->Close();
  pumpWhile(3, ^{ return !gLiveWindows.empty(); });
  ReleaseDiagnostics();
  chromeui::ReleaseRouteWatches();
  MessagePump::Get().Stop();
  gContexts.clear();
  gDownloads.clear();
  gDownloadIds.clear();
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
  auto it = gDownloads.find(strtoull(downloadId.UTF8String ?: "", nullptr, 10));
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
}

+ (void)releaseProfile:(NSString *)profile {
  gContexts.erase(profile.UTF8String);
  // A private context goes for good: its downloads stop and nothing it downloaded stays in memory.
  if (IsIncognito(profile)) ForgetPrivateDownloads(profile);
}

+ (NSString *)rootCachePath {
  return AppSupportRoot();
}

@end
