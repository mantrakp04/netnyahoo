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

// DEV simulation trace: every tracker decision, in event order. Builds nothing outside a simulation.
#define Diag(...)                                   \
  do {                                              \
    if (gTrace) [gTrace addObject:(__VA_ARGS__)];   \
  } while (0)

NSArray *RectValue(NSRect r) {
  return @[ @(r.origin.x), @(r.origin.y), @(r.size.width), @(r.size.height) ];
}

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
  int seq = 0;
  int emitted = 0;
};
Gesture gGesture;
int gGestureSeq;
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

NSView<NNSwipeTarget> *TargetAt(NSWindow *window, NSPoint locationInWindow, NSView *hit, NSMutableArray *why = nil) {
  if (!hit) return nil;
  NSView<NNSwipeTarget> *best = nil;
  for (NSView<NNSwipeTarget> *target in Targets()) {
    NSView *container = target.superview;
    NSString *miss = target.window != window                    ? @"otherWindow"
                     : !container                                ? @"noSuperview"
                     : target.isHiddenOrHasHiddenAncestor        ? @"hidden"
                     : ![hit isDescendantOf:container]           ? @"hitOutsideContainer"
                     : !NSPointInRect([target convertPoint:locationInWindow fromView:nil], target.bounds) ? @"pointOutside"
                                                                 : nil;
    if (why) [why addObject:@{
      @"target" : [NSString stringWithFormat:@"%p", target],
      @"window" : @(target.window.windowNumber),
      @"inWindow" : RectValue([target convertRect:target.bounds toView:nil]),
      @"pager" : @([target respondsToSelector:@selector(isPager)] && target.isPager),
      @"miss" : miss ?: @"",
    }];
    if (miss) continue;
    if (!best || [container isDescendantOf:best.superview]) best = target;
  }
  return best;
}

NSArray *HitChain(NSView *hit) {
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = hit; v; v = v.superview) {
    [chain addObject:@{
      @"class" : NSStringFromClass(v.class),
      @"frame" : RectValue(v.frame),
      @"inWindow" : RectValue([v convertRect:v.bounds toView:nil]),
      @"hidden" : @(v.isHidden),
    }];
  }
  return chain;
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

// Mirrors NativeContentScrolls with every input it reads, for both directions.
NSArray *NativeScrollReport(NSView *hit, NSView *container) {
  NSMutableArray *out = [NSMutableArray array];
  for (NSView *v = hit; v && v != container; v = v.superview) {
    if (![v isKindOfClass:NSScrollView.class]) continue;
    NSScrollView *scroll = (NSScrollView *)v;
    NSRect visible = scroll.contentView.bounds;
    CGFloat width = NSWidth(scroll.documentView.frame);
    BOOL fits = width <= NSWidth(visible) + 0.5;
    NSView *wrapper = scroll.superview;
    [out addObject:@{
      @"class" : NSStringFromClass(scroll.class),
      @"frame" : RectValue(scroll.frame),
      @"inWindow" : RectValue([scroll convertRect:scroll.bounds toView:nil]),
      @"clipBounds" : RectValue(visible),
      @"clipFrame" : RectValue(scroll.contentView.frame),
      @"document" : RectValue(scroll.documentView.frame),
      @"documentClass" : scroll.documentView ? NSStringFromClass(scroll.documentView.class) : @"",
      @"wrapper" : wrapper ? NSStringFromClass(wrapper.class) : @"",
      @"wrapperFrame" : RectValue(wrapper.frame),
      // RCTScrollView isHorizontal: compares against the wrapper frame, not the clip.
      @"wrapperHorizontal" : @(width > NSWidth(wrapper.frame)),
      @"hasHorizontalScroller" : @(scroll.hasHorizontalScroller),
      @"hasVerticalScroller" : @(scroll.hasVerticalScroller),
      @"scrollerStyle" : @(scroll.scrollerStyle),
      @"horizontalElasticity" : @(scroll.horizontalScrollElasticity),
      @"verticalElasticity" : @(scroll.verticalScrollElasticity),
      @"fits" : @(fits),
      @"blocksBack" : @(!fits && NSMinX(visible) > 0.5),
      @"blocksForward" : @(!fits && NSMaxX(visible) < width - 0.5),
    }];
  }
  return out;
}

void Emit(NSString *phase, CGFloat velocity) {
  NSView<NNSwipeTarget> *target = gGesture.target;
  if (!target) return;
  CGFloat distance = gGesture.dx * gGesture.direction;
  Diag(@{
    @"diag" : @"emit",
    @"seq" : @(gGesture.seq),
    @"n" : @(++gGesture.emitted),
    @"phase" : phase,
    @"direction" : gGesture.direction > 0 ? @"back" : @"forward",
    @"distance" : @(distance),
    @"dx" : @(gGesture.dx),
    @"dy" : @(gGesture.dy),
    @"velocity" : @(velocity * gGesture.direction),
    @"available" : @(gGesture.available),
    @"width" : @(NSWidth(target.bounds)),
    @"target" : [NSString stringWithFormat:@"%p", target],
  });
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

NSEvent *HandleWheel(NSEvent *event, NSWindow *window, NSPoint location) {
  CGFloat dx = event.scrollingDeltaX;
  if (fabs(dx) <= fabs(event.scrollingDeltaY)) return event;
  NSView *hit = HitView(window, location);
  NSView<NNSwipeTarget> *target = TargetAt(window, location, hit);
  if (!target || !IsPager(target)) {
    Diag(@{@"diag" : @"wheel", @"reject" : target ? @"notPager" : @"noTarget", @"hit" : HitChain(hit)});
    return event;
  }
  BOOL back = (dx > 0) == event.isDirectionInvertedFromDevice;
  if (NativeContentScrolls(hit, target.superview, back ? 1 : -1)) {
    Diag(@{@"diag" : @"wheel", @"reject" : @"nativeContentScrolls", @"scrollers" : NativeScrollReport(hit, target.superview)});
    return event;
  }
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

void Begin(NSWindow *window, NSPoint location, BOOL ignoreSystemPreference) {
  gGesture = Gesture();
  gGesture.ignoreSystemPreference = ignoreSystemPreference;
  gGesture.seq = ++gGestureSeq;
  NSView *hit = HitView(window, location);
  NSView<NNSwipeTarget> *target = TargetAt(window, location, hit);
  if (gTrace) {
    NSMutableArray *why = [NSMutableArray array];
    TargetAt(window, location, hit, why);
    Diag(@{
      @"diag" : @"begin",
      @"seq" : @(gGesture.seq),
      @"window" : @(window.windowNumber),
      @"location" : @[ @(location.x), @(location.y) ],
      @"hit" : HitChain(hit),
      @"targets" : why,
      @"target" : target ? [NSString stringWithFormat:@"%p", target] : @"",
      @"canSwipeBack" : @(target.canSwipeBack),
      @"canSwipeForward" : @(target.canSwipeForward),
      @"scrollers" : NativeScrollReport(hit, target.superview),
      @"systemSwipe" : @(NSEvent.isSwipeTrackingFromScrollEventsEnabled),
      @"ignorePreference" : @(ignoreSystemPreference),
    });
  }
  if (!target || (!NSEvent.isSwipeTrackingFromScrollEventsEnabled && !ignoreSystemPreference && !IsPager(target))) {
    Diag(@{@"diag" : @"reject", @"seq" : @(gGesture.seq), @"reason" : target ? @"systemPreferenceOff" : (hit ? @"noTarget" : @"noHit")});
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

BOOL Reject(NSString *reason, NSDictionary *extra = nil) {
  if (gTrace) {
    NSMutableDictionary *entry = [@{@"diag" : @"reject", @"seq" : @(gGesture.seq), @"reason" : reason, @"dx" : @(gGesture.dx), @"dy" : @(gGesture.dy)} mutableCopy];
    if (extra) [entry addEntriesFromDictionary:extra];
    [gTrace addObject:entry];
  }
  gGesture.state = State::Ignored;
  return NO;
}

BOOL Wait(NSString *reason) {
  Diag(@{@"diag" : @"wait", @"seq" : @(gGesture.seq), @"reason" : reason, @"dx" : @(gGesture.dx), @"dy" : @(gGesture.dy)});
  return NO;
}

BOOL ShouldTrack() {
  CGFloat dx = gGesture.dx, dy = gGesture.dy;
  NSView<NNSwipeTarget> *target = gGesture.target;
  // Let a pager's small initial vertical wobble resolve before locking its axis.
  const CGFloat verticalIntent = IsPager(target) ? 3 * kStartDistance : kStartDistance;
  if (fabs(dy) >= verticalIntent && kCancelDominance * fabs(dx) < fabs(dy)) return Reject(@"verticalIntent");
  if (fabs(dx) < kStartDistance || kStartDominance * fabs(dx) < fabs(dy)) return Wait(@"belowStart");
  int direction = dx > 0 ? 1 : -1;

  NNRendererScrollObserver *renderer = gGesture.renderer;
  if (renderer) {
    switch (renderer.scroll) {
      case RendererScroll::FirstUpdateConsumed:
        return Reject(@"rendererConsumed");
      case RendererScroll::FirstUpdateUnconsumed:
        break;
      default:
        return Wait(gTrace ? [NSString stringWithFormat:@"renderer%d", (int)renderer.scroll] : @"rendererAck");
    }
    if (!renderer.overscrolled) return Wait(@"rendererNoOverscroll");
    if (!renderer.overscrollAllowed) return Reject(@"overscrollBehavior");
  } else if (NativeContentScrolls(gGesture.hit, target.superview, direction)) {
    return Reject(@"nativeContentScrolls", gTrace ? @{@"direction" : @(direction), @"scrollers" : NativeScrollReport(gGesture.hit, target.superview)} : nil);
  }

  BOOL available = direction > 0 ? target.canSwipeBack : target.canSwipeForward;
  if (!available && !target.tracksUnavailableDirections) return Reject(@"unavailable", gTrace ? @{@"direction" : @(direction)} : nil);
  gGesture.direction = direction;
  gGesture.available = available;
  Diag(@{@"diag" : @"track", @"seq" : @(gGesture.seq), @"direction" : @(direction), @"available" : @(available), @"dx" : @(dx), @"dy" : @(dy),
         @"scrollers" : NativeScrollReport(gGesture.hit, target.superview)});
  return YES;
}

// Recognizes on the event's deltas, phases and timestamps at an already resolved window and point.
// Returns the event when it stays native scrolling, nil when the swipe consumed it.
NSEvent *HandleScroll(NSEvent *event, NSWindow *window, NSPoint location, BOOL ignoreSystemPreference) {
  NSEventPhase phase = event.phase;
  if (phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone) return HandleWheel(event, window, location);
  if (!event.hasPreciseScrollingDeltas) {
    Diag(@{@"diag" : @"pass", @"reason" : @"notPrecise"});
    return event;
  }

  // Leave begin/end events to Chromium or wheel-phase scrolling stalls.
  if (phase == NSEventPhaseNone) return event;
  if (phase & NSEventPhaseMayBegin) return event;
  if (phase & NSEventPhaseBegan) Begin(window, location, ignoreSystemPreference);

  switch (gGesture.state) {
    case State::Idle:
    case State::Ignored:
      return event;
    case State::Pending:
    case State::Tracking:
      break;
  }
  if (!gGesture.target) {
    Reject(@"targetGone");
    return event;
  }

  gGesture.dx += event.scrollingDeltaX;
  gGesture.dy += event.scrollingDeltaY;
  Sample(event);

  if (phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) {
    if (gGesture.state != State::Tracking) {
      Diag(@{@"diag" : @"endUntracked", @"seq" : @(gGesture.seq), @"dx" : @(gGesture.dx), @"dy" : @(gGesture.dy)});
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

// DEV simulation only: fail the retargeted copy, or recognize on it as before.
BOOL gRetargetCopyFailure;
BOOL gLegacyRecognition;

// The window showing the profile under the pointer. AppKit can keep targeting an old profile
// window after a swap, including a visible full-screen host.
NSWindow *RetargetWindow(NSWindow *window) {
  NSWindow *under = CurrentWindow(window);
  return window && under != window && under.isVisible && !under.ignoresMouseEvents ? under : nil;
}

// A copy of the event addressed to the retarget window, for native delivery.
NSEvent *Unlatched(NSEvent *event) {
  NSWindow *window = event.window;
  NSWindow *under = RetargetWindow(window);
  if (!under || (gTrace && gRetargetCopyFailure)) return nil;
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

// The pre-decoupling path: recognition depended on the retargeted copy.
NSEvent *LegacyHandleScrollEvent(NSEvent *event, BOOL ignoreSystemPreference) {
  NSEvent *moved = Unlatched(event);
  if (!moved) return HandleScroll(event, event.window, event.locationInWindow, ignoreSystemPreference);
  Diag(@{@"diag" : @"unlatched", @"legacy" : @YES, @"from" : @(event.window.windowNumber), @"to" : @(moved.window.windowNumber)});
  if (NSEvent *out = HandleScroll(moved, moved.window, moved.locationInWindow, ignoreSystemPreference)) [moved.window sendEvent:out];
  return nil;
}

NSEvent *HandleScrollEvent(NSEvent *event, BOOL ignoreSystemPreference) {
  if (gTrace && gLegacyRecognition) return LegacyHandleScrollEvent(event, ignoreSystemPreference);
  // Recognize in the window holding the root, whether or not the event can be rebuilt for it.
  NSWindow *window = event.window;
  NSPoint location = event.locationInWindow;
  NSWindow *canonical = CurrentWindow(window) ?: window;
  if (canonical != window) location = [canonical convertPointFromScreen:[window convertPointToScreen:location]];
  NSEvent *out = HandleScroll(event, canonical, location, ignoreSystemPreference);
  if (!out || canonical == window) return out;
  // Native scrolling goes to the shown window; without a copy, AppKit delivers it as it would have.
  NSEvent *moved = Unlatched(event);
  Diag(@{@"diag" : @"unlatched", @"from" : @(window.windowNumber), @"to" : @(canonical.windowNumber), @"copied" : @(moved != nil)});
  if (!moved) return out;
  [moved.window sendEvent:moved];
  return nil;
}

void InstallMonitor() {
  if (gMonitor) return;
  gMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel | NSEventMaskSwipe
                                                   handler:^NSEvent *(NSEvent *event) {
                                                     Diag(@{
                                                       @"diag" : @"monitorEntry",
                                                       @"type" : @(event.type),
                                                       @"window" : @(event.window.windowNumber),
                                                       @"phase" : @(event.phase),
                                                       @"momentum" : event.type == NSEventTypeScrollWheel ? @(event.momentumPhase) : @(-1),
                                                       @"timestamp" : @(event.timestamp),
                                                     });
                                                     NSEvent *out = event.type == NSEventTypeSwipe
                                                                        ? (HandleDiscreteSwipe(event.window, event.locationInWindow, event.deltaX) ? nil : event)
                                                                        : HandleScrollEvent(event, NO);
                                                     Diag(@{@"diag" : @"monitorExit", @"resultWindow" : out ? @(out.window.windowNumber) : @(-1), @"swallowed" : @(out == nil)});
                                                     return out;
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

// Optional captured fields: timestampMs (from the simulation start), dxPoint/dyPoint,
// dxFixed/dyFixed, dxLine/dyLine, rawPhase and rawMomentumPhase (CGScrollPhase values).
NSEvent *SyntheticScroll(NSWindow *window, NSPoint point, NSDictionary *step, uint64_t startNs) {
  NSString *phase = step[@"phase"];
  double dx = [step[@"dx"] doubleValue], dy = [step[@"dy"] doubleValue];
  BOOL wheel = [phase isEqualToString:@"wheel"];
  CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 2, (int32_t)lround(dy), (int32_t)lround(dx), 0);
  if (!cg) return nil;
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, wheel ? 0 : 1);
  if ([step[@"shift"] boolValue]) CGEventSetFlags(cg, kCGEventFlagMaskShift);
  // CGEvent timestamps are uptime nanoseconds, the clock NSEvent.timestamp reports.
  CGEventSetTimestamp(cg, step[@"timestampMs"] ? startNs + (uint64_t)llround([step[@"timestampMs"] doubleValue] * 1e6)
                                               : clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
  // CG's delta setters rewrite each other's fields (fixed then point then line turned point -13 into
  // scrollingDeltaX -8), so set line, then fixed, then point, which scrollingDeltaX/Y read, last.
  if (step[@"dyLine"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis1, [step[@"dyLine"] longLongValue]);
  if (step[@"dxLine"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis2, [step[@"dxLine"] longLongValue]);
  if (!wheel) {
    CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, step[@"dyFixed"] ? [step[@"dyFixed"] doubleValue] : dy);
    CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis2, step[@"dxFixed"] ? [step[@"dxFixed"] doubleValue] : dx);
  }
  if (step[@"dyPoint"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis1, [step[@"dyPoint"] longLongValue]);
  if (step[@"dxPoint"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis2, [step[@"dxPoint"] longLongValue]);
  if ([phase hasPrefix:@"momentum"]) {
    CGMomentumScrollPhase momentum = [phase isEqualToString:@"momentumBegan"] ? kCGMomentumScrollPhaseBegin
                                     : [phase isEqualToString:@"momentumEnded"] ? kCGMomentumScrollPhaseEnd
                                                                                : kCGMomentumScrollPhaseContinue;
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, momentum);
  } else if (!wheel) {
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, ScrollPhaseOf(phase));
  }
  if (step[@"rawPhase"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, [step[@"rawPhase"] longLongValue]);
  if (step[@"rawMomentumPhase"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, [step[@"rawMomentumPhase"] longLongValue]);
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
  // Steps with atMs run at that offset from this start, so timing does not drift.
  const uint64_t startNs = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
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
      NSDictionary *result = @{@"where" : where, @"startNs" : @(startNs), @"events" : log, @"acks" : gTrace ?: @[], @"responder" : ResponderReport(hit)};
      gTrace = nil;
      next = nil;
      completion(result);
      return;
    }
    NSDictionary *s = steps[index++];
    NSString *phase = s[@"phase"];
    const double atMs = (clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - startNs) / 1e6;
    if ([phase isEqualToString:@"swipe"]) {
      BOOL handled = HandleDiscreteSwipe(window, inWindow, [s[@"dx"] doubleValue]);
      [log addObject:@{@"phase" : phase, @"swallowed" : @(handled)}];
    } else {
      NSEvent *event = SyntheticScroll(window, point, s, startNs);
      if (event.window != window || fabs(event.locationInWindow.x - inWindow.x) > 1 || fabs(event.locationInWindow.y - inWindow.y) > 1) {
        [log addObject:@{@"phase" : phase, @"error" : [NSString stringWithFormat:@"event window %@ at %@, expected %@",
                                                                  event.window, NSStringFromPoint(event.locationInWindow), NSStringFromPoint(inWindow)]}];
      }
      gRetargetCopyFailure = [s[@"retargetCopyFailure"] boolValue];
      gLegacyRecognition = [s[@"legacyRecognition"] boolValue];
      if ([s[@"dispatch"] isEqualToString:@"app"]) {
        // Through NSApp as AppKit delivers it; the monitor trace shows whether the tracker saw it.
        const NSUInteger mark = gTrace.count;
        [NSApp sendEvent:event];
        NSArray *during = [gTrace subarrayWithRange:NSMakeRange(mark, gTrace.count - mark)];
        NSDictionary *exit = nil;
        BOOL entered = NO;
        for (NSDictionary *entry in during) {
          if ([entry[@"diag"] isEqual:@"monitorEntry"]) entered = YES;
          if ([entry[@"diag"] isEqual:@"monitorExit"]) exit = entry;
        }
        [log addObject:@{
          @"phase" : phase,
          @"dispatch" : @"app",
          @"time" : @(event.timestamp),
          @"atMs" : @(atMs),
          @"lateMs" : s[@"atMs"] ? @(atMs - [s[@"atMs"] doubleValue]) : @0,
          @"nsPhase" : @(event.phase),
          @"nsMomentumPhase" : @(event.momentumPhase),
          @"scrollingDeltaX" : @(event.scrollingDeltaX),
          @"scrollingDeltaY" : @(event.scrollingDeltaY),
          @"monitorEntered" : @(entered),
          // Unknown unless the monitor ran.
          @"monitorSwallowed" : exit ? exit[@"swallowed"] : NSNull.null,
          @"seq" : @(gGesture.seq),
          @"state" : @((int)gGesture.state),
          @"targetWindow" : @(gGesture.target.window.windowNumber),
        }];
      } else {
        NSEvent *out = HandleScrollEvent(event, ignoreSystemPreference);
        [log addObject:@{
          @"phase" : phase,
          @"time" : @(event.timestamp),
          @"atMs" : @(atMs),
          @"lateMs" : s[@"atMs"] ? @(atMs - [s[@"atMs"] doubleValue]) : @0,
          @"nsPhase" : @(event.phase),
          @"nsMomentumPhase" : @(event.momentumPhase),
          @"scrollingDeltaX" : @(event.scrollingDeltaX),
          @"scrollingDeltaY" : @(event.scrollingDeltaY),
          @"seq" : @(gGesture.seq),
          @"state" : @((int)gGesture.state),
          @"swallowed" : @(out == nil),
          @"renderer" : gGesture.renderer ? @((int)gGesture.renderer.scroll) : @(-1),
          @"targetWindow" : @(gGesture.target.window.windowNumber),
          @"legacyRecognition" : @(gLegacyRecognition),
          @"retargetCopyFailure" : @(gRetargetCopyFailure),
        }];
        if (out) [window sendEvent:out];
      }
      gRetargetCopyFailure = NO;
      gLegacyRecognition = NO;
    }
    NSDictionary *following = index < steps.count ? steps[index] : nil;
    int64_t delayNs = following[@"atMs"]
                          ? (int64_t)(startNs + llround([following[@"atMs"] doubleValue] * 1e6)) - (int64_t)clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
                          : (int64_t)llround((s[@"delayMs"] ? [s[@"delayMs"] doubleValue] : 16) * 1e6);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, MAX(delayNs, (int64_t)0)), dispatch_get_main_queue(), next);
  };
  next = step;
  step();
}

@end
