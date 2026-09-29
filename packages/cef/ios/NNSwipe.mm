#import "NNSwipe.h"
#import "NNChromeWindow.h"

#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

namespace {

// Dia threshold: 4pt start, 1.5× horizontal, 2× vertical cancel.
constexpr CGFloat kStartDistance = 4;
constexpr CGFloat kStartDominance = 1.5;
constexpr CGFloat kCancelDominance = 2;

// Chromium 154 event layout: keep the ack decoder offsets in sync.
constexpr size_t kInputEventTypeOffset = 40;
constexpr int kGestureScrollBegin = 11;
constexpr int kGestureScrollUpdate = 13;
constexpr size_t kOverscrollBehaviorOffset = 32;
constexpr int kOverscrollBehaviorAuto = 1;

enum class RendererScroll { Idle, AwaitingBegin, AwaitingFirstUpdate, FirstUpdateUnconsumed, FirstUpdateConsumed };
enum class State { Idle, Pending, Tracking, Ignored };

NSMutableArray *gTrace;

}

@interface NNRendererScrollObserver : NSObject
- (instancetype)initWithOriginal:(nullable NSObject *)original;
@property (nonatomic) RendererScroll scroll;
@property (nonatomic) BOOL overscrolled;
@property (nonatomic) BOOL overscrollAllowed;
@end

@implementation NNRendererScrollObserver {
 @public
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

// Suppress Chrome history-swiper scrolls or a gesture navigates twice.
- (BOOL)handleEvent:(NSEvent *)event {
  if (event.type == NSEventTypeScrollWheel || ![_original respondsToSelector:_cmd]) return NO;
  return ((BOOL (*)(id, SEL, NSEvent *))objc_msgSend)(_original, _cmd, event);
}

// Chromium may call required responder methods without a selector check.
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

NSMapTable<NSWindow *, NSView *> *WindowRoots() {
  static NSMapTable *roots = [NSMapTable weakToWeakObjectsMapTable];
  return roots;
}

void RememberRoot(NSView<NNSwipeTarget> *target) {
  NSWindow *window = target.window;
  NSView *root = [NNChromeWindowHost rootViewOfWindow:window];
  // Registration can run inside addSubview, before the host records the root.
  if (!root) {
    root = target;
    while (root.superview && root.superview != window.contentView) root = root.superview;
  }
  if (root && root != window.contentView) [WindowRoots() setObject:root forKey:window];
}

NSWindow *CurrentWindow(NSWindow *window) {
  if (!window) return nil;
  return [WindowRoots() objectForKey:window].window ?: window;
}

struct Gesture {
  State state = State::Idle;
  __weak NSView<NNSwipeTarget> *target;
  __weak NNRendererScrollObserver *renderer;
  __weak NSView *hit;
  CGFloat dx = 0, dy = 0;
  int direction = 0;
  BOOL available = NO;
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

NNRendererScrollObserver *ObserverFor(NSView *hit) {
  static Ivar ivar = class_getInstanceVariable(NSClassFromString(@"RenderWidgetHostViewCocoa"), "_responderDelegate");
  for (NSView *v = hit; v; v = v.superview) {
    if (!IsRenderWidgetView(v)) continue;
    static const void *kKey = &kKey;
    NNRendererScrollObserver *observer = objc_getAssociatedObject(v, kKey);
    if (!observer) {
      // Without the delegate ivar, leave Chrome's delegate untouched.
      if (!ivar) return nil;
      NSObject *original = object_getIvar(v, ivar);
      observer = [[NNRendererScrollObserver alloc] initWithOriginal:original];
      objc_setAssociatedObject(v, kKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
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

NSEvent *HandleWheel(NSEvent *event) {
  CGFloat dx = event.scrollingDeltaX;
  if (fabs(dx) <= fabs(event.scrollingDeltaY)) return event;
  NSView *hit = HitView(event.window, event.locationInWindow);
  NSView<NNSwipeTarget> *target = TargetAt(event.window, event.locationInWindow, hit);
  if (!target || !IsPager(target)) return event;
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

BOOL ShouldTrack() {
  CGFloat dx = gGesture.dx, dy = gGesture.dy;
  NSView<NNSwipeTarget> *target = gGesture.target;
  // Let a pager's small initial vertical wobble resolve before locking its axis.
  const CGFloat verticalIntent = IsPager(target) ? 3 * kStartDistance : kStartDistance;
  if (fabs(dy) >= verticalIntent && kCancelDominance * fabs(dx) < fabs(dy)) {
    gGesture.state = State::Ignored;
    return NO;
  }
  if (fabs(dx) < kStartDistance || kStartDominance * fabs(dx) < fabs(dy)) return NO;
  int direction = dx > 0 ? 1 : -1;

  NNRendererScrollObserver *renderer = gGesture.renderer;
  if (renderer) {
    switch (renderer.scroll) {
      case RendererScroll::FirstUpdateConsumed:
        gGesture.state = State::Ignored;
        return NO;
      case RendererScroll::FirstUpdateUnconsumed:
        break;
      default:
        return NO;
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

NSEvent *HandleScroll(NSEvent *event, BOOL ignoreSystemPreference) {
  NSEventPhase phase = event.phase;
  if (phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone) return HandleWheel(event);
  if (!event.hasPreciseScrollingDeltas) return event;

  // Leave begin/end events to Chromium or wheel-phase scrolling stalls.
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
  if (!IsPager(gGesture.target) && !gGesture.target.allowsVerticalMotion && kCancelDominance * fabs(gGesture.dx) < fabs(gGesture.dy)) {
    Emit(@"cancelled", 0);
    gGesture.state = State::Ignored;
    return event;
  }
  Emit(@"changed", ReleaseVelocity(event.timestamp));
  return nil;
}

BOOL HandleDiscreteSwipe(NSWindow *window, NSPoint location, CGFloat deltaX) {
  if (fabs(deltaX) < 0.5) return NO;
  NSWindow *current = CurrentWindow(window);
  if (current != window) location = [current convertPointFromScreen:[window convertPointToScreen:location]];
  window = current;
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

// Retarget latched gestures after profile swaps or swipes target the hidden window.
NSEvent *Unlatched(NSEvent *event) {
  NSWindow *window = event.window;
  NSWindow *under = CurrentWindow(window);
  // AppKit can keep targeting an old profile window, including a visible full-screen host.
  if (!window || under == window || !under.isVisible || under.ignoresMouseEvents) return nil;
  const NSPoint screen = [window convertPointToScreen:event.locationInWindow];
  CGEventRef cg = CGEventCreateCopy(event.CGEvent);
  if (!cg) return nil;
  CGEventSetIntegerValueField(cg, (CGEventField)51, under.windowNumber);
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  const NSPoint inWindow = [under convertPointFromScreen:screen];
  if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(under.frame) - inWindow.y));
  NSEvent *moved = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  return moved.window == under ? moved : nil;
}

NSEvent *HandleScrollEvent(NSEvent *event, BOOL ignoreSystemPreference) {
  NSEvent *moved = Unlatched(event);
  if (!moved) return HandleScroll(event, ignoreSystemPreference);
  if (NSEvent *out = HandleScroll(moved, ignoreSystemPreference)) [moved.window sendEvent:out];
  return nil;
}

void InstallMonitor() {
  if (gMonitor) return;
  gMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel | NSEventMaskSwipe
                                                   handler:^NSEvent *(NSEvent *event) {
                                                     if (event.type == NSEventTypeSwipe)
                                                       return HandleDiscreteSwipe(event.window, event.locationInWindow, event.deltaX) ? nil : event;
                                                     return HandleScrollEvent(event, NO);
                                                   }];
}

// MARK: DEV simulation

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

NSEvent *SyntheticScroll(NSWindow *window, NSPoint point, NSDictionary *step) {
  NSString *phase = step[@"phase"];
  double dx = [step[@"dx"] doubleValue], dy = [step[@"dy"] doubleValue];
  BOOL wheel = [phase isEqualToString:@"wheel"];
  CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 2, (int32_t)lround(dy), (int32_t)lround(dx), 0);
  if (!cg) return nil;
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, wheel ? 0 : 1);
  if ([step[@"shift"] boolValue]) CGEventSetFlags(cg, kCGEventFlagMaskShift);
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
  NSPoint local = LocalPoint(window, point);
  NSPoint screen = [window convertPointToScreen:[window.contentView convertPoint:local toView:nil]];
  CGFloat mainHeight = NSHeight(NSScreen.screens.firstObject.frame);
  CGEventSetLocation(cg, CGPointMake(screen.x, mainHeight - screen.y));
  CGEventSetIntegerValueField(cg, (CGEventField)51, window.windowNumber);
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSPoint inWindow = [window.contentView convertPoint:local toView:nil];
  if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(window.frame) - inWindow.y));
  NSEvent *event = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  return event;
}

}

@implementation NNSwipe

+ (void)performHaptic:(NSString *)pattern {
  NSHapticFeedbackPattern p = [pattern isEqualToString:@"levelChange"] ? NSHapticFeedbackPatternLevelChange
                              : [pattern isEqualToString:@"alignment"]  ? NSHapticFeedbackPatternAlignment
                                                                         : NSHapticFeedbackPatternGeneric;
  NSHapticFeedbackPerformanceTime time = p == NSHapticFeedbackPatternLevelChange ? NSHapticFeedbackPerformanceTimeDefault
                                                                                  : NSHapticFeedbackPerformanceTimeNow;
  [NSHapticFeedbackManager.defaultPerformer performFeedbackPattern:p performanceTime:time];
}

+ (void)addTarget:(NSView<NNSwipeTarget> *)target {
  [Targets() addObject:target];
  RememberRoot(target);
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
  NSWindow *current = CurrentWindow(window);
  NSPoint currentPoint = current == window ? inWindow : [current convertPointFromScreen:[window convertPointToScreen:inWindow]];
  NSView *hit = HitView(current, currentPoint);
  NSDictionary *where = @{
    @"hit" : hit ? NSStringFromClass(hit.class) : @"",
    @"target" : TargetAt(current, currentPoint, hit) ? @YES : @NO,
    @"sourceWindow" : @(window.windowNumber),
    @"targetWindow" : @(current.windowNumber),
    @"sourceVisible" : @(window.isVisible),
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
      NSEvent *out = HandleScrollEvent(event, ignoreSystemPreference);
      [log addObject:@{
        @"phase" : phase,
        @"time" : @(event.timestamp),
        @"state" : @((int)gGesture.state),
        @"swallowed" : @(out == nil),
        @"renderer" : gGesture.renderer ? @((int)gGesture.renderer.scroll) : @(-1),
        @"targetWindow" : @(gGesture.target.window.windowNumber),
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
