#import "NNZoom.h"

#import "NNChromePages.h"
#import "NNClient.h"

using namespace nn;

namespace {

// Levels set (by the settings UI) for hosts no tab showed: {profile: {host: factor}}.
NSMutableDictionary<NSString *, NSMutableDictionary<NSString *, NSNumber *> *> *gPending;

void EmitAll(NSString *profile, NSString *host) {
  for (NNBrowserView *view in LiveViews()) {
    CefRefPtr<Client> client = view.client;
    if (client && [client->Profile() isEqualToString:profile] && [HostOf(client->URL()) isEqualToString:host])
      client->EmitZoom();
  }
}

}  // namespace

namespace nn::zoom {

void Changed(NSString *profile, NSString *host) {
  // SetZoomLevel/Zoom run on the UI thread right away; HostZoomMap has updated
  // the other tabs on the host by the next turn of the loop.
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
  // Fingers on a trackpad or Magic Mouse right now, and when that was last reported.
  static NSUInteger touching = 0;
  static NSTimeInterval touchedAt = 0;
  // The scroll in progress (its fingers and its momentum) comes from a trackpad.
  static BOOL trackpadScroll = NO;
  // Scroll events look the same from a trackpad and a Magic Mouse; the touches don't: a trackpad
  // scrolls with two fingers, a Magic Mouse with one (and a wheel mouse has none).
  touchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskGesture handler:^NSEvent *(NSEvent *event) {
    touching = [event touchesMatchingPhase:NSTouchPhaseTouching inView:nil].count;
    touchedAt = event.timestamp;
    return event;
  }];
  // ⌘-scroll over a page zooms it with a mouse (a Magic Mouse accumulates a few points per
  // step). With a trackpad it's an ordinary scroll: resting a thumb on ⌘ while scrolling with
  // two fingers zoomed pages by accident, and a trackpad pinches to zoom.
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    if (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin))
      trackpadScroll = touching >= 2 && event.timestamp - touchedAt < 0.5;
    else if (event.phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone)
      trackpadScroll = NO;  // a wheel mouse's notch
    if (!(event.modifierFlags & NSEventModifierFlagCommand) || trackpadScroll) return event;
    NSWindow *window = event.window;
    NSPoint point = event.locationInWindow;
    if (!window) {  // no window: locationInWindow is in screen coordinates
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

}  // namespace nn::zoom

// MARK: - Public API

@implementation NNZoom

/// Chrome's saved levels: the "partition.per_host_zoom_levels" pref,
/// {partition: {host: {zoom_level, last_modified}}}.
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
      // Current format: {zoom_level: …}; older profiles store the level itself.
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
  // Through a tab showing the host, which updates the others and Chrome's saved level.
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
    // Chrome's settings page removes a saved level without a tab.
    pages::WebUIEval(profile, @"chrome://settings/", pages::Script(@"(chrome.send('removeZoomLevel', [%@]), true)", @[ host ]),
                     ^(id, NSString *) {});
    return;
  }
  // Otherwise it applies when a tab next shows the host.
  if (!gPending[profile]) gPending[profile] = [NSMutableDictionary dictionary];
  gPending[profile][host] = @(zoom);
}

@end
