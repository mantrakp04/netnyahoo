#import "NNZoom.h"

#import "NNChromePages.h"
#import "NNClient.h"

using namespace nn;

namespace {

NSMutableDictionary<NSString *, NSMutableDictionary<NSString *, NSNumber *> *> *gPending;

void EmitAll(NSString *profile, NSString *host) {
  for (NNBrowserView *view in LiveViews()) {
    CefRefPtr<Client> client = view.client;
    if (client && [client->Profile() isEqualToString:profile] && [HostOf(client->URL()) isEqualToString:host])
      client->EmitZoom();
  }
}

}

namespace nn::zoom {

void Changed(NSString *profile, NSString *host) {
  dispatch_async(dispatch_get_main_queue(), ^{ EmitAll(profile, host); });
}

void Committed(Client *client) {
  NSString *host = HostOf(client->URL());
  NSNumber *factor = gPending[client->Profile()][host];
  if (factor && client->Browser()) {
    [gPending[client->Profile()] removeObjectForKey:host];
    client->Browser()->GetHost()->SetZoomLevel(fabs(factor.doubleValue - 1) < 0.001 ? 0 : LevelForFactor(factor.doubleValue));
    Changed(client->Profile(), host);
  }
  client->EmitZoom();
}

void InstallScrollMonitor() {
  static id monitor, touchMonitor;
  if (monitor) return;
  static double accumulated = 0;
  static NSUInteger touching = 0;
  static NSTimeInterval touchedAt = 0;
  static BOOL trackpadScroll = NO;
  touchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskGesture handler:^NSEvent *(NSEvent *event) {
    touching = [event touchesMatchingPhase:NSTouchPhaseTouching inView:nil].count;
    touchedAt = event.timestamp;
    return event;
  }];
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    if (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin))
      trackpadScroll = touching >= 2 && event.timestamp - touchedAt < 0.5;
    else if (event.phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone)
      trackpadScroll = NO;
    // Keep trackpad ⌘-scroll as scrolling; trackpads zoom by pinching.
    if (!(event.modifierFlags & NSEventModifierFlagCommand) || trackpadScroll) return event;
    NSWindow *window = event.window;
    NSPoint point = event.locationInWindow;
    if (!window) {
      NSPoint screen = event.locationInWindow;
      for (NSWindow *w in NSApp.orderedWindows)
        if (w.isVisible && !w.ignoresMouseEvents && NSPointInRect(screen, w.frame)) {
          window = w;
          break;
        }
      point = [window convertPointFromScreen:screen];
    }
    NSView *content = window.contentView;
    NSView *hit = [content hitTest:[content.superview convertPoint:point fromView:nil]];
    while (hit && ![hit isKindOfClass:NNBrowserView.class]) hit = hit.superview;
    NNBrowserView *view = (NNBrowserView *)hit;
    if (!view.browserId) return event;
    if (event.phase == NSEventPhaseBegan) accumulated = 0;
    accumulated += event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 30;
    if (fabs(accumulated) >= 30) {
      [view zoomStep:accumulated > 0 ? 1 : -1];
      accumulated = 0;
    }
    return nil;
  }];
}

}

// MARK: - Public API

@implementation NNZoom

+ (NSDictionary<NSString *, NSNumber *> *)zoomLevelsForProfile:(NSString *)profile {
  NSMutableDictionary *levels = [NSMutableDictionary dictionary];
  CefRefPtr<CefValue> pref = ContextForProfile(profile)->GetPreference("partition.per_host_zoom_levels");
  CefRefPtr<CefDictionaryValue> partitions = pref && pref->GetType() == VTYPE_DICTIONARY ? pref->GetDictionary() : nullptr;
  CefDictionaryValue::KeyList partitionKeys;
  if (partitions) partitions->GetKeys(partitionKeys);
  for (const CefString &partition : partitionKeys) {
    CefRefPtr<CefDictionaryValue> hosts = partitions->GetDictionary(partition);
    CefDictionaryValue::KeyList hostKeys;
    if (hosts) hosts->GetKeys(hostKeys);
    for (const CefString &host : hostKeys) {
      CefRefPtr<CefValue> entry = hosts->GetValue(host);
      double level = entry->GetType() == VTYPE_DICTIONARY ? entry->GetDictionary()->GetDouble("zoom_level") : entry->GetDouble();
      if (fabs(level) > 0.001) levels[ToNS(host)] = @(round(zoom::FactorForLevel(level) * 100) / 100);
    }
  }
  for (NSString *host in gPending[profile]) levels[host] = gPending[profile][host];
  return levels;
}

+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host {
  host = host.lowercaseString;
  if (!host.length || zoom <= 0) return;
  for (NNBrowserView *view in LiveViews()) {
    CefRefPtr<Client> client = view.client;
    if (client && [client->Profile() isEqualToString:profile] && [HostOf(client->URL()) isEqualToString:host]) {
      [view setZoomFactor:zoom];
      return;
    }
  }
  if (!gPending) gPending = [NSMutableDictionary dictionary];
  if (fabs(zoom - 1) < 0.001) {
    [gPending[profile] removeObjectForKey:host];
    pages::WebUIEval(profile, @"chrome://settings/", pages::Script(@"(chrome.send('removeZoomLevel', [%@]), true)", @[ host ]),
                     ^(id, NSString *) {});
    return;
  }
  if (!gPending[profile]) gPending[profile] = [NSMutableDictionary dictionary];
  gPending[profile][host] = @(zoom);
}

@end
