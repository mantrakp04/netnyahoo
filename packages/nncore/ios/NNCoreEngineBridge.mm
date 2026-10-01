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
  NSString *data = nncore_host::IsIncognito(profile) ? @"" : (profile ?: @"");
  void (^done)(NSString *) = [completion copy];
  NSString *argsCopy = [args copy];
  nncore_host::WithProfile(data, ^(NNCoreProfile *p) {
    if (!p || !NNCoreHost.isStarted) return done(JSON(@{@"error" : @"profile not loaded"}));
    call(p.path.UTF8String, argsCopy.UTF8String, Replied, (__bridge_retained void *)done);
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
