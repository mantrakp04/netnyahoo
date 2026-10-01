// Chrome's tab strips as revisioned transactions (packages/cef/src/tabStrip.ts, docs/store-api.md › "Live tabs"):
// on NNCore a strip is one profile's Browser in one NNCoreWindow. Chrome commits; the app sends commands with ids;
// every change goes out as one transaction naming its cause: the command's id, -1 for the app's own engine calls
// (a WebView opening, adopting or closing its tab), null for Chrome's own (an extension, the tab Chrome shows after
// the active one closes).
#import "NNCoreTabStrip.h"

#import "NNCoreInternal.h"
#import "NNCoreWebView.h"

namespace {

void (^gHandler)(NSDictionary *);
int64_t gRev = 0;
// The command being run (its changes carry its id).
NSNumber *gCommand;

NSMapTable<NNCoreTab *, NSNumber *> *Pinned() {
  static NSMapTable *pinned = [NSMapTable weakToStrongObjectsMapTable];
  return pinned;
}

NSMapTable<NNCoreProfile *, NNCoreTab *> *ActiveTabs(NNCoreWindowController *controller) {
  static NSMapTable *byWindow = [NSMapTable weakToStrongObjectsMapTable];
  NSMapTable *active = [byWindow objectForKey:controller];
  if (!active) {
    active = [NSMapTable weakToWeakObjectsMapTable];
    [byWindow setObject:active forKey:controller];
  }
  return active;
}

NSDictionary *Strip(NNCoreWindowController *controller, NNCoreProfile *profile) {
  NNCoreWindow *window = controller.coreWindow;
  NSMutableArray *tabs = [NSMutableArray array];
  NSArray<NNCoreTab *> *live = [window tabsForProfile:profile];
  NNCoreTab *active = [ActiveTabs(controller) objectForKey:profile];
  for (NSUInteger i = 0; i < live.count; i++) {
    NNCoreTab *tab = live[i];
    NSString *key = [NNCoreTabs viewForTab:tab].transferKey;
    [tabs addObject:@{
      @"key" : key.length ? key : NSNull.null,
      @"browser" : @(nncore_host::BrowserId(tab)),
      @"index" : @(i),
      @"active" : @(tab == active || (!active && i == 0)),
      @"pinned" : @([[Pinned() objectForKey:tab] boolValue]),
    }];
  }
  return @{
    @"strip" : @([window chromeWindowIdForProfile:profile]),
    @"profile" : nncore_host::ProfileName(profile),
    @"tabs" : tabs,
  };
}

NSArray<NNCoreProfile *> *ProfilesWithTabs(NNCoreWindowController *controller) {
  NSMutableArray *profiles = [NSMutableArray array];
  // Every profile the app has loaded that has a Browser in this window.
  for (NNCoreProfile *profile in nncore_host::LoadedProfiles())
    if ([controller.coreWindow chromeWindowIdForProfile:profile] >= 0) [profiles addObject:profile];
  return profiles;
}

}  // namespace

@implementation NNCoreTabStrip

+ (void)setHandler:(void (^)(NSDictionary<NSString *, id> *))handler {
  gHandler = [handler copy];
}

+ (void)changedInWindow:(NNCoreWindowController *)controller profile:(NNCoreProfile *)profile {
  if (!gHandler || !controller || !profile) return;
  id cause = gCommand ?: (controller.hostChanges > 0 ? @(-1) : NSNull.null);
  gHandler(@{@"rev" : @(++gRev), @"cmd" : cause, @"strips" : @[ Strip(controller, profile) ]});
}

+ (void)activated:(NNCoreTab *)tab inWindow:(NNCoreWindowController *)controller {
  NNCoreProfile *profile = tab.profile;
  if (profile) [ActiveTabs(controller) setObject:tab forKey:profile];
}

+ (void)setPinned:(BOOL)pinned tab:(NNCoreTab *)tab {
  [Pinned() setObject:@(pinned) forKey:tab];
}

+ (NSDictionary<NSString *, id> *)allStrips {
  NSMutableArray *strips = [NSMutableArray array];
  for (NNCoreWindowController *controller in NNCoreWindowController.all)
    for (NNCoreProfile *profile in ProfilesWithTabs(controller)) [strips addObject:Strip(controller, profile)];
  return @{@"rev" : @(gRev), @"cmd" : NSNull.null, @"strips" : strips};
}

+ (void)command:(NSInteger)commandId command:(NSDictionary<NSString *, id> *)command {
  NSString *op = command[@"op"];
  const int stripId = [command[@"strip"] intValue];
  NNCoreWindowController *found = nil;
  NNCoreProfile *profile = nil;
  for (NNCoreWindowController *controller in NNCoreWindowController.all)
    for (NNCoreProfile *p in ProfilesWithTabs(controller))
      if ([controller.coreWindow chromeWindowIdForProfile:p] == stripId) found = controller, profile = p;
  NSMutableDictionary<NSString *, NNCoreTab *> *byKey = [NSMutableDictionary dictionary];
  for (NNCoreTab *tab in found ? [found.coreWindow tabsForProfile:profile] : @[]) {
    NSString *key = [NNCoreTabs viewForTab:tab].transferKey;
    if (key.length) byKey[key] = tab;
  }
  BOOL rejected = !found;
  gCommand = @(commandId);
  if (found && [op isEqualToString:@"activate"]) {
    NNCoreTab *tab = byKey[command[@"key"]];
    if (tab) {
      [found.coreWindow activateTab:tab];
      [self activated:tab inWindow:found];
    } else {
      rejected = YES;
    }
  } else if (found && [op isEqualToString:@"arrange"]) {
    NSArray<NSString *> *keys = [command[@"keys"] isKindOfClass:NSArray.class] ? command[@"keys"] : @[];
    const NSInteger pinned = [command[@"pinned"] integerValue];
    int index = 0;
    for (NSUInteger i = 0; i < keys.count; i++) {
      NNCoreTab *tab = byKey[keys[i]];
      if (!tab) continue;
      [self setPinned:(NSInteger)i < pinned tab:tab];
      if ([found.coreWindow respondsToSelector:@selector(placeTab:index:pinned:)])
        [found.coreWindow placeTab:tab index:index pinned:(NSInteger)i < pinned];
      index++;
    }
  }
  gCommand = nil;
  NSMutableDictionary *tx = [@{@"rev" : @(++gRev), @"cmd" : @(commandId), @"strips" : found ? @[ Strip(found, profile) ] : @[]} mutableCopy];
  if (rejected) tx[@"rejected"] = @YES;
  if (gHandler) gHandler(tx);
}

@end
