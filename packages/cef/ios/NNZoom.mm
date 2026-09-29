#import "NNZoom.h"

#import "NNChromePages.h"
#import "NNClient.h"

#import <IOKit/IOKitLib.h>
#import <dlfcn.h>

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

// Set by devScroll: the device a synthetic scroll claims to come from, and the ⌘-scrolls that zoomed.
int gDevTrackpad = -1;
NSUInteger gZoomScrolls = 0;

// Scroll events look the same from a trackpad and a Magic Mouse; the HID service that sent one
// doesn't. Built-in trackpads and Magic Trackpads are AppleMultitouchTrackpadHIDEventDriver, a
// Magic Mouse is AppleMultitouchMouseHIDEventDriver. Momentum events have no sender.
BOOL FromTrackpad(NSEvent *event) {
  if (gDevTrackpad >= 0) return gDevTrackpad;
  static auto copyHIDEvent = (CFTypeRef (*)(CGEventRef))dlsym(RTLD_DEFAULT, "CGEventCopyIOHIDEvent");
  static auto senderOf = (uint64_t (*)(CFTypeRef))dlsym(RTLD_DEFAULT, "IOHIDEventGetSenderID");
  CGEventRef cg = event.CGEvent;
  CFTypeRef hid = copyHIDEvent && senderOf && cg ? copyHIDEvent(cg) : nullptr;
  if (!hid) return NO;
  uint64_t sender = senderOf(hid);
  CFRelease(hid);
  if (!sender) return NO;
  static NSMutableDictionary<NSNumber *, NSNumber *> *trackpads = [NSMutableDictionary dictionary];
  if (NSNumber *known = trackpads[@(sender)]) return known.boolValue;
  BOOL trackpad = NO;
  io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IORegistryEntryIDMatching(sender));
  if (service) {
    io_name_t name;
    trackpad = IOObjectGetClass(service, name) == KERN_SUCCESS && strstr(name, "Trackpad");
    IOObjectRelease(service);
  }
  trackpads[@(sender)] = @(trackpad);
  return trackpad;
}

zoom::ScrollGesture gScroll;

zoom::ScrollStep ScrollStepOf(NSEvent *event, BOOL trackpad) {
  return {.phase = event.phase, .momentumPhase = event.momentumPhase, .command = !!(event.modifierFlags & NSEventModifierFlagCommand),
          .trackpad = trackpad};
}

}

namespace nn::zoom {

bool CommandScrollZooms(ScrollGesture &gesture, ScrollStep step) {
  if (step.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) gesture.trackpad = step.trackpad;
  else if (step.phase == NSEventPhaseNone && step.momentumPhase == NSEventPhaseNone) gesture.trackpad = false;
  else gesture.trackpad = gesture.trackpad || step.trackpad;
  // A trackpad pinches to zoom; ⌘ with two fingers is a thumb resting on the key while scrolling.
  return step.command && !gesture.trackpad;
}

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
  touchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskGesture handler:^NSEvent *(NSEvent *event) {
    touching = [event touchesMatchingPhase:NSTouchPhaseTouching inView:nil].count;
    touchedAt = event.timestamp;
    return event;
  }];
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    // Two fingers down is a trackpad too (a Magic Mouse scrolls with one), when AppKit reports touches.
    BOOL fingers = (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) && touching >= 2 && event.timestamp - touchedAt < 0.5;
    BOOL trackpad = event.phase != NSEventPhaseNone && (fingers || FromTrackpad(event));
    if (!CommandScrollZooms(gScroll, ScrollStepOf(event, trackpad))) return event;
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
    gZoomScrolls++;
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

// DEV: sends ⌘-scroll events over the middle of the visible page through the app's event dispatch.
// Each step is {phase: "wheel" | "mayBegin" | "began" | "changed" | "ended" | "momentum", dy, trackpad};
// the result says, per step, whether the scroll zoomed the page instead of scrolling it.
+ (NSArray<NSNumber *> *)devScroll:(NSArray<NSDictionary<NSString *, id> *> *)steps {
  NNBrowserView *view = nil;
  for (NNBrowserView *v in LiveViews())
    if (v.window.isVisible && !v.isHiddenOrHasHiddenAncestor && v.browserId) view = v;
  if (!view) return @[];
  NSWindow *window = view.window;
  NSPoint inWindow = [view convertPoint:NSMakePoint(NSMidX(view.bounds), NSMidY(view.bounds)) toView:nil];
  NSPoint screen = [window convertPointToScreen:inWindow];
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSMutableArray *zoomed = [NSMutableArray array];
  for (NSDictionary *step in steps) {
    NSString *phase = step[@"phase"];
    BOOL wheel = [phase isEqualToString:@"wheel"];
    int32_t dy = (int32_t)[step[@"dy"] intValue];
    CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 1, dy, 0, 0);
    CGEventSetFlags(cg, kCGEventFlagMaskCommand);
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, !wheel);
    if (!wheel) CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, dy);
    if ([phase isEqualToString:@"momentum"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, kCGMomentumScrollPhaseContinue);
    else if (!wheel)
      CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase,
                                  [phase isEqualToString:@"mayBegin"] ? kCGScrollPhaseMayBegin
                                  : [phase isEqualToString:@"began"]  ? kCGScrollPhaseBegan
                                  : [phase isEqualToString:@"ended"]  ? kCGScrollPhaseEnded
                                                                      : kCGScrollPhaseChanged);
    CGEventSetLocation(cg, CGPointMake(screen.x, NSHeight(NSScreen.screens.firstObject.frame) - screen.y));
    CGEventSetIntegerValueField(cg, (CGEventField)51, window.windowNumber);
    if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(window.frame) - inWindow.y));
    NSEvent *event = [NSEvent eventWithCGEvent:cg];
    CFRelease(cg);
    gDevTrackpad = [step[@"trackpad"] boolValue];
    NSUInteger before = gZoomScrolls;
    [NSApp sendEvent:event];
    gDevTrackpad = -1;
    [zoomed addObject:@(gZoomScrolls > before)];
  }
  return zoomed;
}

@end
