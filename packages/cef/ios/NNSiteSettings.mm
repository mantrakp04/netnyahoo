#import "NNSiteSettings.h"

#import "NNWindowHost.h"

#import <CommonCrypto/CommonDigest.h>

#include <algorithm>
#include <map>

#include "include/cef_cookie.h"
#include "include/cef_ssl_status.h"
#include "include/cef_x509_certificate.h"
#include "include/internal/cef_time.h"

#import "NNClient.h"

using namespace nn;

namespace {

// MARK: - Types and values

struct SettingType {
  const char *name;
  cef_content_setting_types_t type;
  /// Chrome's content settings registry name: its exceptions are the pref
  /// "profile.content_settings.exceptions.<pref>".
  const char *pref;
};

// Only types Chromium registers on macOS (querying others CHECK-fails).
// Chrome stores "autoplay" but only enforces it on Android; the page script
// enforces it here.
const SettingType kTypes[] = {
    {"popups", CEF_CONTENT_SETTING_TYPE_POPUPS, "popups"},
    {"camera", CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_CAMERA, "media_stream_camera"},
    {"microphone", CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_MIC, "media_stream_mic"},
    {"location", CEF_CONTENT_SETTING_TYPE_GEOLOCATION, "geolocation"},
    {"notifications", CEF_CONTENT_SETTING_TYPE_NOTIFICATIONS, "notifications"},
    {"sound", CEF_CONTENT_SETTING_TYPE_SOUND, "sound"},
    {"autoplay", CEF_CONTENT_SETTING_TYPE_AUTOPLAY, "autoplay"},
    {"javascript", CEF_CONTENT_SETTING_TYPE_JAVASCRIPT, "javascript"},
    {"images", CEF_CONTENT_SETTING_TYPE_IMAGES, "images"},
    {"clipboard", CEF_CONTENT_SETTING_TYPE_CLIPBOARD_READ_WRITE, "clipboard"},
    {"automaticDownloads", CEF_CONTENT_SETTING_TYPE_AUTOMATIC_DOWNLOADS, "automatic_downloads"},
    {"cookies", CEF_CONTENT_SETTING_TYPE_COOKIES, "cookies"},
    {"midi", CEF_CONTENT_SETTING_TYPE_MIDI_SYSEX, "midi_sysex"},
    {"sensors", CEF_CONTENT_SETTING_TYPE_SENSORS, "sensors"},
    {"windowManagement", CEF_CONTENT_SETTING_TYPE_WINDOW_MANAGEMENT, "window_placement"},
    {"localFonts", CEF_CONTENT_SETTING_TYPE_LOCAL_FONTS, "local_fonts"},
    {"idleDetection", CEF_CONTENT_SETTING_TYPE_IDLE_DETECTION, "idle_detection"},
    {"storageAccess", CEF_CONTENT_SETTING_TYPE_STORAGE_ACCESS, "storage_access"},
    {"fileSystem", CEF_CONTENT_SETTING_TYPE_FILE_SYSTEM_WRITE_GUARD, "file_system_write_guard"},
    {"keyboardLock", CEF_CONTENT_SETTING_TYPE_KEYBOARD_LOCK, "keyboard_lock"},
    {"pointerLock", CEF_CONTENT_SETTING_TYPE_POINTER_LOCK, "pointer_lock"},
    {"cameraPanTiltZoom", CEF_CONTENT_SETTING_TYPE_CAMERA_PAN_TILT_ZOOM, "camera_pan_tilt_zoom"},
};

const SettingType *TypeNamed(NSString *name) {
  for (const SettingType &t : kTypes)
    if ([name isEqualToString:@(t.name)]) return &t;
  return nullptr;
}

NSString *ValueName(cef_content_setting_values_t v) {
  switch (v) {
    case CEF_CONTENT_SETTING_VALUE_ALLOW:
    case CEF_CONTENT_SETTING_VALUE_SESSION_ONLY: return @"allow";
    case CEF_CONTENT_SETTING_VALUE_BLOCK: return @"block";
    case CEF_CONTENT_SETTING_VALUE_ASK: return @"ask";
    default: return @"default";
  }
}

cef_content_setting_values_t ValueNamed(NSString *name) {
  if ([name isEqualToString:@"allow"]) return CEF_CONTENT_SETTING_VALUE_ALLOW;
  if ([name isEqualToString:@"block"]) return CEF_CONTENT_SETTING_VALUE_BLOCK;
  if ([name isEqualToString:@"ask"]) return CEF_CONTENT_SETTING_VALUE_ASK;
  return CEF_CONTENT_SETTING_VALUE_DEFAULT;
}

// MARK: - Site-specific values
//
// CEF can read a value but not enumerate them: Chrome's exceptions are read
// from its prefs, {"https://example.com:443,*": {setting, last_modified…}}.

/// "https://example.com" for an exception's primary pattern (nil for wildcards and non-web schemes).
NSString *OriginOfPattern(NSString *pattern) {
  NSString *primary = [pattern componentsSeparatedByString:@","].firstObject;
  if ([primary containsString:@"*"]) return nil;
  NSURLComponents *c = [NSURLComponents componentsWithString:primary];
  NSString *scheme = c.scheme.lowercaseString;
  if (!c.host.length || !([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) return nil;
  bool defaultPort = !c.port || ([scheme isEqualToString:@"https"] && c.port.intValue == 443) ||
                     ([scheme isEqualToString:@"http"] && c.port.intValue == 80);
  NSString *origin = [NSString stringWithFormat:@"%@://%@", scheme, c.host.lowercaseString];
  return defaultPort ? origin : [origin stringByAppendingFormat:@":%@", c.port];
}

/// Origins with an exception for `type` in the profile.
NSSet<NSString *> *ExceptionOrigins(NSString *profile, const SettingType &type) {
  NSMutableSet *origins = [NSMutableSet set];
  std::string pref = std::string("profile.content_settings.exceptions.") + type.pref;
  CefRefPtr<CefValue> value = ContextForProfile(profile)->GetPreference(pref);
  CefRefPtr<CefDictionaryValue> exceptions = value && value->GetType() == VTYPE_DICTIONARY ? value->GetDictionary() : nullptr;
  CefDictionaryValue::KeyList keys;
  if (exceptions) exceptions->GetKeys(keys);
  for (const CefString &key : keys)
    if (NSString *origin = OriginOfPattern(ToNS(key))) [origins addObject:origin];
  return origins;
}

// MARK: - Per-browser state

struct TemporaryGrant {
  NSString *profile, *origin;
  cef_content_setting_types_t type;
};
std::map<int, std::vector<TemporaryGrant>> gTemporary;
std::map<int, uint32_t> gGrantedMedia;
std::map<int, CefRefPtr<CefUnresponsiveProcessCallback>> gUnresponsive;

struct BlockedPopup {
  int browserId;
  NSString *url, *name, *features;
};
std::map<std::string, BlockedPopup> gBlockedPopups;
uint64_t gBlockedPopupSeq = 0;

void SetValue(NSString *profile, NSString *origin, cef_content_setting_types_t type, cef_content_setting_values_t value) {
  ContextForProfile(profile)->SetContentSetting(ToCef(origin), ToCef(origin), type, value);
}

class CookiesDeleted : public CefDeleteCookiesCallback {
 public:
  explicit CookiesDeleted(void (^block)(int)) : block_([block copy]) {}
  void OnComplete(int num_deleted) override {
    auto block = block_;  // not `this`: we may be released before the block runs
    dispatch_async(dispatch_get_main_queue(), ^{ block(num_deleted); });
  }

 private:
  void (^block_)(int);
  IMPLEMENT_REFCOUNTING(CookiesDeleted);
};

double EpochSeconds(CefBaseTime time) {
  cef_time_t t;
  double seconds = 0;
  if (cef_time_from_basetime(time, &t)) cef_time_to_doublet(&t, &seconds);
  return seconds;
}

NSDictionary *Principal(CefRefPtr<CefX509CertPrincipal> p) {
  if (!p) return @{};
  std::vector<CefString> orgs;
  p->GetOrganizationNames(orgs);
  NSMutableArray *organizations = [NSMutableArray array];
  for (auto &o : orgs) [organizations addObject:ToNS(o)];
  return @{
    @"commonName" : ToNS(p->GetCommonName()),
    @"displayName" : ToNS(p->GetDisplayName()),
    @"organizations" : organizations,
    @"country" : ToNS(p->GetCountryName()),
  };
}

NSString *Hex(const unsigned char *bytes, size_t length, NSString *separator) {
  NSMutableArray *parts = [NSMutableArray arrayWithCapacity:length];
  for (size_t i = 0; i < length; i++) [parts addObject:[NSString stringWithFormat:@"%02X", bytes[i]]];
  return [parts componentsJoinedByString:separator];
}

NSArray<NSString *> *CertErrorNames(uint32_t status) {
  static const std::pair<uint32_t, NSString *> kErrors[] = {
      {CERT_STATUS_COMMON_NAME_INVALID, @"nameMismatch"}, {CERT_STATUS_DATE_INVALID, @"dateInvalid"},
      {CERT_STATUS_AUTHORITY_INVALID, @"authorityInvalid"}, {CERT_STATUS_REVOKED, @"revoked"},
      {CERT_STATUS_INVALID, @"invalid"}, {CERT_STATUS_WEAK_SIGNATURE_ALGORITHM, @"weakSignature"},
      {CERT_STATUS_NON_UNIQUE_NAME, @"nonUniqueName"}, {CERT_STATUS_WEAK_KEY, @"weakKey"},
      {CERT_STATUS_PINNED_KEY_MISSING, @"pinnedKeyMissing"}, {CERT_STATUS_NAME_CONSTRAINT_VIOLATION, @"nameConstraint"},
      {CERT_STATUS_VALIDITY_TOO_LONG, @"validityTooLong"}, {CERT_STATUS_CT_COMPLIANCE_FAILED, @"certificateTransparency"},
  };
  NSMutableArray *names = [NSMutableArray array];
  for (auto &[bit, name] : kErrors)
    if (status & bit) [names addObject:name];
  return names;
}

NSDictionary *CertificateInfo(CefRefPtr<CefX509Certificate> cert) {
  if (!cert) return nil;
  NSMutableDictionary *info = [@{
    @"subject" : Principal(cert->GetSubject()),
    @"issuer" : Principal(cert->GetIssuer()),
    @"validFrom" : @(EpochSeconds(cert->GetValidStart()) * 1000),
    @"validUntil" : @(EpochSeconds(cert->GetValidExpiry()) * 1000),
    @"chainLength" : @(cert->GetIssuerChainSize() + 1),
  } mutableCopy];
  if (CefRefPtr<CefBinaryValue> serial = cert->GetSerialNumber()) {
    std::vector<unsigned char> bytes(serial->GetSize());
    serial->GetData(bytes.data(), bytes.size(), 0);
    info[@"serialNumber"] = Hex(bytes.data(), bytes.size(), @":");
  }
  if (CefRefPtr<CefBinaryValue> der = cert->GetDEREncoded()) {
    std::vector<unsigned char> bytes(der->GetSize());
    der->GetData(bytes.data(), bytes.size(), 0);
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(bytes.data(), (CC_LONG)bytes.size(), digest);
    info[@"sha256"] = Hex(digest, sizeof digest, @":");
  }
  return info;
}

NSString *TLSVersion(cef_ssl_version_t v) {
  switch (v) {
    case SSL_CONNECTION_VERSION_TLS1: return @"TLS 1.0";
    case SSL_CONNECTION_VERSION_TLS1_1: return @"TLS 1.1";
    case SSL_CONNECTION_VERSION_TLS1_2: return @"TLS 1.2";
    case SSL_CONNECTION_VERSION_TLS1_3: return @"TLS 1.3";
    case SSL_CONNECTION_VERSION_QUIC: return @"QUIC";
    default: return nil;
  }
}

// Minor statuses Chromium doesn't treat as errors.
constexpr uint32_t kCertErrorMask = 0xFF00FFFF & ~(CERT_STATUS_NO_REVOCATION_MECHANISM | CERT_STATUS_UNABLE_TO_CHECK_REVOCATION);

}  // namespace

// MARK: - nn::site

namespace nn::site {

bool PopupsAllowed(NSString *profile, NSString *openerURL) {
  NSString *origin = OriginOf(openerURL);
  if (!origin) return true;  // file:, about:, extensions…
  return ContextForProfile(profile)->GetContentSetting(ToCef(origin), ToCef(origin), CEF_CONTENT_SETTING_TYPE_POPUPS) ==
         CEF_CONTENT_SETTING_VALUE_ALLOW;
}

NSString *RecordBlockedPopup(int browserId, NSString *url, NSString *name, const CefPopupFeatures &features) {
  NSMutableArray *parts = [NSMutableArray array];
  if (features.isPopup) [parts addObject:@"popup"];
  if (features.widthSet) [parts addObject:[NSString stringWithFormat:@"width=%d", features.width]];
  if (features.heightSet) [parts addObject:[NSString stringWithFormat:@"height=%d", features.height]];
  if (features.xSet) [parts addObject:[NSString stringWithFormat:@"left=%d", features.x]];
  if (features.ySet) [parts addObject:[NSString stringWithFormat:@"top=%d", features.y]];
  std::string id = "popup" + std::to_string(++gBlockedPopupSeq);
  gBlockedPopups[id] = {browserId, url, name, [parts componentsJoinedByString:@","]};
  return @(id.c_str());
}

bool OpenBlockedPopup(CefRefPtr<CefBrowser> browser, NSString *popupId, bool always, NSString *profile) {
  auto it = gBlockedPopups.find(popupId.UTF8String);
  if (it == gBlockedPopups.end()) return false;
  BlockedPopup popup = it->second;
  gBlockedPopups.erase(it);
  if (always) {
    if (NSString *origin = OriginOf(ToNS(browser->GetMainFrame()->GetURL())))
      SetValue(profile, origin, CEF_CONTENT_SETTING_TYPE_POPUPS, CEF_CONTENT_SETTING_VALUE_ALLOW);
  }
  // Replaying window.open() with a user gesture keeps window.opener and the features.
  NSString *call = [NSString stringWithFormat:@"void window.open(%@, %@, %@)", ToJSON(popup.url), ToJSON(popup.name ?: @""),
                                              ToJSON(popup.features ?: @"")];
  EvaluateWithGesture(browser, call, nil);
  return true;
}

NSDictionary *SecurityInfo(CefRefPtr<CefBrowser> browser) {
  CefRefPtr<CefNavigationEntry> entry = browser->GetHost()->GetVisibleNavigationEntry();
  NSString *url = entry && entry->IsValid() ? ToNS(entry->GetURL()) : ToNS(browser->GetMainFrame()->GetURL());
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString ?: @"";
  NSMutableDictionary *info = [@{@"url" : url, @"origin" : OriginOf(url) ?: [NSNull null]} mutableCopy];
  if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"ws"]) {
    info[@"level"] = @"insecure";
    return info;
  }
  if (!([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"wss"])) {
    info[@"level"] = url.length && ![url isEqualToString:@"about:blank"] ? @"local" : @"none";
    return info;
  }
  CefRefPtr<CefSSLStatus> ssl = entry ? entry->GetSSLStatus() : nullptr;
  if (!ssl) {
    info[@"level"] = @"none";
    return info;
  }
  uint32_t certErrors = ssl->GetCertStatus() & kCertErrorMask;
  uint32_t content = ssl->GetContentStatus();
  NSString *level = @"secure";
  if (certErrors || !ssl->IsSecureConnection()) level = @"certificateError";
  else if (content & (SSL_CONTENT_RAN_INSECURE_CONTENT | SSL_CONTENT_DISPLAYED_INSECURE_CONTENT)) level = @"mixed";
  info[@"level"] = level;
  info[@"certificateErrors"] = CertErrorNames(certErrors);
  info[@"mixedContent"] = content & SSL_CONTENT_RAN_INSECURE_CONTENT ? @"ran" : content ? @"displayed" : [NSNull null];
  info[@"isEV"] = @((ssl->GetCertStatus() & CERT_STATUS_IS_EV) != 0);
  if (NSString *tls = TLSVersion(ssl->GetSSLVersion())) info[@"protocol"] = tls;
  if (NSDictionary *cert = CertificateInfo(ssl->GetX509Certificate())) info[@"certificate"] = cert;
  return info;
}

bool OnCertificateError(Client *, cef_errorcode_t, NSString *, CefRefPtr<CefSSLInfo>, CefRefPtr<CefCallback>) {
  // Chrome shows its SSL interstitial (with "Proceed" for overridable errors); Site Controls
  // read the page's certificate state from its security info.
  return false;
}

std::vector<cef_content_setting_types_t> TypesForPermissions(uint32_t permissions) {
  static const std::pair<uint32_t, cef_content_setting_types_t> kMap[] = {
      {CEF_PERMISSION_TYPE_CAMERA_STREAM, CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_CAMERA},
      {CEF_PERMISSION_TYPE_MIC_STREAM, CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_MIC},
      {CEF_PERMISSION_TYPE_CAMERA_PAN_TILT_ZOOM, CEF_CONTENT_SETTING_TYPE_CAMERA_PAN_TILT_ZOOM},
      {CEF_PERMISSION_TYPE_GEOLOCATION, CEF_CONTENT_SETTING_TYPE_GEOLOCATION},
      {CEF_PERMISSION_TYPE_NOTIFICATIONS, CEF_CONTENT_SETTING_TYPE_NOTIFICATIONS},
      {CEF_PERMISSION_TYPE_CLIPBOARD, CEF_CONTENT_SETTING_TYPE_CLIPBOARD_READ_WRITE},
      {CEF_PERMISSION_TYPE_MIDI_SYSEX, CEF_CONTENT_SETTING_TYPE_MIDI_SYSEX},
      {CEF_PERMISSION_TYPE_MULTIPLE_DOWNLOADS, CEF_CONTENT_SETTING_TYPE_AUTOMATIC_DOWNLOADS},
      {CEF_PERMISSION_TYPE_LOCAL_FONTS, CEF_CONTENT_SETTING_TYPE_LOCAL_FONTS},
      {CEF_PERMISSION_TYPE_IDLE_DETECTION, CEF_CONTENT_SETTING_TYPE_IDLE_DETECTION},
      {CEF_PERMISSION_TYPE_STORAGE_ACCESS, CEF_CONTENT_SETTING_TYPE_STORAGE_ACCESS},
      {CEF_PERMISSION_TYPE_WINDOW_MANAGEMENT, CEF_CONTENT_SETTING_TYPE_WINDOW_MANAGEMENT},
      {CEF_PERMISSION_TYPE_FILE_SYSTEM_ACCESS, CEF_CONTENT_SETTING_TYPE_FILE_SYSTEM_WRITE_GUARD},
      {CEF_PERMISSION_TYPE_KEYBOARD_LOCK, CEF_CONTENT_SETTING_TYPE_KEYBOARD_LOCK},
      {CEF_PERMISSION_TYPE_POINTER_LOCK, CEF_CONTENT_SETTING_TYPE_POINTER_LOCK},
      {CEF_PERMISSION_TYPE_SENSORS, CEF_CONTENT_SETTING_TYPE_SENSORS},
  };
  std::vector<cef_content_setting_types_t> types;
  for (auto &[bit, type] : kMap)
    if (permissions & bit) types.push_back(type);
  return types;
}

std::vector<cef_content_setting_types_t> TypesForMedia(uint32_t media) {
  std::vector<cef_content_setting_types_t> types;
  if (media & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE) types.push_back(CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_CAMERA);
  if (media & CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE) types.push_back(CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_MIC);
  return types;
}

cef_content_setting_values_t Decision(NSString *profile, NSString *origin,
                                      const std::vector<cef_content_setting_types_t> &types) {
  if (types.empty() || !OriginOf(origin)) return CEF_CONTENT_SETTING_VALUE_DEFAULT;
  CefRefPtr<CefRequestContext> context = ContextForProfile(profile);
  bool all = true;
  for (auto type : types) {
    cef_content_setting_values_t v = context->GetContentSetting(ToCef(origin), ToCef(origin), type);
    if (v == CEF_CONTENT_SETTING_VALUE_BLOCK) return CEF_CONTENT_SETTING_VALUE_BLOCK;
    all &= v == CEF_CONTENT_SETTING_VALUE_ALLOW;
  }
  return all ? CEF_CONTENT_SETTING_VALUE_ALLOW : CEF_CONTENT_SETTING_VALUE_DEFAULT;
}

void Remember(NSString *profile, NSString *origin, const std::vector<cef_content_setting_types_t> &types,
              cef_content_setting_values_t value, int temporaryForBrowser) {
  origin = OriginOf(origin);
  if (!origin) return;
  for (auto type : types) {
    SetValue(profile, origin, type, value);
    if (temporaryForBrowser) gTemporary[temporaryForBrowser].push_back({profile, origin, type});
  }
}

bool AutoplayBlocked(NSString *profile, NSString *topURL) {
  NSString *origin = OriginOf(topURL);
  return origin && ContextForProfile(profile)->GetContentSetting(ToCef(origin), ToCef(origin), CEF_CONTENT_SETTING_TYPE_AUTOPLAY) ==
                       CEF_CONTENT_SETTING_VALUE_BLOCK;
}

static std::map<int, CFTimeInterval> gDesktopCaptureAllowed;

void AllowDesktopCapture(int browserId) { gDesktopCaptureAllowed[browserId] = CACurrentMediaTime(); }

bool ConsumeDesktopCapture(int browserId) {
  auto it = gDesktopCaptureAllowed.find(browserId);
  // Sharing a tab: Chrome asks on behalf of the captured tab, not the page that asked.
  if (it == gDesktopCaptureAllowed.end() && host::ChromeTabs()) {
    it = std::max_element(gDesktopCaptureAllowed.begin(), gDesktopCaptureAllowed.end(),
                          [](auto &a, auto &b) { return a.second < b.second; });
  }
  if (it == gDesktopCaptureAllowed.end()) return false;
  bool fresh = CACurrentMediaTime() - it->second < 15;
  gDesktopCaptureAllowed.erase(it);
  return fresh;
}

NSArray<NSDictionary *> *DesktopCaptureSources() {
  NSMutableArray *sources = [NSMutableArray array];
  // Chromium's desktop-capture ids: "screen:<CGDirectDisplayID>:0", "window:<CGWindowID>:0".
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
  pid_t me = getpid();
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowOwnerPID] intValue] == me) continue;
    NSDictionary *bounds = w[(id)kCGWindowBounds];
    CGFloat width = [bounds[@"Width"] doubleValue], height = [bounds[@"Height"] doubleValue];
    if (width < 50 || height < 50) continue;
    NSString *app = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = w[(id)kCGWindowName];  // empty without Screen Recording permission
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

void NoteGrantedMedia(int browserId, uint32_t media) { gGrantedMedia[browserId] |= media; }
void ClearGrantedMedia(int browserId) { gGrantedMedia.erase(browserId); }

uint32_t GrantedMedia(int browserId) {
  auto it = gGrantedMedia.find(browserId);
  return it == gGrantedMedia.end() ? 0 : it->second;
}

static void ExpireGrants(int browserId, NSString *keepOrigin) {
  auto it = gTemporary.find(browserId);
  if (it == gTemporary.end()) return;
  std::vector<TemporaryGrant> kept;
  for (const TemporaryGrant &g : it->second) {
    if (keepOrigin && [g.origin isEqualToString:keepOrigin]) kept.push_back(g);
    else SetValue(g.profile, g.origin, g.type, CEF_CONTENT_SETTING_VALUE_DEFAULT);
  }
  if (kept.empty()) gTemporary.erase(it);
  else it->second = kept;
}

void OriginChanged(Client *client) {
  CefRefPtr<CefBrowser> browser = client->Browser();
  if (!browser) return;
  int bid = browser->GetIdentifier();
  NSString *origin = OriginOf(client->URL());
  ExpireGrants(bid, origin);
  gGrantedMedia.erase(bid);
  // Sound: a site set to "block" is muted while the tab shows it.
  client->SetSiteMuted(origin && ContextForProfile(client->Profile())->GetContentSetting(
                                     ToCef(origin), ToCef(origin), CEF_CONTENT_SETTING_TYPE_SOUND) ==
                                     CEF_CONTENT_SETTING_VALUE_BLOCK);
}

void BrowserClosed(int browserId) {
  ExpireGrants(browserId, nil);
  gGrantedMedia.erase(browserId);
  gDesktopCaptureAllowed.erase(browserId);
  gUnresponsive.erase(browserId);
  for (auto it = gBlockedPopups.begin(); it != gBlockedPopups.end();)
    it = it->second.browserId == browserId ? gBlockedPopups.erase(it) : std::next(it);
}

void SetUnresponsiveCallback(int browserId, CefRefPtr<CefUnresponsiveProcessCallback> callback) {
  if (callback) gUnresponsive[browserId] = callback;
  else gUnresponsive.erase(browserId);
}

CefRefPtr<CefUnresponsiveProcessCallback> UnresponsiveCallback(int browserId) {
  auto it = gUnresponsive.find(browserId);
  return it == gUnresponsive.end() ? nullptr : it->second;
}

}  // namespace nn::site

// MARK: - Public API

@implementation NNSiteSettings

+ (NSArray<NSString *> *)types {
  NSMutableArray *names = [NSMutableArray array];
  for (const SettingType &t : kTypes) [names addObject:@(t.name)];
  return names;
}

+ (NSString *)settingForProfile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type {
  const SettingType *t = TypeNamed(type);
  origin = OriginOf(origin);
  if (!t || !origin) return @"default";
  return ValueName(ContextForProfile(profile)->GetContentSetting(ToCef(origin), ToCef(origin), t->type));
}

+ (void)setSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type {
  const SettingType *t = TypeNamed(type);
  origin = OriginOf(origin);
  if (!t || !origin) return;
  SetValue(profile, origin, t->type, ValueNamed(value));
  // Sound applies to open tabs right away.
  if (t->type == CEF_CONTENT_SETTING_TYPE_SOUND) {
    for (NNBrowserView *view in LiveViews()) {
      CefRefPtr<Client> client = view.client;
      if (client && [client->Profile() isEqualToString:profile] && [OriginOf(client->URL()) isEqualToString:origin])
        client->SetSiteMuted([value isEqualToString:@"block"]);
    }
  }
}

+ (NSDictionary *)settingsForProfile:(NSString *)profile origin:(NSString *)origin {
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  NSString *o = OriginOf(origin);
  if (!o) return out;
  for (const SettingType &t : kTypes) {
    NSString *name = @(t.name);
    out[name] = @{
      @"value" : [self settingForProfile:profile origin:o type:name],
      @"isDefault" : @(![ExceptionOrigins(profile, t) containsObject:o]),
    };
  }
  return out;
}

+ (NSArray<NSString *> *)originsForProfile:(NSString *)profile {
  NSMutableSet *origins = [NSMutableSet set];
  for (const SettingType &t : kTypes) [origins unionSet:ExceptionOrigins(profile, t)];
  return [origins.allObjects sortedArrayUsingSelector:@selector(compare:)];
}

+ (void)resetOrigin:(NSString *)origin profile:(NSString *)profile {
  origin = OriginOf(origin);
  if (!origin) return;
  for (const SettingType &t : kTypes) SetValue(profile, origin, t.type, CEF_CONTENT_SETTING_VALUE_DEFAULT);
}

+ (void)clearSiteDataForProfile:(NSString *)profile
                         origin:(NSString *)origin
                     completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  origin = OriginOf(origin);
  if (!origin) {
    completion(@{@"cookies" : @NO, @"storage" : @NO});
    return;
  }
  // Storage goes through DevTools (Storage.clearDataForOrigin) on any browser
  // of the profile; cookies through the cookie manager.
  CefRefPtr<CefBrowser> browser;
  for (NNBrowserView *view in LiveViews()) {
    if (![view.profile isEqualToString:profile]) continue;
    browser = CefBrowserHost::GetBrowserByIdentifier(view.browserId);
    if (browser) break;
  }
  __block NSNumber *cookies = nil, *storage = browser ? nil : @NO;
  void (^finish)(void) = ^{
    if (cookies && storage) completion(@{@"cookies" : cookies, @"storage" : storage});
  };
  ContextForProfile(profile)->GetCookieManager(nullptr)->DeleteCookies(ToCef(origin), "", new CookiesDeleted(^(int count) {
    cookies = @(count);
    finish();
  }));
  if (browser) {
    DevToolsCall(browser, @"Storage.clearDataForOrigin", @{@"origin" : origin, @"storageTypes" : @"all"},
                 ^(NSDictionary *result) {
                   storage = @(result != nil);
                   finish();
                 });
  }
}

@end
