// Field timing for the opt-in journey telemetry (apps/browser/src/telemetry/journeys.ts): when the user's last key or
// click reached the app, when a React commit reached the screen, and what a tab's engine did (navigation requested,
// started, committed, first contentful paint, a hidden page's first frame once shown), as epoch-ms marks JS drains when
// it settles a journey. Nothing is recorded, and no event monitor runs, until JS turns it on, which it does only while
// the user shares diagnostics. A mark names the app's tab id and a kind; never a URL.
#import "NNCoreFieldTiming.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTUIManager.h>
#import <React/RCTUIManagerUtils.h>
#import <os/lock.h>

#include <atomic>
#include <cmath>

@interface CATransaction (NNFieldTimingPrivate)
+ (void)addCommitHandler:(void (^)(void))block forPhase:(unsigned int)phase;
@end

namespace {

// Marks JS hasn't drained yet: a journey settles within seconds and JS drains at least every minute while it waits.
constexpr NSUInteger kMaxMarks = 512;
// kCATransactionPhasePostCommit: the transaction went to the render server.
constexpr unsigned int kPostCommit = 2;

std::atomic<bool> gEnabled{false};
// The module (one per bridge) that set the state last: only it turns timing off as its bridge goes away.
std::atomic<uintptr_t> gOwner{0};
std::atomic<double> gLastInputAt{0};
std::atomic<int> gLastInputKind{0};
os_unfair_lock gLock = OS_UNFAIR_LOCK_INIT;
NSMutableArray<NSArray *> *gMarks;
id gInputMonitor;

// An event's time (seconds of uptime) as epoch ms: when the key or click happened, before the app got to it.
double EventTime(NSEvent *event) {
  return NNFieldNow() - (NSProcessInfo.processInfo.systemUptime - event.timestamp) * 1000;
}

void SetEnabled(bool enabled) {
  gEnabled = enabled;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (enabled && !gInputMonitor) {
      gInputMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown | NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp
                                                            handler:^NSEvent *(NSEvent *event) {
        gLastInputAt = EventTime(event);
        gLastInputKind = event.type == NSEventTypeKeyDown ? 1 : 2;
        return event;
      }];
    } else if (!enabled && gInputMonitor) {
      [NSEvent removeMonitor:gInputMonitor];
      gInputMonitor = nil;
    }
    // Pages loaded before a change start or stop reporting now, not at their next document.
    NNCoreWebViewsSetFieldTiming(gEnabled);
  });
  if (enabled) return;
  os_unfair_lock_lock(&gLock);
  [gMarks removeAllObjects];
  os_unfair_lock_unlock(&gLock);
}

}  // namespace

BOOL NNFieldTimingEnabled(void) {
  return gEnabled;
}

double NNFieldNow(void) {
  return NSDate.date.timeIntervalSince1970 * 1000;
}

void NNFieldMark(NSString *key, NSString *kind, double at) {
  if (!gEnabled || !key.length || !std::isfinite(at)) return;
  NSArray *mark = @[ key, kind, @(round(at * 10) / 10) ];
  os_unfair_lock_lock(&gLock);
  if (!gMarks) gMarks = [NSMutableArray array];
  if (gMarks.count >= kMaxMarks) [gMarks removeObjectAtIndex:0];
  [gMarks addObject:mark];
  os_unfair_lock_unlock(&gLock);
}

void NNFieldMarkNow(NSString *key, NSString *kind) {
  if (gEnabled) NNFieldMark(key, kind, NNFieldNow());
}

void NNFieldMarkAtCommit(NSString *key, NSString *kind) {
  if (!gEnabled || !key.length) return;
  NSString *k = [key copy];
  if ([CATransaction respondsToSelector:@selector(addCommitHandler:forPhase:)])
    [CATransaction addCommitHandler:^{ NNFieldMark(k, kind, NNFieldNow()); } forPhase:kPostCommit];
  else
    NNFieldMark(k, kind, NNFieldNow());
}

// JS's side (NativeModules.NNFieldTiming). Its queue is React Native's UI manager's, so a markFrame call is handled after
// the view updates of the commits JS made before it, and its block runs on the main thread in the same batch as them.
@interface NNFieldTimingModule : NSObject <RCTBridgeModule, RCTInvalidating>
@end

@implementation NNFieldTimingModule

@synthesize bridge = _bridge;

RCT_EXPORT_MODULE(NNFieldTiming)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (dispatch_queue_t)methodQueue {
  return RCTGetUIManagerQueue();
}

RCT_EXPORT_METHOD(setEnabled : (BOOL)enabled) {
  gOwner = (uintptr_t)(__bridge void *)self;
  SetEnabled(enabled);
}

// A reload (or the bridge going away) drops JS's calls still queued, its "off" among them: off, unless a newer bridge's
// JS has said since. The new JS always says at start (journeys.ts).
- (void)invalidate {
  uintptr_t me = (uintptr_t)(__bridge void *)self;
  if (gOwner.compare_exchange_strong(me, 0)) SetEnabled(false);
}

// `kind` for `key` when the views JS changed before this call are committed to the screen.
RCT_EXPORT_METHOD(markFrame : (NSString *)key kind : (NSString *)kind) {
  if (!gEnabled) return;
  NSString *k = [key copy], *what = [kind copy];
  [_bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, __unused NSDictionary *registry) {
    NNFieldMarkAtCommit(k, what);
  }];
}

// [epoch ms, 1 key | 2 click] of the last key down or click the app received ([0, 0]: none yet, or off).
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(lastInput) {
  return @[ @(round(gLastInputAt.load() * 10) / 10), @(gLastInputKind.load()) ];
}

// The marks so far, oldest first, as [key, kind, epoch ms]; they're gone from here after.
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(drain) {
  os_unfair_lock_lock(&gLock);
  NSArray *marks = gMarks.copy ?: @[];
  [gMarks removeAllObjects];
  os_unfair_lock_unlock(&gLock);
  return marks;
}

@end
