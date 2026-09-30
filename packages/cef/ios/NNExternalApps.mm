#import "NNExternalApps.h"

#import "NNClient.h"

#include <map>

using namespace nn;

namespace nn::external {

namespace {

// CEF's scheme::IsInternalHandledScheme, plus Chromium schemes with loaders of their own.
bool IsEngineScheme(const std::string &scheme) {
  static const char *const kSchemes[] = {
      "about", "blob", "chrome", "chrome-error", "chrome-extension", "chrome-native", "chrome-search",
      "chrome-untrusted", "data", "devtools", "file", "filesystem", "http", "https", "isolated-app", "javascript",
      "ws", "wss",
  };
  for (const char *s : kSchemes)
    if (scheme == s) return true;
  return false;
}

// Chrome's kDeniedSchemes, and schemes that must never leave the browser from a page: its own
// URLs (the netnyahoo: app pages included) and handlers that run code.
NSSet<NSString *> *DeniedSchemes() {
  static NSSet *schemes = [NSSet setWithArray:@[
    @"afp", @"applescript", @"data", @"disk", @"disks", @"file", @"hcp", @"ie.http", @"javascript", @"mk", @"ms-help",
    @"nntp", @"res", @"shell", @"vbscript", @"view-source", @"vnd.ms.radio", @"about", @"blob", @"filesystem",
    @"chrome", @"chrome-extension", @"chrome-untrusted", @"chrome-search", @"chrome-error", @"devtools", @"netnyahoo",
    @"google-chrome", @"chromium",
  ]];
  return schemes;
}

void Log(NSString *line) {
  const char *dir = getenv("NETNYAHOO_DATA_DIR");
  if (!dir) return;
  NSString *path = [@(dir) stringByAppendingPathComponent:@"external-apps.log"];
  NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!file) {
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
    file = [NSFileHandle fileHandleForWritingAtPath:path];
  }
  [file seekToEndOfFile];
  [file writeData:[[NSString stringWithFormat:@"%@ %@\n", NSDate.date, line] dataUsingEncoding:NSUTF8StringEncoding]];
  [file closeFile];
}

class CancelHandler : public CefResourceRequestHandler {
 public:
  ReturnValue OnBeforeResourceLoad(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, CefRefPtr<CefRequest>,
                                   CefRefPtr<CefCallback>) override {
    return RV_CANCEL;
  }

 private:
  IMPLEMENT_REFCOUNTING(CancelHandler);
};

struct Gesture {
  std::string frameId, url;
  bool userGesture;
};

struct Pending {
  CefRefPtr<Client> client;
  int browserId;
  NSString *profile, *origin, *scheme;
  NSURL *url, *app;
  bool canRemember, ownsTab;
};

std::map<int, Gesture> gGestures;
std::map<std::string, Pending> gPending;
uint64_t gSeq = 0;
// Chrome's anti-flood rule: after one request, more need user input first.
bool gAcceptRequests = true;

NSURL *LinkURL(NSString *spec) {
  if (NSURL *url = [NSURL URLWithString:spec]) return url;
  NSMutableCharacterSet *allowed = [NSCharacterSet.URLQueryAllowedCharacterSet mutableCopy];
  [allowed addCharactersInString:@"%#"];
  return [NSURL URLWithString:[spec stringByAddingPercentEncodingWithAllowedCharacters:allowed]];
}

// The initiator as Chrome shows it: scheme omitted for http(s), nil when opaque or absent.
NSString *DisplayOrigin(NSString *origin) {
  NSURLComponents *c = origin.length ? [NSURLComponents componentsWithString:origin] : nil;
  if (!c.scheme.length || !c.host.length) return nil;
  NSString *scheme = c.scheme.lowercaseString, *host = c.host.lowercaseString;
  if (c.port) host = [host stringByAppendingFormat:@":%@", c.port];
  return [scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"] ? host
                                                                              : [NSString stringWithFormat:@"%@://%@", scheme, host];
}

// Chrome remembers "always allow" only for potentially trustworthy origins.
bool MayRemember(NSString *origin) {
  NSURLComponents *c = [NSURLComponents componentsWithString:origin];
  NSString *scheme = c.scheme.lowercaseString, *host = c.host.lowercaseString;
  if (!host.length) return false;
  if ([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"wss"]) return true;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"ws"]) return false;
  return [host isEqualToString:@"localhost"] || [host hasSuffix:@".localhost"] || [host hasPrefix:@"127."] ||
         [host isEqualToString:@"[::1]"] || [host isEqualToString:@"::1"];
}

NSString *AppName(NSURL *app) {
  NSBundle *bundle = [NSBundle bundleWithURL:app];
  for (NSString *key in @[ @"CFBundleDisplayName", @"CFBundleName" ]) {
    NSString *name = bundle.localizedInfoDictionary[key] ?: bundle.infoDictionary[key];
    if ([name isKindOfClass:NSString.class] && name.length) return name;
  }
  return app.lastPathComponent.stringByDeletingPathExtension;
}

NSString *IconDataURI(NSURL *app, int pixels) {
  NSImage *icon = [NSWorkspace.sharedWorkspace iconForFile:app.path];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil
                                                                  pixelsWide:pixels
                                                                  pixelsHigh:pixels
                                                               bitsPerSample:8
                                                             samplesPerPixel:4
                                                                    hasAlpha:YES
                                                                    isPlanar:NO
                                                              colorSpaceName:NSDeviceRGBColorSpace
                                                                 bytesPerRow:0
                                                                bitsPerPixel:0];
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [icon drawInRect:NSMakeRect(0, 0, pixels, pixels) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];
  [NSGraphicsContext restoreGraphicsState];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return png ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : nil;
}

bool IsSelf(NSURL *app) {
  NSBundle *main = NSBundle.mainBundle;
  if ([app.URLByStandardizingPath isEqual:main.bundleURL.URLByStandardizingPath]) return true;
  NSString *theirs = [NSBundle bundleWithURL:app].bundleIdentifier;
  return theirs && [theirs isEqualToString:main.bundleIdentifier];
}

// MARK: - "Always allow", in Chrome's own per-profile preference: { origin: { scheme: true } }

constexpr char kAllowedPref[] = "protocol_handler.allowed_origin_protocol_pairs";

CefRefPtr<CefDictionaryValue> AllowedPairs(NSString *profile) {
  CefRefPtr<CefRequestContext> context = ContextForProfile(profile);
  CefRefPtr<CefValue> value = context ? context->GetPreference(kAllowedPref) : nullptr;
  return value && value->GetType() == VTYPE_DICTIONARY ? value->GetDictionary() : nullptr;
}

bool IsAllowed(NSString *profile, NSString *origin, NSString *scheme) {
  CefRefPtr<CefDictionaryValue> pairs = AllowedPairs(profile);
  CefRefPtr<CefDictionaryValue> schemes = pairs && pairs->HasKey(ToCef(origin)) ? pairs->GetDictionary(ToCef(origin)) : nullptr;
  return schemes && schemes->HasKey(ToCef(scheme)) && schemes->GetBool(ToCef(scheme));
}

void SetAllowed(NSString *profile, NSString *origin, NSString *scheme, bool allowed) {
  // Private windows never keep this.
  if (IsIncognito(profile)) return;
  CefRefPtr<CefRequestContext> context = ContextForProfile(profile);
  if (!context) return;
  CefRefPtr<CefDictionaryValue> current = AllowedPairs(profile);
  CefRefPtr<CefDictionaryValue> pairs = current ? current->Copy(false) : CefDictionaryValue::Create();
  CefRefPtr<CefDictionaryValue> schemes =
      pairs->HasKey(ToCef(origin)) ? pairs->GetDictionary(ToCef(origin))->Copy(false) : CefDictionaryValue::Create();
  if (allowed) schemes->SetBool(ToCef(scheme), true);
  else schemes->Remove(ToCef(scheme));
  if (schemes->GetSize()) pairs->SetDictionary(ToCef(origin), schemes);
  else pairs->Remove(ToCef(origin));
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetDictionary(pairs);
  CefString error;
  if (!context->SetPreference(kAllowedPref, value, error)) NSLog(@"[external] %@: %@", @(kAllowedPref), ToNS(error));
}

// MARK: - Opening

void Launch(CefRefPtr<Client> client, NSURL *url, NSURL *app, bool ownsTab) {
  if (activation::Background()) {
    Log([NSString stringWithFormat:@"open %@ in %@ (background mode: not launched)", url.absoluteString, AppName(app)]);
  } else {
    NSWorkspaceOpenConfiguration *config = [NSWorkspaceOpenConfiguration configuration];
    config.activates = YES;
    [NSWorkspace.sharedWorkspace openURLs:@[ url ]
                     withApplicationAtURL:app
                            configuration:config
                        completionHandler:^(NSRunningApplication *, NSError *error) {
                          if (error) NSLog(@"[external] opening %@: %@", url, error);
                        }];
  }
  // As in Chrome, a tab opened just for this link closes once the app has it.
  CefRefPtr<CefBrowser> browser = client ? client->Browser() : nullptr;
  if (ownsTab && browser && !client->CommittedPage() && !browser->CanGoBack()) client->Emit(@"windowClose", @{});
}

bool IsWebContentView(NSView *view) {
  for (; view; view = view.superview)
    if ([NSStringFromClass(view.class) hasPrefix:@"RenderWidgetHostView"]) return true;
  return false;
}

}

bool IsAppLink(const CefString &url) {
  const std::string spec = url.ToString();
  const size_t colon = spec.find(':');
  if (colon == std::string::npos || colon == 0) return false;
  std::string scheme = spec.substr(0, colon);
  for (char &c : scheme) c = (char)tolower((unsigned char)c);
  return !IsEngineScheme(scheme);
}

CefRefPtr<CefResourceRequestHandler> Canceller() {
  static CefRefPtr<CancelHandler> handler = new CancelHandler();
  return handler;
}

void NoteNavigation(int browserId, const std::string &frameId, NSString *url, bool userGesture) {
  gGestures[browserId] = {frameId, url.UTF8String ?: "", userGesture};
}

void NoteUserInput() { gAcceptRequests = true; }

void WatchUserInput() {
  static id monitor = nil;
  if (monitor) return;
  // Chrome lifts the flood block on any input to a page (ExternalProtocolObserver), not to its own UI.
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown |
                                                           NSEventMaskOtherMouseDown
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    NSView *content = event.window.contentView;
                                                    NSView *frame = content.superview ?: content;
                                                    NSPoint point = [frame convertPoint:event.locationInWindow fromView:nil];
                                                    if (IsWebContentView([content hitTest:point])) NoteUserInput();
                                                    return event;
                                                  }];
}

void Handle(CefRefPtr<Client> client, const Navigation &navigation) {
  CefRefPtr<CefBrowser> browser = client->Browser();
  if (!browser) return;
  const int browserId = browser->GetIdentifier();
  NSString *spec = navigation.url;
  NSURL *url = LinkURL(spec);
  NSString *scheme = url.scheme.lowercaseString;
  NSString *initiator = navigation.initiator ?: @"";
  auto log = [&](NSString *what) {
    Log([NSString stringWithFormat:@"%@ %@ from %@ (tab %d, %@)", what, spec, (initiator.length ? initiator : @"the app"),
                                   browserId, (navigation.ownsTab ? @"main frame" : @"subframe or opener")]);
  };

  if (!url || scheme.length < 2 || [DeniedSchemes() containsObject:scheme]) return log(@"blocked (scheme not allowed):");

  bool userGesture = navigation.userGesture > 0;
  if (navigation.userGesture < 0) {
    auto it = gGestures.find(browserId);
    userGesture = it != gGestures.end() && it->second.frameId == navigation.frameId && it->second.url == spec.UTF8String &&
                  it->second.userGesture;
  }
  // Typed transitions are browser-initiated (a new tab's first load reports an opaque initiator).
  const bool fromApp = navigation.typed || !initiator.length;
  NSString *origin = fromApp ? nil : DisplayOrigin(initiator);
  // Only the user's own address-bar navigations prompt without a page behind them.
  if (fromApp && !navigation.typed) return log(@"ignored (navigation by the app):");
  // Sandboxed frames and other opaque origins: Chrome gates these on sandbox flags we can't see, so
  // they need a user gesture here.
  if (!fromApp && !origin && !userGesture) return log(@"blocked (opaque origin without a user gesture):");
  if (userGesture || navigation.typed) gAcceptRequests = true;
  if (!gAcceptRequests) return log(@"blocked (repeated request without user input):");
  gAcceptRequests = false;
  for (const auto &[id, pending] : gPending)
    if (pending.browserId == browserId) return log(@"blocked (a prompt is already showing):");
  if (!client->View()) return log(@"ignored (no window to ask in):");

  NSURL *app = [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:url];
  if (app && IsSelf(app)) return log(@"blocked (Netnyahoo is the handler):");
  NSString *profile = client->Profile();
  const bool canRemember = app && origin && MayRemember(initiator) && !client->Incognito();
  NSString *storedOrigin = initiator.lowercaseString;
  if (canRemember && IsAllowed(profile, storedOrigin, scheme)) {
    log([NSString stringWithFormat:@"always allowed for %@:", storedOrigin]);
    return Launch(client, url, app, navigation.ownsTab);
  }

  NSString *requestId = [NSString stringWithFormat:@"x%llu", ++gSeq];
  NSString *name = app ? AppName(app) : nil;
  NSString *title = app ? [NSString stringWithFormat:@"Open “%@”?", name] : @"No application is set to open this link";
  NSString *message = app ? (origin     ? [NSString stringWithFormat:@"%@ wants to open this application.", origin]
                             : fromApp ? nil
                                       : @"This page wants to open this application.")
                          : [NSString stringWithFormat:@"Your Mac doesn’t have an app for “%@:” links.", scheme];
  NSString *remember =
      canRemember ? [NSString stringWithFormat:@"Always allow %@ to open links of this type in %@", origin, name] : nil;
  if (app) gPending[requestId.UTF8String] = {client, browserId, profile, storedOrigin, scheme, url, app, canRemember, navigation.ownsTab};
  NSString *checkbox = remember ? [NSString stringWithFormat:@" / [ ] %@", remember] : @"";
  log([NSString stringWithFormat:@"prompt %@ “%@” / “%@”%@:", requestId, title, message ?: @"", checkbox]);
  client->Emit(@"externalApp", @{
    @"id" : requestId,
    @"url" : spec,
    @"scheme" : scheme,
    @"origin" : origin ?: [NSNull null],
    @"app" : name ?: [NSNull null],
    @"appPath" : app.path ?: [NSNull null],
    @"icon" : (app ? IconDataURI(app, 64) : nil) ?: [NSNull null],
    @"title" : title,
    @"message" : message ?: [NSNull null],
    @"remember" : remember ?: [NSNull null],
  });
}

void Resolve(NSString *requestId, bool open, bool remember) {
  auto it = gPending.find(requestId.UTF8String ?: "");
  if (it == gPending.end()) return;
  Pending pending = it->second;
  gPending.erase(it);
  if (!open) return Log([NSString stringWithFormat:@"cancelled %@ %@", requestId, pending.url.absoluteString]);
  if (remember && pending.canRemember) {
    SetAllowed(pending.profile, pending.origin, pending.scheme, true);
    Log([NSString stringWithFormat:@"always allow %@ → %@: (profile %@)", pending.origin, pending.scheme, pending.profile]);
  }
  Launch(pending.client, pending.url, pending.app, pending.ownsTab);
}

void BrowserClosed(int browserId) {
  gGestures.erase(browserId);
  std::erase_if(gPending, [&](const auto &entry) { return entry.second.browserId == browserId; });
}

void ShowSheet(NSWindow *window, NSDictionary *request) {
  NSString *requestId = request[@"id"];
  auto text = [&](NSString *key) -> NSString * {
    id value = request[key];
    return [value isKindOfClass:NSString.class] ? value : nil;
  };
  if (activation::Background() || !window) {
    Log([NSString stringWithFormat:@"sheet not shown (background mode) %@ “%@”", requestId, text(@"title")]);
    return;
  }
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = text(@"title") ?: @"";
  alert.informativeText = text(@"message") ?: @"";
  if (NSString *path = text(@"appPath")) {
    alert.icon = [NSWorkspace.sharedWorkspace iconForFile:path];
    [alert addButtonWithTitle:@"Open"];
    [alert addButtonWithTitle:@"Cancel"];
  } else {
    [alert addButtonWithTitle:@"OK"];
  }
  if (NSString *remember = text(@"remember")) {
    alert.showsSuppressionButton = YES;
    alert.suppressionButton.title = remember;
    alert.suppressionButton.state = NSControlStateValueOff;
  }
  [alert beginSheetModalForWindow:window
                completionHandler:^(NSModalResponse response) {
                  Resolve(requestId, response == NSAlertFirstButtonReturn,
                          alert.suppressionButton.state == NSControlStateValueOn);
                }];
}

}

@implementation NNExternalApps

+ (void)resolve:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  external::Resolve(requestId, open, remember);
}

+ (NSArray<NSDictionary<NSString *, id> *> *)allowedForProfile:(NSString *)profile {
  NSMutableArray *out = [NSMutableArray array];
  CefRefPtr<CefDictionaryValue> pairs = external::AllowedPairs(profile);
  CefDictionaryValue::KeyList origins;
  if (pairs) pairs->GetKeys(origins);
  for (const CefString &origin : origins) {
    CefRefPtr<CefDictionaryValue> schemes = pairs->GetDictionary(origin);
    CefDictionaryValue::KeyList keys;
    if (schemes) schemes->GetKeys(keys);
    for (const CefString &scheme : keys) {
      if (!schemes->GetBool(scheme)) continue;
      NSURL *probe = [NSURL URLWithString:[ToNS(scheme) stringByAppendingString:@":"]];
      NSURL *app = probe ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:probe] : nil;
      [out addObject:@{
        @"origin" : ToNS(origin),
        @"scheme" : ToNS(scheme),
        @"app" : (app ? external::AppName(app) : (id)[NSNull null]),
        @"icon" : (app ? external::IconDataURI(app, 64) : nil) ?: [NSNull null],
      }];
    }
  }
  [out sortUsingDescriptors:@[
    [NSSortDescriptor sortDescriptorWithKey:@"origin" ascending:YES], [NSSortDescriptor sortDescriptorWithKey:@"scheme" ascending:YES]
  ]];
  return out;
}

+ (void)removeAllowedForProfile:(NSString *)profile origin:(NSString *)origin scheme:(NSString *)scheme {
  external::SetAllowed(profile, origin, scheme, false);
}

@end
