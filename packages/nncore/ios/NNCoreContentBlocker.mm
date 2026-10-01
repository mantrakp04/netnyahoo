// The built-in content blocker on NNCore: packages/cef/ios/NNContentBlocker.mm's logic (uBlock Origin Lite, MV3,
// driven by its own runtime messages), with NNCore underneath: the extension loads as a component extension into
// each profile, and the app talks to it from one of its pages (chrome-extension://<id>/manifest.json) opened in a
// hidden window of ours, where evaluate: runs with the extension's APIs.
#import "NNCoreServices.h"
#import "NNCoreInternal.h"

#import <CommonCrypto/CommonDigest.h>
#include <sys/clonefile.h>
#include <sys/stat.h>

namespace {

NSString *ExtensionId() { return @"bnjeokpoejhioagiokhkhmdogkhbnbki"; }
NSString *ExtensionPath();
void LoadIntoProfile(NSString *profile);
void PageEval(NSString *profile, NSString *expression, void (^completion)(id value, NSString *error));
void ClosePage(NSString *profile);

NSString *ScriptWith(NSString *format, NSArray *args) {
  NSMutableString *out = [NSMutableString string];
  NSArray<NSString *> *parts = [format componentsSeparatedByString:@"%@"];
  for (NSUInteger i = 0; i < parts.count; i++) {
    [out appendString:parts[i]];
    if (i < args.count) {
      NSData *json = [NSJSONSerialization dataWithJSONObject:args[i] options:NSJSONWritingFragmentsAllowed error:nil];
      [out appendString:json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"null"];
    }
  }
  return out;
}

constexpr int kModeNone = 0;
constexpr int kModeOptimal = 2;

NSString *const kProfile = @"";

NSMutableOrderedSet<NSString *> *LoadedProfiles() {
  static NSMutableOrderedSet<NSString *> *profiles = [NSMutableOrderedSet orderedSet];
  return profiles;
}

NSMutableDictionary<NSString *, NSDate *> *LastAnswers() {
  static NSMutableDictionary<NSString *, NSDate *> *answers = [NSMutableDictionary dictionary];
  return answers;
}
bool Answering(NSString *profile) { return LastAnswers()[profile] && LastAnswers()[profile].timeIntervalSinceNow > -20; }

bool PageDead(NSString *error) { return [error containsString:@"context invalidated"] || [error isEqualToString:@"closed"]; }
void Reopen(NSString *profile) {
  [LastAnswers() removeObjectForKey:profile];
  ClosePage(profile);
}

void WhenAnswering(NSString *profile, void (^then)(void), int tries = 0) {
  if (Answering(profile)) return then();
  then = [then copy];
  __block bool settled = false;
  void (^next)(bool) = ^(bool answered) {
    if (settled) return;
    settled = true;
    if (answered) LastAnswers()[profile] = [NSDate date];
    if (answered || tries >= 10) return then();
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      WhenAnswering(profile, then, tries + 1);
    });
  };
  NSString *js = @"Promise.race([chrome.runtime.sendMessage({what: 'getDefaultFilteringMode'}), "
                 @"new Promise((r) => setTimeout(r, 1000))]).then((level) => typeof level === 'number')";
  PageEval(profile, js, ^(id answered, NSString *error) {
    if (PageDead(error)) Reopen(profile);
    next([answered isEqual:@YES]);
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ next(false); });
}

void Send(NSString *profile, NSDictionary *message, void (^completion)(id value, NSString *error), bool retried = false) {
  if (!NNCoreHost.isStarted) return completion(nil, @"unavailable");
  completion = [completion copy];
  if (![LoadedProfiles() containsObject:profile]) {
    return nncore_host::WithProfile(profile, ^(NNCoreProfile *) {
      LoadIntoProfile(profile);
      if ([LoadedProfiles() containsObject:profile]) Send(profile, message, completion, retried);
      else completion(nil, @"not loaded");
    });
  }
  WhenAnswering(profile, ^{
    NSString *js = ScriptWith(@"chrome.runtime.sendMessage(%@)", @[ message ]);
    PageEval(profile, js, ^(id value, NSString *error) {
      if (!error) LastAnswers()[profile] = [NSDate date];
      else {
        [LastAnswers() removeObjectForKey:profile];
        if (PageDead(error)) {
          Reopen(profile);
          if (!retried) return Send(profile, message, completion, true);
        }
        NSLog(@"[blocker] %@ (profile \"%@\"): %@", message[@"what"], profile, error);
      }
      completion(value, error);
    });
  });
}

void Send(NSDictionary *message, void (^completion)(id value, NSString *error)) { Send(kProfile, message, completion); }

NSDictionary *SortedModes(id modes) {
  if (![modes isKindOfClass:NSDictionary.class]) return nil;
  NSMutableDictionary *sorted = [NSMutableDictionary dictionary];
  for (NSString *key in modes) {
    id hosts = modes[key];
    sorted[key] = [hosts isKindOfClass:NSArray.class] ? [hosts sortedArrayUsingSelector:@selector(compare:)] : hosts;
  }
  return sorted;
}

void Follow(NSString *profile, NSDictionary *modes, NSArray *lists, void (^done)(void)) {
  Send(profile, @{@"what" : @"getFilteringModeDetails"}, ^(id theirModes, NSString *) {
    Send(profile, @{@"what" : @"getEnabledRulesets"}, ^(id theirLists, NSString *) {
      dispatch_group_t group = dispatch_group_create();
      if (![SortedModes(theirModes) isEqual:modes]) {
        dispatch_group_enter(group);
        Send(profile, @{@"what" : @"setFilteringModeDetails", @"modes" : modes}, ^(id, NSString *) { dispatch_group_leave(group); });
      }
      if (![theirLists isKindOfClass:NSArray.class] || ![[NSSet setWithArray:theirLists] isEqual:[NSSet setWithArray:lists]]) {
        dispatch_group_enter(group);
        Send(profile, @{@"what" : @"applyRulesets", @"enabledRulesets" : lists}, ^(id, NSString *) { dispatch_group_leave(group); });
      }
      dispatch_group_notify(group, dispatch_get_main_queue(), done);
    });
  });
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(void)) {
  done = [done copy];
  profiles = [(profiles ?: LoadedProfiles().array) filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
  if (!profiles.count) return done();
  Send(@{@"what" : @"getFilteringModeDetails"}, ^(id modes, NSString *) {
    Send(@{@"what" : @"getEnabledRulesets"}, ^(id lists, NSString *) {
      NSDictionary *sorted = SortedModes(modes);
      if (!sorted || ![lists isKindOfClass:NSArray.class]) return done();
      dispatch_group_t group = dispatch_group_create();
      for (NSString *profile in profiles) {
        dispatch_group_enter(group);
        Follow(profile, sorted, lists, ^{ dispatch_group_leave(group); });
      }
      dispatch_group_notify(group, dispatch_get_main_queue(), done);
    });
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

NSString *BundledVersion() {
  NSString *path = [ExtensionPath() stringByAppendingPathComponent:@"manifest.json"];
  NSData *data = path ? [NSData dataWithContentsOfFile:path] : nil;
  NSDictionary *manifest = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [manifest isKindOfClass:NSDictionary.class] && [manifest[@"version"] isKindOfClass:NSString.class] ? manifest[@"version"] : @"";
}

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
          @"defaultOn" : @([r[@"enabled"] boolValue]),
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

void Changed(void (^completion)(void)) {
  completion = [completion copy];
  FollowDefault(nil, ^{
    State(^(NSDictionary *state) { if (NNCoreHost.eventHandler) NNCoreHost.eventHandler(@"contentBlocker", state[@"stats"]); });
    completion();
  });
}

// The fingerprint embed.sh wrote next to the bundled copy; builds from before it walk the copy instead.
NSString *Fingerprint(NSString *dir) {
  NSString *stamped = [NSString stringWithContentsOfFile:[dir stringByAppendingString:@".fingerprint"]
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
  stamped = [stamped stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (stamped.length) return stamped;
  NSData *manifest = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"manifest.json"]];
  if (!manifest) return nil;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(manifest.bytes, (CC_LONG)manifest.length, digest);
  NSMutableString *fingerprint = [NSMutableString string];
  for (unsigned char byte : digest) [fingerprint appendFormat:@"%02x", byte];
  unsigned long long files = 0, bytes = 0;
  NSDirectoryEnumerator<NSURL *> *entries = [NSFileManager.defaultManager enumeratorAtURL:[NSURL fileURLWithPath:dir]
                                                               includingPropertiesForKeys:@[ NSURLFileSizeKey ]
                                                                                  options:0
                                                                             errorHandler:nil];
  for (NSURL *entry in entries) {
    if ([entry.lastPathComponent isEqualToString:@"_metadata"]) {
      [entries skipDescendants];
      continue;
    }
    NSNumber *size;
    [entry getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    files++;
    bytes += size.unsignedLongLongValue;
  }
  [fingerprint appendFormat:@"-%llu-%llu", files, bytes];
  return fingerprint;
}

NSString *WritableCopy(NSString *bundled) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *dir = [[NNCoreHost.dataDirectory stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Built-in Extensions"];
  NSString *copy = [dir stringByAppendingPathComponent:@"ublock-lite"];
  NSString *stampPath = [dir stringByAppendingPathComponent:@"ublock-lite.source"];
  NSString *fingerprint = Fingerprint(bundled);
  NSString *stamp = [NSString stringWithContentsOfFile:stampPath encoding:NSUTF8StringEncoding error:nil];
  if (fingerprint && [stamp isEqualToString:fingerprint] &&
      [fm fileExistsAtPath:[copy stringByAppendingPathComponent:@"manifest.json"]])
    return copy;

  NSError *error;
  if (![fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:&error]) {
    NSLog(@"[blocker] %@: %@", dir, error);
    return nil;
  }
  for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil])
    if ([name hasPrefix:@".ublock-lite"]) [fm removeItemAtPath:[dir stringByAppendingPathComponent:name] error:nil];
  NSString *staging = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@".ublock-lite-%d", getpid()]];
  bool cloned = clonefile(bundled.fileSystemRepresentation, staging.fileSystemRepresentation, 0) == 0;
  if (!cloned) [fm removeItemAtPath:staging error:nil];
  if (!cloned && ![fm copyItemAtPath:bundled toPath:staging error:&error]) {
    NSLog(@"[blocker] copying %@: %@", bundled, error);
    [fm removeItemAtPath:staging error:nil];
    return nil;
  }
  NSDirectoryEnumerator<NSString *> *entries = [fm enumeratorAtPath:staging];
  for (NSString *entry = @""; entry; entry = entries.nextObject) {
    NSString *path = [staging stringByAppendingPathComponent:entry];
    struct stat info;
    if (lstat(path.fileSystemRepresentation, &info) == 0 && !S_ISLNK(info.st_mode) && !(info.st_mode & S_IWUSR))
      chmod(path.fileSystemRepresentation, info.st_mode | S_IWUSR);
  }
  [fm removeItemAtPath:[staging stringByAppendingPathComponent:@"_metadata"] error:nil];

  NSString *old = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@".ublock-lite-old-%d", getpid()]];
  bool hadCopy = [fm fileExistsAtPath:copy];
  if ((hadCopy && ![fm moveItemAtPath:copy toPath:old error:&error]) || ![fm moveItemAtPath:staging toPath:copy error:&error]) {
    NSLog(@"[blocker] installing %@: %@", copy, error);
    [fm removeItemAtPath:staging error:nil];
    return nil;
  }
  if (hadCopy) [fm removeItemAtPath:old error:nil];
  [fingerprint writeToFile:stampPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
  return copy;
}


// MARK: The extension

NSString *gExtensionPath;
dispatch_group_t Preparing() {
  static dispatch_group_t group = dispatch_group_create();
  return group;
}

void StartPreparing() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    dispatch_group_async(Preparing(), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"Extensions/ublock-lite"];
      if ([NSFileManager.defaultManager fileExistsAtPath:[bundled stringByAppendingPathComponent:@"manifest.json"]])
        gExtensionPath = WritableCopy(bundled);
    });
  });
}

NSString *ExtensionPath() {
  StartPreparing();
  dispatch_group_wait(Preparing(), DISPATCH_TIME_FOREVER);
  return gExtensionPath;
}

void LoadIntoProfile(NSString *profile) {
  if ([LoadedProfiles() containsObject:profile]) return;
  // The writable copy is made on a background queue at launch (thousands of files the first time): wait for it
  // there, never on the main thread.
  StartPreparing();
  dispatch_group_notify(Preparing(), dispatch_get_main_queue(), ^{
    if ([LoadedProfiles() containsObject:profile]) return;
    NNCoreProfile *p = nncore_host::LoadedProfile(profile);
    NSString *path = gExtensionPath;
    if (!p || !path || ![p respondsToSelector:@selector(loadComponentExtension:)]) return;
    NSString *loaded = [p loadComponentExtension:path];
    if (![loaded isEqualToString:ExtensionId()]) return (void)NSLog(@"[blocker] component load failed (%@)", loaded);
    [LoadedProfiles() addObject:profile];
    [LastAnswers() removeObjectForKey:profile];
    if (profile.length) FollowDefault(@[ profile ], ^{});
  });
}

// MARK: The extension's page

NSMutableDictionary<NSString *, NNCoreWindow *> *PageWindows() {
  static NSMutableDictionary *windows = [NSMutableDictionary dictionary];
  return windows;
}

NSMutableDictionary<NSString *, NNCoreTab *> *Pages() {
  static NSMutableDictionary *pages = [NSMutableDictionary dictionary];
  return pages;
}

void ClosePage(NSString *profile) {
  [Pages()[profile] closeNow];
  [Pages() removeObjectForKey:profile];
}

void PageEval(NSString *profile, NSString *expression, void (^completion)(id value, NSString *error)) {
  completion = [completion copy];
  NNCoreProfile *p = nncore_host::LoadedProfile(profile);
  if (!p) return completion(nil, @"not loaded");
  NNCoreTab *tab = Pages()[profile];
  if (!tab || tab.closed) {
    // A window of our own that nobody sees: no controller, so nothing routes or reports its tab.
    NNCoreWindow *window = PageWindows()[profile];
    if (!window) {
      PageWindows()[profile] = window = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)];
      // The extension's page is ours, not the user's: never in history or the omnibox.
      if ([window respondsToSelector:@selector(setInternal:)]) window.internal = YES;
    }
    tab = [window openTab:[NSString stringWithFormat:@"chrome-extension://%@/manifest.json", ExtensionId()] profile:p foreground:YES];
    if (!tab) return completion(nil, @"closed");
    Pages()[profile] = tab;
  }
  NSString *code = [NSString stringWithFormat:
      @"Promise.resolve().then(() => (%@)).then("
       "(v) => post('result', JSON.stringify({value: v === undefined ? null : v})),"
       "(e) => post('result', JSON.stringify({error: String(e && e.message || e)})))", expression];
  // The page may still be loading: evaluate answers nil without a frame; try again a few times.
  __block int tries = 0;
  __block void (^attempt)(void);
  void (^run)(void) = ^{
    [tab evaluate:code
        completion:^(NSString *json) {
          if (!json && tries++ < 20 && !tab.closed) {
            void (^again)(void) = attempt;
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), again);
            return;
          }
          attempt = nil;
          NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
          NSDictionary *answer = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
          if (![answer isKindOfClass:NSDictionary.class]) return completion(nil, json ? @"bad answer" : @"closed");
          if ([answer[@"error"] isKindOfClass:NSString.class]) return completion(nil, answer[@"error"]);
          id value = answer[@"value"];
          completion(value == NSNull.null ? nil : value, nil);
        }];
  };
  attempt = run;
  run();
}

}  // namespace

namespace nncore_host {
void PrepareContentBlocker() {
  StartPreparing();
}

void LoadContentBlocker(NSString *profile) {
  if (!IsIncognito(profile)) LoadIntoProfile(profile ?: @"");
}
}  // namespace nncore_host

// MARK: - Public API

@implementation NNCoreContentBlocker

+ (void)state:(void (^)(NSDictionary<NSString *, id> *))completion {
  State(completion);
}

+ (void)setEnabled:(BOOL)enabled completion:(void (^)(void))completion {
  Send(@{@"what" : @"setDefaultFilteringMode", @"level" : @(enabled ? kModeOptimal : kModeNone)}, ^(id, NSString *) {
    Changed(completion);
  });
}

+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(void))completion {
  Send(@{@"what" : @"getEnabledRulesets"}, ^(id value, NSString *) {
    NSMutableOrderedSet *ids = [NSMutableOrderedSet orderedSetWithArray:[value isKindOfClass:NSArray.class] ? value : @[]];
    if (enabled) [ids addObject:listId];
    else [ids removeObject:listId];
    Send(@{@"what" : @"applyRulesets", @"enabledRulesets" : ids.array}, ^(id, NSString *) {
      Changed(completion);
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
// Sync each profile’s rules before the caller reloads its page.
    Send(@{@"what" : @"setFilteringMode", @"hostname" : host.lowercaseString, @"level" : @(level)}, ^(id, NSString *) {
      FollowDefault(nil, completion);
    });
  });
}

@end
