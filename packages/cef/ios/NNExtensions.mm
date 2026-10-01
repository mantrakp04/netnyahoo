#import "NNExtensions.h"

#import "NNClient.h"
#import "NNContentBlocker.h"
#import "NNEngine.h"
#import "NNExtensionPackage.h"
#import "NNExtensionsInternal.h"
#import "NNWindowHost.h"

#include <map>

using namespace nn;

namespace {

NNEventHandler gHandler = nil;
void Emit(NSString *name, NSDictionary *payload) {
  if (gHandler) gHandler(name, payload);
}

void Changed(NSString *profile, NSString *extensionId, NSString *event) {
  Emit(@"changed", @{@"profile" : DataProfile(profile), @"id" : extensionId, @"event" : event});
}

// Where Chrome unpacked a store extension: <profile>/Extensions/<id>/<version>_<n>.
NSString *StoreFolder(NSString *profile, NSString *extensionId, NSString *version) {
  if (!ext::IsExtensionId(extensionId) || ![version isKindOfClass:NSString.class] || !version.length) return nil;
  NSString *dir = [[ProfileDirectory(DataProfile(profile)) stringByAppendingPathComponent:@"Extensions"] stringByAppendingPathComponent:extensionId];
  NSString *prefix = [version stringByAppendingString:@"_"];
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:nil])
    if ([name hasPrefix:prefix]) return [dir stringByAppendingPathComponent:name];
  return nil;
}

// //chrome/browser/netnyahoo/nn_extensions.h; a change the app should hear about is announced once done.
void Run(const char *name, NSString *profile, NSDictionary *args, NSString *event, NNExtensionsCompletion completion) {
  NSString *extensionId = args[@"id"];
  engine::Call(name, profile, args, ^(NSDictionary *result) {
    if (event && !result[@"error"]) Changed(profile, extensionId, event);
    completion(result);
  });
}

}

namespace nn::ext {

void EmitOpenTab(NSString *url, NSString *profile) {
  Emit(@"tabs", @{@"action" : @"open", @"url" : url ?: @"", @"profile" : profile ?: @"", @"active" : @YES, @"window" : [NSNull null],
                  @"extensionId" : @""});
}

namespace {
struct InstallPrompt {
  CefRefPtr<CefExtensionPromptCallback> callback;
  NSDictionary *payload;
};
std::map<std::string, InstallPrompt> gInstallPrompts;
int gInstallPromptSeq = 0;
}

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

CefRefPtr<CefRequestContextHandler> ContextHandler(NSString *profile) {
  class Handler : public CefRequestContextHandler {
   public:
    explicit Handler(NSString *profile) : profile_([profile copy]) {}
    bool OnExtensionInstallPrompt(CefRefPtr<CefBrowser> browser, const CefString &extension_id,
                                  CefRefPtr<CefDictionaryValue> details,
                                  CefRefPtr<CefExtensionPromptCallback> callback) override {
      return OnInstallPrompt(profile_, browser, extension_id, details, callback);
    }

   private:
    NSString *profile_;
    IMPLEMENT_REFCOUNTING(Handler);
  };
  return new Handler(profile ?: @"");
}

}

// MARK: - Public API

@implementation NNExtensions

+ (NNEventHandler)eventHandler {
  return gHandler;
}

+ (void)setEventHandler:(NNEventHandler)eventHandler {
  gHandler = [eventHandler copy];
  if (gHandler)
    for (auto &[requestId, prompt] : nn::ext::gInstallPrompts) Emit(@"installPrompt", prompt.payload);
}

+ (void)resolveInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
  auto &prompts = nn::ext::gInstallPrompts;
  auto it = prompts.find(requestId.UTF8String ?: "");
  if (it == prompts.end()) return;
  CefRefPtr<CefExtensionPromptCallback> callback = it->second.callback;
  prompts.erase(it);
  callback->Continue(accepted);
}

+ (void)listForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  engine::Call("nn_extensions_list", profile, nil, ^(NSDictionary *result) {
    if (result[@"error"]) return completion(result);
    NSArray *infos = result[@"extensions"];
    if (![infos isKindOfClass:NSArray.class]) return completion(@{@"error" : @"Unexpected extension list"});
    NSMutableArray *list = [NSMutableArray array];
    for (NSDictionary *info in infos) {
      if (![info isKindOfClass:NSDictionary.class]) continue;
      if ([info[@"id"] isEqual:blocker::ExtensionId()]) continue;
      NSMutableDictionary *item = [info mutableCopy];
      for (NSString *key in item.allKeys)
        if (item[key] == NSNull.null) item[key] = nil;
      NSString *path = [info[@"path"] isKindOfClass:NSString.class] ? info[@"path"] : nil;
      // Store extensions have no path: their manifest is in Chrome's copy. Without it their popup never opened
      // from the extensions menu or a shortcut, which pass no action state.
      NSString *folder = path ?: StoreFolder(profile, info[@"id"], info[@"version"]);
      NSDictionary *manifest = folder ? ext::ReadManifest(folder) : nil;
      for (NSString *key in @[ @"popup", @"actionTitle", @"actionIcon", @"sidePanel", @"hasAction" ])
        if (manifest[key]) item[key] = manifest[key];
      // Whether its pages can run in a private window's own profile (Chrome loads only split-mode ones there).
      item[@"incognitoSplit"] = @([manifest[@"incognitoSplit"] boolValue]);
      for (NSString *key in @[ @"siteAccess", @"optionsUrl", @"path", @"homepageUrl" ])
        if (!item[key]) item[key] = NSNull.null;
      BOOL fromStore = [info[@"location"] isEqual:@"FROM_STORE"];
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
  engine::Call("nn_extensions_install", profile, @{@"path" : folder ?: @""}, ^(NSDictionary *result) {
    if ([result[@"id"] isKindOfClass:NSString.class]) Changed(profile, result[@"id"], @"installed");
    completion(result);
  });
}

+ (void)setEnabled:(BOOL)enabled extension:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  Run("nn_extensions_set_enabled", profile, @{@"id" : extensionId, @"enabled" : @(enabled)}, enabled ? @"enabled" : @"disabled",
      completion);
}

+ (void)uninstall:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  // Removing deletes nothing itself: Chrome deletes its own copy of a store extension, and an unpacked
  // extension's folder is the user's. The app asked the user already, so Chrome's dialog doesn't show, and a
  // disabled extension stays disabled until it's gone.
  Run("nn_extensions_uninstall", profile, @{@"id" : extensionId}, @"uninstalled", completion);
}

+ (void)reload:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  Run("nn_extensions_reload", profile, @{@"id" : extensionId}, @"reloaded", completion);
}

+ (void)configure:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary *)options completion:(NNExtensionsCompletion)completion {
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithObject:extensionId forKey:@"id"];
  for (NSString *key in @[ @"pinned", @"incognito", @"fileAccess", @"siteAccess" ])
    if (options[key]) args[key] = options[key];
  Run("nn_extensions_configure", profile, args, @"configured", completion);
}

@end
