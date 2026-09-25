#import "NNChromeUI.h"

#import "NNChromeSurfaces.h"
#import "NNClient.h"
#import "NNSiteSettings.h"

#include <map>

#if NN_TAB_CAPTURE
#include "include/cef_media_capture.h"
#endif

using namespace nn;

namespace nn::chromeui {

NSDictionary *PasswordPrompt(CefRefPtr<CefBrowser> browser) {
#if NN_PASSWORD_PROMPT
  CefRefPtr<CefDictionaryValue> prompt = browser->GetHost()->GetPasswordPrompt();
  if (!prompt) return nil;
  // password_manager::ui::State. Other states (auto sign-in, generated-password and
  // Keychain notices…) keep Chrome's bubble.
  NSString *state = nil;
  switch (prompt->GetInt("state")) {
    case 1: state = @"save"; break;     // PENDING_PASSWORD_STATE
    case 7: state = @"update"; break;   // PENDING_PASSWORD_UPDATE_STATE
    case 2:                             // SAVE_CONFIRMATION_STATE
    case 3: state = @"saved"; break;    // UPDATE_CONFIRMATION_STATE
    default: return nil;
  }
  NSMutableArray *usernames = [NSMutableArray array];
  if (CefRefPtr<CefListValue> list = prompt->GetList("usernames"))
    for (size_t i = 0; i < list->GetSize(); i++) [usernames addObject:ToNS(list->GetString(i))];
  return @{
    @"state" : state,
    @"origin" : ToNS(prompt->GetString("origin")),
    @"username" : ToNS(prompt->GetString("username")),
    @"passwordLength" : @(prompt->GetInt("passwordLength")),
    @"federation" : ToNS(prompt->GetString("federation")),
    @"usernames" : usernames,
  };
#else
  return nil;
#endif
}

bool ShowPasswordPrompt(Client *client, CefRefPtr<CefBrowser> browser) {
  NSDictionary *prompt = client->View() ? PasswordPrompt(browser) : nil;
  if (!prompt) return false;
  client->Emit(@"passwordPrompt", prompt);
  return true;
}

void ResolvePasswordPrompt(CefRefPtr<CefBrowser> browser, NSString *action, NSString *username, NSString *password) {
#if NN_PASSWORD_PROMPT
  browser->GetHost()->ResolvePasswordPrompt(ToCef(action), ToCef(username ?: @""), ToCef(password ?: @""));
#endif
}

NSString *ExecuteExtensionAction(CefRefPtr<CefBrowser> browser, NSString *extensionId) {
#if NN_EXTENSION_ACTION
  switch (browser->GetHost()->ExecuteExtensionAction(ToCef(extensionId))) {
    case 0: return @"none";
    case 1: return @"popup";
    case 2: return @"sidePanel";
    default: return nil;
  }
#else
  return nil;
#endif
}

}  // namespace nn::chromeui

// MARK: - Chrome surfaces the app draws (NNChromeSurfaces)

namespace {

NNEventHandler gSurfaceHandler = nil;

void EmitSurface(NSString *name, NSDictionary *payload) {
  if (gSurfaceHandler) gSurfaceHandler(name, payload);
}

#if NN_CHROME_UI

id FromValue(CefRefPtr<CefValue> value);

NSDictionary *FromDictionary(CefRefPtr<CefDictionaryValue> dict) {
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  if (!dict) return out;
  CefDictionaryValue::KeyList keys;
  dict->GetKeys(keys);
  for (const auto &key : keys) out[ToNS(key)] = FromValue(dict->GetValue(key)) ?: [NSNull null];
  return out;
}

id FromValue(CefRefPtr<CefValue> value) {
  switch (value ? value->GetType() : VTYPE_NULL) {
    case VTYPE_BOOL: return @(value->GetBool());
    case VTYPE_INT: return @(value->GetInt());
    case VTYPE_DOUBLE: return @(value->GetDouble());
    case VTYPE_STRING: return ToNS(value->GetString());
    case VTYPE_DICTIONARY: return FromDictionary(value->GetDictionary());
    case VTYPE_LIST: {
      CefRefPtr<CefListValue> list = value->GetList();
      NSMutableArray *out = [NSMutableArray array];
      for (size_t i = 0; i < list->GetSize(); i++) [out addObject:FromValue(list->GetValue(i)) ?: [NSNull null]];
      return out;
    }
    default: return nil;
  }
}

/// "#rrggbb" for an ARGB color, nil when unset (transparent).
id HexColor(int argb) {
  uint32_t c = (uint32_t)argb;
  if (!(c >> 24)) return [NSNull null];
  return [NSString stringWithFormat:@"#%02x%02x%02x", (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

std::map<int, CefRefPtr<CefDeviceChooser>> gChoosers;
std::map<int, CefRefPtr<CefCastDialog>> gCastDialogs;
std::map<int, int> gChooserBrowsers, gCastBrowsers;  // chooser / dialog id → browser id

NSDictionary *ChooserPayload(CefRefPtr<CefDeviceChooser> chooser, int browserId) {
  NSMutableDictionary *payload = [FromDictionary(chooser->GetState()) mutableCopy];
  payload[@"id"] = @(chooser->GetIdentifier());
  payload[@"browserId"] = @(browserId);
  payload[@"open"] = @(chooser->IsOpen());
  return payload;
}

NSDictionary *CastPayload(CefRefPtr<CefCastDialog> dialog, int browserId) {
  NSMutableDictionary *payload = [FromDictionary(dialog->GetState()) mutableCopy];
  payload[@"id"] = @(dialog->GetIdentifier());
  payload[@"browserId"] = @(browserId);
  payload[@"open"] = @(dialog->IsOpen());
  return payload;
}

/// Chrome's device choosers, Cast dialog and extension side panels come to the app.
class SurfaceHandler : public CefChromeUIHandler {
 public:
  bool OnDeviceChooser(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDeviceChooser> chooser) override {
    if (!gSurfaceHandler) return false;
    int browserId = browser->GetIdentifier();
    gChoosers[chooser->GetIdentifier()] = chooser;
    gChooserBrowsers[chooser->GetIdentifier()] = browserId;
    EmitSurface(@"deviceChooser", ChooserPayload(chooser, browserId));
    return true;
  }

  void OnDeviceChooserChanged(CefRefPtr<CefDeviceChooser> chooser) override {
    int id = chooser->GetIdentifier();
    EmitSurface(@"deviceChooser", ChooserPayload(chooser, gChooserBrowsers[id]));
    if (!chooser->IsOpen()) {
      gChoosers.erase(id);
      gChooserBrowsers.erase(id);
    }
  }

  bool OnCastDialog(CefRefPtr<CefBrowser> browser, CefRefPtr<CefCastDialog> dialog) override {
    if (!gSurfaceHandler) return false;
    int browserId = browser->GetIdentifier();
    gCastDialogs[dialog->GetIdentifier()] = dialog;
    gCastBrowsers[dialog->GetIdentifier()] = browserId;
    EmitSurface(@"castDialog", CastPayload(dialog, browserId));
    return true;
  }

  void OnCastDialogChanged(CefRefPtr<CefCastDialog> dialog) override {
    int id = dialog->GetIdentifier();
    EmitSurface(@"castDialog", CastPayload(dialog, gCastBrowsers[id]));
    if (!dialog->IsOpen()) {
      gCastDialogs.erase(id);
      gCastBrowsers.erase(id);
    }
  }

  bool OnExtensionSidePanel(CefRefPtr<CefBrowser> browser, const CefString &extension_id, bool open) override {
    if (!gSurfaceHandler) return false;
    EmitSurface(@"sidePanel", @{@"browserId" : @(browser->GetIdentifier()), @"extensionId" : ToNS(extension_id), @"open" : @(open)});
    return true;
  }

  IMPLEMENT_REFCOUNTING(SurfaceHandler);
};

/// The profile's local Cast routes ("castRoutes").
class RouteObserver : public CefMediaObserver {
 public:
  explicit RouteObserver(NSString *profile) : profile_([profile copy]) {}

  void OnSinks(const std::vector<CefRefPtr<CefMediaSink>> &) override {}
  void OnRoutes(const std::vector<CefRefPtr<CefMediaRoute>> &routes) override {
    NSMutableArray *list = [NSMutableArray array];
    for (auto &route : routes) {
      if (!route->IsLocal()) continue;
      NSString *routeId = ToNS(route->GetId());
      Routes()[routeId.UTF8String] = route;
      CefRefPtr<CefMediaSink> sink = route->GetSink();
      CefRefPtr<CefMediaSource> source = route->GetSource();
      [list addObject:@{
        @"id" : routeId,
        @"sink" : sink ? ToNS(sink->GetName()) : @"",
        @"description" : ToNS(route->GetDescription()),
        @"source" : source ? ToNS(source->GetId()) : @"",
      }];
    }
    EmitSurface(@"castRoutes", @{@"profile" : profile_, @"routes" : list});
  }
  void OnRouteStateChanged(CefRefPtr<CefMediaRoute>, ConnectionState) override {}
  void OnRouteMessageReceived(CefRefPtr<CefMediaRoute>, const void *, size_t) override {}

  static std::map<std::string, CefRefPtr<CefMediaRoute>> &Routes() {
    static std::map<std::string, CefRefPtr<CefMediaRoute>> routes;
    return routes;
  }

 private:
  NSString *profile_;
  IMPLEMENT_REFCOUNTING(RouteObserver);
};

std::map<std::string, CefRefPtr<CefRegistration>> gRouteWatches;  // by profile

/// A chooser the app answered: it hides it (Chrome reports only its own closes).
void ChooserAnswered(int chooserId) {
  auto it = gChoosers.find(chooserId);
  if (it == gChoosers.end() || it->second->IsOpen()) return;
  EmitSurface(@"deviceChooser", ChooserPayload(it->second, gChooserBrowsers[chooserId]));
  gChoosers.erase(chooserId);
  gChooserBrowsers.erase(chooserId);
}

/// The module can load before the engine: take over once it runs.
void InstallSurfaceHandler() {
  if (!gSurfaceHandler) return;
  if (!NNCef.isStarted) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ InstallSurfaceHandler(); });
    return;
  }
  CefSetChromeUIHandler(new SurfaceHandler());
  // A reloaded app gets what's still waiting for an answer.
  for (auto &[id, chooser] : gChoosers)
    if (chooser->IsOpen()) EmitSurface(@"deviceChooser", ChooserPayload(chooser, gChooserBrowsers[id]));
  for (auto &[id, dialog] : gCastDialogs)
    if (dialog->IsOpen()) EmitSurface(@"castDialog", CastPayload(dialog, gCastBrowsers[id]));
}

CefRefPtr<CefBrowser> BrowserById(NSInteger browserId) {
  return browserId > 0 ? CefBrowserHost::GetBrowserByIdentifier((int)browserId) : nullptr;
}

#endif

}  // namespace

@implementation NNChromeSurfaces

+ (BOOL)available {
  return NN_CHROME_UI;
}

+ (NNEventHandler)eventHandler {
  return gSurfaceHandler;
}

+ (void)setEventHandler:(NNEventHandler)eventHandler {
  gSurfaceHandler = [eventHandler copy];
#if NN_CHROME_UI
  if (eventHandler) InstallSurfaceHandler();
  else if (NNCef.isStarted) CefSetChromeUIHandler(nullptr);
#endif
}

+ (void)selectDevice:(NSInteger)chooserId index:(NSInteger)index {
#if NN_CHROME_UI
  auto it = gChoosers.find((int)chooserId);
  if (it == gChoosers.end()) return;
  it->second->Select((int)index);
  ChooserAnswered((int)chooserId);
#endif
}

+ (void)cancelDeviceChooser:(NSInteger)chooserId {
#if NN_CHROME_UI
  auto it = gChoosers.find((int)chooserId);
  if (it == gChoosers.end()) return;
  it->second->Cancel();
  ChooserAnswered((int)chooserId);
#endif
}

+ (void)refreshDeviceChooser:(NSInteger)chooserId {
#if NN_CHROME_UI
  auto it = gChoosers.find((int)chooserId);
  if (it != gChoosers.end()) it->second->Refresh();
#endif
}

+ (void)openBluetoothSettings:(NSInteger)chooserId {
#if NN_CHROME_UI
  auto it = gChoosers.find((int)chooserId);
  if (it != gChoosers.end()) it->second->OpenPermissionSettings();
#endif
}

+ (BOOL)showCastDialog:(NSInteger)browserId {
#if NN_CHROME_UI
  CefRefPtr<CefBrowser> browser = BrowserById(browserId);
  return browser && CefShowCastDialog(browser);
#else
  return NO;
#endif
}

+ (void)startCasting:(NSInteger)dialogId sink:(NSString *)sinkId mode:(NSInteger)mode {
#if NN_CHROME_UI
  auto it = gCastDialogs.find((int)dialogId);
  if (it != gCastDialogs.end()) it->second->StartCasting(ToCef(sinkId), (int)mode);
#endif
}

+ (void)stopCasting:(NSInteger)dialogId route:(NSString *)routeId {
#if NN_CHROME_UI
  auto it = gCastDialogs.find((int)dialogId);
  if (it != gCastDialogs.end()) it->second->StopCasting(ToCef(routeId));
  else [self terminateCastRoute:routeId];
#endif
}

+ (void)closeCastDialog:(NSInteger)dialogId {
#if NN_CHROME_UI
  auto it = gCastDialogs.find((int)dialogId);
  if (it != gCastDialogs.end()) {
    CefRefPtr<CefCastDialog> dialog = it->second;
    dialog->Close();
  }
#endif
}

+ (void)watchCastRoutes:(NSString *)profile {
#if NN_CHROME_UI
  std::string key = profile.UTF8String ?: "";
  CefRefPtr<CefRequestContext> context = ContextForProfile(profile);
  CefRefPtr<CefMediaRouter> router = context ? context->GetMediaRouter(nullptr) : nullptr;
  if (!router) return;
  // Already watching: the current list comes again.
  if (!gRouteWatches.count(key)) gRouteWatches[key] = router->AddObserver(new RouteObserver(profile));
  router->NotifyCurrentRoutes();
#endif
}

+ (void)terminateCastRoute:(NSString *)routeId {
#if NN_CHROME_UI
  auto &routes = RouteObserver::Routes();
  auto it = routes.find(routeId.UTF8String ?: "");
  if (it != routes.end()) it->second->Terminate();
#endif
}

+ (NSDictionary *)actionStatesForBrowser:(NSInteger)browserId extensions:(NSArray<NSString *> *)extensionIds {
  NSMutableDictionary *states = [NSMutableDictionary dictionary];
#if NN_CHROME_UI
  CefRefPtr<CefBrowser> browser = BrowserById(browserId);
  if (!browser) return states;
  for (NSString *extensionId in extensionIds) {
    CefRefPtr<CefDictionaryValue> state = CefGetExtensionActionState(browser, ToCef(extensionId));
    if (!state) continue;
    states[extensionId] = @{
      @"title" : ToNS(state->GetString("title")),
      // Placeholders like <<declarativeNetRequestActionCount>> are for Chrome to fill.
      @"badgeText" : [ToNS(state->GetString("badgeText")) hasPrefix:@"<<"] ? @"" : ToNS(state->GetString("badgeText")),
      @"badgeColor" : HexColor(state->GetInt("badgeColor")),
      @"badgeTextColor" : HexColor(state->GetInt("badgeTextColor")),
      @"popup" : ToNS(state->GetString("popup")),
      @"enabled" : @(state->GetBool("enabled")),
      @"icon" : ToNS(state->GetString("icon")),
    };
  }
#endif
  return states;
}

+ (NSString *)sidePanelURLForBrowser:(NSInteger)browserId extension:(NSString *)extensionId {
#if NN_CHROME_UI
  CefRefPtr<CefBrowser> browser = BrowserById(browserId);
  NSString *url = browser ? ToNS(CefGetExtensionSidePanel(browser, ToCef(extensionId))) : nil;
  return url.length ? url : nil;
#else
  return nil;
#endif
}

+ (BOOL)changeCaptureSource:(NSInteger)capturerId toTab:(NSInteger)targetId {
#if NN_CHROME_UI && NN_TAB_CAPTURE
  CefRefPtr<CefBrowser> capturer = BrowserById(capturerId), target = BrowserById(targetId);
  CefString source = target ? CefGetMediaCaptureSourceId(target) : CefString();
  if (!capturer || source.empty()) return NO;
  // Chrome asks for the new source's permission again: the user just picked it.
  site::AllowDesktopCapture((int)capturerId);
  return CefChangeMediaCaptureSource(capturer, source);
#else
  return NO;
#endif
}

+ (BOOL)stopCapture:(NSInteger)capturerId {
#if NN_CHROME_UI && defined(CEF_NN_CAPTURE_STOP)
  CefRefPtr<CefBrowser> capturer = BrowserById(capturerId);
  return capturer && CefStopMediaCapture(capturer);
#else
  return NO;
#endif
}

+ (NSInteger)captureTargetOf:(NSInteger)capturerId among:(NSArray<NSNumber *> *)browserIds {
#if NN_CHROME_UI && NN_TAB_CAPTURE
  CefRefPtr<CefBrowser> capturer = BrowserById(capturerId);
  NSString *target = capturer ? ToNS(CefGetMediaCaptureTarget(capturer)) : @"";
  if (!target.length) return 0;
  for (NSNumber *browserId in browserIds) {
    CefRefPtr<CefBrowser> browser = BrowserById(browserId.integerValue);
    if (browser && [ToNS(CefGetMediaCaptureSourceId(browser)) isEqualToString:target]) return browserId.integerValue;
  }
#endif
  return 0;
}

@end
