// Test instances must never activate or show menus and panels. NNCore's copy of packages/cef/ios/NNActivation.mm:
// the class swizzles go in before ChromeMain (NSApp doesn't exist yet), the activation policy once Chrome made NSApp.
#import "NNCoreInternal.h"

#include <execinfo.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

#import <objc/runtime.h>

#include <initializer_list>
#include <vector>

namespace nncore_host {

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

// The same, symbolicated and written off the main thread: a test instance's window calls (every new window's
// makeKeyAndOrderFront:) took ~12 ms each to symbolicate a stack through Chromium's symbol table, which the window
// benchmarks counted.
void LogLater(NSString *what, NSArray<NSNumber *> *addresses) {
  static dispatch_queue_t queue = dispatch_queue_create("netnyahoo.activation-log", DISPATCH_QUEUE_SERIAL);
  dispatch_async(queue, ^{
    std::vector<void *> frames;
    for (NSNumber *address in addresses) frames.push_back((void *)address.unsignedLongValue);
    char **symbols = backtrace_symbols(frames.data(), (int)frames.size());
    NSMutableArray<NSString *> *stack = [NSMutableArray array];
    for (size_t i = 0; symbols && i < frames.size(); i++) [stack addObject:@(symbols[i])];
    free(symbols);
    Log(what, stack);
  });
}

bool FromChromium(NSArray<NSString *> *stack) {
  for (NSString *frame in stack)
    if ([frame containsString:@"Chromium Framework"]) return true;
  return false;
}

template <typename Block>
void Swizzle(Class cls, SEL selector, Block block) {
  Method method = class_getInstanceMethod(cls, selector);
  if (!method) return;
  method_setImplementation(method, imp_implementationWithBlock(block));
}

void ObserveActivation() {
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                Log(@"became active (deactivating)", NSThread.callStackSymbols);
                                                [NSApp deactivate];
                                              }];
}

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

NSModalResponse AnswerPanel(NSSavePanel *panel, NSWindow *parent, NSString *how) {
  NSArray<NSURL *> *picks = TakePicks();
  NSString *answer = picks ? [NSString stringWithFormat:@"chose %@", [[picks valueForKey:@"path"] componentsJoinedByString:@", "]]
                           : @"cancelled";
  Log([NSString stringWithFormat:@"%@ | %@", DescribePanel(panel, parent, how), answer], @[]);
  if (picks) ReturnPicks(panel, picks);
  return picks ? NSModalResponseOK : NSModalResponseCancel;
}

void InterceptFilePanels() {
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

}

bool Background() {
  static bool background = getenv("NETNYAHOO_BACKGROUND") != nullptr;
  return background;
}

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

void InstallActivationGuardsEarly() {
  static bool installed = false;
  if (installed) return;
  installed = true;

  Method activate = class_getInstanceMethod(NSRunningApplication.class, @selector(activateWithOptions:));
  auto originalActivate = (BOOL (*)(id, SEL, NSApplicationActivationOptions))method_getImplementation(activate);
  Swizzle(NSRunningApplication.class, @selector(activateWithOptions:), ^BOOL(NSRunningApplication *app, NSApplicationActivationOptions options) {
    if ([app isEqual:NSRunningApplication.currentApplication] && !Allow(@"activateWithOptions:")) return NO;
    return originalActivate(app, @selector(activateWithOptions:), options);
  });

  if (!Background()) return;
  auto note = [](NSString *name, NSWindow *window) {
    if (!NSApp.isActive)
      LogLater([NSString stringWithFormat:@"%@ on %@ #%ld \"%@\" (inactive app)", name, window.className,
                                          (long)window.windowNumber, window.title],
               NSThread.callStackReturnAddresses);
  };
  // A child window ordered to the front (Chrome's bubbles: "extension added", save card…) would come up
  // over the user's other apps while its window stays behind them. Keep it just above its parent.
  auto aboveParent = [](NSWindow *window) {
    NSWindow *parent = window.parentWindow;
    if (!parent) return false;
    [window orderWindow:NSWindowAbove relativeTo:parent.windowNumber];
    return true;
  };
  {
    SEL selector = @selector(makeKeyAndOrderFront:);
    auto original = (void (*)(id, SEL, id))method_getImplementation(class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^(NSWindow *window, id sender) {
      note(@"makeKeyAndOrderFront:", window);
      if (aboveParent(window)) [window makeKeyWindow];
      else original(window, selector, sender);
      NoteFocusIntent(window);
    });
  }
  for (NSString *name in @[ @"makeKeyWindow", @"orderFrontRegardless" ]) {
    SEL selector = NSSelectorFromString(name);
    auto original = (void (*)(id, SEL))method_getImplementation(class_getInstanceMethod(NSWindow.class, selector));
    const bool ordersFront = [name isEqualToString:@"orderFrontRegardless"];
    Swizzle(NSWindow.class, selector, ^(NSWindow *window) {
      note(name, window);
      if (!ordersFront || !aboveParent(window)) original(window, selector);
      if (!ordersFront) NoteFocusIntent(window);
    });
  }
  Swizzle(NSApplication.class, @selector(unhide:), ^(NSApplication *app, id sender) {
    Log(@"unhide: (unhiding without activation)", NSThread.callStackSymbols);
    [app unhideWithoutActivation];
  });
  Method policy = class_getInstanceMethod(NSApplication.class, @selector(setActivationPolicy:));
  auto originalPolicy = (BOOL (*)(id, SEL, NSApplicationActivationPolicy))method_getImplementation(policy);
  Swizzle(NSApplication.class, @selector(setActivationPolicy:), ^BOOL(NSApplication *app, NSApplicationActivationPolicy value) {
    if (value != NSApplicationActivationPolicyProhibited) Log(@"blocked setActivationPolicy:", NSThread.callStackSymbols);
    return originalPolicy(app, @selector(setActivationPolicy:), NSApplicationActivationPolicyProhibited);
  });
  ObserveActivation();
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

namespace {

char gCrashDir[1024];

void WriteAll(int fd, const char *text) {
  for (size_t left = strlen(text); left > 0;) {
    const ssize_t n = write(fd, text, left);
    if (n <= 0) return;
    text += n;
    left -= (size_t)n;
  }
}

// Async-signal-safe enough for a dying test instance: a record, then a plain exit, so the kernel never makes a crash
// report of it (no ReportCrash, no dialog, no focus change).
void OnFatalSignal(int sig) {
  char path[1200], number[32];
  int len = snprintf(path, sizeof(path), "%s/crash-%d.txt", gCrashDir, getpid());
  const int fd = len > 0 ? open(path, O_WRONLY | O_CREAT | O_APPEND, 0644) : -1;
  if (fd >= 0) {
    snprintf(number, sizeof(number), "%d", sig);
    WriteAll(fd, "signal ");
    WriteAll(fd, number);
    WriteAll(fd, sig < NSIG ? " (" : "");
    WriteAll(fd, sig < NSIG ? sys_signame[sig] : "");
    WriteAll(fd, sig < NSIG ? ")\n" : "\n");
    void *frames[128];
    backtrace_symbols_fd(frames, backtrace(frames, 128), fd);
    close(fd);
  }
  _exit(128 + sig);
}

}  // namespace

void InstallTestCrashGuard(NSString *dataDir) {
  if (!dataDir.length) return;
  NSString *dir = [dataDir stringByAppendingPathComponent:@"crashes"];
  [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  strlcpy(gCrashDir, dir.fileSystemRepresentation, sizeof(gCrashDir));
  // Its own stack: a stack overflow still gets a record.
  static char altStack[64 * 1024];
  stack_t ss = {.ss_sp = altStack, .ss_size = sizeof(altStack), .ss_flags = 0};
  sigaltstack(&ss, nullptr);
  struct sigaction action = {};
  action.sa_handler = OnFatalSignal;
  action.sa_flags = SA_ONSTACK | SA_RESETHAND;
  sigemptyset(&action.sa_mask);
  for (int sig : {SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE, SIGSYS}) sigaction(sig, &action, nullptr);
}

void LogActivation(NSString *what) {
  Log(what, @[]);
}

void InstallActivationGuardsLate() {
  if (Background()) [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
}

}  // namespace nncore_host
