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
//   deactivates at once. Context menus and open / save panels, which would show over
//   everyone's work anyway, are logged instead of shown.
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

// Open and save panels (a page's <input type=file>, Save As…) show above every app as well, so
// test instances log what the panel would have been and answer it at once: with the files
// listed in $NETNYAHOO_DATA_DIR/file-chooser.txt (one path per line, used once), or Cancel.
const void *kPicksKey = &kPicksKey;

NSArray<NSURL *> *TakePicks() {
  const char *dir = getenv("NETNYAHOO_DATA_DIR");
  if (!dir) return nil;
  NSString *path = [@(dir) stringByAppendingPathComponent:@"file-chooser.txt"];
  NSString *text = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
  if (!text) return nil;
  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  NSMutableArray<NSURL *> *urls = [NSMutableArray array];
  for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet])
    if (line.length) [urls addObject:[NSURL fileURLWithPath:line]];
  return urls.count ? urls : nil;
}

/// The panel's URL / URLs answer with the picked files (the panel never ran, so it has none).
void ReturnPicks(NSSavePanel *panel, NSArray<NSURL *> *picks) {
  objc_setAssociatedObject(panel, kPicksKey, picks, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  static NSMutableSet<NSValue *> *patched = [NSMutableSet set];
  for (SEL selector : {@selector(URLs), @selector(URL)}) {
    Method method = class_getInstanceMethod(object_getClass(panel), selector);
    if (!method || [patched containsObject:[NSValue valueWithPointer:method]]) continue;
    [patched addObject:[NSValue valueWithPointer:method]];
    auto original = (id (*)(id, SEL))method_getImplementation(method);
    const bool many = selector == @selector(URLs);
    method_setImplementation(method, imp_implementationWithBlock(^id(id self) {
      NSArray<NSURL *> *urls = objc_getAssociatedObject(self, kPicksKey);
      if (urls) return many ? urls : urls.firstObject;
      return original(self, selector);
    }));
  }
}

NSString *DescribePanel(NSSavePanel *panel, NSWindow *parent, NSString *how) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  const bool open = [panel isKindOfClass:NSOpenPanel.class];
  [parts addObject:[NSString stringWithFormat:@"%@ panel (not shown): %@", open ? @"open" : @"save", how]];
  if (parent)
    [parts addObject:[NSString stringWithFormat:@"parent %@ #%ld \"%@\"%@", parent.className, (long)parent.windowNumber,
                                                parent.title, parent.isVisible ? @"" : @" (hidden)"]];
  if (open) {
    NSOpenPanel *o = (NSOpenPanel *)panel;
    [parts addObject:[NSString stringWithFormat:@"multiple=%d files=%d directories=%d", o.allowsMultipleSelection,
                                                o.canChooseFiles, o.canChooseDirectories]];
  } else {
    [parts addObject:[NSString stringWithFormat:@"name=\"%@\"", panel.nameFieldStringValue]];
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [parts addObject:[NSString stringWithFormat:@"types=%@ others=%d",
                                              panel.allowedFileTypes ? [panel.allowedFileTypes componentsJoinedByString:@","] : @"*",
                                              panel.allowsOtherFileTypes]];
#pragma clang diagnostic pop
  // Chrome's accept list is a popup in the accessory view ("Custom Files", "All Files").
  NSMutableArray<NSView *> *views = panel.accessoryView ? [NSMutableArray arrayWithObject:panel.accessoryView] : [NSMutableArray array];
  while (views.count) {
    NSView *v = views.lastObject;
    [views removeLastObject];
    if ([v isKindOfClass:NSPopUpButton.class])
      [parts addObject:[NSString stringWithFormat:@"popup=[%@] selected=%ld", [((NSPopUpButton *)v).itemTitles componentsJoinedByString:@"|"],
                                                  (long)((NSPopUpButton *)v).indexOfSelectedItem]];
    [views addObjectsFromArray:v.subviews];
  }
  if (panel.directoryURL) [parts addObject:[NSString stringWithFormat:@"directory=%@", panel.directoryURL.path]];
  return [parts componentsJoinedByString:@" | "];
}

/// Logs the panel and answers it (on the next turn of the run loop, as a real panel would).
NSModalResponse AnswerPanel(NSSavePanel *panel, NSWindow *parent, NSString *how) {
  NSArray<NSURL *> *picks = TakePicks();
  NSString *answer = picks ? [NSString stringWithFormat:@"chose %@", [[picks valueForKey:@"path"] componentsJoinedByString:@", "]]
                           : @"cancelled";
  Log([NSString stringWithFormat:@"%@ | %@", DescribePanel(panel, parent, how), answer], @[]);
  if (picks) ReturnPicks(panel, picks);
  return picks ? NSModalResponseOK : NSModalResponseCancel;
}

void InterceptFilePanels() {
  // NSOpenPanel may implement these itself.
  for (Class cls : {NSSavePanel.class, NSOpenPanel.class}) {
    Swizzle(cls, @selector(beginSheetModalForWindow:completionHandler:),
            ^(NSSavePanel *panel, NSWindow *window, void (^handler)(NSModalResponse)) {
              NSModalResponse response = AnswerPanel(panel, window, @"sheet");
              if (handler) dispatch_async(dispatch_get_main_queue(), ^{ handler(response); });
            });
    Swizzle(cls, @selector(beginWithCompletionHandler:), ^(NSSavePanel *panel, void (^handler)(NSModalResponse)) {
      NSModalResponse response = AnswerPanel(panel, nil, [NSString stringWithFormat:@"free-standing, level %ld", (long)panel.level]);
      if (handler) dispatch_async(dispatch_get_main_queue(), ^{ handler(response); });
    });
    Swizzle(cls, @selector(runModal), ^NSModalResponse(NSSavePanel *panel) { return AnswerPanel(panel, nil, @"app-modal"); });
  }
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
  // A context menu is drawn above every app, even from a process that can never be active:
  // the release smoke test's right-click popped a menu up over the user's work. Test
  // instances log the menu (its items, for the smoke test) instead of showing it, and tell
  // its delegate it opened and closed, as if dismissed at once.
  Method popUp = class_getClassMethod(NSMenu.class, @selector(popUpContextMenu:withEvent:forView:));
  method_setImplementation(popUp, imp_implementationWithBlock(^(id, NSMenu *menu, NSEvent *, NSView *) {
    NSMutableArray<NSString *> *titles = [NSMutableArray array];
    for (NSMenuItem *item in menu.itemArray)
      if (!item.isSeparatorItem && item.title.length) [titles addObject:item.title];
    Log([NSString stringWithFormat:@"context menu (not shown): %@", [titles componentsJoinedByString:@" | "]], @[]);
    id<NSMenuDelegate> delegate = menu.delegate;
    if ([delegate respondsToSelector:@selector(menuWillOpen:)]) [delegate menuWillOpen:menu];
    if ([delegate respondsToSelector:@selector(menuDidClose:)]) [delegate menuDidClose:menu];
  }));
  InterceptFilePanels();
}

}  // namespace nn::activation
