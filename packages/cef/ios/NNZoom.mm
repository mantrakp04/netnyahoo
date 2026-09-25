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
  static id monitor;
  if (monitor) return;
  static double accumulated = 0;
  // ⌘-scroll over a page zooms it (trackpads accumulate a few points per step).
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    if (!(event.modifierFlags & NSEventModifierFlagCommand)) return event;
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

+ (double)zoomForProfile:(NSString *)profile host:(NSString *)host {
  NSNumber *factor = [self zoomLevelsForProfile:profile][host.lowercaseString];
  return factor ? factor.doubleValue : 1;
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
