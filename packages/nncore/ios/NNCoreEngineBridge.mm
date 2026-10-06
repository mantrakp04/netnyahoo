#import "NNCoreEngineBridge.h"

#import "NNCoreInternal.h"

#import <dlfcn.h>
#include <stdlib.h>

#include "../../../engine/chromium/src/chrome/browser/netnyahoo/public/nn_engine.h"

namespace {

void (^gEventHandler)(NSString *, NSString *);

void *Symbol(const char *name) {
  // The framework is linked: its exports are in the process's namespace.
  return dlsym(RTLD_DEFAULT, name);
}

NSString *JSON(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

void Replied(void *context, const char *json) {
  void (^completion)(NSString *) = (__bridge_transfer void (^)(NSString *))context;
  completion(json ? @(json) : JSON(@{@"error" : @"bad reply from the engine"}));
}

NSString *RealPath(NSString *path) {
  char resolved[PATH_MAX];
  return realpath(path.fileSystemRepresentation, resolved) ? @(resolved) : path;
}

// The app's profile name for a profile directory the engine names.
NSString *ProfileNamed(NSString *dir) {
  NSString *real = RealPath(dir);
  for (NNCoreProfile *profile in nncore_host::LoadedProfiles())
    if (!([profile respondsToSelector:@selector(offTheRecord)] && profile.offTheRecord) && [RealPath(profile.path) isEqualToString:real]) return nncore_host::ProfileName(profile);
  NSString *name = real.lastPathComponent;
  return [name hasPrefix:@"Profile "] ? [name substringFromIndex:8] : @"";
}

// The engine's conventions (public/nn_engine.h NN_ENGINE_ABI_VERSION); 0 if it can't say.
int EngineABI() {
  static int abi = [] {
    auto version = (nn_engine_abi_version_t)Symbol("nn_engine_abi_version");
    return version ? version() : 0;
  }();
  return abi;
}

NSMutableDictionary<NSString *, NSMutableArray *> *Observers() {
  static NSMutableDictionary *observers = [NSMutableDictionary dictionary];
  return observers;
}

void Dispatch(void *, const char *topic, const char *json) {
  if (!topic) return;
  NSData *data = [@(json ?: "{}") dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableDictionary *payload = [[NSJSONSerialization JSONObjectWithData:data options:0 error:nil] mutableCopy] ?: [NSMutableDictionary dictionary];
  if ([payload[@"profile"] isKindOfClass:NSString.class]) payload[@"profile"] = ProfileNamed(payload[@"profile"]);
  for (void (^observer)(NSDictionary *) in [Observers()[@(topic)] copy]) observer(payload);
  if (gEventHandler) gEventHandler(@(topic), JSON(payload));
}

void InstallSink() {
  static bool installed = false;
  if (installed) return;
  auto sink = (nn_engine_set_event_sink_t)Symbol("nn_engine_set_event_sink");
  if (!sink) return;
  installed = true;
  sink(Dispatch, nullptr);
}

}  // namespace

@implementation NNCoreEngineBridge

+ (void)call:(NSString *)name profile:(NSString *)profile args:(NSString *)args completion:(void (^)(NSString *))completion {
  auto call = (nn_engine_call_t)Symbol(name.UTF8String);
  if (!call) return completion(JSON(@{@"error" : [NSString stringWithFormat:@"the engine has no %@", name]}));
  // A private window's calls name its regular profile (the engine finds a profile by its path, which an
  // off-the-record profile shares). Site settings, site data and zoom are its session's own, as in Chrome's incognito:
  // they run on that profile's off-the-record profile ("offTheRecord", engine ABI 2) and go with the session. Before
  // ABI 2 they would have acted on the regular profile, so the ones that change something are refused there; so are
  // the regular profile's own lists and browsing data, which a private window never changes.
  if (nncore_host::IsIncognito(profile)) {
    static NSSet<NSString *> *session = [NSSet setWithArray:@[
      @"nn_site_settings_get", @"nn_site_settings_origins", @"nn_site_settings_set", @"nn_site_settings_reset",
      @"nn_site_data_clear", @"nn_zoom_list", @"nn_zoom_set"
    ]];
    static NSSet<NSString *> *changes = [NSSet setWithArray:@[
      @"nn_site_settings_set", @"nn_site_settings_reset", @"nn_site_data_clear", @"nn_zoom_set", @"nn_external_apps_remove",
      @"nn_browsing_data_clear"
    ]];
    if ([session containsObject:name] && EngineABI() >= 2) {
      NSData *bytes = [(args.length ? args : @"{}") dataUsingEncoding:NSUTF8StringEncoding];
      NSMutableDictionary *parsed = [[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil] mutableCopy];
      if (![parsed isKindOfClass:NSMutableDictionary.class]) return completion(JSON(@{@"error" : @"bad arguments"}));
      parsed[@"offTheRecord"] = @YES;
      args = JSON(parsed);
    } else if ([changes containsObject:name]) {
      return completion(JSON(@{@"error" : @"private profile"}));
    }
  }
  NSString *data = nncore_host::OriginalProfileName(profile);
  void (^done)(NSString *) = [completion copy];
  NSString *argsCopy = [args copy];
  nncore_host::WithProfile(data, ^(NNCoreProfile *p) {
    if (!p || !NNCoreHost.isStarted) return done(JSON(@{@"error" : @"profile not loaded"}));
    call(p.path.UTF8String, argsCopy.UTF8String, Replied, (__bridge_retained void *)done);
  });
}

+ (void)callWithSecret:(NSString *)name profile:(NSString *)profile args:(NSMutableData *)args completion:(void (^)(NSString *))completion {
  NSMutableData *secret = args;
  void (^wipe)(void) = ^{
    // Volatile stores: the compiler can't drop them as dead (memset_s needs __STDC_WANT_LIB_EXT1__ before any
    // <string.h>, which the pod's prefix header includes first).
    volatile unsigned char *bytes = (volatile unsigned char *)secret.mutableBytes;
    for (NSUInteger i = 0; i < secret.length; i++) bytes[i] = 0;
  };
  auto call = (nn_engine_call_t)Symbol(name.UTF8String);
  const char *bytes = (const char *)secret.bytes;
  if (!call || nncore_host::IsIncognito(profile) || !secret.length || bytes[secret.length - 1] != 0) {
    wipe();
    return completion(JSON(@{@"error" : !call ? [NSString stringWithFormat:@"the engine has no %@", name]
                                     : nncore_host::IsIncognito(profile) ? @"private profile" : @"bad arguments"}));
  }
  void (^done)(NSString *) = [completion copy];
  nncore_host::WithProfile(profile ?: @"", ^(NNCoreProfile *p) {
    if (!p || !NNCoreHost.isStarted || ([p respondsToSelector:@selector(offTheRecord)] && p.offTheRecord)) {
      wipe();
      return done(JSON(@{@"error" : @"profile not loaded"}));
    }
    // Exports parse their arguments before returning (public/nn_engine.h): the buffer can go now.
    call(p.path.UTF8String, (const char *)secret.mutableBytes, Replied, (__bridge_retained void *)done);
    wipe();
  });
}

+ (void)setEventHandler:(void (^)(NSString *, NSString *))handler {
  gEventHandler = [handler copy];
  InstallSink();
}

+ (void)observe:(NSString *)topic handler:(void (^)(NSDictionary<NSString *, id> *))handler {
  if (!Observers()[topic]) Observers()[topic] = [NSMutableArray array];
  [Observers()[topic] addObject:[handler copy]];
  InstallSink();
}

+ (BOOL)exports:(NSString *)name {
  return Symbol(name.UTF8String) != nullptr;
}

@end
