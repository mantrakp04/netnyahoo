// Keeps the app from taking focus on its own.
//
// - Chromium activates the app whenever it shows or focuses one of its windows
//   (NativeWidgetNSWindowBridge::SetVisibilityState, CocoaMouseCapture, the
//   AppController…). With Chrome-style tabs its windows are our app windows and
//   their dialogs and bubbles, so a page (an alert in a background tab, a password
//   bubble) could pull the app in front of whatever the user is doing. Only the
//   user (clicking our window, the Dock, a notification) activates the app:
//   requests coming from Chromium while the app is inactive are dropped, unless
//   they're handling the user's own click or key press.
// - NETNYAHOO_BACKGROUND=1 (test instances next to someone's work): nothing
//   activates the app at all. Its activation policy is "prohibited", every
//   activation API is blocked, and should it become active anyway it
//   deactivates at once.
//
// Blocked attempts and unexpected activations are logged with their call stack
// to $NETNYAHOO_DATA_DIR/activation.log.
#import "NNCefInternal.h"

#import <objc/runtime.h>

namespace nn::activation {

namespace {

NSString *LogPath() {
  const char *dir = getenv("NETNYAHOO_DATA_DIR");
  return dir ? [@(dir) stringByAppendingPathComponent:@"activation.log"] : nil;
}

void Log(NSString *what, NSArray<NSString *> *stack) {
  NSString *path = LogPath();
  if (!path) return;
  NSMutableString *line = [NSMutableString stringWithFormat:@"%@ %@\n", NSDate.date, what];
  for (NSString *frame in [stack subarrayWithRange:NSMakeRange(0, MIN(stack.count, (NSUInteger)40))])
    [line appendFormat:@"    %@\n", frame];
  NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!file) {
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
    file = [NSFileHandle fileHandleForWritingAtPath:path];
  }
  [file seekToEndOfFile];
  [file writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
  [file closeFile];
}

bool FromChromium(NSArray<NSString *> *stack) {
  for (NSString *frame in stack)
    if ([frame containsString:@"Chromium Embedded Framework"]) return true;
  return false;
}

template <typename Block>
void Swizzle(Class cls, SEL selector, Block block) {
  Method method = class_getInstanceMethod(cls, selector);
  if (!method) return;
  method_setImplementation(method, imp_implementationWithBlock(block));
}

/// Background instances that become active anyway give it straight back.
void ObserveActivation() {
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                Log(@"became active (deactivating)", NSThread.callStackSymbols);
                                                [NSApp deactivate];
                                              }];
}

}  // namespace

bool Background() {
  static bool background = getenv("NETNYAHOO_BACKGROUND") != nullptr;
  return background;
}

/// The event being handled is the user's own click or key press.
bool UserEvent() {
  switch (NSApp.currentEvent.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeRightMouseDown:
    case NSEventTypeOtherMouseDown:
    case NSEventTypeKeyDown:
      return true;
    default:
      return false;
  }
}

bool Allow(NSString *what) {
  if (!Background() && (NSApp.isActive || UserEvent())) return true;
  NSArray<NSString *> *stack = NSThread.callStackSymbols;
  if (Background() || FromChromium(stack)) {
    Log([@"blocked " stringByAppendingString:what], stack);
    return false;
  }
  return true;
}

void Install() {
  static bool installed = false;
  if (installed) return;
  installed = true;

  // Activation that doesn't go through NSApp (NNApplication guards those).
  Method activate = class_getInstanceMethod(NSRunningApplication.class, @selector(activateWithOptions:));
  auto originalActivate = (BOOL (*)(id, SEL, NSApplicationActivationOptions))method_getImplementation(activate);
  Swizzle(NSRunningApplication.class, @selector(activateWithOptions:), ^BOOL(NSRunningApplication *app, NSApplicationActivationOptions options) {
    if ([app isEqual:NSRunningApplication.currentApplication] && !Allow(@"activateWithOptions:")) return NO;
    return originalActivate(app, @selector(activateWithOptions:), options);
  });

  if (!Background()) return;
  // Windows ordered front or made key while the app is inactive: logged, to find what
  // tries to bring a test instance forward.
  auto note = [](NSString *name, NSWindow *window) {
    if (!NSApp.isActive)
      Log([NSString stringWithFormat:@"%@ on %@ \"%@\" (inactive app)", name, window.className, window.title],
          NSThread.callStackSymbols);
  };
  {
    // - (void)makeKeyAndOrderFront:(id)sender
    SEL selector = @selector(makeKeyAndOrderFront:);
    auto original = (void (*)(id, SEL, id))method_getImplementation(class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^(NSWindow *window, id sender) {
      note(@"makeKeyAndOrderFront:", window);
      original(window, selector, sender);
    });
  }
  // - (void)makeKeyWindow, - (void)orderFrontRegardless: no arguments.
  for (NSString *name in @[ @"makeKeyWindow", @"orderFrontRegardless" ]) {
    SEL selector = NSSelectorFromString(name);
    auto original = (void (*)(id, SEL))method_getImplementation(class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^(NSWindow *window) {
      note(name, window);
      original(window, selector);
    });
  }
  Swizzle(NSApplication.class, @selector(unhide:), ^(NSApplication *app, id sender) {
    Log(@"unhide: (unhiding without activation)", NSThread.callStackSymbols);
    [app unhideWithoutActivation];
  });
  // Never a regular app: no Dock icon, no menu bar, and the window server won't make
  // it the front process. (An `open -g` launch still asks LaunchServices to bring the
  // app forward once it shows a window; seen on test instances at 09:16 and 09:20.)
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  Method policy = class_getInstanceMethod(NSApplication.class, @selector(setActivationPolicy:));
  auto originalPolicy = (BOOL (*)(id, SEL, NSApplicationActivationPolicy))method_getImplementation(policy);
  Swizzle(NSApplication.class, @selector(setActivationPolicy:), ^BOOL(NSApplication *app, NSApplicationActivationPolicy value) {
    if (value != NSApplicationActivationPolicyProhibited) Log(@"blocked setActivationPolicy:", NSThread.callStackSymbols);
    return originalPolicy(app, @selector(setActivationPolicy:), NSApplicationActivationPolicyProhibited);
  });
  ObserveActivation();
}

}  // namespace nn::activation
