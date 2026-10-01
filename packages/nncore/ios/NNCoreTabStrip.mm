// Chrome's tab strips as revisioned transactions (packages/cef/src/tabStrip.ts, docs/store-api.md › "Live tabs"):
// on NNCore a strip is one profile's Browser in one NNCoreWindow. Chrome commits; the app sends commands with ids;
// every change goes out as one transaction naming its cause: the command's id, -1 for the app's own engine calls
// (a WebView opening, adopting or closing its tab), null for Chrome's own (an extension, the tab Chrome shows after
// the active one closes).
#import "NNCoreTabStrip.h"

#import "NNCoreInternal.h"
#import "NNCoreWebView.h"
#import "NNCoreEngineBridge.h"
#import "NNCoreServices.h"

namespace {

void (^gHandler)(NSDictionary *);
int64_t gRev = 0;
// The JS sends tab-strip commands: only they (and Chrome) change the active tab, not a view becoming visible.
bool gCommandsSeen = false;

// The strips each window has reported, to send them once more as closed when the window goes.
NSMapTable<NNCoreWindowController *, NSMutableDictionary<NSNumber *, NSString *> *> *KnownStrips() {
  static NSMapTable *known = [NSMapTable weakToStrongObjectsMapTable];
  return known;
}

void Remember(NNCoreWindowController *controller, int strip, NSString *profile) {
  if (strip < 0) return;
  NSMutableDictionary *strips = [KnownStrips() objectForKey:controller];
  if (!strips) {
    strips = [NSMutableDictionary dictionary];
    [KnownStrips() setObject:strips forKey:controller];
  }
  strips[@(strip)] = profile;
}
// The command being run (its changes carry its id).
NSNumber *gCommand;

// Chrome's tab groups as //chrome/browser/netnyahoo's nn_tabs reports them ("tabs.strip"), by the Browser's session id
// (= the strip id): {groups: [...], tabs: {chrome tab id: group token or NSNull}}.
NSMutableDictionary<NSNumber *, NSDictionary *> *Groups() {
  static NSMutableDictionary *groups = [NSMutableDictionary dictionary];
  return groups;
}

bool ReportsGroups() {
  static bool reports = [NNCoreEngineBridge exports:@"nn_tabs_watch"];
  return reports;
}

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

// The app's id for the window (the windowId its React root was made with).
NSString *AppWindowOf(NNCoreWindowController *controller) {
  NSMutableArray<NSView *> *views = [NSMutableArray array];
  if (controller.root) [views addObject:controller.root];
  for (NSUInteger i = 0; i < views.count && i < 16; i++) {
    NSView *view = views[i];
    if ([view respondsToSelector:NSSelectorFromString(@"appProperties")]) {
      id properties = [view valueForKey:@"appProperties"];
      id windowId = [properties isKindOfClass:NSDictionary.class] ? properties[@"windowId"] : nil;
      if ([windowId isKindOfClass:NSString.class]) return windowId;
    }
    [views addObjectsFromArray:view.subviews];
  }
  return nil;
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
    if (ReportsGroups()) {
      NSMutableDictionary *last = [tabs.lastObject mutableCopy];
      id group = Groups()[@([window chromeWindowIdForProfile:profile])][@"tabs"][@(tab.tabId)];
      last[@"group"] = group ?: NSNull.null;
      tabs[tabs.count - 1] = last;
    }
  }
  const int strip = [window chromeWindowIdForProfile:profile];
  NSString *name = nncore_host::ProfileName(profile);
  Remember(controller, strip, name);
  NSMutableDictionary *state = [@{
    @"strip" : @(strip),
    @"window" : @(window.window.windowNumber),
    @"profile" : name,
    @"tabs" : tabs,
  } mutableCopy];
  if (ReportsGroups()) {
    state[@"groups"] = Groups()[@(strip)][@"groups"] ?: @[];
    if ([Groups()[@(strip)][@"activePickedOnClose"] boolValue]) state[@"activePickedOnClose"] = @YES;
  }
  if (NSString *appWindow = AppWindowOf(controller)) state[@"appWindow"] = appWindow;
  return state;
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
  static bool watching = false;
  if (watching || !ReportsGroups()) return;
  watching = true;
  [NNCoreEngineBridge observe:@"tabs.strip"
                      handler:^(NSDictionary *strip) {
                        NSNumber *window = [strip[@"window"] isKindOfClass:NSNumber.class] ? strip[@"window"] : nil;
                        if (!window) return;
                        if ([strip[@"closed"] boolValue]) return (void)[Groups() removeObjectForKey:window];
                        NSMutableDictionary *byTab = [NSMutableDictionary dictionary];
                        for (NSDictionary *tab in strip[@"tabs"])
                          if ([tab isKindOfClass:NSDictionary.class] && tab[@"tab"]) byTab[tab[@"tab"]] = tab[@"group"] ?: NSNull.null;
                        NSDictionary *before = Groups()[window];
                        NSDictionary *now = @{
                          @"groups" : strip[@"groups"] ?: @[],
                          @"tabs" : byTab,
                          @"activePickedOnClose" : @([strip[@"activePickedOnClose"] boolValue]),
                        };
                        Groups()[window] = now;
                        if ([before isEqualToDictionary:now] || gCommand) return;
                        // A group change Chrome made (an extension's tabs.group): the strip again, as Chrome's report.
                        for (NNCoreWindowController *c in NNCoreWindowController.all)
                          for (NNCoreProfile *p in nncore_host::LoadedProfiles())
                            if ([c.coreWindow chromeWindowIdForProfile:p] == window.intValue)
                              [NNCoreTabStrip changedInWindow:c profile:p cause:c.hostChanges > 0 ? @(-1) : NSNull.null];
                      }];
  [NNCoreServices call:@"nn_tabs_watch" profile:@"" args:nil completion:^(NSDictionary *) {}];
}

+ (void)changedInWindow:(NNCoreWindowController *)controller profile:(NNCoreProfile *)profile {
  [self changedInWindow:controller profile:profile cause:nil];
}

+ (void)changedInWindow:(NNCoreWindowController *)controller profile:(NNCoreProfile *)profile cause:(id)cause {
  if (!gHandler || !controller || !profile || controller.standalone) return;
  cause = cause ?: (gCommand ?: (controller.hostChanges > 0 ? @(-1) : NSNull.null));
  gHandler(@{@"rev" : @(++gRev), @"cmd" : cause, @"strips" : @[ Strip(controller, profile) ]});
}

+ (void)windowClosed:(NNCoreWindowController *)controller {
  NSDictionary<NSNumber *, NSString *> *strips = [KnownStrips() objectForKey:controller];
  [KnownStrips() removeObjectForKey:controller];
  if (!gHandler || !strips.count) return;
  NSMutableArray *closed = [NSMutableArray array];
  const NSInteger window = controller.coreWindow.window.windowNumber;
  for (NSNumber *strip in strips)
    [closed addObject:@{@"strip" : strip, @"window" : @(window), @"profile" : strips[strip], @"tabs" : @[], @"closed" : @YES}];
  gHandler(@{@"rev" : @(++gRev), @"cmd" : NSNull.null, @"strips" : closed});
}

+ (BOOL)commandsSeen {
  return gCommandsSeen;
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
    if (!controller.standalone)
      for (NNCoreProfile *profile in ProfilesWithTabs(controller)) [strips addObject:Strip(controller, profile)];
  return @{@"rev" : @(gRev), @"cmd" : NSNull.null, @"strips" : strips};
}

+ (void)command:(NSInteger)commandId command:(NSDictionary<NSString *, id> *)command {
  gCommandsSeen = true;
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
    rejected = keys.count > 0;
    for (NSString *key in keys)
      if (byKey[key]) rejected = NO;
    for (NSUInteger i = 0; i < keys.count; i++) {
      NNCoreTab *tab = byKey[keys[i]];
      if (!tab) continue;
      [self setPinned:(NSInteger)i < pinned tab:tab];
      if ([found.coreWindow respondsToSelector:@selector(placeTab:index:pinned:)])
        [found.coreWindow placeTab:tab index:index pinned:(NSInteger)i < pinned];
      index++;
    }
  }
  if (found && [op isEqualToString:@"group"]) {
    NSMutableArray *ids = [NSMutableArray array];
    for (NSString *key in [command[@"keys"] isKindOfClass:NSArray.class] ? command[@"keys"] : @[])
      if (NNCoreTab *tab = byKey[key]) [ids addObject:@(tab.tabId)];
    if (!ids.count) rejected = YES;
    else {
      // nn_tabs_group replies once Chrome grouped them; the command's one transaction carries the result.
      NSMutableDictionary *args = [@{@"window" : @(stripId), @"tabs" : ids} mutableCopy];
      id group = command[@"group"];
      args[@"group"] = [group isKindOfClass:NSString.class] ? group : @"";
      for (NSString *key in @[ @"title", @"color" ])
        if ([command[key] isKindOfClass:NSString.class]) args[key] = command[key];
      // Collapse mirrors both ways (bffaa2de). NNCore's Browsers have no views tab strip, so collapsing never
      // moves the active tab (only BrowserTabStripController did that).
      if ([command[@"collapsed"] isKindOfClass:NSNumber.class]) args[@"collapsed"] = command[@"collapsed"];
      gCommand = nil;
      NNCoreWindowController *controller = found;
      NNCoreProfile *p = profile;
      [NNCoreServices call:@"nn_tabs_group" profile:nncore_host::ProfileName(profile) args:args completion:^(NSDictionary *result) {
        NSMutableDictionary *tx = [@{@"rev" : @(++gRev), @"cmd" : @(commandId), @"strips" : @[ Strip(controller, p) ]} mutableCopy];
        if (result[@"error"]) tx[@"rejected"] = @YES;
        if (gHandler) gHandler(tx);
      }];
      return;
    }
  }
  gCommand = nil;
  NSMutableDictionary *tx = [@{@"rev" : @(++gRev), @"cmd" : @(commandId), @"strips" : found ? @[ Strip(found, profile) ] : @[]} mutableCopy];
  // None of its keys were in its strip: nothing was done.
  if (rejected) tx[@"rejected"] = @YES;
  if (gHandler) gHandler(tx);
}

@end
