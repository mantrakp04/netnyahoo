#import "NNSwipe.h"

#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

// Two-finger swipe back/forward, modelled on Chrome's HistorySwiper and Dia's
// WebContentGesturalNavigationEventDriver: an app-wide scroll-wheel monitor sees every
// trackpad gesture before the view under the pointer does. A gesture over a registered
// target stays with the content until it's clear the content won't use it; from then on
// the monitor swallows it and reports it to the target, which draws the overlay and
// navigates. Web pages decide through their RenderWidgetHostViewCocoa's responder
// delegate (the renderer acks each scroll); native content (New Tab page, internal pages,
// the sidebar) through the NSScrollViews under the pointer.

namespace {

// Dia's native-page driver (GesturalNavigationEventInterceptorView): a swipe starts once
// |ΣdX| ≥ 4 pt with 1.5·|ΣdX| ≥ |ΣdY|, and vertical motion (2·|ΣdX| < |ΣdY|) cancels it
// unless the target lets the gesture move vertically (its destination list is open).
constexpr CGFloat kStartDistance = 4;
constexpr CGFloat kStartDominance = 1.5;
constexpr CGFloat kCancelDominance = 2;

// Chromium 154 layouts, verified against live renderer acks (DEV trace in simulateInWindow):
// blink::WebGestureEvent keeps its WebInputEvent::Type at byte 40 (kGestureScrollBegin 11,
// kGestureScrollUpdate 13); ui::DidOverscrollParams has three gfx::Vector2dF and a
// gfx::PointF, then cc::OverscrollBehavior {Type x, y} with Type { kNone, kAuto, kContain }.
constexpr size_t kInputEventTypeOffset = 40;
constexpr int kGestureScrollBegin = 11;
constexpr int kGestureScrollUpdate = 13;
constexpr size_t kOverscrollBehaviorOffset = 32;
constexpr int kOverscrollBehaviorAuto = 1;

enum class RendererScroll { Idle, AwaitingBegin, AwaitingFirstUpdate, FirstUpdateUnconsumed, FirstUpdateConsumed };
enum class State { Idle, Pending, Tracking, Ignored };

NSMutableArray *gTrace;  // DEV: renderer acks while simulating

}  // namespace

/// RenderWidgetHostViewCocoa's responder delegate (content's RenderWidgetHostViewMacDelegate
/// protocol), in front of the one the page view had. On Chrome tabs that's Chrome's
/// ChromeRenderWidgetHostViewMacDelegate: spelling and speech menu items, dialog focus,
/// mouse acceptance, and its HistorySwiper. Everything goes on to it except the scroll events
/// its history swiper would act on: this file is the swiper (Dia's overlay), and two would
/// navigate twice. Alloy views have none. Chromium passes C++ references, which are pointers at
/// the ABI level.
@interface NNRendererScrollObserver : NSObject
- (instancetype)initWithOriginal:(nullable NSObject *)original;
@property (nonatomic) RendererScroll scroll;
/// The renderer reported an overscroll this gesture; `overscrollAllowed`: its
/// overscroll-behavior-x is auto (none/contain opt the page out of swipe navigation).
@property (nonatomic) BOOL overscrolled;
@property (nonatomic) BOOL overscrollAllowed;
@end

@implementation NNRendererScrollObserver {
 @public
  /// The page view's own delegate (the view held the only strong reference to it).
  NSObject *_original;
}

- (instancetype)initWithOriginal:(NSObject *)original {
  if ((self = [super init])) _original = original;
  return self;
}

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || [_original respondsToSelector:selector];
}

- (id)forwardingTargetForSelector:(SEL)selector {
  return [_original respondsToSelector:selector] ? _original : [super forwardingTargetForSelector:selector];
}

- (void)reset {
  _scroll = RendererScroll::AwaitingBegin;
  _overscrolled = NO;
  _overscrollAllowed = NO;
}

- (void)rendererHandledGestureScrollEvent:(const void *)event consumed:(BOOL)consumed {
  if ([_original respondsToSelector:_cmd])
    ((void (*)(id, SEL, const void *, BOOL))objc_msgSend)(_original, _cmd, event, consumed);
  int type = *reinterpret_cast<const int32_t *>(static_cast<const char *>(event) + kInputEventTypeOffset);
  if (gTrace) [gTrace addObject:@{@"ack" : @"gesture", @"raw" : [self words:event count:12], @"consumed" : @(consumed)}];
  if (type == kGestureScrollBegin) {
    if (_scroll == RendererScroll::AwaitingBegin) _scroll = RendererScroll::AwaitingFirstUpdate;
  } else if (type == kGestureScrollUpdate) {
    if (_scroll == RendererScroll::AwaitingFirstUpdate)
      _scroll = consumed ? RendererScroll::FirstUpdateConsumed : RendererScroll::FirstUpdateUnconsumed;
  }
}

- (void)rendererHandledOverscrollEvent:(const void *)params {
  if ([_original respondsToSelector:_cmd]) ((void (*)(id, SEL, const void *))objc_msgSend)(_original, _cmd, params);
  const char *p = static_cast<const char *>(params);
  int behaviorX = *reinterpret_cast<const int32_t *>(p + kOverscrollBehaviorOffset);
  if (gTrace) [gTrace addObject:@{@"ack" : @"overscroll", @"raw" : [self words:params count:10]}];
  _overscrolled = YES;
  _overscrollAllowed = behaviorX == kOverscrollBehaviorAuto;
}

/// Every key and mouse event: scroll events stay away from Chrome's history swiper.
- (BOOL)handleEvent:(NSEvent *)event {
  if (event.type == NSEventTypeScrollWheel || ![_original respondsToSelector:_cmd]) return NO;
  return ((BOOL (*)(id, SEL, NSEvent *))objc_msgSend)(_original, _cmd, event);
}

// The protocol's required methods, which Chromium calls without asking respondsToSelector:.
- (void)touchesBeganWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesBeganWithEvent:event];
}
- (void)touchesMovedWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesMovedWithEvent:event];
}
- (void)touchesCancelledWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesCancelledWithEvent:event];
}
- (void)touchesEndedWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesEndedWithEvent:event];
}

/// DEV trace: the struct as 32-bit words (floats show up as their bit patterns).
- (NSArray *)words:(const void *)p count:(int)count {
  NSMutableArray *out = [NSMutableArray array];
  for (int i = 0; i < count; i++) [out addObject:@(reinterpret_cast<const int32_t *>(p)[i])];
  return out;
}

@end

namespace {

NSHashTable<NSView<NNSwipeTarget> *> *Targets() {
  static NSHashTable *targets = [NSHashTable weakObjectsHashTable];
  return targets;
}

struct Gesture {
  State state = State::Idle;
  __weak NSView<NNSwipeTarget> *target;
  __weak NNRendererScrollObserver *renderer;  // nil over native content
  __weak NSView *hit;
  CGFloat dx = 0, dy = 0;  // accumulated scrolling deltas; +dx is "back"
  int direction = 0;       // +1 back, -1 forward
  BOOL available = NO;
  // Recent motion along x, for the release velocity.
  NSTimeInterval times[6] = {};
  CGFloat deltas[6] = {};
  int samples = 0;
  BOOL ignoreSystemPreference = NO;
};
Gesture gGesture;
id gMonitor;

BOOL IsRenderWidgetView(NSView *view) {
  static Class cls = NSClassFromString(@"RenderWidgetHostViewCocoa");
  return cls && [view isKindOfClass:cls];
}

/// The page's scroll acks come to us: attach to the page view the gesture starts on, in front of
/// its own responder delegate. A page gets a new RenderWidgetHostViewCocoa on cross-site
/// navigations, so this runs for every gesture (before the view sees its first event).
NNRendererScrollObserver *ObserverFor(NSView *hit) {
  static Ivar ivar = class_getInstanceVariable(NSClassFromString(@"RenderWidgetHostViewCocoa"), "_responderDelegate");
  for (NSView *v = hit; v; v = v.superview) {
    if (!IsRenderWidgetView(v)) continue;
    static const void *kKey = &kKey;
    NNRendererScrollObserver *observer = objc_getAssociatedObject(v, kKey);
    if (!observer) {
      // Without the ivar (another Chromium layout) Chrome's delegate can't be kept: leave it be.
      if (!ivar) return nil;
      NSObject *original = object_getIvar(v, ivar);
      observer = [[NNRendererScrollObserver alloc] initWithOriginal:original];
      objc_setAssociatedObject(v, kKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      // A strong ivar (content is ARC): the view now owns the observer, the observer the original.
      object_setIvar(v, ivar, observer);
    }
    return observer;
  }
  return nil;
}

NSView *HitView(NSWindow *window, NSPoint locationInWindow) {
  NSView *frame = window.contentView.superview ?: window.contentView;
  return [frame hitTest:locationInWindow];
}

/// The innermost registered target whose container (superview) holds the view under the pointer.
NSView<NNSwipeTarget> *TargetAt(NSWindow *window, NSPoint locationInWindow, NSView *hit) {
  if (!hit) return nil;
  NSView<NNSwipeTarget> *best = nil;
  for (NSView<NNSwipeTarget> *target in Targets()) {
    NSView *container = target.superview;
    if (target.window != window || !container || target.isHiddenOrHasHiddenAncestor) continue;
    if (![hit isDescendantOf:container]) continue;
    if (!NSPointInRect([target convertPoint:locationInWindow fromView:nil], target.bounds)) continue;
    if (!best || [container isDescendantOf:best.superview]) best = target;
  }
  return best;
}

/// A native scroll view between the pointer and the target that can still scroll that way
/// keeps the gesture (Chrome's rule for pages, applied to native content).
BOOL NativeContentScrolls(NSView *hit, NSView *container, int direction) {
  for (NSView *v = hit; v && v != container; v = v.superview) {
    if (![v isKindOfClass:NSScrollView.class]) continue;
    NSScrollView *scroll = (NSScrollView *)v;
    NSRect visible = scroll.contentView.bounds;
    CGFloat width = NSWidth(scroll.documentView.frame);
    if (width <= NSWidth(visible) + 0.5) continue;
    if (direction > 0 ? NSMinX(visible) > 0.5 : NSMaxX(visible) < width - 0.5) return YES;
  }
  return NO;
}

void Emit(NSString *phase, CGFloat velocity) {
  NSView<NNSwipeTarget> *target = gGesture.target;
  if (!target) return;
  CGFloat distance = gGesture.dx * gGesture.direction;
  [target swipeEvent:@{
    @"phase" : phase,
    @"direction" : gGesture.direction > 0 ? @"back" : @"forward",
    @"distance" : @(distance),
    @"dy" : @(gGesture.dy),
    @"velocity" : @(velocity * gGesture.direction),
    @"available" : @(gGesture.available),
    @"width" : @(NSWidth(target.bounds)),
  }];
}

void Sample(NSEvent *event) {
  int i = gGesture.samples++ % 6;
  gGesture.times[i] = event.timestamp;
  gGesture.deltas[i] = event.scrollingDeltaX;
}

/// Points per second along x over the last ~100 ms of motion.
CGFloat ReleaseVelocity(NSTimeInterval now) {
  int n = MIN(gGesture.samples, 6);
  CGFloat sum = 0;
  NSTimeInterval oldest = now;
  for (int k = 0; k < n; k++) {
    if (now - gGesture.times[k] > 0.1) continue;
    sum += gGesture.deltas[k];
    oldest = MIN(oldest, gGesture.times[k]);
  }
  return now - oldest > 0.004 ? sum / (now - oldest) : 0;
}

BOOL IsPager(NSView<NNSwipeTarget> *target) {
  return [target respondsToSelector:@selector(isPager)] && target.isPager;
}

/// Wheel mice (no phases; Shift-scroll turns vertical into horizontal): a horizontal scroll
/// over a pager goes to it as a "wheel" event (Dia's PageSwipeController pages once the burst
/// adds up to 1 pt, layout/profilePager). Everything else passes through.
NSEvent *HandleWheel(NSEvent *event) {
  CGFloat dx = event.scrollingDeltaX;
  if (fabs(dx) <= fabs(event.scrollingDeltaY)) return event;
  NSView *hit = HitView(event.window, event.locationInWindow);
  NSView<NNSwipeTarget> *target = TargetAt(event.window, event.locationInWindow, hit);
  if (!target || !IsPager(target)) return event;
  // The content moves the way the device says: + is "back" with natural scrolling.
  BOOL back = (dx > 0) == event.isDirectionInvertedFromDevice;
  if (NativeContentScrolls(hit, target.superview, back ? 1 : -1)) return event;
  [target swipeEvent:@{
    @"phase" : @"wheel",
    @"direction" : back ? @"back" : @"forward",
    @"distance" : @(fabs(dx)),
    @"dy" : @0,
    @"velocity" : @0,
    @"available" : @(back ? target.canSwipeBack : target.canSwipeForward),
    @"width" : @(NSWidth(target.bounds)),
  }];
  return nil;
}

void Begin(NSEvent *event, BOOL ignoreSystemPreference) {
  gGesture = Gesture();
  gGesture.ignoreSystemPreference = ignoreSystemPreference;
  NSView *hit = HitView(event.window, event.locationInWindow);
  NSView<NNSwipeTarget> *target = TargetAt(event.window, event.locationInWindow, hit);
  if (!target || (!NSEvent.isSwipeTrackingFromScrollEventsEnabled && !ignoreSystemPreference && !IsPager(target))) {
    gGesture.state = State::Ignored;
    return;
  }
  gGesture.state = State::Pending;
  gGesture.target = target;
  gGesture.hit = hit;
  NNRendererScrollObserver *renderer = ObserverFor(hit);
  [renderer reset];
  gGesture.renderer = renderer;
}

/// Pending: is it time to take the gesture from the content? Returns NO to keep waiting;
/// sets `state` to Ignored when the content keeps it.
BOOL ShouldTrack() {
  CGFloat dx = gGesture.dx, dy = gGesture.dy;
  if (fabs(dy) >= kStartDistance && kCancelDominance * fabs(dx) < fabs(dy)) {
    gGesture.state = State::Ignored;
    return NO;
  }
  if (fabs(dx) < kStartDistance || kStartDominance * fabs(dx) < fabs(dy)) return NO;
  int direction = dx > 0 ? 1 : -1;

  NSView<NNSwipeTarget> *target = gGesture.target;
  NNRendererScrollObserver *renderer = gGesture.renderer;
  if (renderer) {
    switch (renderer.scroll) {
      case RendererScroll::FirstUpdateConsumed:
        gGesture.state = State::Ignored;
        return NO;
      case RendererScroll::FirstUpdateUnconsumed:
        break;
      default:
        return NO;  // the renderer hasn't answered yet
    }
    if (!renderer.overscrolled) return NO;
    if (!renderer.overscrollAllowed) {
      gGesture.state = State::Ignored;
      return NO;
    }
  } else if (NativeContentScrolls(gGesture.hit, target.superview, direction)) {
    gGesture.state = State::Ignored;
    return NO;
  }

  BOOL available = direction > 0 ? target.canSwipeBack : target.canSwipeForward;
  if (!available && !target.tracksUnavailableDirections) {
    gGesture.state = State::Ignored;
    return NO;
  }
  gGesture.direction = direction;
  gGesture.available = available;
  return YES;
}

/// Returns the event to let it through to the view under the pointer, or nil to swallow it.
NSEvent *HandleScroll(NSEvent *event, BOOL ignoreSystemPreference) {
  NSEventPhase phase = event.phase;
  if (phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone) return HandleWheel(event);
  if (!event.hasPreciseScrollingDeltas) return event;

  // Like Chrome's history swiper, only the Changed events of a swipe are taken: the view
  // still sees each gesture begin and end (and its momentum), which keeps Chromium's
  // wheel-phase handling in step (a page that never sees the end stops scrolling).
  if (phase == NSEventPhaseNone) return event;
  if (phase & NSEventPhaseMayBegin) return event;
  if (phase & NSEventPhaseBegan) Begin(event, ignoreSystemPreference);

  switch (gGesture.state) {
    case State::Idle:
    case State::Ignored:
      return event;
    case State::Pending:
    case State::Tracking:
      break;
  }
  if (!gGesture.target) {
    gGesture.state = State::Ignored;
    return event;
  }

  gGesture.dx += event.scrollingDeltaX;
  gGesture.dy += event.scrollingDeltaY;
  Sample(event);

  if (phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) {
    if (gGesture.state != State::Tracking) {
      gGesture.state = State::Idle;
      return event;
    }
    Emit(phase & NSEventPhaseEnded ? @"ended" : @"cancelled", ReleaseVelocity(event.timestamp));
    gGesture.state = State::Idle;
    return event;
  }

  if (gGesture.state == State::Pending) {
    if (!ShouldTrack()) return event;
    gGesture.state = State::Tracking;
    Emit(@"began", 0);
    return nil;
  }
  if (!gGesture.target.allowsVerticalMotion && kCancelDominance * fabs(gGesture.dx) < fabs(gGesture.dy)) {
    Emit(@"cancelled", 0);
    gGesture.state = State::Ignored;  // the rest of the gesture scrolls the content
    return event;
  }
  Emit(@"changed", ReleaseVelocity(event.timestamp));
  return nil;
}

/// Three-finger swipes (Swipe between pages › Swipe with three fingers) arrive whole.
/// Returns YES when a target took it.
BOOL HandleDiscreteSwipe(NSWindow *window, NSPoint location, CGFloat deltaX) {
  if (fabs(deltaX) < 0.5) return NO;
  NSView *hit = HitView(window, location);
  NSView<NNSwipeTarget> *target = TargetAt(window, location, hit);
  if (!target) return NO;
  BOOL back = deltaX > 0;
  if (!(back ? target.canSwipeBack : target.canSwipeForward)) return NO;
  [target swipeEvent:@{
    @"phase" : @"swipe",
    @"direction" : back ? @"back" : @"forward",
    @"distance" : @0,
    @"dy" : @0,
    @"velocity" : @0,
    @"available" : @YES,
    @"width" : @(NSWidth(target.bounds)),
  }];
  return YES;
}

void InstallMonitor() {
  if (gMonitor) return;
  gMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel | NSEventMaskSwipe
                                                   handler:^NSEvent *(NSEvent *event) {
                                                     if (event.type == NSEventTypeSwipe)
                                                       return HandleDiscreteSwipe(event.window, event.locationInWindow, event.deltaX) ? nil : event;
                                                     return HandleScroll(event, NO);
                                                   }];
}

// MARK: DEV simulation

/// DEV: the page view's responder delegate chain and what it validates (Edit › Spelling and
/// Grammar, Speech), to check Chrome's delegate still answers behind ours.
NSDictionary *ResponderReport(NSView *hit) {
  static Ivar ivar = class_getInstanceVariable(NSClassFromString(@"RenderWidgetHostViewCocoa"), "_responderDelegate");
  NSView *page = hit;
  while (page && !IsRenderWidgetView(page)) page = page.superview;
  if (!page || !ivar) return @{};
  id delegate = object_getIvar(page, ivar);
  NSObject *original = [delegate isKindOfClass:NNRendererScrollObserver.class] ? ((NNRendererScrollObserver *)delegate)->_original : nil;
  NSMutableDictionary *valid = [NSMutableDictionary dictionary];
  for (NSString *action in @[ @"checkSpelling:", @"showGuessPanel:", @"toggleContinuousSpellChecking:", @"toggleGrammarChecking:",
                              @"startSpeaking:", @"stopSpeaking:" ]) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:action action:NSSelectorFromString(action) keyEquivalent:@""];
    valid[action] = @([(id<NSUserInterfaceValidations>)page validateUserInterfaceItem:item]);
  }
  return @{
    @"delegate" : delegate ? NSStringFromClass([delegate class]) : @"",
    @"chainedTo" : original ? NSStringFromClass(original.class) : @"",
    @"valid" : valid,
  };
}

/// `point` (top-left origin, as devLocate reports it) in the content view's coordinates.
NSPoint LocalPoint(NSWindow *window, NSPoint point) {
  NSView *content = window.contentView;
  return content.isFlipped ? point : NSMakePoint(point.x, NSHeight(content.bounds) - point.y);
}

CGScrollPhase ScrollPhaseOf(NSString *phase) {
  if ([phase isEqualToString:@"began"]) return kCGScrollPhaseBegan;
  if ([phase isEqualToString:@"changed"]) return kCGScrollPhaseChanged;
  if ([phase isEqualToString:@"ended"]) return kCGScrollPhaseEnded;
  if ([phase isEqualToString:@"cancelled"]) return kCGScrollPhaseCancelled;
  if ([phase isEqualToString:@"mayBegin"]) return kCGScrollPhaseMayBegin;
  return (CGScrollPhase)0;
}

/// A trackpad scroll event like the ones AppKit makes from the multitouch driver.
NSEvent *SyntheticScroll(NSWindow *window, NSPoint point, NSDictionary *step) {
  NSString *phase = step[@"phase"];
  double dx = [step[@"dx"] doubleValue], dy = [step[@"dy"] doubleValue];
  // "wheel": a wheel mouse's notch (lines, not continuous, no phase).
  BOOL wheel = [phase isEqualToString:@"wheel"];
  CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 2, (int32_t)lround(dy), (int32_t)lround(dx), 0);
  if (!cg) return nil;
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, wheel ? 0 : 1);
  if ([step[@"shift"] boolValue]) CGEventSetFlags(cg, kCGEventFlagMaskShift);
  // Real events carry the time they happened; the release velocity is measured from it.
  CGEventSetTimestamp(cg, clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
  if (!wheel) {
    CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, dy);
    CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis2, dx);
  }
  if ([phase hasPrefix:@"momentum"]) {
    CGMomentumScrollPhase momentum = [phase isEqualToString:@"momentumBegan"] ? kCGMomentumScrollPhaseBegin
                                     : [phase isEqualToString:@"momentumEnded"] ? kCGMomentumScrollPhaseEnd
                                                                                : kCGMomentumScrollPhaseContinue;
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, momentum);
  } else if (!wheel) {
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, ScrollPhaseOf(phase));
  }
  // Global display coordinates (origin top-left of the main screen).
  NSPoint local = LocalPoint(window, point);
  NSPoint screen = [window convertPointToScreen:[window.contentView convertPoint:local toView:nil]];
  CGFloat mainHeight = NSHeight(NSScreen.screens.firstObject.frame);
  CGEventSetLocation(cg, CGPointMake(screen.x, mainHeight - screen.y));
  // Field 51 is the event's target window (what NSEvent.window comes from); the private
  // CGEventSetWindowLocation sets locationInWindow (top-left origin in the window's frame).
  CGEventSetIntegerValueField(cg, (CGEventField)51, window.windowNumber);
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSPoint inWindow = [window.contentView convertPoint:local toView:nil];
  if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(window.frame) - inWindow.y));
  NSEvent *event = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  return event;
}

}  // namespace

@implementation NNSwipe

+ (void)performHaptic:(NSString *)pattern {
  NSHapticFeedbackPattern p = [pattern isEqualToString:@"levelChange"] ? NSHapticFeedbackPatternLevelChange
                              : [pattern isEqualToString:@"alignment"]  ? NSHapticFeedbackPatternAlignment
                                                                         : NSHapticFeedbackPatternGeneric;
  // Dia: the threshold uses the default time, list haptics fire now.
  NSHapticFeedbackPerformanceTime time = p == NSHapticFeedbackPatternLevelChange ? NSHapticFeedbackPerformanceTimeDefault
                                                                                  : NSHapticFeedbackPerformanceTimeNow;
  [NSHapticFeedbackManager.defaultPerformer performFeedbackPattern:p performanceTime:time];
}

+ (void)addTarget:(NSView<NNSwipeTarget> *)target {
  [Targets() addObject:target];
  InstallMonitor();
}

+ (void)removeTarget:(NSView<NNSwipeTarget> *)target {
  [Targets() removeObject:target];
}

+ (void)simulateInWindow:(NSWindow *)window
                   point:(NSPoint)point
                   steps:(NSArray<NSDictionary<NSString *, id> *> *)steps
  ignoreSystemPreference:(BOOL)ignoreSystemPreference
              completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  gTrace = [NSMutableArray array];
  NSMutableArray *log = [NSMutableArray array];
  NSPoint local = LocalPoint(window, point);
  NSPoint inWindow = [window.contentView convertPoint:local toView:nil];
  NSView *hit = HitView(window, inWindow);
  NSDictionary *where = @{
    @"hit" : hit ? NSStringFromClass(hit.class) : @"",
    @"target" : TargetAt(window, inWindow, hit) ? @YES : @NO,
    @"systemSwipeEnabled" : @(NSEvent.isSwipeTrackingFromScrollEventsEnabled),
  };
  __block NSUInteger index = 0;
  __block void (^next)(void);
  void (^step)(void) = ^{
    if (index >= steps.count) {
      NSDictionary *result = @{@"where" : where, @"events" : log, @"acks" : gTrace ?: @[], @"responder" : ResponderReport(hit)};
      gTrace = nil;
      next = nil;
      completion(result);
      return;
    }
    NSDictionary *s = steps[index++];
    NSString *phase = s[@"phase"];
    if ([phase isEqualToString:@"swipe"]) {
      BOOL handled = HandleDiscreteSwipe(window, inWindow, [s[@"dx"] doubleValue]);
      [log addObject:@{@"phase" : phase, @"swallowed" : @(handled)}];
    } else {
      NSEvent *event = SyntheticScroll(window, point, s);
      if (event.window != window || fabs(event.locationInWindow.x - inWindow.x) > 1 || fabs(event.locationInWindow.y - inWindow.y) > 1) {
        [log addObject:@{@"phase" : phase, @"error" : [NSString stringWithFormat:@"event window %@ at %@, expected %@",
                                                                  event.window, NSStringFromPoint(event.locationInWindow), NSStringFromPoint(inWindow)]}];
      }
      NSEvent *out = HandleScroll(event, ignoreSystemPreference);
      [log addObject:@{
        @"phase" : phase,
        @"time" : @(event.timestamp),
        @"state" : @((int)gGesture.state),
        @"swallowed" : @(out == nil),
        @"renderer" : gGesture.renderer ? @((int)gGesture.renderer.scroll) : @(-1),
      }];
      if (out) [window sendEvent:out];
    }
    NSTimeInterval delay = (s[@"delayMs"] ? [s[@"delayMs"] doubleValue] : 16) / 1000;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), next);
  };
  next = step;
  step();
}

@end
