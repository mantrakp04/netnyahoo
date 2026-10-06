// Loaded into the benchmark's copy of the app (DYLD_INSERT_LIBRARIES; native-bench.mjs builds it with clang): when a
// React root's content appears (React Native's RCTContentDidAppearNotification) and when the Core Animation
// transaction carrying it has committed, as JSON lines in $NETNYAHOO_DATA_DIR/bench-marks.jsonl. The same marks in
// any build, whatever it does with its windows meanwhile: 0.2.21 shows a new window empty and its content later,
// 0.2.22 keeps it transparent until its content is in.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

@interface CATransaction (NNMarkPrivate)
+ (void)addCommitHandler:(void (^)(void))block forPhase:(unsigned int)phase;
@end

static FILE *gOut;

static void Mark(NSString *key, NSInteger window) {
  fprintf(gOut, "{\"%s\":%.1f,\"window\":%ld}\n", key.UTF8String, NSDate.date.timeIntervalSince1970 * 1000, (long)window);
  fflush(gOut);
}

__attribute__((constructor)) static void Start(void) {
  const char *dir = getenv("NETNYAHOO_DATA_DIR");
  if (!dir) return;
  // Only the app: Chrome's helper processes inherit the environment.
  if (![NSBundle.mainBundle.bundlePath hasSuffix:@".app"] || [NSBundle.mainBundle.bundlePath containsString:@"Helper"]) return;
  gOut = fopen([NSString stringWithFormat:@"%s/bench-marks.jsonl", dir].UTF8String, "a");
  if (!gOut) return;
  // NN_BENCH_KEYLOG=1 (native-bench's journey phases): every key down the app's event loop sees, with the time the key was
  // made (the event's timestamp) and the time the app got to it, and the window it went to.
  if (getenv("NN_BENCH_KEYLOG")) {
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
      double now = NSDate.date.timeIntervalSince1970 * 1000;
      fprintf(gOut, "{\"keydown\":%.1f,\"made\":%.1f,\"window\":%ld,\"chars\":\"%s\"}\n", now,
              now - (NSProcessInfo.processInfo.systemUptime - event.timestamp) * 1000, (long)event.windowNumber, event.characters.UTF8String ?: "");
      fflush(gOut);
      return event;
    }];
  }
  [NSNotificationCenter.defaultCenter addObserverForName:@"RCTContentDidAppearNotification" object:nil queue:nil
                                              usingBlock:^(NSNotification *note) {
    NSInteger window = [note.object isKindOfClass:NSView.class] ? ((NSView *)note.object).window.windowNumber : 0;
    Mark(@"content", window);
    // Post-commit: the transaction this content went out in (a flush now, or the run loop's) has been committed.
    [CATransaction addCommitHandler:^{ Mark(@"committed", window); } forPhase:2];
  }];
}
