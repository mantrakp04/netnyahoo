// The JS side of //chrome/browser/netnyahoo's calls that the app reads Chrome's own stores through (history,
// favicons, closed tabs, bookmarks): `engineCall` and `onEngineEvent` (packages/cef/src/engine.ts).

#import "NNEngine.h"

using namespace nn;

namespace {

// The exports JS may name. Only these: a name the engine doesn't export aborts (NNEngine's Symbol).
NSSet<NSString *> *Allowed() {
  static NSSet<NSString *> *names = [NSSet setWithArray:@[
    @"nn_history_query", @"nn_history_add", @"nn_history_import", @"nn_history_delete_urls", @"nn_history_watch",
    @"nn_favicons_get", @"nn_favicons_set",
    @"nn_tab_restore_load",
    @"nn_bookmarks_tree", @"nn_bookmarks_apply", @"nn_bookmarks_watch",
  ]];
  return names;
}

NSArray<NSString *> *Topics() { return @[ @"history.changed", @"bookmarks.changed" ]; }

}

@implementation NNEngineBridge

+ (void)call:(NSString *)name profile:(NSString *)profile args:(NSString *)args completion:(void (^)(NSString *))completion {
  if (![Allowed() containsObject:name]) return completion(ToJSON(@{@"error" : [@"not an engine call: " stringByAppendingString:name]}));
  // Never a private window's: the engine would answer with its parent profile's data.
  if (IsIncognito(profile)) return completion(ToJSON(@{@"error" : @"no engine data for a private profile"}));
  id parsed = args.length ? FromJSON(args) : nil;
  if (args.length && ![parsed isKindOfClass:NSDictionary.class]) return completion(ToJSON(@{@"error" : @"arguments are not an object"}));
  engine::Call(name.UTF8String, profile, parsed, ^(NSDictionary *result) { completion(ToJSON(result)); });
}

+ (void)setEventHandler:(void (^)(NSString *, NSString *))handler {
  static void (^current)(NSString *, NSString *);
  static BOOL observing = NO;
  current = [handler copy];
  if (observing) return;
  observing = YES;
  for (NSString *topic in Topics())
    engine::Observe(topic, ^(NSDictionary *payload) {
      if (current) current(topic, ToJSON(payload));
    });
}

@end
