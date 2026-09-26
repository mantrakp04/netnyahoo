#import "NNContentBlocker.h"

#import "NNChromePages.h"

#import <CommonCrypto/CommonDigest.h>
#include <sys/clonefile.h>
#include <sys/stat.h>

using namespace nn;

namespace {

// uBOL filtering modes (js/mode-manager.js).
constexpr int kModeNone = 0;
constexpr int kModeOptimal = 2;

/// Settings live in the default profile's copy. Every other profile has its own, with its own
/// rules, storage and service worker: it follows the default's (Follow).
NSString *const kProfile = @"";

/// The profiles uBOL is loaded into (LoadIntoProfile).
NSMutableOrderedSet<NSString *> *LoadedProfiles() {
  static NSMutableOrderedSet<NSString *> *profiles = [NSMutableOrderedSet orderedSet];
  return profiles;
}

/// When uBOL last answered us in each profile, since it was last loaded there.
NSMutableDictionary<NSString *, NSDate *> *LastAnswers() {
  static NSMutableDictionary<NSString *, NSDate *> *answers = [NSMutableDictionary dictionary];
  return answers;
}
/// Lately: our page of it closes after 30 s idle (as its worker stops), and a new page is as new.
bool Answering(NSString *profile) { return LastAnswers()[profile] && LastAnswers()[profile].timeIntervalSinceNow > -20; }

/// Our page of the extension outlives a reload of the extension (a profile's first run loads it
/// twice; uBOL restarts itself after a bad start), and its chrome.runtime is then dead ("Extension
/// context invalidated"): every message would fail until the page idles out. The next gets a new page.
bool PageDead(NSString *error) { return [error containsString:@"context invalidated"] || [error isEqualToString:@"closed"]; }
void Reopen(NSString *profile) {
  [LastAnswers() removeObjectForKey:profile];
  pages::CloseExtensionContext(profile, blocker::ExtensionId());
}

/// A message sent while uBOL is starting in a profile (just loaded there) can go unanswered for
/// good, and so can the first thing evaluated in our page of it as it finishes loading: the settings
/// change it carried was lost after a 30 s wait. Until uBOL there has answered lately, ask it
/// something harmless, a second at a time, until it does (for 15 s or so: then the real message goes anyway).
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
  pages::ExtensionEval(profile, blocker::ExtensionId(), js, ^(id answered, NSString *error) {
    if (PageDead(error)) Reopen(profile);
    next([answered isEqual:@YES]);
  });
  // The page itself may never answer (above).
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ next(false); });
}

/// Sends `message` to uBOL's service worker in `profile`, from its own context like its settings page.
void Send(NSString *profile, NSDictionary *message, void (^completion)(id value, NSString *error), bool retried = false) {
  if (![NNCef isStarted]) return completion(nil, @"unavailable");
  completion = [completion copy];
  if (![LoadedProfiles() containsObject:profile]) {
    // Not loaded there yet (no window of that profile so far): loading it is part of getting it ready.
    return pages::WhenProfileReady(profile, ^(CefRefPtr<CefRequestContext>) {
      if ([LoadedProfiles() containsObject:profile]) Send(profile, message, completion, retried);
      else completion(nil, @"not loaded");
    });
  }
  WhenAnswering(profile, ^{
    NSString *js = pages::Script(@"chrome.runtime.sendMessage(%@)", @[ message ]);
    pages::ExtensionEval(profile, blocker::ExtensionId(), js, ^(id value, NSString *error) {
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

/// uBOL's filtering modes with each list sorted: two profiles with the same sites compare equal.
NSDictionary *SortedModes(id modes) {
  if (![modes isKindOfClass:NSDictionary.class]) return nil;
  NSMutableDictionary *sorted = [NSMutableDictionary dictionary];
  for (NSString *key in modes) {
    id hosts = modes[key];
    sorted[key] = [hosts isKindOfClass:NSArray.class] ? [hosts sortedArrayUsingSelector:@selector(compare:)] : hosts;
  }
  return sorted;
}

/// Gives `profile`'s uBOL the default profile's filtering modes (on/off, the sites allowed ads)
/// and lists, where they differ.
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

/// Brings `profiles` (every loaded one but the default when nil) in line with the default profile.
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

/// After a settings change in the default profile: the other profiles follow, then listeners hear.
void Changed(void (^completion)(void)) {
  completion = [completion copy];
  FollowDefault(nil, ^{
    State(^(NSDictionary *state) { EmitGlobal(@"contentBlocker", state[@"stats"]); });
    completion();
  });
}

/// Identifies the bundled extension's contents: its manifest (version and key), file count and size.
NSString *Fingerprint(NSString *dir) {
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
    // A bundle Chrome wrote into before (Netnyahoo 0.1.0) also has _metadata: not part of the extension.
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

/// Chrome writes into the folder of an extension it loads: declarativeNetRequest indexes the
/// static rulesets into <extension>/_metadata/generated_indexed_rulesets the first time a profile
/// loads it, and again whenever an index goes stale (a new Chrome ruleset format, say). Written
/// into the app bundle, that breaks its code signature, and a read-only or translocated app can't
/// be written at all. So Chrome loads a copy in the data directory (an APFS clone, next to the
/// Chromium folder), made again whenever the bundled extension changes; its indexes persist there.
NSString *WritableCopy(NSString *bundled) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *dir = [[DataRoot() stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Built-in Extensions"];
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
  // Leftovers of an interrupted copy.
  for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil])
    if ([name hasPrefix:@".ublock-lite"]) [fm removeItemAtPath:[dir stringByAppendingPathComponent:name] error:nil];
  NSString *staging = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@".ublock-lite-%d", getpid()]];
  // Not on APFS, or across volumes: a real copy.
  bool cloned = clonefile(bundled.fileSystemRepresentation, staging.fileSystemRepresentation, 0) == 0;
  if (!cloned) [fm removeItemAtPath:staging error:nil];
  if (!cloned && ![fm copyItemAtPath:bundled toPath:staging error:&error]) {
    NSLog(@"[blocker] copying %@: %@", bundled, error);
    [fm removeItemAtPath:staging error:nil];
    return nil;
  }
  // A read-only bundle makes a read-only copy: Chrome must be able to write its indexes, and a
  // later update to replace the copy.
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

}  // namespace

namespace nn::blocker {

NSString *ExtensionPath() {
  static NSString *path;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"Extensions/ublock-lite"];
    if ([NSFileManager.defaultManager fileExistsAtPath:[bundled stringByAppendingPathComponent:@"manifest.json"]])
      path = WritableCopy(bundled);
  });
  return path;
}

NSString *ExtensionId() { return @"bnjeokpoejhioagiokhkhmdogkhbnbki"; }

void LoadIntoProfile(NSString *profile, CefRefPtr<CefRequestContext> context) {
#if NN_CHROME_TABS
  NSString *path = ExtensionPath();
  if (!path || !context) return;
  NSString *loaded = ToNS(context->LoadComponentExtension(ToCef(path)));
  if (![loaded isEqualToString:ExtensionId()]) return (void)NSLog(@"[blocker] component load failed (%@)", loaded);
  [LoadedProfiles() addObject:profile];
  [LastAnswers() removeObjectForKey:profile];
  if (profile.length) FollowDefault(@[ profile ], ^{});
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
    // Every profile's copy has its rules before the caller reloads the page, whichever profile it's in.
    Send(@{@"what" : @"setFilteringMode", @"hostname" : host.lowercaseString, @"level" : @(level)}, ^(id, NSString *) {
      FollowDefault(nil, completion);
    });
  });
}

@end
