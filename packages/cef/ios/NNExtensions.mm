#import "NNExtensions.h"

#import "NNChromePages.h"
#import "NNClient.h"
#import "NNContentBlocker.h"
#import "NNExtensionPackage.h"
#import "NNExtensionsInternal.h"
#import "NNWindowHost.h"

#include <map>

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

/// Where our own download-and-load path put store extensions before Chrome installed them
/// itself (existing installs still load from there).
NSString *ManagedRoot(NSString *profile) {
  NSString *key = DataProfile(profile);
  return [[DataRoot() stringByAppendingPathComponent:@"Netnyahoo Extensions"] stringByAppendingPathComponent:key.length ? key : @"Default"];
}

void HostEval(NSString *profile, NSString *expression, pages::EvalCompletion completion) {
  pages::WebUIEval(profile, kExtensionsPage, expression, completion);
}

void Respond(NNExtensionsCompletion completion, id value, NSString *error) {
  if (error) return completion(@{@"error" : error});
  completion([value isKindOfClass:NSDictionary.class] ? value : @{@"ok" : @YES});
}

}  // namespace

namespace nn::ext {

void EmitOpenTab(NSString *url, NSString *profile) {
  Emit(@"tabs", @{@"action" : @"open", @"url" : url ?: @"", @"profile" : profile ?: @"", @"active" : @YES, @"window" : [NSNull null],
                  @"extensionId" : @""});
}

#if NN_INSTALL_PROMPT
namespace {
struct InstallPrompt {
  CefRefPtr<CefExtensionPromptCallback> callback;
  NSDictionary *payload;
};
std::map<std::string, InstallPrompt> gInstallPrompts;  // request id → Chrome's callback
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
  gInstallPrompts[requestId.UTF8String] = {callback, payload};
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
#if NN_INSTALL_PROMPT
  // A reloaded app asks again for installs Chrome is still waiting on.
  if (gHandler)
    for (auto &[requestId, prompt] : nn::ext::gInstallPrompts) Emit(@"installPrompt", prompt.payload);
#endif
}

+ (void)resolveInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
#if NN_INSTALL_PROMPT
  auto &prompts = nn::ext::gInstallPrompts;
  auto it = prompts.find(requestId.UTF8String ?: "");
  if (it == prompts.end()) return;
  CefRefPtr<CefExtensionPromptCallback> callback = it->second.callback;
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

+ (NSDictionary *)inspectUnpacked:(NSString *)path {
  NSMutableDictionary *info = [ext::ReadManifest(path) mutableCopy];
  if (!info[@"error"]) info[@"path"] = path;
  return info;
}

+ (void)installPath:(NSString *)folder profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
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
    if (installed) {
      pages::CloseExtensionContext(profile, installed);
      Changed(profile, installed, @"installed");
    }
    Respond(completion, value, error);
  });
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

@end
