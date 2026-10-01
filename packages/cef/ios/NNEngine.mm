#import "NNEngine.h"

#import "NNContentBlocker.h"
#import "NNExtensionsInternal.h"

#import <dlfcn.h>
#include <stdlib.h>

// The C surface's rules live in the header itself (plain C, mirrored into the Chromium tree).
#include "../../../engine/chromium/src/chrome/browser/netnyahoo/public/nn_engine.h"

#include "include/cef_request_context_handler.h"

using namespace nn;

namespace {

// The engine ships inside the app and main() loaded it before anything asks, so a missing export is an app
// bundled with an engine other than the one it was built for.
void *Symbol(const char *name) {
  static void *engine = [] {
    NSString *path = [NSBundle.mainBundle.privateFrameworksPath
        stringByAppendingPathComponent:@"Chromium Embedded Framework.framework/Chromium Embedded Framework"];
    return dlopen(path.fileSystemRepresentation, RTLD_LAZY | RTLD_LOCAL | RTLD_NOLOAD);
  }();
  void *symbol = engine ? dlsym(engine, name) : nullptr;
  if (!symbol) {
    NSLog(@"[engine] the engine doesn't export %s: the app bundles an engine other than the one it was built with", name);
    abort();
  }
  return symbol;
}

NSString *RealPath(NSString *path) {
  char resolved[PATH_MAX];
  return realpath(path.fileSystemRepresentation, resolved) ? @(resolved) : path;
}

void Replied(void *context, const char *json) {
  engine::Completion completion = (__bridge_transfer engine::Completion)context;
  id value = json ? FromJSON(@(json)) : nil;
  completion([value isKindOfClass:NSDictionary.class] ? value : @{@"error" : @"bad reply from the engine"});
}

NSMutableDictionary<NSString *, NSMutableArray *> *gObservers;

// The app's profile name for a profile directory the engine names.
NSString *ProfileNamed(NSString *dir) {
  NSString *real = RealPath(dir);
  if ([real isEqualToString:RealPath(ProfileDirectory(@""))]) return @"";
  NSString *name = real.lastPathComponent;
  return [name hasPrefix:@"Profile "] ? [name substringFromIndex:8] : name;
}

void Dispatch(void *, const char *topic, const char *json) {
  NSArray *handlers = [gObservers[@(topic)] copy];
  if (!handlers.count) return;
  NSMutableDictionary *payload = [FromJSON(@(json ?: "{}")) mutableCopy] ?: [NSMutableDictionary dictionary];
  if ([payload[@"profile"] isKindOfClass:NSString.class]) payload[@"profile"] = ProfileNamed(payload[@"profile"]);
  for (void (^handler)(NSDictionary *) in handlers) handler(payload);
}

NSMutableSet<NSString *> *gReady;

class ContextReady : public CefRequestContextHandler {
 public:
  ContextReady(NSString *profile, void (^ready)(CefRefPtr<CefRequestContext>))
      : profile_([profile copy]), ready_([ready copy]) {}
  void OnRequestContextInitialized(CefRefPtr<CefRequestContext> context) override {
    auto ready = ready_;
    ready_ = nil;
    if (ready) dispatch_async(dispatch_get_main_queue(), ^{ ready(context); });
  }
  bool OnExtensionInstallPrompt(CefRefPtr<CefBrowser> browser, const CefString &extension_id,
                                CefRefPtr<CefDictionaryValue> details,
                                CefRefPtr<CefExtensionPromptCallback> callback) override {
    return ext::OnInstallPrompt(profile_, browser, extension_id, details, callback);
  }

 private:
  NSString *profile_;
  void (^ready_)(CefRefPtr<CefRequestContext>);
  IMPLEMENT_REFCOUNTING(ContextReady);
};

}

namespace nn::engine {

void Call(const char *name, NSString *profile, NSDictionary<NSString *, id> *args, Completion completion) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    // A hidden test instance never shows Chrome's OS reauth (nn_reauth.h); the engine reports each request.
    Observe(@"reauth.requested", ^(NSDictionary *event) {
      NSLog(@"[engine] OS reauth requested (%@) in a hidden instance: %@", event[@"purpose"],
            [event[@"granted"] boolValue] ? @"granted" : @"denied");
    });
  });
  auto call = (nn_engine_call_t)Symbol(name);
  NSString *data = DataProfile(profile);
  NSString *json = args ? ToJSON(args) : nil;
  Completion done = [completion copy];
  void (^run)(void) = ^{
    if (![NNCef isStarted] || ShuttingDown()) return done(@{@"error" : @"engine not started"});
    call(ProfileDirectory(data).UTF8String, json.UTF8String, Replied, (__bridge_retained void *)done);
  };
  // A context the app made is in Chrome's ProfileManager once it's initialized.
  if ([gReady containsObject:data]) return run();
  WhenProfileReady(data, ^(CefRefPtr<CefRequestContext>) { run(); });
}

void Observe(NSString *topic, void (^handler)(NSDictionary<NSString *, id> *payload)) {
  if (!gObservers) {
    gObservers = [NSMutableDictionary dictionary];
    ((nn_engine_set_event_sink_t)Symbol("nn_engine_set_event_sink"))(Dispatch, nullptr);
  }
  if (!gObservers[topic]) gObservers[topic] = [NSMutableArray array];
  [gObservers[topic] addObject:[handler copy]];
}

}

namespace nn {

NSString *DataProfile(NSString *profile) { return IsIncognito(profile) ? @"" : (profile ?: @""); }

void WhenProfileReady(NSString *profile, void (^ready)(CefRefPtr<CefRequestContext> context)) {
  ready = [ready copy];
  CefRequestContext::CreateContext(ContextForProfile(profile), new ContextReady(profile, ^(CefRefPtr<CefRequestContext> context) {
    static NSMutableSet<NSString *> *prepared = [NSMutableSet set];
    if (![prepared containsObject:profile]) {
      [prepared addObject:profile];
      CefRefPtr<CefValue> startup = CefValue::Create();
      startup->SetInt(5);
      CefString error;
      if (!context->SetPreference("session.restore_on_startup", startup, error))
        NSLog(@"[cef] session.restore_on_startup: %@", ToNS(error));
      CefRefPtr<CefValue> off = CefValue::Create();
      off->SetBool(false);
      if (!IsIncognito(profile) && !context->SetPreference("download_bubble.partial_view_enabled", off, error))
        NSLog(@"[cef] download_bubble.partial_view_enabled: %@", ToNS(error));
      if (IsIncognito(profile)) {
        WhenProfileReady(DataProfile(profile), ^(CefRefPtr<CefRequestContext>) {});
      } else {
        NSString *prefs = [ProfileDirectory(profile) stringByAppendingPathComponent:@"Preferences"];
        bool fresh = ![NSFileManager.defaultManager fileExistsAtPath:prefs];
        blocker::LoadIntoProfile(profile, context);
        if (fresh)
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            blocker::LoadAgainIfNeeded(profile, context);
          });
      }
    }
    if (!IsIncognito(profile)) {
      if (!gReady) gReady = [NSMutableSet set];
      [gReady addObject:profile];
    }
    ready(context);
  }));
}

}
