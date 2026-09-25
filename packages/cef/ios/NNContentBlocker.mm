#import "NNContentBlocker.h"

#import "NNChromePages.h"

using namespace nn;

namespace {

// uBOL filtering modes (js/mode-manager.js).
constexpr int kModeNone = 0;
constexpr int kModeOptimal = 2;

/// Settings live in the default profile's copy (other profiles have their own; they follow it).
NSString *const kProfile = @"";

/// Sends `message` to uBOL's service worker from its own context, like its settings page.
void Send(NSDictionary *message, void (^completion)(id value, NSString *error)) {
  NSString *js = pages::Script(@"chrome.runtime.sendMessage(%@)", @[ message ]);
  pages::ExtensionEval(kProfile, blocker::ExtensionId(), js, ^(id value, NSString *error) {
    if (error) NSLog(@"[blocker] %@: %@", message[@"what"], error);
    completion(value, error);
  });
}

NSString *Category(NSDictionary *ruleset) {
  NSString *rulesetId = ruleset[@"id"], *group = ruleset[@"group"];
  if ([group isEqual:@"regions"]) return @"regional";
  if ([rulesetId isEqual:@"annoyances-cookies"]) return @"cookies";
  if ([group isEqual:@"privacy"] || [rulesetId isEqual:@"easyprivacy"]) return @"trackers";
  if ([group isEqual:@"annoyances"]) return @"annoyances";
  if ([group isEqual:@"malware"]) return @"security";
  return @"ads";
}

double Count(NSDictionary *d, NSString *key) { return [d[key] isKindOfClass:NSNumber.class] ? [d[key] doubleValue] : 0; }

/// The bundled uBlock Origin Lite's version: its lists are the ones it shipped with.
NSString *BundledVersion() {
  NSString *path = [blocker::ExtensionPath() stringByAppendingPathComponent:@"manifest.json"];
  NSData *data = path ? [NSData dataWithContentsOfFile:path] : nil;
  NSDictionary *manifest = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [manifest isKindOfClass:NSDictionary.class] && [manifest[@"version"] isKindOfClass:NSString.class] ? manifest[@"version"] : @"";
}

/// {enabled, lists, allowedHosts, stats} from the options page data and the per-site modes.
void State(void (^completion)(NSDictionary *state)) {
  Send(@{@"what" : @"getOptionsPageData"}, ^(id options, NSString *error) {
    Send(@{@"what" : @"getFilteringModeDetails"}, ^(id modes, NSString *) {
      if (![options isKindOfClass:NSDictionary.class]) {
        return completion(@{
          @"enabled" : @NO, @"lists" : @[], @"allowedHosts" : @[], @"version" : BundledVersion(),
          @"stats" : @{@"ready" : @NO, @"enabled" : @NO, @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0,
                       @"maxLookupMicros" : @0, @"error" : error ?: @"unavailable"},
        });
      }
      NSSet *enabledIds = [NSSet setWithArray:options[@"enabledRulesets"] ?: @[]];
      BOOL on = [options[@"defaultFilteringMode"] intValue] != kModeNone;
      NSMutableArray *lists = [NSMutableArray array];
      double network = 0, cosmetic = 0;
      for (NSDictionary *r in options[@"rulesetDetails"]) {
        if (![r isKindOfClass:NSDictionary.class] || [r[@"id"] isEqual:@"ubol-tests"]) continue;
        BOOL enabled = [enabledIds containsObject:r[@"id"]];
        NSDictionary *rules = [r[@"rules"] isKindOfClass:NSDictionary.class] ? r[@"rules"] : @{};
        NSDictionary *css = [r[@"css"] isKindOfClass:NSDictionary.class] ? r[@"css"] : @{};
        NSDictionary *filters = [r[@"filters"] isKindOfClass:NSDictionary.class] ? r[@"filters"] : @{};
        double count = Count(rules, @"total");
        if (enabled) {
          network += count;
          cosmetic += Count(css, @"generic") + Count(css, @"specific");
        }
        [lists addObject:@{
          @"id" : r[@"id"],
          @"title" : r[@"name"] ?: r[@"id"],
          @"category" : Category(r),
          @"enabled" : @(enabled),
          // On by default in uBOL; every list ships with it, the rest are opt-in.
          @"defaultOn" : @([r[@"enabled"] boolValue]),
          // The list's own filters (DNR packs many of them into one rule).
          @"filters" : @(Count(filters, @"accepted") ?: count),
        }];
      }
      NSMutableArray *allowed = [NSMutableArray array];
      NSArray *none = [modes isKindOfClass:NSDictionary.class] && [modes[@"none"] isKindOfClass:NSArray.class] ? modes[@"none"] : @[];
      for (NSString *host in none)
        if ([host isKindOfClass:NSString.class] && ![host isEqualToString:@"all-urls"]) [allowed addObject:host];
      completion(@{
        @"enabled" : @(on),
        @"version" : BundledVersion(),
        @"lists" : lists,
        @"allowedHosts" : allowed,
        @"stats" : @{
          @"ready" : @YES, @"enabled" : @(on), @"networkFilters" : @(network), @"cosmeticFilters" : @(cosmetic),
          @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0, @"maxLookupMicros" : @0,
        },
      });
    });
  });
}

void Changed() {
  State(^(NSDictionary *state) { EmitGlobal(@"contentBlocker", state[@"stats"]); });
}

}  // namespace

namespace nn::blocker {

NSString *ExtensionPath() {
  NSString *path = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"Extensions/ublock-lite"];
  return [NSFileManager.defaultManager fileExistsAtPath:[path stringByAppendingPathComponent:@"manifest.json"]] ? path : nil;
}

NSString *ExtensionId() { return @"bnjeokpoejhioagiokhkhmdogkhbnbki"; }

void LoadIntoProfile(CefRefPtr<CefRequestContext> context) {
#if NN_CHROME_TABS
  NSString *path = ExtensionPath();
  if (!path || !context) return;
  NSString *loaded = ToNS(context->LoadComponentExtension(ToCef(path)));
  if (![loaded isEqualToString:ExtensionId()]) NSLog(@"[blocker] component load failed (%@)", loaded);
#endif
}

}  // namespace nn::blocker

// MARK: - Public API

@implementation NNContentBlocker

+ (void)state:(void (^)(NSDictionary<NSString *, id> *))completion {
  State(completion);
}

+ (void)setEnabled:(BOOL)enabled completion:(void (^)(void))completion {
  Send(@{@"what" : @"setDefaultFilteringMode", @"level" : @(enabled ? kModeOptimal : kModeNone)}, ^(id, NSString *) {
    Changed();
    completion();
  });
}

+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(void))completion {
  Send(@{@"what" : @"getEnabledRulesets"}, ^(id value, NSString *) {
    NSMutableOrderedSet *ids = [NSMutableOrderedSet orderedSetWithArray:[value isKindOfClass:NSArray.class] ? value : @[]];
    if (enabled) [ids addObject:listId];
    else [ids removeObject:listId];
    Send(@{@"what" : @"applyRulesets", @"enabledRulesets" : ids.array}, ^(id, NSString *) {
      Changed();
      completion();
    });
  });
}

+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL))completion {
  Send(@{@"what" : @"getFilteringMode", @"hostname" : host.lowercaseString}, ^(id level, NSString *error) {
    completion(!error && [level isKindOfClass:NSNumber.class] && [level intValue] == kModeNone);
  });
}

+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(void))completion {
  Send(@{@"what" : @"getDefaultFilteringMode"}, ^(id defaultLevel, NSString *) {
    int level = allowed ? kModeNone : ([defaultLevel intValue] ?: kModeOptimal);
    Send(@{@"what" : @"setFilteringMode", @"hostname" : host.lowercaseString, @"level" : @(level)}, ^(id, NSString *) {
      completion();
    });
  });
}

+ (void)checkURL:(NSString *)url
       sourceURL:(NSString *)sourceURL
            type:(NSString *)type
      completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  static NSDictionary *types = @{@"xhr" : @"xmlhttprequest", @"subdocument" : @"sub_frame", @"document" : @"main_frame",
                                 @"popup" : @"main_frame", @"fetch" : @"xmlhttprequest"};
  NSString *resourceType = types[type] ?: type;
  NSString *origin = OriginOf(sourceURL);
  // testMatchOutcome: DNR's own dry run (unpacked extensions only, which ours is).
  NSString *js = pages::Script(
      @"chrome.declarativeNetRequest.testMatchOutcome({ url: %@, initiator: %@ || undefined, type: %@, tabId: -1 })"
       ".then((o) => o.matchedRules.map((r) => r.rulesetId + '#' + r.ruleId))",
      @[ url, origin ?: [NSNull null], resourceType ]);
  pages::ExtensionEval(kProfile, blocker::ExtensionId(), js, ^(id value, NSString *error) {
    NSArray *matched = [value isKindOfClass:NSArray.class] ? value : @[];
    NSString *host = HostOf(sourceURL);
    [self isAllowedOnHost:host completion:^(BOOL allowedSite) {
      completion(@{
        @"blocked" : @(matched.count > 0 && !allowedSite),
        @"filter" : matched.firstObject ?: (error ? (id)error : [NSNull null]),
        @"thirdParty" : @(![HostOf(url) hasSuffix:host] || !host.length),
        @"allowedSite" : @(allowedSite),
      });
    }];
  });
}

@end
