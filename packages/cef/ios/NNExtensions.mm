#import "NNExtensions.h"

#import "NNChromePages.h"
#import "NNClient.h"
#import "NNContentBlocker.h"
#import "NNExtensionPackage.h"
#import "NNExtensionsInternal.h"
#import "NNWindowHost.h"

#include <algorithm>
#include <map>
#include <vector>

using namespace nn;
using pages::DataProfile;
using pages::Script;

namespace {

NSString *const kExtensionsPage = @"chrome://extensions/";

NNEventHandler gHandler = nil;
void Emit(NSString *name, NSDictionary *payload) {
  if (gHandler) gHandler(name, payload);
}

void Changed(NSString *profile, NSString *extensionId, NSString *event) {
  host::InvalidateExtensionCommands(profile);
  Emit(@"changed", @{@"profile" : DataProfile(profile), @"id" : extensionId, @"event" : event});
}

/// Where we unpack store extensions for a profile (not inside Chrome's own profile dir).
NSString *ManagedRoot(NSString *profile) {
  NSString *key = DataProfile(profile);
  return [[DataRoot() stringByAppendingPathComponent:@"Netnyahoo Extensions"] stringByAppendingPathComponent:key.length ? key : @"Default"];
}

/// Downloads waiting for the user's confirmation.
NSString *StagingRoot() {
  return [[DataRoot() stringByAppendingPathComponent:@"Netnyahoo Extensions"] stringByAppendingPathComponent:@".staging"];
}

void HostEval(NSString *profile, NSString *expression, pages::EvalCompletion completion) {
  pages::WebUIEval(profile, kExtensionsPage, expression, completion);
}

void Respond(NNExtensionsCompletion completion, id value, NSString *error) {
  if (error) return completion(@{@"error" : error});
  completion([value isKindOfClass:NSDictionary.class] ? value : @{@"ok" : @YES});
}

// MARK: - Extension tab ids
//
// Extension APIs identify tabs by Chrome's session id, not the CefBrowser id,
// and nothing exposes one from the other. From any extension context,
// chrome.tabs.get(id) finds our tabs, and session ids are handed out in
// sequence: scan a range around the context's own tab (tabs.getCurrent) and
// pair what's found with our browsers by URL (in creation order for repeats).

NSDictionary *gProbes = @{};                   // profile → an enabled extension's id
std::map<int, int> gTabIdOfBrowser;            // browser id → extension tab id
std::map<int, int> gBrowserOfTabId;
int gHighestTabId = 0;
std::map<std::string, std::vector<void (^)(void)>> gResolveWaiters;  // by profile, while scanning
std::map<std::string, CFTimeInterval> gLastValidated;

int TabIdOf(int browserId) {
  // Chrome tabs know their own id; Alloy tabs were looked up through a probe extension.
  if (host::ChromeTabs())
    for (NNBrowserView *view in LiveViews())
      if (view.browserId == browserId && view.chromeTabId) return view.chromeTabId;
  auto it = gTabIdOfBrowser.find(browserId);
  return it == gTabIdOfBrowser.end() ? 0 : it->second;
}
int BrowserOfTabId(int tabId) {
  auto it = gBrowserOfTabId.find(tabId);
  return it == gBrowserOfTabId.end() ? 0 : it->second;
}

bool InProfile(NNBrowserView *view, NSString *profile) {
  return !IsIncognito(view.profile) && [DataProfile(view.profile) isEqualToString:profile];
}

void ResolveTabIds(NSString *profile, void (^done)(void)) {
  profile = DataProfile(profile);
  NSString *probe = [gProbes[profile] isKindOfClass:NSString.class] ? gProbes[profile] : nil;
  std::vector<NNBrowserView *> unmapped;
  NSMutableArray<NSNumber *> *known = [NSMutableArray array];
  for (NNBrowserView *view in LiveViews()) {
    if (!InProfile(view, profile)) continue;
    if (int tabId = TabIdOf(view.browserId)) [known addObject:@(tabId)];
    else unmapped.push_back(view);
  }
  // Mapped ids are re-checked every few seconds (a tab's page can move to a new
  // web contents); otherwise only new browsers need work.
  CFTimeInterval now = CACurrentMediaTime();
  bool validate = now - gLastValidated[profile.UTF8String] > 3;
  if (!probe.length || (unmapped.empty() && !validate)) return done();
  auto &waiters = gResolveWaiters[profile.UTF8String];
  waiters.push_back([done copy]);
  if (waiters.size() > 1) return;
  gLastValidated[profile.UTF8String] = now;
  NSNumber *lowest = [known valueForKeyPath:@"@min.self"];
  NSString *js = Script(@"(async () => {"
                         "  const known = %@, lowest = %@, highest = %@;"
                         "  const exists = (id) => chrome.tabs.get(id).then((t) => t, () => null);"
                         "  const gone = (await Promise.all(known.map(async (id) => ((await exists(id)) ? null : id)))).filter(Boolean);"
                         "  const self = await chrome.tabs.getCurrent().catch(() => null);"
                         "  const anchor = self ? self.id : 0;"
                         "  const lo = lowest ? lowest - 200 : Math.max(1, anchor - 3000), hi = Math.max(anchor, highest) + 500;"
                         "  const found = [];"
                         "  for (let start = lo; start <= hi; start += 500) {"
                         "    const ids = [];"
                         "    for (let id = start; id < Math.min(start + 500, hi + 1); id++) ids.push(id);"
                         "    const batch = await Promise.all(ids.map((id) => exists(id).then("
                         "      (t) => t && { id: t.id, url: t.url || '', pending: t.pendingUrl || '' })));"
                         "    for (const t of batch) if (t) found.push(t);"
                         "  }"
                         "  return { anchor, found, gone };"
                         "})()",
                         @[ known, lowest ?: @0, @(gHighestTabId) ]);
  pages::ExtensionEval(profile, probe, js, ^(id value, NSString *) {
    NSDictionary *result = [value isKindOfClass:NSDictionary.class] ? value : @{};
    for (NSNumber *tabId in result[@"gone"]) {
      int browserId = BrowserOfTabId(tabId.intValue);
      gBrowserOfTabId.erase(tabId.intValue);
      gTabIdOfBrowser.erase(browserId);
    }
    NSMutableArray<NSDictionary *> *found = [NSMutableArray array];
    for (NSDictionary *t in result[@"found"]) {
      int tabId = [t[@"id"] intValue];
      gHighestTabId = MAX(gHighestTabId, tabId);
      if (!BrowserOfTabId(tabId)) [found addObject:t];
    }
    gHighestTabId = MAX(gHighestTabId, [result[@"anchor"] intValue]);
    // Pair by URL. Both kinds of id grow with creation, so repeats of a URL pair
    // newest with newest (an older contents with the same page may be closing).
    std::vector<NNBrowserView *> views;
    for (NNBrowserView *view in LiveViews())
      if (InProfile(view, profile) && !TabIdOf(view.browserId)) views.push_back(view);
    std::sort(views.begin(), views.end(), [](NNBrowserView *a, NNBrowserView *b) { return a.browserId > b.browserId; });
    [found sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) { return [b[@"id"] compare:a[@"id"]]; }];
    for (NNBrowserView *view : views) {
      NSString *url = view.client ? view.client->URL() : @"";
      if (!url.length) continue;  // not committed yet: next round
      for (NSDictionary *t in found) {
        if (![t[@"url"] isEqualToString:url] && ![t[@"pending"] isEqualToString:url]) continue;
        int tabId = [t[@"id"] intValue];
        gTabIdOfBrowser[view.browserId] = tabId;
        gBrowserOfTabId[tabId] = view.browserId;
        [found removeObject:t];
        break;
      }
    }
    auto waiting = std::move(gResolveWaiters[profile.UTF8String]);
    gResolveWaiters.erase(profile.UTF8String);
    for (auto &block : waiting) block();
  });
}

}  // namespace

namespace nn::ext {

void EmitOpenTab(NSString *url, NSString *profile) {
  Emit(@"tabs", @{@"action" : @"open", @"url" : url ?: @"", @"profile" : profile ?: @"", @"active" : @YES, @"window" : [NSNull null],
                  @"extensionId" : @""});
}

#if NN_INSTALL_PROMPT
namespace {
std::map<std::string, CefRefPtr<CefExtensionPromptCallback>> gInstallPrompts;  // request id → Chrome's callback
int gInstallPromptSeq = 0;
}  // namespace

bool OnInstallPrompt(NSString *profile, CefRefPtr<CefBrowser> browser, const CefString &extensionId,
                     CefRefPtr<CefDictionaryValue> details, CefRefPtr<CefExtensionPromptCallback> callback) {
  if (!gHandler || !details) return false;
  NSMutableArray *permissions = [NSMutableArray array];
  if (CefRefPtr<CefListValue> list = details->GetList("permissions"))
    for (size_t i = 0; i < list->GetSize(); i++) [permissions addObject:ToNS(list->GetString(i))];
  NSString *requestId = [NSString stringWithFormat:@"install%d", ++gInstallPromptSeq];
  NSDictionary *payload = @{
    @"requestId" : requestId,
    @"profile" : DataProfile(profile ?: @""),
    @"id" : ToNS(extensionId),
    @"name" : ToNS(details->GetString("name")),
    @"version" : ToNS(details->GetString("version")),
    @"type" : ToNS(details->GetString("type")),
    @"icon" : ToNS(details->GetString("icon")),
    @"permissions" : permissions,
    @"browserId" : @(browser ? browser->GetIdentifier() : 0),
  };
  gInstallPrompts[requestId.UTF8String] = callback;
  dispatch_async(dispatch_get_main_queue(), ^{ Emit(@"installPrompt", payload); });
  return true;
}
#endif

CefRefPtr<CefRequestContextHandler> ContextHandler(NSString *profile) {
  class Handler : public CefRequestContextHandler {
   public:
    explicit Handler(NSString *profile) : profile_([profile copy]) {}
#if NN_INSTALL_PROMPT
    bool OnExtensionInstallPrompt(CefRefPtr<CefBrowser> browser, const CefString &extension_id,
                                  CefRefPtr<CefDictionaryValue> details,
                                  CefRefPtr<CefExtensionPromptCallback> callback) override {
      return OnInstallPrompt(profile_, browser, extension_id, details, callback);
    }
#endif

   private:
    NSString *profile_;
    IMPLEMENT_REFCOUNTING(Handler);
  };
  return new Handler(profile ?: @"");
}

}  // namespace nn::ext

// MARK: - Public API

@implementation NNExtensions

+ (NNEventHandler)eventHandler {
  return gHandler;
}

+ (void)setEventHandler:(NNEventHandler)eventHandler {
  gHandler = [eventHandler copy];
}

+ (BOOL)supportsInstallPrompt {
  return NN_INSTALL_PROMPT;
}

+ (void)resolveInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
#if NN_INSTALL_PROMPT
  auto &prompts = nn::ext::gInstallPrompts;
  auto it = prompts.find(requestId.UTF8String ?: "");
  if (it == prompts.end()) return;
  CefRefPtr<CefExtensionPromptCallback> callback = it->second;
  prompts.erase(it);
  callback->Continue(accepted);
#endif
}

+ (void)evaluateInHost:(NSString *)expression profile:(NSString *)profile page:(NSString *)page completion:(void (^)(id))completion {
  pages::WebUIEval(profile, page ?: kExtensionsPage, expression, ^(id value, NSString *error) {
    completion(error ? @{@"error" : error} : value);
  });
}

+ (void)listForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  NSString *js = @"(async () => {"
                  "  const infos = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true });"
                  "  return { extensions: infos.filter((i) => i.type === 'EXTENSION').map((i) => {"
                  "    const hosts = i.permissions.runtimeHostPermissions;"
                  "    return {"
                  "      id: i.id, name: i.name, version: i.version, description: i.description,"
                  "      enabled: i.state === 'ENABLED', state: i.state, icon: i.iconUrl,"
                  "      permissions: i.permissions.simplePermissions.map((p) => p.message),"
                  "      siteAccess: hosts ? hosts.hostAccess : null,"
                  "      sites: hosts ? hosts.hosts.filter((h) => h.granted).map((h) => h.host) : [],"
                  "      optionsUrl: i.optionsPage ? i.optionsPage.url : null,"
                  "      location: i.location, path: i.path || null,"
                  "      homepageUrl: (i.homePage && i.homePage.url) || null,"
                  "      incognito: i.incognitoAccess.isActive, fileAccess: i.fileAccess.isActive,"
                  "      pinned: !!i.pinnedToToolbar, mayModify: i.userMayModify,"
                  "      errors: [...i.manifestErrors, ...i.runtimeErrors].map((e) => e.message),"
                  "    };"
                  "  }) };"
                  "})()";
  HostEval(profile, js, ^(id value, NSString *error) {
    if (error) return completion(@{@"error" : error});
    NSString *managed = ManagedRoot(@"").stringByDeletingLastPathComponent;
    NSMutableArray *list = [NSMutableArray array];
    for (NSDictionary *info in value[@"extensions"]) {
      // The content blocker is built in, not one of the user's extensions.
      if ([info[@"id"] isEqual:blocker::ExtensionId()]) continue;
      NSMutableDictionary *item = [info mutableCopy];
      NSString *path = [info[@"path"] isKindOfClass:NSString.class] ? info[@"path"] : nil;
      NSDictionary *manifest = path ? ext::ReadManifest(path) : nil;
      for (NSString *key in @[ @"popup", @"actionTitle", @"actionIcon", @"sidePanel", @"hasAction" ])
        if (manifest[key]) item[key] = manifest[key];
      // Chrome's own store installs (they auto-update), or our earlier download-and-load ones.
      BOOL fromStore = [info[@"location"] isEqual:@"FROM_STORE"] || (path && [path hasPrefix:managed]);
      item[@"fromWebStore"] = @(fromStore);
      item[@"webStoreUrl"] = fromStore ? [@"https://chromewebstore.google.com/detail/" stringByAppendingString:info[@"id"]] : [NSNull null];
      [list addObject:item];
    }
    completion(@{@"extensions" : list});
  });
}

+ (void)prepareWebStoreExtension:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  NSString *version = NNCef.engineInfo[@"chromiumVersion"];
  ext::DownloadFromWebStore(extensionId, version, StagingRoot(), ^(NSString *folder, NSString *error) {
    if (error) return completion(@{@"error" : error});
    NSMutableDictionary *info = [ext::ReadManifest(folder) mutableCopy];
    info[@"path"] = folder;
    info[@"id"] = extensionId;
    completion(info);
  });
}

+ (NSDictionary *)inspectUnpacked:(NSString *)path {
  NSMutableDictionary *info = [ext::ReadManifest(path) mutableCopy];
  if (!info[@"error"]) info[@"path"] = path;
  return info;
}

+ (void)installPath:(NSString *)path profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *folder = path;
  // A prepared store download moves into the profile's own folder first.
  if ([path hasPrefix:StagingRoot()]) {
    NSDictionary *manifest = ext::ReadManifest(path);
    NSString *extensionId = manifest[@"id"];
    if (!extensionId) return completion(@{@"error" : manifest[@"error"] ?: @"Invalid extension"});
    NSString *dir = [ManagedRoot(profile) stringByAppendingPathComponent:extensionId];
    folder = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@_%@", manifest[@"version"],
                                                                            [NSUUID.UUID.UUIDString substringToIndex:8]]];
    [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSError *moveError = nil;
    if (![fm moveItemAtPath:path toPath:folder error:&moveError])
      return completion(@{@"error" : moveError.localizedDescription ?: @"Couldn't install the extension"});
  }
  NSString *managed = [folder hasPrefix:ManagedRoot(profile)] ? folder : nil;

  // developerPrivate.loadUnpacked asks for the folder with a file dialog, which
  // the host answers with `folder`. (Developer mode is how Chrome allows it.)
  pages::SetWebUIDialogPath(profile, kExtensionsPage, folder);
  NSString *js = Script(@"(async () => {"
                         "  const dp = chrome.developerPrivate;"
                         "  await dp.updateProfileConfiguration({ inDeveloperMode: true });"
                         "  const error = await dp.loadUnpacked({ failQuietly: true });"
                         "  if (error) return { error: error.error || 'Could not load the extension' };"
                         "  const all = await dp.getExtensionsInfo({ includeDisabled: true, includeTerminated: true });"
                         "  const hit = all.find((i) => i.path === %@);"
                         "  return hit ? { id: hit.id } : { error: 'The extension could not be loaded' };"
                         "})()",
                         @[ folder ]);
  HostEval(profile, js, ^(id value, NSString *error) {
    NSString *installed = [value isKindOfClass:NSDictionary.class] ? value[@"id"] : nil;
    if (managed) {
      NSString *dir = managed.stringByDeletingLastPathComponent;
      // Keep only the version that loaded (an update replaces the previous one).
      for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil]) {
        NSString *other = [dir stringByAppendingPathComponent:name];
        if (installed ? ![other isEqualToString:managed] : [other isEqualToString:managed]) [fm removeItemAtPath:other error:nil];
      }
    }
    if (installed) {
      pages::CloseExtensionContext(profile, installed);
      Changed(profile, installed, @"installed");
    }
    Respond(completion, value, error);
  });
}

+ (void)discardPrepared:(NSString *)path {
  if ([path hasPrefix:StagingRoot()]) [NSFileManager.defaultManager removeItemAtPath:path error:nil];
}

+ (void)setEnabled:(BOOL)enabled extension:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  NSString *js = Script(@"chrome.management.setEnabled(%@, %@).then(() => ({ ok: true }))", @[ extensionId, @(enabled) ]);
  pages::CloseExtensionContext(profile, extensionId);
  HostEval(profile, js, ^(id value, NSString *error) {
    if (!error) Changed(profile, extensionId, enabled ? @"enabled" : @"disabled");
    Respond(completion, value, error);
  });
}

+ (void)uninstall:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  // management.uninstall of another extension always brings up Chrome's own
  // confirmation (on the hidden host, where nobody can answer it; the user
  // already confirmed in ours). uninstallSelf from the extension's own context
  // doesn't ask. A disabled extension has no context: enable it first.
  NSString *info = Script(@"chrome.developerPrivate.getExtensionInfo(%@).then((i) => ({ path: i.path || null, enabled: i.state === 'ENABLED' }))",
                          @[ extensionId ]);
  NSString *gone = Script(@"chrome.developerPrivate.getExtensionInfo(%@).then(() => false, () => true)", @[ extensionId ]);
  NSString *enable = Script(@"chrome.management.setEnabled(%@, true).then(() => true)", @[ extensionId ]);
  void (^finish)(NSDictionary *, NSString *) = ^(NSDictionary *details, NSString *error) {
    NSString *path = [details[@"path"] isKindOfClass:NSString.class] ? details[@"path"] : nil;
    // Our copy of a store extension goes with it; a developer's folder stays.
    if (!error && path && [path hasPrefix:ManagedRoot(profile)])
      [NSFileManager.defaultManager removeItemAtPath:path.stringByDeletingLastPathComponent error:nil];
    if (!error) Changed(profile, extensionId, @"uninstalled");
    completion(error ? @{@"error" : error} : @{@"ok" : @YES});
  };
  // Polls until Chrome has unloaded it (uninstallSelf resolves in a page that's going away).
  __block void (^waitGone)(NSDictionary *, int);
  void (^wait)(NSDictionary *, int) = ^(NSDictionary *details, int attempt) {
    HostEval(profile, gone, ^(id removed, NSString *) {
      if ([removed boolValue] || attempt >= 30) {
        waitGone = nil;
        return finish(details, [removed boolValue] ? nil : @"The extension could not be removed");
      }
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        if (waitGone) waitGone(details, attempt + 1);
      });
    });
  };
  waitGone = [wait copy];
  HostEval(profile, info, ^(id details, NSString *error) {
    if (error) return completion(@{@"error" : error});
    void (^remove)(void) = ^{
      pages::ExtensionEval(profile, extensionId, @"(chrome.management.uninstallSelf({ showConfirmDialog: false }), true)",
                           ^(id, NSString *) {});
      waitGone(details, 0);
    };
    if ([details[@"enabled"] boolValue]) return remove();
    HostEval(profile, enable, ^(id, NSString *enableError) {
      if (enableError) return completion(@{@"error" : enableError});
      remove();
    });
  });
}

+ (void)reload:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  pages::CloseExtensionContext(profile, extensionId);
  NSString *js = Script(@"chrome.developerPrivate.reload(%@, { failQuietly: true }).then((e) => e ? { error: e.error } : { ok: true })",
                        @[ extensionId ]);
  HostEval(profile, js, ^(id value, NSString *error) {
    if (!error) Changed(profile, extensionId, @"reloaded");
    Respond(completion, value, error);
  });
}

+ (void)configure:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary *)options completion:(NNExtensionsCompletion)completion {
  NSMutableDictionary *update = [NSMutableDictionary dictionaryWithObject:extensionId forKey:@"extensionId"];
  if (options[@"pinned"]) update[@"pinnedToToolbar"] = options[@"pinned"];
  if (options[@"incognito"]) update[@"incognitoAccess"] = options[@"incognito"];
  if (options[@"fileAccess"]) update[@"fileAccess"] = options[@"fileAccess"];
  NSDictionary *access = @{@"onClick" : @"ON_CLICK", @"specificSites" : @"ON_SPECIFIC_SITES", @"allSites" : @"ON_ALL_SITES"};
  if (access[options[@"siteAccess"]]) update[@"hostAccess"] = access[options[@"siteAccess"]];
  NSString *js = Script(@"chrome.developerPrivate.updateExtensionConfiguration(%@).then(() => ({ ok: true }))", @[ update ]);
  HostEval(profile, js, ^(id value, NSString *error) {
    if (!error) Changed(profile, extensionId, @"configured");
    Respond(completion, value, error);
  });
}

+ (void)actionStateForProfile:(NSString *)profile
                   extensions:(NSArray<NSString *> *)extensionIds
                        tabId:(NSInteger)tabId
                   completion:(NNExtensionsCompletion)completion {
  // Chrome keeps per-tab badge/title/popup state keyed by extension tab id.
  if (tabId > 0 && !TabIdOf((int)tabId) && [gProbes[DataProfile(profile)] length]) {
    return ResolveTabIds(profile, ^{
      [self actionStateForProfile:profile extensions:extensionIds tabId:TabIdOf((int)tabId) ? tabId : 0 completion:completion];
    });
  }
  int chromeTabId = tabId > 0 ? TabIdOf((int)tabId) : 0;
  NSString *js = Script(@"(async () => {"
                         "  const a = chrome.action || chrome.browserAction;"
                         "  if (!a) return null;"
                         "  const tabId = %@;"
                         "  const d = tabId > 0 ? { tabId } : {};"
                         "  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');"
                         "  const get = (f, fallback) => f ? f.call(a, d).catch(() => (tabId > 0 ? f.call(a, {}) : fallback)).catch(() => fallback) : fallback;"
                         "  const [text, color, title, popup, textColor] = await Promise.all(["
                         "    get(a.getBadgeText, ''), get(a.getBadgeBackgroundColor, [0, 0, 0, 0]), get(a.getTitle, ''),"
                         "    get(a.getPopup, ''), a.getBadgeTextColor ? get(a.getBadgeTextColor, null) : null,"
                         "  ]);"
                         "  const enabled = a.isEnabled ? await a.isEnabled(d.tabId).catch(() => true) : true;"
                         "  // Placeholders like <<declarativeNetRequestActionCount>> need a permission to read.\n"
                         "  return { badgeText: /^<<.*>>$/.test(text) ? '' : text, badgeColor: hex(color), badgeTextColor: textColor ? hex(textColor) : null,"
                         "           title, popup, enabled };"
                         "})()",
                         @[ @(chromeTabId) ]);
  NSMutableDictionary *states = [NSMutableDictionary dictionary];
  __block NSUInteger pending = extensionIds.count;
  if (!pending) return completion(@{@"states" : states});
  for (NSString *extensionId in extensionIds) {
    pages::ExtensionEval(profile, extensionId, js, ^(id value, NSString *) {
      if ([value isKindOfClass:NSDictionary.class]) states[extensionId] = value;
      if (--pending == 0) completion(@{@"states" : states});
    });
  }
}

+ (void)setTabModel:(NSDictionary *)model {
  gProbes = [model[@"probes"] isKindOfClass:NSDictionary.class] ? [model[@"probes"] copy] : @{};
  // Look up new tabs' extension ids ahead of the next question.
  for (NSString *profile in gProbes) ResolveTabIds(profile, ^{});
}

@end
