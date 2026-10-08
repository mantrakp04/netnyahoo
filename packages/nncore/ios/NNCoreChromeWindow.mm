// NNChromeWindowHost on NNCore: the class packages/shell's ChromeWindows looks up by name. Each app window is
// one NNCoreWindow (a Views-backed NSWindow, so Chrome's bubbles and dialogs attach to it) holding a Chrome
// Browser per profile shown in it. Paging between profiles is a change of the active profile, never a window
// swap, so swappedHandler never fires here.
#import "NNChromeWindow.h"
#import "NNCoreInternal.h"
#import "NNCoreWebView.h"
#import "NNCoreWebViewInternal.h"
#import "NNCoreServices.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include <initializer_list>

namespace {

BOOL (^gShouldClose)(NSWindow *);
void (^gSwapped)(NSWindow *, NSWindow *);

NSMapTable<NSWindow *, NNCoreWindowController *> *Controllers() {
  static NSMapTable *controllers = [NSMapTable weakToStrongObjectsMapTable];
  return controllers;
}

NSColor *WindowColor() {
  return [NSColor colorWithName:nil
                dynamicProvider:^NSColor *(NSAppearance *appearance) {
                  const bool dark = [[appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
                      isEqualToString:NSAppearanceNameDarkAqua];
                  return dark ? [NSColor colorWithSRGBRed:0.17 green:0.12 blue:0.14 alpha:1]
                              : [NSColor colorWithSRGBRed:0.93 green:0.91 blue:0.90 alpha:1];
                }];
}

// MARK: Traffic lights

// The close button's top-left from the window's top-left, as the CEF build's window had it (Chrome's browser frame
// made AppKit's title bar as tall as its tab strip, which centred the buttons there): its centre at (25, 27); Dia's is
// at (25, 26). The app can centre them elsewhere (setTrafficLightsCenter:inWindow:).
constexpr CGFloat kTrafficLightInsetX = 18;
constexpr CGFloat kTrafficLightTop = 20;
const void *kInsetLightsKey = &kInsetLightsKey;
const void *kLightsCenterKey = &kLightsCenterKey;

// MARK: Test hook: every change to the traffic lights (NETNYAHOO_TRAFFIC_LIGHTS_LOG=<file>, test instances only)

// One line per frame, visibility or alpha change of a window's buttons or the title bar views holding them, per style
// mask change and per AppKit layout pass of the buttons ("layout"), each with the close button's top-left from the
// window's top-left right then and the caller. Tab operations may lay the buttons out but must never move, hide or fade
// them (acceptance: traffic-lights-steady).
const void *kLoggedKey = &kLoggedKey;
NSFileHandle *gLightsLog;

// "close=(x,y) mini=(x,y) zoom=(x,y) hidden=0 alpha=1.00": each button's top-left from the window's top-left.
NSString *LightsState(NSWindow *window) {
  NSMutableString *state = [NSMutableString string];
  BOOL hidden = NO;
  CGFloat alpha = 1;
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
    NSButton *button = [window standardWindowButton:kind];
    if (!button) return @"no buttons";
    const NSRect r = [button convertRect:button.bounds toView:nil];
    [state appendFormat:@"%@=(%.1f,%.1f) ", kind == NSWindowCloseButton ? @"close" : kind == NSWindowZoomButton ? @"zoom" : @"mini",
                        NSMinX(r), NSHeight(window.frame) - NSMaxY(r)];
    hidden |= button.hiddenOrHasHiddenAncestor;
    CGFloat opacity = 1;  // As drawn: a title bar view above the button can fade it too.
    for (NSView *view = button; view && view != window.contentView.superview; view = view.superview) opacity *= view.alphaValue;
    alpha = MIN(alpha, opacity);
  }
  [state appendFormat:@"hidden=%d alpha=%.2f", hidden, alpha];
  return state;
}

void LogLights(NSWindow *window, NSString *what) {
  if (!gLightsLog || !window) return;
  NSArray<NSString *> *stack = NSThread.callStackSymbols;
  NSMutableArray<NSString *> *callers = [NSMutableArray array];
  for (NSUInteger i = 2; i < stack.count && callers.count < 8; i++) {
    NSString *frame = stack[i];
    const NSRange at = [frame rangeOfString:@"0x"];
    NSString *symbol = at.location == NSNotFound ? frame : [frame substringFromIndex:at.location];
    const NSRange space = [symbol rangeOfString:@" "];
    [callers addObject:space.location == NSNotFound ? symbol : [symbol substringFromIndex:space.location + 1]];
  }
  NSString *line = [NSString stringWithFormat:@"%.3f window=%ld %@ -> %@ | %@\n", NSProcessInfo.processInfo.systemUptime,
                                              (long)window.windowNumber, what, LightsState(window),
                                              [callers componentsJoinedByString:@" < "]];
  // A failed write ends the log; it never throws into AppKit's layout.
  if (![gLightsLog writeData:[line dataUsingEncoding:NSUTF8StringEncoding] error:nil]) gLightsLog = nil;
}

void Swizzle(Class cls, SEL sel, id (^make)(IMP original)) {
  Method method = class_getInstanceMethod(cls, sel);
  IMP original = method_getImplementation(method);
  method_setImplementation(method, imp_implementationWithBlock(make(original)));
}

void InstallTrafficLightsLog() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *path = NSProcessInfo.processInfo.environment[@"NETNYAHOO_TRAFFIC_LIGHTS_LOG"];
    if (!path.length) return;
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
    gLightsLog = [NSFileHandle fileHandleForWritingAtPath:path];
    if (!gLightsLog || ![gLightsLog seekToEndReturningOffset:nil error:nil]) {
      gLightsLog = nil;
      return;
    }
    auto logged = ^NSWindow *(NSView *view) { return objc_getAssociatedObject(view, kLoggedKey) ? view.window : nil; };
    Swizzle(NSView.class, @selector(setFrameOrigin:), ^id(IMP original) {
      return ^(NSView *self, NSPoint origin) {
        const NSRect before = self.frame;
        ((void (*)(id, SEL, NSPoint))original)(self, @selector(setFrameOrigin:), origin);
        if (NSWindow *window = logged(self); window && !NSEqualRects(before, self.frame))
          LogLights(window, [NSString stringWithFormat:@"%@ setFrameOrigin %@", self.className, NSStringFromPoint(origin)]);
      };
    });
    Swizzle(NSView.class, @selector(setFrameSize:), ^id(IMP original) {
      return ^(NSView *self, NSSize size) {
        const NSRect before = self.frame;
        ((void (*)(id, SEL, NSSize))original)(self, @selector(setFrameSize:), size);
        if (NSWindow *window = logged(self); window && !NSEqualRects(before, self.frame))
          LogLights(window, [NSString stringWithFormat:@"%@ setFrameSize %@", self.className, NSStringFromSize(size)]);
      };
    });
    Swizzle(NSView.class, @selector(setFrame:), ^id(IMP original) {
      return ^(NSView *self, NSRect frame) {
        const NSRect before = self.frame;
        ((void (*)(id, SEL, NSRect))original)(self, @selector(setFrame:), frame);
        if (NSWindow *window = logged(self); window && !NSEqualRects(before, self.frame))
          LogLights(window, [NSString stringWithFormat:@"%@ setFrame %@", self.className, NSStringFromRect(frame)]);
      };
    });
    Swizzle(NSView.class, @selector(setHidden:), ^id(IMP original) {
      return ^(NSView *self, BOOL hidden) {
        const BOOL before = self.hidden;
        ((void (*)(id, SEL, BOOL))original)(self, @selector(setHidden:), hidden);
        if (NSWindow *window = logged(self); window && before != hidden)
          LogLights(window, [NSString stringWithFormat:@"%@ setHidden %d", self.className, hidden]);
      };
    });
    Swizzle(NSView.class, @selector(setAlphaValue:), ^id(IMP original) {
      return ^(NSView *self, CGFloat alpha) {
        const CGFloat before = self.alphaValue;
        ((void (*)(id, SEL, CGFloat))original)(self, @selector(setAlphaValue:), alpha);
        if (NSWindow *window = logged(self); window && before != alpha)
          LogLights(window, [NSString stringWithFormat:@"%@ setAlphaValue %.2f", self.className, alpha]);
      };
    });
    const SEL layout = NSSelectorFromString(@"_updateButtonPositions");
    if (Class themeFrame = NSClassFromString(@"NSThemeFrame"); class_getInstanceMethod(themeFrame, layout))
      Swizzle(themeFrame, layout, ^id(IMP original) {
        return ^(NSView *self) {
          ((void (*)(id, SEL))original)(self, layout);
          if (objc_getAssociatedObject(self.window, kLoggedKey)) LogLights(self.window, @"layout");
        };
      });
    Swizzle(NSWindow.class, @selector(setStyleMask:), ^id(IMP original) {
      return ^(NSWindow *self, NSWindowStyleMask mask) {
        const NSWindowStyleMask before = self.styleMask;
        ((void (*)(id, SEL, NSWindowStyleMask))original)(self, @selector(setStyleMask:), mask);
        if (objc_getAssociatedObject(self, kLoggedKey) && before != mask)
          LogLights(self, [NSString stringWithFormat:@"setStyleMask %#llx -> %#llx", (unsigned long long)before, (unsigned long long)mask]);
      };
    });
  });
}

// Logs the window's buttons and the title bar views above them (each layout pass may replace none of them).
void LogTrafficLightsOf(NSWindow *window) {
  if (!gLightsLog || !window) return;
  objc_setAssociatedObject(window, kLoggedKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton})
    for (NSView *view = [window standardWindowButton:kind]; view && view != window.contentView.superview; view = view.superview)
      objc_setAssociatedObject(view, kLoggedKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

// AppKit lays the title bar out again on every title change (a tab switch or close renames the window), style, key or
// size change, and each pass puts the buttons where the frame view's -_closeButtonOrigin says (minimise and zoom
// follow it). Answering it for our windows keeps the buttons at the app's spot in every pass. Moving them back after
// AppKit's pass (on the next window update or notification) showed them at AppKit's (9, 9) for 10–430 ms at each tab
// switch or close.
void InstallTrafficLightsOrigin(Class frameClass) {
  static NSMutableSet<Class> *installed = [NSMutableSet set];
  if (!frameClass || [installed containsObject:frameClass]) return;
  [installed addObject:frameClass];
  const SEL sel = NSSelectorFromString(@"_closeButtonOrigin");
  Method method = class_getInstanceMethod(frameClass, sel);
  if (!method) return;  // An AppKit without it: the buttons stay at its standard place.
  const IMP standard = method_getImplementation(method);
  const IMP ours = imp_implementationWithBlock(^NSPoint(NSView *frameView) {
    NSWindow *window = frameView.window;
    if (!window || !objc_getAssociatedObject(window, kInsetLightsKey) || (window.styleMask & NSWindowStyleMaskFullScreen))
      return ((NSPoint (*)(id, SEL))standard)(frameView, sel);
    // The frame view's coordinates: the whole window, y up.
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    const NSSize size = close ? close.frame.size : NSMakeSize(14, 14);
    const CGFloat height = NSHeight(frameView.bounds);
    if (NSValue *center = objc_getAssociatedObject(window, kLightsCenterKey))
      return NSMakePoint(center.pointValue.x - size.width / 2, height - center.pointValue.y - size.height / 2);
    return NSMakePoint(kTrafficLightInsetX, height - kTrafficLightTop - size.height);
  });
  // Chrome's frame class inherits NSThemeFrame's: add the override there (or replace its own, if it has one).
  if (!class_addMethod(frameClass, sel, ours, method_getTypeEncoding(method))) method_setImplementation(method, ours);
}

// AppKit's layout pass for the buttons, run now (the app moved their spot).
void RetileTrafficLights(NSWindow *window) {
  NSView *frameView = window.contentView.superview;
  const SEL sel = NSSelectorFromString(@"_updateButtonPositions");
  if ([frameView respondsToSelector:sel]) ((void (*)(id, SEL))objc_msgSend)(frameView, sel);
}

// MARK: Lights that move every frame

// The sidebar's slide and its peek move the lights every frame (SidebarDock.tsx). Laid out at each step, the buttons'
// frames moved, and AppKit answers a title-bar button's move by recomputing the window's drag regions on its next display
// cycle: walks of every view (the window's minimum size from its constraints, the standard-button search), 5-7 ms with
// the 200-tab sidebar's 3200 views, a dropped frame at 120 Hz each time. So a move is drawn by translating the buttons'
// layers, and they are laid out at the new spot (one recompute) once they have held still for kLightsSettle.
const void *kLightsShownKey = &kLightsShownKey;  // where they are drawn while that differs from their layout (NSNull: AppKit's)
const void *kLightsMoveKey = &kLightsMoveKey;    // the latest move, so only its settle lays them out
constexpr int64_t kLightsSettle = 50 * NSEC_PER_MSEC;

NSArray<NSButton *> *TrafficLightButtons(NSWindow *window) {
  NSMutableArray *buttons = [NSMutableArray array];
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton})
    if (NSButton *button = [window standardWindowButton:kind]) [buttons addObject:button];
  return buttons;
}

// The close button's centre (window top-left points) at `center`, or at its own spot when nil (-_closeButtonOrigin above).
NSPoint LightsCenter(NSValue *center, NSSize size) {
  return center ? center.pointValue : NSMakePoint(kTrafficLightInsetX + size.width / 2, kTrafficLightTop + size.height / 2);
}

void TranslateTrafficLights(NSArray<NSButton *> *buttons, CGFloat dx) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSButton *button in buttons) button.layer.affineTransform = CGAffineTransformMakeTranslation(dx, 0);
  [CATransaction commit];
}

// Lays the buttons out where they're drawn and drops the translation, in one transaction (no frame shows either alone).
void SettleTrafficLights(NSWindow *window) {
  id shown = objc_getAssociatedObject(window, kLightsShownKey);
  if (!shown) return;
  objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  objc_setAssociatedObject(window, kLightsCenterKey, shown == NSNull.null ? nil : shown, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  TranslateTrafficLights(TrafficLightButtons(window), 0);
  RetileTrafficLights(window);
  [CATransaction commit];
}

// Draws the lights centred at `center` (nil: AppKit's spot) without laying them out, and lays them out there once they
// hold still. NO when that can't be drawn as a translation (full screen, a vertical move, buttons without layers).
bool MoveTrafficLights(NSWindow *window, NSValue *center) {
  NSArray<NSButton *> *buttons = TrafficLightButtons(window);
  if (!buttons.count || !objc_getAssociatedObject(window, kInsetLightsKey) || (window.styleMask & NSWindowStyleMaskFullScreen))
    return false;
  for (NSButton *button in buttons)
    if (!button.layer) return false;
  const NSSize size = buttons[0].frame.size;
  const NSPoint laidOut = LightsCenter(objc_getAssociatedObject(window, kLightsCenterKey), size), to = LightsCenter(center, size);
  if (to.y != laidOut.y) return false;
  TranslateTrafficLights(buttons, to.x - laidOut.x);
  if (to.x == laidOut.x) {  // back where they're laid out: nothing to settle
    objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, kLightsMoveKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return true;
  }
  objc_setAssociatedObject(window, kLightsShownKey, center ?: NSNull.null, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  NSObject *move = [[NSObject alloc] init];
  objc_setAssociatedObject(window, kLightsMoveKey, move, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  __weak NSWindow *weakWindow = window;
  __weak NSObject *weakMove = move;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kLightsSettle), dispatch_get_main_queue(), ^{
    // A later move replaced this one (and released it): that one settles.
    if (NSWindow *w = weakWindow; w && weakMove) SettleTrafficLights(w);
  });
  return true;
}

void InsetTrafficLights(NSWindow *window) {
  objc_setAssociatedObject(window, kInsetLightsKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  InstallTrafficLightsOrigin(object_getClass(window.contentView.superview));
  RetileTrafficLights(window);
  LogTrafficLightsOf(window);
}

void ConfigureWindow(NSWindow *window) {
  InstallTrafficLightsLog();
  // AppKit keeps the content rect through a style change: going full-size content, the window would lose its title
  // bar's height (32 pt, so app windows opened 32 pt shorter than CEF's). It keeps the frame Chrome made instead.
  const NSRect frame = window.frame;
  window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  if (!NSEqualRects(window.frame, frame)) [window setFrame:frame display:NO];
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
  window.title = @"Netnyahoo";
  window.minSize = NSMakeSize(720, 460);
  window.backgroundColor = WindowColor();
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  InsetTrafficLights(window);
}

// Shortcuts the app's menus own before the page sees them, as Chrome reserves them (they can't be
// overridden by a page): new/close tab and window, quit, reopen closed tab, tab cycling.
bool IsReservedKey(NSEvent *event) {
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  if ((mods & NSEventModifierFlagControl) && event.keyCode == 48) return true;  // ⌃Tab, ⌃⇧Tab
  if (!(mods & NSEventModifierFlagCommand) || (mods & (NSEventModifierFlagControl | NSEventModifierFlagOption))) return false;
  return [@[ @"t", @"w", @"n", @"q" ] containsObject:key];
}

}  // namespace

// MARK: - The window's full screen, and whether the user sees it

// A page's element full screen fills the window, which enters macOS full screen for it unless it already was, and
// leaves it afterwards only if it entered for the page, as Chrome does on the Mac (and the CEF build did). Leaving the
// window's full screen by hand (the green button, ⌃⌘F) takes the page out of full screen too. AppKit ignores
// -toggleFullScreen: mid-transition: the window catches up once the transition ends.
//
// Each transition is recorded with who started it, the app (for a page) or the user, rather than inferred afterwards.
// AppKit sends nothing when a transition fails; the window then waits for its next transition (the page still fills
// the window), which beats a watchdog misreading a slow transition's late end as the user's.
//
// The same record says whether the user sees the window, for what follows the user (NNCoreWebView's seenByUser):
// macOS's occlusion, except that the window's own full-screen transition never hides it. The Space animation reports
// the window occluded, and visible again before or after the did-enter/did-exit notification (crbug.com/1081229): the
// window counts as seen from the transition's start until macOS reports it visible with the transition over. While the
// screen is locked, occlusion changes nothing (locking covers every window; it doesn't mean the user left).
//
// Test instances (NETNYAHOO_BACKGROUND) act the window's full screen out, since a real one opens a Space on the owner's
// screen: the same notifications go out, Chrome counts the window as full screen (actedFullScreen), and
// NETNYAHOO_FAKE_FULLSCREEN_MS gives the acted transition AppKit's length. Their windows count as seen unless a run acts
// occlusion out (fakeOcclusion, fakeFullScreenOcclusionMs), as Chrome's own reading of them is (NNCoreHost.mm). The
// owner's screen lock is not the run's: an acted reading counts whether or not their screen is locked.

namespace {

const void *kActedFullScreenKey = &kActedFullScreenKey;
const void *kActingKey = &kActingKey;
const void *kWindowFullScreenKey = &kWindowFullScreenKey;

BOOL IsWindowFullScreen(NSWindow *window) {
  return window && ((window.styleMask & NSWindowStyleMaskFullScreen) || objc_getAssociatedObject(window, kActedFullScreenKey));
}

// Test instances: macOS's occlusion state for a window, acted out ("fakeOcclusion:<visible|occluded|off>"), so a run
// doesn't depend on what covers the window on the owner's screen. The change goes out as macOS sends it.
const void *kActedOcclusionKey = &kActedOcclusionKey;

void ActOcclusion(NSWindow *window, NSNumber *visible) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Method m = class_getInstanceMethod(NSWindow.class, @selector(occlusionState));
    auto original = (NSWindowOcclusionState(*)(id, SEL))method_getImplementation(m);
    method_setImplementation(m, imp_implementationWithBlock(^NSWindowOcclusionState(NSWindow *w) {
      NSNumber *acted = objc_getAssociatedObject(w, kActedOcclusionKey);
      return acted ? (acted.boolValue ? NSWindowOcclusionStateVisible : 0) : original(w, @selector(occlusionState));
    }));
  });
  objc_setAssociatedObject(window, kActedOcclusionKey, visible, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  if (getenv("NETNYAHOO_TRACE_VISIBILITY")) NSLog(@"[nncore-vis] window %ld acted occlusion %@", (long)window.windowNumber, visible ?: @"off");
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidChangeOcclusionStateNotification object:window];
}

// What a real transition does to occlusion, for acted ones ("fakeFullScreenOcclusionMs:<ms>", -1 off): the Space
// animation occludes the window as it starts, and macOS reports it visible again <ms> after the did-enter or did-exit
// notification (a negative gap: before it).
NSTimeInterval gActedOcclusionGap = NAN;
// The acted transition whose "visible again" is still to come: a transition started before it arrives takes it over,
// as macOS reports the window visible after the last one.
const void *kActedOcclusionTurnKey = &kActedOcclusionTurnKey;
// The window's frame before an acted full screen, given back as it leaves.
const void *kActedRestoreFrameKey = &kActedRestoreFrameKey;

// The window's full screen acted out (a test instance): what -toggleFullScreen: does, without the Space.
void ActWindowFullScreen(NNCoreWindow *coreWindow, BOOL enter, NSTimeInterval seconds) {
  NSWindow *window = coreWindow.window;
  // AppKit ignores a toggle while a transition runs.
  if (!window || objc_getAssociatedObject(window, kActingKey)) return;
  __weak NSWindow *weakWindow = window;
  __weak NNCoreWindow *weakCore = coreWindow;
  void (^set)(BOOL) = ^(BOOL on) {
    if (NSWindow *w = weakWindow) objc_setAssociatedObject(w, kActedFullScreenKey, on ? @YES : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NNCoreWindow *c = weakCore;
    if ([c respondsToSelector:@selector(setActedFullScreen:)]) c.actedFullScreen = on;
  };
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  const BOOL trace = getenv("NETNYAHOO_TRACE_VISIBILITY") != nullptr;
  if (trace) NSLog(@"[nncore-vis] window %ld acted %@", (long)window.windowNumber, enter ? @"willEnterFullScreen" : @"willExitFullScreen");
  [center postNotificationName:enter ? NSWindowWillEnterFullScreenNotification : NSWindowWillExitFullScreenNotification object:window];
  if (enter) set(YES);
  // AppKit gives the window its new size as the transition starts: the screen's on the way in, the one it had on the
  // way out, so a run sees the page resized as the owner does.
  if (enter) {
    objc_setAssociatedObject(window, kActedRestoreFrameKey, [NSValue valueWithRect:window.frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (NSScreen *screen = window.screen ?: NSScreen.mainScreen) [window setFrame:screen.frame display:YES];
  } else if (NSValue *restore = objc_getAssociatedObject(window, kActedRestoreFrameKey)) {
    objc_setAssociatedObject(window, kActedRestoreFrameKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [window setFrame:restore.rectValue display:YES];
  }
  objc_setAssociatedObject(window, kActingKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  const NSTimeInterval gap = gActedOcclusionGap;
  if (!isnan(gap)) {
    NSObject *turn = [NSObject new];
    objc_setAssociatedObject(window, kActedOcclusionTurnKey, turn, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    ActOcclusion(window, @NO);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(0, seconds + gap) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      NSWindow *w = weakWindow;
      if (w && objc_getAssociatedObject(w, kActedOcclusionTurnKey) == turn) ActOcclusion(w, @YES);
    });
  }
  void (^finish)(void) = ^{
    NSWindow *w = weakWindow;
    if (!w) return;
    objc_setAssociatedObject(w, kActingKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (!enter) set(NO);
    if (trace) NSLog(@"[nncore-vis] window %ld acted %@", (long)w.windowNumber, enter ? @"didEnterFullScreen" : @"didExitFullScreen");
    [center postNotificationName:enter ? NSWindowDidEnterFullScreenNotification : NSWindowDidExitFullScreenNotification object:w];
  };
  if (seconds > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), finish);
  else finish();
}

// The acted transition's length (seconds) for page full screen; the dev action "fakeFullScreenMs:<ms>" sets it.
NSTimeInterval gActedTransition = NSProcessInfo.processInfo.environment[@"NETNYAHOO_FAKE_FULLSCREEN_MS"].doubleValue / 1000;

void ToggleWindowFullScreen(NNCoreWindow *coreWindow) {
  NSWindow *window = coreWindow.window;
  if (!nncore_host::Background()) return [window toggleFullScreen:nil];
  const BOOL enter = !IsWindowFullScreen(window);
  nncore_host::LogActivation(enter ? @"toggleFullScreen: (page full screen; acted out)" : @"toggleFullScreen: (page left full screen; acted out)");
  ActWindowFullScreen(coreWindow, enter, gActedTransition);
}

}  // namespace

NSNotificationName const NNCoreWindowSeenDidChange = @"NNCoreWindowSeenDidChange";

// Page full screen changes the page's layout and the window's in steps, each waiting for the page to have drawn the
// one before: AppKit pictures the window as its full-screen transition starts and animates that picture, and the page,
// a Chrome view laid out by the app's JS, draws a new size or layout a frame or several (a heavy page: hundreds of ms)
// after its view changes. Done at once (up to 0.2.30), the transition pictured the page mid-change: the full-screen video kept
// in the shrinking window for the whole way out, ghosted over the page, and the page sized for the old window in a
// corner of the new one on the way in.
//
// A wait asks the page (twice requestAnimationFrame, so it has drawn) for its size and full-screen state until its size
// matches its view as it is then and `test` says it drew (1) or there is no point waiting (-1), for at most
// kPageDrawWait; a page that can't answer (hidden, closed, no frame) doesn't wait. `done` runs once, on the main
// thread.
static const NSTimeInterval kPageDrawWait = 0.4;

@interface NNPageDrawWait : NSObject
@end

@implementation NNPageDrawWait {
  __weak NNCoreTab *_tab;
  NSInteger (^_test)(BOOL fullScreen, BOOL fills);
  void (^_done)(void);
}

+ (void)tab:(NNCoreTab *)tab draws:(NSInteger (^)(BOOL fullScreen, BOOL fills))test then:(void (^)(void))done {
  NSView *page = tab.view;
  if (!page.window || page.isHiddenOrHasHiddenAncestor || ![tab respondsToSelector:@selector(evaluate:completion:)]) return done();
  NNPageDrawWait *wait = [NNPageDrawWait new];
  wait->_tab = tab;
  wait->_test = test;
  wait->_done = done;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageDrawWait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (wait->_done && getenv("NETNYAHOO_TRACE_VISIBILITY")) NSLog(@"[nncore-vis] full screen: the page didn't draw in time");
    [wait finish];
  });
  [wait ask];
}

- (void)finish {
  void (^done)(void) = _done;
  _done = nil;
  if (done) done();
}

- (void)ask {
  NNCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!_done) return;
  if (!page.window) return [self finish];
  const NSSize asked = [page convertRect:page.bounds toView:nil].size;
  // Weak: a page that never answers (its requestAnimationFrame replaced) keeps only this block, not the wait.
  __weak NNPageDrawWait *weakSelf = self;
  [tab evaluate:@"requestAnimationFrame(() => requestAnimationFrame(() => post('result', JSON.stringify("
                @"[innerWidth * devicePixelRatio, innerHeight * devicePixelRatio, !!document.fullscreenElement]))))"
     completion:^(NSString *json) {
       [weakSelf answered:json asked:asked];
     }];
}

- (void)answered:(NSString *)json asked:(NSSize)asked {
  if (!_done) return;
  NSView *page = _tab.view;
  NSWindow *window = page.window;
  // No page to ask any more (closed, moved away, no frame or an exception): nothing to wait for.
  if (!window || !json) return [self finish];
  NSArray *drawn = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![drawn isKindOfClass:NSArray.class] || drawn.count != 3 || ![drawn[0] isKindOfClass:NSNumber.class] ||
      ![drawn[1] isKindOfClass:NSNumber.class] || ![drawn[2] isKindOfClass:NSNumber.class])
    return [self finish];
  const NSSize now = [page convertRect:page.bounds toView:nil].size, pixels = [page convertSizeToBacking:page.bounds.size];
  const NSSize content = window.contentView.bounds.size;
  const BOOL fills = fabs(now.width - content.width) < 1 && fabs(now.height - content.height) < 1;
  const BOOL sized = NSEqualSizes(asked, now) && fabs([drawn[0] doubleValue] - pixels.width) <= 2 &&
                     fabs([drawn[1] doubleValue] - pixels.height) <= 2;
  const NSInteger drew = sized ? _test([drawn[2] boolValue], fills) : 0;
  if (getenv("NETNYAHOO_TRACE_VISIBILITY"))
    NSLog(@"[nncore-vis] full screen: page drew %@, its view %@ (fills=%d) -> %ld", json, NSStringFromSize(pixels), fills, (long)drew);
  if (drew) return [self finish];
  [self ask];
}

@end

// AppKit doesn't show the window during its full-screen transition: an overlay window stands in for it
// (_NSFullScreenTransitionOverlayWindow), crossfading a picture of the window from before the transition into one from
// after, and hands the window back once it ends. Those pictures come from the window's own layers, and a page doesn't
// draw there: Chrome draws it in the GPU process and the window only hosts that (CALayerHost), so a picture of the
// window shows the app's sidebar and toolbar around the page's bare background colour (an in-process picture of a
// window, as devSnapshotWindow takes, shows the same). Up to 0.2.30 the page's place stayed that colour, near black,
// for the whole transition (its whole window on the way in, with the sidebar hidden), and the page popped back in
// once AppKit returned the window.
//
// So the page lends the window a picture of itself (-[NNCoreTab copyPicture:completion:], Chrome's copy of its last
// frame), an ordinary layer over it from just before the transition starts until the page has drawn its new size
// after it. It lives inside the page's own view, which sizes every subview to itself (WebContentsViewCocoa) and
// takes it wherever the page goes; it takes no clicks and says nothing to accessibility.
static const NSTimeInterval kPageCoverPicture = 0.25;  // How long the page may take to give its picture.
static const NSTimeInterval kPageCoverLimit = 4;       // A cover never outstays this (a transition AppKit never ends).
static BOOL gPageCoverOff = NO;                        // Test instances' "pageCover:0": transitions as up to 0.2.30.

@interface NNPageCover : NSView
@property(readonly, weak) NNCoreTab *tab;
@end

@implementation NNPageCover {
  CGImageRef _picture;
  NSSize _pictured;  // The page's size in its picture.
}

// Covers over the pages of `tabs` that have a picture to give, in no order (then: on the main thread).
+ (void)coverTabs:(NSArray<NNCoreTab *> *)tabs then:(void (^)(NSArray<NNPageCover *> *covers))then {
  NSMutableArray<NNPageCover *> *covers = [NSMutableArray array];
  __block NSUInteger waiting = tabs.count + 1;
  void (^one)(NNPageCover *) = ^(NNPageCover *cover) {
    if (cover) [covers addObject:cover];
    if (--waiting == 0) then(covers);
  };
  for (NNCoreTab *tab in tabs) [self coverTab:tab then:one];
  one(nil);
}

+ (void)coverTab:(NNCoreTab *)tab then:(void (^)(NNPageCover *cover))then {
  NSView *page = tab.view;
  if (gPageCoverOff || !page.window || page.isHiddenOrHasHiddenAncestor ||
      ![tab respondsToSelector:@selector(copyPicture:completion:)])
    return then(nil);
  __weak NNCoreTab *weakTab = tab;
  __weak NSWindow *weakWindow = page.window;
  __weak NSView *weakHost = page.superview;
  const NSSize pictured = page.bounds.size;
  [tab copyPicture:kPageCoverPicture
        completion:^(CGImageRef picture) {
          NNCoreTab *t = weakTab;
          NSView *now = t.view;
          // Only where it was pictured: a page moved meanwhile (to another view or window) is another window's matter.
          if (!picture || !now.window || now.window != weakWindow || now.superview != weakHost) return then(nil);
          NNPageCover *cover = [[NNPageCover alloc] initWithFrame:now.bounds picture:picture];
          cover->_tab = t;
          cover->_pictured = pictured;
          [now addSubview:cover];  // Over the page: Chrome puts each new page view at the bottom.
          // Its picture in its layer now, not at AppKit's next display: the transition pictures the window right away.
          [cover displayIfNeeded];
          cover.layer.contents = (__bridge id)cover->_picture;
          then(cover);
        }];
}

- (instancetype)initWithFrame:(NSRect)frame picture:(CGImageRef)picture {
  if ((self = [super initWithFrame:frame])) {
    _picture = CGImageRetain(picture);
    self.wantsLayer = YES;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    __weak NNPageCover *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageCoverLimit * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [weakSelf uncover:NO];
    });
  }
  return self;
}

- (void)dealloc {
  CGImageRelease(_picture);
}

- (BOOL)wantsUpdateLayer {
  return YES;
}

// Stretched as the page is resized under it: AppKit's own pictures stretch the same way.
- (void)updateLayer {
  self.layer.contents = (__bridge id)_picture;
  self.layer.contentsGravity = kCAGravityResize;
}

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (BOOL)isAccessibilityElement {
  return NO;
}

// The window's transition resized the page under its picture: once the page has drawn its new size, a picture of
// that (AppKit's picture from after the transition, and the window it hands back, then show the page as it is).
- (void)repicture {
  NNCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!self.superview || !page) return;
  __weak NNPageCover *weakSelf = self;
  const NSSize before = _pictured;
  [NNPageDrawWait tab:tab
                draws:^NSInteger(BOOL, BOOL) { return NSEqualSizes(page.bounds.size, before) ? 0 : 1; }
                 then:^{
                   NNPageCover *me = weakSelf;
                   NNCoreTab *t = me.tab;
                   const NSSize now = t.view.bounds.size;
                   if (!me.superview || !t || NSEqualSizes(now, before)) return;
                   [t copyPicture:kPageCoverPicture
                       completion:^(CGImageRef picture) {
                         NNPageCover *again = weakSelf;
                         if (!picture || !again.superview) return;
                         CGImageRelease(again->_picture);
                         again->_picture = CGImageRetain(picture);
                         again->_pictured = now;
                         again.layer.contents = (__bridge id)again->_picture;
                       }];
                 }];
}

// The page shows through again: a short fade hides a frame's difference between the picture and the page.
- (void)uncover:(BOOL)fade {
  if (!self.superview) return;
  if (!fade) return [self removeFromSuperview];
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.1;
        self.animator.alphaValue = 0;
      }
      completionHandler:^{
        [self removeFromSuperview];
      }];
}

@end

// One per app window.
@interface NNWindowFullScreen : NSObject
- (NNCoreTab *)probedTab;  // The page whose full screen the window follows (the one it left, until it has).
- (BOOL)covered;           // Its picture is over it (NNPageCover).
- (NSInteger)covers;       // How many pages' pictures are over them.
- (BOOL)transitioning;
@end

@implementation NNWindowFullScreen {
  __weak NNCoreWindow *_coreWindow;
  __weak NNCoreTab *_tab;  // The page in full screen.
  BOOL _entered;           // The window is in full screen (or going) for it.
  NSInteger _asked;        // The transition the app asked for and AppKit hasn't started: 1 in, -1 out.
  BOOL _transitioning;
  BOOL _ours;              // The running transition is the app's.
  BOOL _settling;          // A transition started and macOS hasn't reported the window visible since it ended.
  BOOL _seen;
  BOOL _closed;
  NSArray *_observers;
  // What waits for the page to have drawn its new layout (NNPageDrawWait).
  __weak NNCoreTab *_leftTab;  // The page that just left full screen, while the window still has to.
  NSInteger _waitingFor;       // The window's transition waiting for it: 1 in, -1 out, 0 none.
  NSUInteger _wait;            // Which wait, so the answer to an older one does nothing.
  BOOL _askedWait;             // The current wait has asked.
  BOOL _drew;                  // The page drew it (or can't answer): the transition may start.
  NSInteger _telling;          // Changes the app hasn't been told of yet, waiting for the page to draw them in place.
  // The page's picture through the window's transition (NNPageCover).
  NSArray<NNPageCover *> *_covers;
  __weak NNCoreTab *_lastTab;  // The last page in full screen (the test probe's).
  NSUInteger _coverTurn;  // Which picture is wanted: one that arrives after a change does nothing.
  BOOL _picturing;        // A picture is on its way; the transition starts once it's in place.
}

+ (instancetype)ofWindow:(NNCoreWindow *)coreWindow create:(BOOL)create {
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  NNWindowFullScreen *state = objc_getAssociatedObject(window, kWindowFullScreenKey);
  if (state || !create) return state;
  state = [[NNWindowFullScreen alloc] initWithCoreWindow:coreWindow];
  objc_setAssociatedObject(window, kWindowFullScreenKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return state;
}

- (instancetype)initWithCoreWindow:(NNCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    // Until macOS says otherwise: a window just made may not be on screen yet.
    _seen = YES;
    __weak NNWindowFullScreen *weakSelf = self;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    NSMutableArray *observers = [NSMutableArray array];
    for (NSNotificationName name in @[
           NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification, NSWindowDidEnterFullScreenNotification,
           NSWindowDidExitFullScreenNotification, NSWindowDidChangeOcclusionStateNotification, NSWindowWillCloseNotification
         ]) {
      [observers addObject:[center addObserverForName:name
                                               object:coreWindow.window
                                                queue:nil
                                           usingBlock:^(NSNotification *note) {
                                             [weakSelf windowDid:note.name];
                                           }]];
    }
    _observers = observers;
  }
  return self;
}

- (void)dealloc {
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
}

// A test instance's reading of occlusion is acted out: always visible, or what the run acts.
- (BOOL)occlusionActed {
  return nncore_host::Background() && (!getenv("NETNYAHOO_ALLOW_OCCLUSION") || objc_getAssociatedObject(_coreWindow.window, kActedOcclusionKey));
}

- (BOOL)windowVisible {
  NSWindow *window = _coreWindow.window;
  if (!window) return NO;
  if ([self occlusionActed] && !objc_getAssociatedObject(window, kActedOcclusionKey)) return YES;
  return (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
}

- (void)windowDid:(NSNotificationName)name {
  if ([name isEqualToString:NSWindowWillCloseNotification]) {
    _closed = YES;
    for (NNPageCover *cover in _covers) [cover uncover:NO];
    _covers = nil;
    return;
  }
  const BOOL will = [name isEqualToString:NSWindowWillEnterFullScreenNotification] || [name isEqualToString:NSWindowWillExitFullScreenNotification];
  const BOOL did = [name isEqualToString:NSWindowDidEnterFullScreenNotification] || [name isEqualToString:NSWindowDidExitFullScreenNotification];
  const BOOL entering = [name isEqualToString:NSWindowWillEnterFullScreenNotification] || [name isEqualToString:NSWindowDidEnterFullScreenNotification];
  if (will) {
    _transitioning = _settling = YES;
    _ours = _asked == (entering ? 1 : -1);
    _asked = 0;
    // AppKit gives the window its new size now: each picture follows its page there.
    for (NNPageCover *cover in _covers) [cover repicture];
  }
  if (did) _transitioning = NO;
  if (!_transitioning && [self windowVisible]) _settling = NO;
  [self updateSeen];
  if (!did) return;
  [self uncoverWhenDrawn];
  const BOOL ours = _ours;
  _ours = NO;
  // After the window's other observers have heard of it.
  __weak NNWindowFullScreen *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf settled:entering ours:ours]; });
}

- (void)updateSeen {
  if (![self occlusionActed] && [CFBridgingRelease(CGSessionCopyCurrentDictionary())[@"CGSSessionScreenIsLocked"] boolValue]) return;
  const BOOL seen = _settling || [self windowVisible];
  if (getenv("NETNYAHOO_TRACE_VISIBILITY"))
    NSLog(@"[nncore-vis] window %ld seen=%d (transitioning=%d settling=%d)", (long)_coreWindow.window.windowNumber, seen, _transitioning, _settling);
  if (seen == _seen) return;
  _seen = seen;
  if (NSWindow *window = _coreWindow.window) [NSNotificationCenter.defaultCenter postNotificationName:NNCoreWindowSeenDidChange object:window];
}

- (BOOL)seen {
  return _seen;
}

- (void)settled:(BOOL)entered ours:(BOOL)ours {
  if (!entered && !ours) {
    // Left by hand: the page leaves full screen too, and its exit comes back through -tab:fullScreen:tell:.
    _entered = NO;
    NNCoreTab *tab = _tab;
    if (tab && [tab respondsToSelector:@selector(exitFullscreen)]) return [tab exitFullscreen];
  }
  [self sync];
}

// Each page's full-screen changes, counted across windows: a delayed exit is told only if nothing changed since.
static NSMapTable<NNCoreTab *, NSNumber *> *FullScreenChanges() {
  static NSMapTable *changes = [NSMapTable weakToStrongObjectsMapTable];
  return changes;
}

// `tell` tells the app's JS, whose layout (sidebar, toolbar) follows, once the page has drawn the change where it is:
// into full screen, the page lays itself out full screen in its card before the card fills the window (never its
// windowed layout stretched over the window, as a page takes a few frames to go full screen); out of it, the
// full-screen video never shows inside the app's sidebar and toolbar. The change is already counted
// (-[NNCoreWindowController window:tab:didChangeFullscreen:], in every window).
- (void)tab:(NNCoreTab *)tab fullScreen:(BOOL)fullScreen tell:(void (^)(void))tell {
  const NSUInteger change = [FullScreenChanges() objectForKey:tab].unsignedIntegerValue;
  // Another page, or the same one again: a wait for the window's transition starts over for it, and a picture on its
  // way for the last one is for nothing.
  _waitingFor = 0;
  _coverTurn++;
  _picturing = NO;
  if (fullScreen) {
    _tab = _lastTab = tab;
  } else if (_tab == tab || !_tab) {
    if (_tab) _leftTab = _tab;
    _tab = nil;
  }
  _telling++;
  __weak NNWindowFullScreen *weakSelf = self;
  __weak NNCoreTab *weakTab = tab;
  // A page Chrome took out (Esc) stays in full screen until its view next changes size (Chrome tells the page with a
  // resize): the app's layout gives it that, at once.
  [NNPageDrawWait tab:tab
                draws:^NSInteger(BOOL drawnFullScreen, BOOL) {
                  if (fullScreen) return drawnFullScreen ? 1 : 0;
                  return drawnFullScreen ? -1 : 1;
                }
                 then:^{
                   NNWindowFullScreen *me = weakSelf;
                   if (me) me->_telling--;
                   // Unless the page went back into full screen meanwhile (here or in another window): the app never heard
                   // it leave.
                   NNCoreTab *t = weakTab;
                   if (t && [FullScreenChanges() objectForKey:t].unsignedIntegerValue == change) tell();
                   [me sync];
                 }];
}

- (void)sync {
  NNCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  if (!window || _closed || _transitioning) return;
  const BOOL full = IsWindowFullScreen(window), page = _tab != nil;
  const NSInteger toggle = page && !full && !_entered ? 1 : !page && full && _entered ? -1 : 0;
  if (toggle != _waitingFor) {
    // A new wait, or none (the page changed its mind meanwhile): an older answer counts for nothing.
    _waitingFor = toggle;
    _drew = _askedWait = NO;
    _wait++;
  }
  if (toggle == 1) {
    // In: the page drew itself full screen in its card, the app gave it the window and the page drew that, then the
    // window grows, the page's picture over it.
    if (_telling > 0 || _picturing || ![self pageDrew:_tab entering:YES]) return;
    [self coverThenToggle:_tab entering:YES];
  } else if (toggle == -1) {
    // Out: the page drew itself out of full screen, the app laid its sidebar and toolbar out around it and the page
    // drew that, then the window shrinks, the page's picture over it.
    if (_telling > 0 || _picturing || ![self pageDrew:_leftTab entering:NO]) return;
    [self coverThenToggle:_leftTab entering:NO];
  } else if (!page) {
    _entered = NO;
  }
}

// The pages the window shows: on the way in, the full-screen page alone (it covers the rest); on the way out, every
// page the app lays out again (a split's panes).
- (NSArray<NNCoreTab *> *)shownTabs:(NNCoreTab *)tab entering:(BOOL)entering {
  NNCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  NSMutableArray<NNCoreTab *> *tabs = [NSMutableArray array];
  if (tab) [tabs addObject:tab];
  if (entering || !coreWindow.activeProfile) return tabs;
  for (NNCoreTab *other in [coreWindow tabsForProfile:coreWindow.activeProfile]) {
    NSView *page = other.view;
    NNCoreWebView *view = [NNCoreTabs viewForTab:other];
    // Shown: in this window, not hidden, and not a page kept painting unseen (alpha 0).
    if (other == tab || page.window != window || page.isHiddenOrHasHiddenAncestor || !view || view.alphaValue < 0.5) continue;
    [tabs addObject:other];
  }
  return tabs;
}

// The window's transition, once the pages' pictures cover them (NNPageCover; without any, at once).
- (void)coverThenToggle:(NNCoreTab *)tab entering:(BOOL)entering {
  _picturing = YES;
  const NSUInteger turn = ++_coverTurn;
  __weak NNWindowFullScreen *weakSelf = self;
  [NNPageCover coverTabs:[self shownTabs:tab entering:entering]
                    then:^(NSArray<NNPageCover *> *covers) {
                      NNWindowFullScreen *me = weakSelf;
                      // A change since (its own sync runs): these pictures are for nothing.
                      if (!me || me->_coverTurn != turn) {
                        for (NNPageCover *cover in covers) [cover uncover:NO];
                        return;
                      }
                      me->_picturing = NO;
                      for (NNPageCover *cover in me->_covers) [cover uncover:NO];
                      me->_covers = covers;
                      [me toggle:entering];
                    }];
}

- (void)toggle:(BOOL)entering {
  NNCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  // Whatever changed while the pictures came (the window closed, a transition began) leaves the window as it is.
  const BOOL wanted = window && !_closed && !_transitioning && IsWindowFullScreen(window) != entering &&
                      (entering ? _tab && !_entered : !_tab && _entered);
  if (!wanted) {
    for (NNPageCover *cover in _covers) [cover uncover:NO];
    _covers = nil;
    return [self sync];
  }
  _entered = entering;
  _asked = entering ? 1 : -1;
  if (!entering) _leftTab = nil;
  // The pictures are in the window's layers before AppKit pictures them.
  [CATransaction flush];
  ToggleWindowFullScreen(coreWindow);
  // AppKit says nothing when it doesn't start a transition: the pages show through rather than stay pictures.
  NSArray *covers = _covers;
  if (!covers.count) return;
  __weak NNWindowFullScreen *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NNWindowFullScreen *me = weakSelf;
    if (me && me->_covers == covers && !me->_transitioning) [me uncoverWhenDrawn];
  });
}

- (NNCoreTab *)probedTab {
  return _tab ?: _leftTab ?: _lastTab;
}

// The pages' pictures still over them, fading out included.
- (NSInteger)covers {
  NSInteger covers = 0;
  NSMutableArray<NSView *> *views = [NSMutableArray arrayWithObject:_coreWindow.window.contentView ?: [NSView new]];
  while (views.count) {
    NSView *view = views.lastObject;
    [views removeLastObject];
    if ([view isKindOfClass:NNPageCover.class]) covers++;
    [views addObjectsFromArray:view.subviews];
  }
  return covers;
}

- (BOOL)covered {
  return self.covers > 0;
}

- (BOOL)transitioning {
  return _transitioning;
}

// After the window's transition: each page shows through once it has drawn the size it has now. A page that can't
// answer, or doesn't in time (NNPageDrawWait), shows through anyway.
- (void)uncoverWhenDrawn {
  NSArray<NNPageCover *> *covers = _covers;
  _covers = nil;
  for (NNPageCover *cover in covers) {
    NNCoreTab *tab = cover.tab;
    if (!tab) {
      [cover uncover:NO];
      continue;
    }
    [NNPageDrawWait tab:tab
                  draws:^NSInteger(BOOL, BOOL) { return 1; }
                   then:^{
                     // Chrome puts that frame on screen a frame or two after the page drew it.
                     dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.034 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                       [cover uncover:YES];
                     });
                   }];
  }
}

- (BOOL)pageDrew:(NNCoreTab *)tab entering:(BOOL)entering {
  if (_drew) {
    _drew = _askedWait = NO;
    _waitingFor = 0;
    _wait++;
    return YES;
  }
  if (_askedWait) return NO;
  _askedWait = YES;
  const NSUInteger wait = _wait;
  __weak NNWindowFullScreen *weakSelf = self;
  __block BOOL now = YES;  // Answered at once (nothing to wait for): no need to sync again.
  [NNPageDrawWait tab:tab
                draws:^NSInteger(BOOL fullScreen, BOOL fills) { return fullScreen == entering && fills == entering; }
                 then:^{
                   NNWindowFullScreen *me = weakSelf;
                   if (!me || me->_wait != wait) return;
                   me->_drew = YES;
                   if (!now) [me sync];
                 }];
  now = NO;
  if (!_drew) return NO;
  _drew = _askedWait = NO;
  _waitingFor = 0;
  _wait++;
  return YES;
}

- (NSDictionary *)state {
  NSWindow *window = _coreWindow.window;
  NNCoreTab *tab = _tab;
  return @{
    @"page" : tab ? @(nncore_host::BrowserId(tab)) : NSNull.null,
    @"entered" : @(_entered),
    @"asked" : @(_asked),
    @"waitingForPage" : @(_waitingFor),
    @"telling" : @(_telling),
    @"picturing" : @(_picturing),
    @"covered" : @([self covered]),
    @"transitioning" : @(_transitioning),
    @"ours" : @(_ours),
    @"settling" : @(_settling),
    @"seen" : @(_seen),
    @"fullScreen" : @(IsWindowFullScreen(window)),
  };
}

@end

namespace {

// A tab Chrome made in a window of its own (chrome.windows.create) while the app shows no page to announce it through:
// offered to the app (tab:<id>) through the extensions module, which opens it in a window of its profile. Its URL
// first, as -[NNCoreWebView openedTab:…] waits for it.
void AnnounceStrayTab(NNCoreTab *tab, int tries) {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ AnnounceStrayTab(tab, tries + 1); });
    return;
  }
  if (!NNCoreServices.extensionsHandler) return;
  NNCoreServices.extensionsHandler(@"tabs", @{
    @"action" : @"open", @"url" : url ?: @"", @"profile" : nncore_host::ProfileName(tab.profile), @"active" : @YES,
    @"window" : NSNull.null, @"extensionId" : @"", @"adoptId" : [NNCoreTabs offerTab:tab prefix:@"tab"]
  });
}

// A tab Chrome made that no view of the app asked for (a window Chrome made, an extension's tab in a window paged to
// another profile): to the app's windows, as a tab Chrome made. A regular tab goes through a view of its own profile,
// else the extensions module, which opens it in a window of its profile; a private tab to a private window of its
// session, else to a private window the app opens for it ("incognito") from the profile it's off the record of, never
// into a normal window or another profile's.
void HandOffTab(NNCoreTab *tab) {
  NNCoreProfile *profile = tab.profile;
  // A profile on its way out (the last private window just closed) has no profile to show it under.
  if (!profile) return (void)dispatch_async(dispatch_get_main_queue(), ^{ [tab closeNow]; });
  NNCoreWebView *view = [NNCoreWindowController hostingViewForProfile:profile];
  if (view || !profile.offTheRecord) {
    // A view of the tab's own profile announces it. With none (a launch on the New Tab page, or only another
    // profile's pages shown, which would adopt it under their profile), the extensions module does, live.
    // A private profile's view is one of its session's windows, whatever its own private name.
    if (view && ([view.profile isEqualToString:nncore_host::ProfileName(profile)] ||
                 nncore_host::IsOffTheRecordOf(profile, view.profile)))
      [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab prefix:@"tab"] disposition:@"foreground"];
    else
      AnnounceStrayTab(tab, 0);
    return;
  }
  if (!(view = [NNCoreWindowController hostingViewForProfile:nil])) return;
  // No window of its session yet: the app opens a private window of the profile it's off the record of, which takes
  // the tab live.
  [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab prefix:@"tab"] disposition:@"incognito"];
}

}  // namespace

// MARK: - NNCoreWindowController

@implementation NNCoreWindowController {
  NSHashTable<NNCoreTab *> *_closing;
}

+ (BOOL)userSees:(NSWindow *)window {
  NNCoreWindowController *controller = [self forNSWindow:window];
  if (!controller || controller.stray || controller.standalone) return YES;
  return [[NNWindowFullScreen ofWindow:controller.coreWindow create:YES] seen];
}

+ (instancetype)strayWindowForProfile:(NNCoreProfile *)profile {
  NNCoreWindow *coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  NNCoreWindowController *controller = [[NNCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_stray = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  return controller;
}

NSMapTable<NNCoreProfile *, NNCoreWindowController *> *StandaloneWindows() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

+ (instancetype)standaloneWindowForProfile:(NNCoreProfile *)profile {
  NSMapTable<NNCoreProfile *, NNCoreWindowController *> *windows = StandaloneWindows();
  NNCoreWindowController *controller = [windows objectForKey:profile];
  if (controller && controller.coreWindow.window) return controller;
  NNCoreWindow *coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  // Extension popups and side panels aren't pages the user visited (CEF's standalone browsers kept no history).
  if ([coreWindow respondsToSelector:@selector(setInternal:)]) coreWindow.internal = YES;
  controller = [[NNCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_standalone = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  [windows setObject:controller forKey:profile];
  return controller;
}

// The app's window to hand a stray tab to, the frontmost first (the user's): one showing the tab's profile, else any
// (nil profile: any). A private tab only ever goes to a window showing its own profile.
+ (NNCoreWebView *)hostingViewForProfile:(NNCoreProfile *)profile {
  NNCoreWebView *any = nil;
  for (NSWindow *window in NSApp.orderedWindows) {
    NNCoreWindowController *c = [Controllers() objectForKey:window];
    if (!c || c.stray || c.standalone) continue;
    if (NNCoreWebView *view = profile ? [c anyShownViewForProfile:profile] : nil) return view;
    any = any ?: [c anyView];
  }
  return profile.offTheRecord ? nil : any;
}

+ (instancetype)holding:(NNCoreTab *)tab {
  NNCoreProfile *profile = tab.profile;
  if (!profile) return nil;
  for (NNCoreWindowController *c in Controllers().objectEnumerator)
    if ([[c.coreWindow tabsForProfile:profile] containsObject:tab]) return c;
  return nil;
}

- (void)noteClosing:(NNCoreTab *)tab {
  if (!_closing) _closing = [NSHashTable weakObjectsHashTable];
  [_closing addObject:tab];
  // A close that never completes (a page's beforeunload kept it) stops counting after a while.
  __weak NNCoreWindowController *weakSelf = self;
  __weak NNCoreTab *weakTab = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    NNCoreWindowController *c = weakSelf;
    NNCoreTab *t = weakTab;
    if (c && t) [c->_closing removeObject:t];
  });
}

- (BOOL)appChanging {
  return _hostChanges > 0 || _closing.count > 0;
}

+ (instancetype)forNSWindow:(NSWindow *)window {
  return window ? [Controllers() objectForKey:window] : nil;
}

+ (NSArray<NNCoreWindowController *> *)all {
  return Controllers().objectEnumerator.allObjects;
}

- (instancetype)initWithCoreWindow:(NNCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    coreWindow.delegate = self;
    __weak NNCoreWindowController *weakSelf = self;
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                    object:coreWindow.window
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  if (NNCoreWindowController *c = weakSelf) [NNCoreTabStrip windowClosed:c];
                                                }];
  }
  return self;
}

- (NNCoreWebView *)viewFor:(NNCoreTab *)tab {
  return tab ? [NNCoreTabs viewForTab:tab] : nil;
}

// A shown tab of this window: who hears about tabs Chrome opened with no opener the app hosts (an
// extension's tabs.create, say).
- (NNCoreWebView *)anyShownViewForProfile:(NNCoreProfile *)profile {
  for (NNCoreTab *tab in [_coreWindow tabsForProfile:profile]) {
    NNCoreWebView *view = [NNCoreTabs viewForTab:tab];
    if (view.visible) return view;
  }
  return nil;
}

- (NNCoreWebView *)anyView {
  for (NNCoreProfile *profile in nncore_host::LoadedProfiles())
    for (NNCoreTab *tab in [_coreWindow tabsForProfile:profile])
      if (NNCoreWebView *view = [NNCoreTabs viewForTab:tab]) return view;
  return nil;
}

- (void)window:(NNCoreWindow *)window didInsertTab:(NNCoreTab *)tab opener:(NNCoreTab *)opener disposition:(NSString *)disposition {
  [NNCoreTabStrip changedInWindow:self profile:tab.profile];
  // The app's own (a WebView opening its tab, or adopting one): the view attaches it itself.
  if (_hostChanges > 0 || [NNCoreTabs viewForTab:tab]) return;
  // A window Chrome made (chrome.windows.create, Open Link in Incognito Window): the tab goes to the app's windows.
  if (_stray) return HandOffTab(tab);
  NNCoreWebView *openerView = [self viewFor:opener];
  if ([disposition isEqualToString:@"popup"] && [tab respondsToSelector:@selector(popupFeatures)]) {
    // A sized window.open (OAuth, payments): a window of its own, not a tab.
    return nncore_host::OpenPopupWindow(tab, openerView);
  }
  if (openerView) {
    // A page's popup, target=_blank or ⌘-click: placed by the app's opener rules.
    [openerView openedTab:tab adoptId:[NNCoreTabs offerTab:tab] disposition:nncore_host::AppDisposition(disposition)];
  } else if (NNCoreWebView *view = [self anyShownViewForProfile:tab.profile]) {
    // A tab Chrome made on its own (an extension's tabs.create): the app takes Chrome's place for it, through a shown
    // view of its own profile in this window.
    [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab prefix:@"tab"] disposition:@"foreground"];
  } else {
    // None here (the window shows another profile now): as a tab of a window Chrome made, so it never lands under
    // another profile's page, where it would keep its own profile's cookies under the other's name.
    HandOffTab(tab);
  }
}

- (void)window:(NNCoreWindow *)window didRemoveTab:(NNCoreTab *)tab {
  if (NNCoreProfile *profile = tab.profile) [NNCoreTabStrip changedInWindow:self profile:profile];
  [[self viewFor:tab] tabRemovedFromWindow:window];
  if (_stray || _standalone) {
    // Its last tab went to the app's windows (or its last standalone view closed): the hidden window goes too, so
    // its empty Browsers don't keep a private profile alive. (The removed tab's profile counts too: one the app never
    // loaded, another profile's private one, may still have tabs here.)
    __weak NNCoreWindowController *weakSelf = self;
    NNCoreProfile *removedProfile = tab.profile;
    dispatch_async(dispatch_get_main_queue(), ^{
      NNCoreWindowController *c = weakSelf;
      if (!c) return;
      NSMutableArray<NNCoreProfile *> *profiles = [nncore_host::LoadedProfiles() mutableCopy];
      if (removedProfile) [profiles addObject:removedProfile];
      for (NNCoreProfile *p in profiles)
        if ([c.coreWindow tabsForProfile:p].count) return;
      if (c.standalone) {
        NSMapTable<NNCoreProfile *, NNCoreWindowController *> *windows = StandaloneWindows();
        for (NNCoreProfile *p in windows.keyEnumerator.allObjects)
          if ([windows objectForKey:p] == c) [windows removeObjectForKey:p];
      }
      [c.coreWindow close];
    });
  }
  // After Chrome picked the next active tab (it does before it reports the removal).
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_closing removeObject:tab]; });
}

- (void)window:(NNCoreWindow *)window didActivateTab:(NNCoreTab *)tab {
  [NNCoreTabStrip activated:tab inWindow:self];
  [NNCoreTabStrip changedInWindow:self profile:tab.profile];
  [[self viewFor:tab] tabActivatedByChrome:!self.appChanging];
}

- (void)window:(NNCoreWindow *)window devToolsDidChangeForTab:(NNCoreTab *)tab view:(NSView *)devToolsView {
  [[self viewFor:tab] devToolsChanged:devToolsView];
}

- (void)window:(NNCoreWindow *)window tab:(NNCoreTab *)tab didChangeFullscreen:(BOOL)fullscreen {
  [FullScreenChanges() setObject:@([FullScreenChanges() objectForKey:tab].unsignedIntegerValue + 1) forKey:tab];
  __weak NNCoreWindowController *weakSelf = self;
  __weak NNCoreTab *weakTab = tab;
  void (^tell)(void) = ^{
    NNCoreTab *t = weakTab;
    if (t) [[weakSelf viewFor:t] emit:@"fullscreen" payload:@{@"fullscreen" : @(fullscreen)}];
  };
  // The app's windows only: a hidden one (a stray tab's, extension pages') shows nothing to fill the screen with.
  if (_stray || _standalone) return tell();
  [[NNWindowFullScreen ofWindow:window create:YES] tab:tab fullScreen:fullscreen tell:tell];
}

// Chrome's password bubble, already in packages/cef's PasswordPrompt shape (save, update or saved; usernames,
// federation, the password's length).
- (void)window:(NNCoreWindow *)window passwordPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(NNCoreTab *)tab {
  [[self viewFor:tab] emit:@"passwordPrompt" payload:prompt];
}

// Chrome's offer to save or update an address or card, or {id, closed} once it went (JS AutofillPrompt).
- (void)window:(NNCoreWindow *)window autofillPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(NNCoreTab *)tab {
  [[self viewFor:tab] emit:@"autofillPrompt" payload:prompt];
}

- (BOOL)windowShouldClose:(NNCoreWindow *)window {
  return [NNChromeWindowHost windowShouldClose:window.window];
}

- (void)windowDidCancelClose:(NNCoreWindow *)window {
  NSLog(@"[nncore] window close cancelled");
}

- (void)window:(NNCoreWindow *)window confirmCloseWithDownloads:(int)count completion:(void (^)(BOOL))completion {
  // The app asks about downloads in flight before it quits (WindowManager.confirmActiveDownloads); closing one
  // window with downloads going keeps them going in Chrome's download manager until quit.
  completion(YES);
}

- (BOOL)window:(NNCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  return IsReservedKey(event) && [NSApp.mainMenu performKeyEquivalent:event];
}

- (BOOL)window:(NNCoreWindow *)window handleKeyEvent:(NSEvent *)event {
  // An Esc the page left alone (Small Yahu closes on it): onCommand "escape" on the shown tab.
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (event.type == NSEventTypeKeyDown && event.keyCode == 53 && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl))) {
    // The page holding focus, whichever profile's Browser has it (the window's active profile can be another one
    // for a moment, e.g. while Chrome deletes a profile that had a Browser here).
    NSResponder *focused = window.window.firstResponder;
    NNCoreWebView *target = nil;
    for (NNCoreProfile *profile in nncore_host::LoadedProfiles()) {
      for (NNCoreTab *tab in [window tabsForProfile:profile]) {
        NNCoreWebView *view = [NNCoreTabs viewForTab:tab];
        if (view.visible && [focused isKindOfClass:NSView.class] && [(NSView *)focused isDescendantOf:tab.view]) target = view;
      }
      if (target) break;
    }
    [target emit:@"command" payload:@{@"command" : @"escape", @"text" : @""}];
  }
  // The engine tries the main menu next, with what AppKit takes as key equivalents.
  return NO;
}

@end

// MARK: - Popup windows

// A page's sized popup in a window of its own (packages/cef's NNPopupWindow): a plain titled window (the page's title,
// its host below), the tab Chrome made for window.open moved into it live, so window.opener holds both ways. Links it
// opens go to the opener's tab, as the app places them; its window.close() closes the window.
@interface NNCorePopupWindow : NSObject <NNCoreWindowDelegate, NNCoreTabDelegate>
@end

namespace {

NSMutableSet<NNCorePopupWindow *> *PopupWindows() {
  static NSMutableSet *windows = [NSMutableSet set];
  return windows;
}

NSString *HostOf(NSString *url) {
  return [NSURL URLWithString:url ?: @""].host ?: @"";
}

}  // namespace

@implementation NNCorePopupWindow {
  NNCoreWindow *_coreWindow;
  NNCoreTab *_tab;
  __weak NNCoreWebView *_opener;
  id _closeObserver;
  BOOL _adopting;
}

- (instancetype)initWithTab:(NNCoreTab *)tab opener:(NNCoreWebView *)opener {
  if (!(self = [super init])) return nil;
  _tab = tab;
  _opener = opener;
  NSDictionary<NSString *, NSNumber *> *features = tab.popupFeatures ?: @{};
  // window.open's width and height are the page's; Chrome's own floor for a popup is 100 × 100, CEF's window 200 × 150.
  const NSSize size = NSMakeSize(MAX(features[@"width"] ? features[@"width"].doubleValue : 500, 200),
                                 MAX(features[@"height"] ? features[@"height"].doubleValue : 600, 150));
  _coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)];
  NSWindow *window = _coreWindow.window;
  if (!window) return nil;
  _coreWindow.delegate = self;
  window.styleMask |= NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                      NSWindowStyleMaskResizable;
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  window.minSize = NSMakeSize(200, 150);
  [window setContentSize:size];
  [self placeWithFeatures:features];
  __weak NNCorePopupWindow *weakSelf = self;
  _closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                   object:window
                                                                    queue:nil
                                                               usingBlock:^(NSNotification *) { [weakSelf windowWillClose]; }];
  return self;
}

- (void)placeWithFeatures:(NSDictionary<NSString *, NSNumber *> *)features {
  NSWindow *window = _coreWindow.window;
  NSWindow *parent = _opener.window;
  NSScreen *screen = parent.screen ?: NSScreen.mainScreen;
  NSRect frame = window.frame;
  if (features[@"x"] || features[@"y"]) {
    // The page's left and top: screen points from the primary screen's top-left (the content's, as Chrome places it).
    const NSRect primary = NSScreen.screens.firstObject.frame;
    const NSRect content = [window contentRectForFrameRect:frame];
    const CGFloat left = features[@"x"] ? features[@"x"].doubleValue : NSMidX(parent.frame) - NSWidth(frame) / 2;
    const CGFloat top = features[@"y"] ? features[@"y"].doubleValue : NSMaxY(primary) - NSMaxY(parent.frame) + 60;
    frame.origin = NSMakePoint(left, NSMaxY(primary) - top - NSHeight(content));
  } else if (parent) {
    frame.origin = NSMakePoint(NSMidX(parent.frame) - NSWidth(frame) / 2, NSMaxY(parent.frame) - NSHeight(frame) - 60);
  } else {
    [window center];
    frame = window.frame;
  }
  const NSRect visible = screen.visibleFrame;
  frame.origin.x = MAX(NSMinX(visible), MIN(NSMinX(frame), NSMaxX(visible) - NSWidth(frame)));
  frame.origin.y = MAX(NSMinY(visible), MIN(NSMinY(frame), NSMaxY(visible) - NSHeight(frame)));
  [window setFrame:frame display:NO];
}

// After the insert that reported the tab: Chrome's strip can't change from inside its own callback.
- (void)takeTab {
  if (_tab.closed) return [_coreWindow close];
  _adopting = YES;
  [_coreWindow adoptTab:_tab];
  _adopting = NO;
  if (NNCoreProfile *profile = _tab.profile) _coreWindow.activeProfile = profile;
  _tab.delegate = self;
  NSView *page = _tab.view;
  [page removeFromSuperview];
  page.frame = _coreWindow.hostView.bounds;
  page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_coreWindow.hostView addSubview:page];
  [self updateTitle];
  if (nncore_host::Background()) [_coreWindow showInactive];
  else [_coreWindow.window makeKeyAndOrderFront:nil];
  [_tab focus];
}

- (void)updateTitle {
  NSString *url = _tab.url ?: @"", *host = HostOf(url), *title = _tab.title;
  NSWindow *window = _coreWindow.window;
  window.title = title.length && ![title isEqualToString:url] ? title : host;
  window.subtitle = [window.title isEqualToString:host] ? @"" : host;
}

- (void)windowWillClose {
  if (_closeObserver) [NSNotificationCenter.defaultCenter removeObserver:_closeObserver];
  _closeObserver = nil;
  if (_tab.delegate == self) _tab.delegate = nil;
  // Removed after the close finishes (the engine is still unwinding the window).
  NNCorePopupWindow *me = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [PopupWindows() removeObject:me]; });
}

// MARK: The page

- (void)tabDidChangeTitle:(NNCoreTab *)tab {
  [self updateTitle];
}

- (void)tabDidChangeURL:(NNCoreTab *)tab {
  [self updateTitle];
}

- (void)tab:(NNCoreTab *)tab requestsActivation:(NSString *)reason {
  if (!nncore_host::Background()) [_coreWindow.window makeKeyAndOrderFront:nil];
}

- (void)tab:(NNCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  // The app's prompt, over the opener's tab (the request answers through the engine, whichever tab shows it).
  id<NNCoreTabDelegate> opener = (id<NNCoreTabDelegate>)_opener;
  if ([opener respondsToSelector:@selector(tab:externalAppRequest:)]) [opener tab:tab externalAppRequest:request];
}

// MARK: The window

- (void)window:(NNCoreWindow *)window didInsertTab:(NNCoreTab *)tab opener:(NNCoreTab *)opener disposition:(NSString *)disposition {
  if (_adopting || tab == _tab) return;
  // The popup's own popups get windows too; its other new tabs go to the app beside the opener's tab.
  if ([disposition isEqualToString:@"popup"]) return nncore_host::OpenPopupWindow(tab, _opener);
  NNCoreWebView *view = _opener ?: [NNCoreWindowController hostingViewForProfile:tab.profile];
  if (view) [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab] disposition:nncore_host::AppDisposition(disposition)];
  else [tab closeNow];
}

- (void)window:(NNCoreWindow *)window didRemoveTab:(NNCoreTab *)tab {
  if (tab != _tab) return;
  // Its page closed (or went to the app): nothing is left to show.
  __weak NNCoreWindow *coreWindow = _coreWindow;
  dispatch_async(dispatch_get_main_queue(), ^{ [coreWindow close]; });
}

- (BOOL)window:(NNCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  // ⌘W closes the popup (the app's menu would close the opener window's tab).
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (mods == NSEventModifierFlagCommand && [event.charactersIgnoringModifiers.lowercaseString isEqualToString:@"w"]) {
    [_coreWindow close];
    return YES;
  }
  return NO;
}

@end

namespace nncore_host {

void OpenPopupWindow(NNCoreTab *tab, NNCoreWebView *opener) {
  NNCorePopupWindow *popup = [[NNCorePopupWindow alloc] initWithTab:tab opener:opener];
  if (!popup) {
    // No window: the tab goes to the app as any page's new tab would.
    if (opener) [opener openedTab:tab adoptId:[NNCoreTabs offerTab:tab] disposition:@"foreground"];
    return;
  }
  [PopupWindows() addObject:popup];
  __weak NNCorePopupWindow *weakPopup = popup;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakPopup takeTab]; });
}

NSUInteger PopupWindowCount() {
  return PopupWindows().count;
}

void ActToggleFullScreen(NSWindow *window) {
  LogActivation(@"toggleFullScreen: (acted out)");
  if (NNCoreWindow *coreWindow = [NNCoreWindowController forNSWindow:window].coreWindow)
    ActWindowFullScreen(coreWindow, !IsWindowFullScreen(window), gActedTransition);
}

}  // namespace nncore_host

// MARK: - NNChromeWindowHost

NSView *NNWindowRootView(NSWindow *window) {
  return [NNChromeWindowHost rootViewOfWindow:window] ?: window.contentView;
}

@implementation NNChromeWindowHost

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  if (!NNCoreHost.isStarted) return nil;
  NNCoreWindow *coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1360, 860)];
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ConfigureWindow(window);
  NNCoreWindowController *controller = [[NNCoreWindowController alloc] initWithCoreWindow:coreWindow];
  [Controllers() setObject:controller forKey:window];
  [self showProfile:profile ?: @"" inWindow:window];
  return window;
}

+ (NSWindow *)makePopupWindowForProfile:(NSString *)profile root:(NSView *)root {
  return nil;
}

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (!controller) return;
  __weak NNCoreWindow *coreWindow = controller.coreWindow;
  nncore_host::WithProfile(profile ?: @"", ^(NNCoreProfile *p) {
    if (!p || !coreWindow) return;
    coreWindow.activeProfile = p;
  });
}

+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (!controller || ![controller.coreWindow respondsToSelector:@selector(prepareProfile:)]) return;
  __weak NNCoreWindow *coreWindow = controller.coreWindow;
  for (NSString *profile in profiles)
    nncore_host::WithProfile(profile, ^(NNCoreProfile *p) {
      if (p && coreWindow) [coreWindow prepareProfile:p];
    });
}

+ (void)setTrafficLightsCenter:(NSValue *)center inWindow:(NSWindow *)window {
  if (objc_getAssociatedObject(window, kLightsShownKey)) {  // drawn elsewhere by a move: laid out here now instead
    objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, kLightsMoveKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    TranslateTrafficLights(TrafficLightButtons(window), 0);
  }
  NSValue *current = objc_getAssociatedObject(window, kLightsCenterKey);
  if (current == center || [current isEqual:center]) return;
  objc_setAssociatedObject(window, kLightsCenterKey, center, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  RetileTrafficLights(window);
}

+ (void)moveTrafficLightsCenter:(NSValue *)center inWindow:(NSWindow *)window {
  id shown = objc_getAssociatedObject(window, kLightsShownKey);
  NSValue *current = shown ? (shown == NSNull.null ? nil : shown) : objc_getAssociatedObject(window, kLightsCenterKey);
  if (current == center || [current isEqual:center]) return;
  if (!MoveTrafficLights(window, center)) [self setTrafficLightsCenter:center inWindow:window];
}

+ (void)setSwappedHandler:(void (^)(NSWindow *, NSWindow *))handler {
  gSwapped = [handler copy];
}

+ (void (^)(NSWindow *, NSWindow *))swappedHandler {
  return gSwapped;
}

+ (void)closeWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  [NNCoreWebView keepTransfersOfWindow:window];
  if (controller) [controller.coreWindow close];
  else [window close];
}

+ (void)setShouldCloseHandler:(BOOL (^)(NSWindow *))handler {
  gShouldClose = [handler copy];
}

+ (BOOL (^)(NSWindow *))shouldCloseHandler {
  return gShouldClose;
}

+ (BOOL)windowShouldClose:(NSWindow *)window {
  return gShouldClose ? gShouldClose(window) : YES;
}

+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (!controller) return;
  NSView *host = controller.coreWindow.hostView;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  root.frame = host.bounds;
  [host addSubview:root];
  controller.root = root;
}

+ (NSView *)rootViewOfWindow:(NSWindow *)window {
  return [NNCoreWindowController forNSWindow:window].root;
}

+ (void)removeRootViewOfWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  [controller.root removeFromSuperview];
  controller.root = nil;
}

@end

// MARK: - DEV input (the same actions as packages/cef's NNChromeWindow.mm, for the shared test scripts)

namespace {

NSString *Describe(NSView *view) {
  if (view && ![view isKindOfClass:NSView.class]) return NSStringFromClass([(id)view class]);
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = view; v && chain.count < 6; v = v.superview) [chain addObject:NSStringFromClass(v.class)];
  return [chain componentsJoinedByString:@" < "];
}

NSPoint WindowPoint(NSWindow *window, NSString *spec) {
  NSArray<NSString *> *n = [spec componentsSeparatedByString:@","];
  if (n.count < 2) return NSMakePoint(-1, -1);
  CGFloat height = window.contentView.superview.bounds.size.height;
  return NSMakePoint(n[0].doubleValue, height - n[1].doubleValue);
}

NSEvent *Mouse(NSWindow *window, NSEventType type, NSPoint at) {
  return [NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                        windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
}

NSEvent *Key(NSWindow *window, NSEventType type, NSEventModifierFlags flags, NSString *chars, unsigned short code) {
  return [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags timestamp:NSProcessInfo.processInfo.systemUptime
                      windowNumber:window.windowNumber context:nil characters:chars charactersIgnoringModifiers:chars
                         isARepeat:NO keyCode:code];
}

}

namespace {

// What an in-process picture of the window (all AppKit shows of it through a full-screen transition: NNPageCover) has
// in the page's place, now: {t (ms since the probe started), size (the window's), page ([x, y, w, h] from the
// window's top-left), cover, transitioning, uniform (the share of the page's place in its most common colour: 1 is
// a bare background), grid (8 × 6 mean colours "rrggbb", rows from the top)}.
NSDictionary *ProbeFrame(NSWindow *window, NNWindowFullScreen *state, CFTimeInterval start) {
  NSView *content = window.contentView;
  CALayer *layer = content.layer;
  if (!layer) return nil;
  const CGFloat scale = 0.125;
  const NSSize size = content.bounds.size;
  const size_t w = MAX(1, (size_t)ceil(size.width * scale)), h = MAX(1, (size_t)ceil(size.height * scale));
  NSMutableData *pixels = [NSMutableData dataWithLength:w * h * 4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes, w, h, 8, w * 4, space,
                                               (CGBitmapInfo)kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return nil;
  CGContextScaleCTM(context, scale, scale);
  if (content.isFlipped || layer.geometryFlipped) {
    CGContextTranslateCTM(context, 0, size.height);
    CGContextScaleCTM(context, 1, -1);
  }
  [layer renderInContext:context];
  CGContextRelease(context);
  NSMutableDictionary *frame = [@{
    @"t" : @(round((CACurrentMediaTime() - start) * 1000)),
    @"size" : @[ @(size.width), @(size.height) ],
    @"cover" : @(state.covered),
    @"covers" : @(state.covers),
    @"transitioning" : @(state.transitioning),
  } mutableCopy];
  NSView *page = state.probedTab.view;
  if (!page.window || page.window != window) return frame;
  // The page's place in the picture's rows (top-down) and columns.
  const NSRect r = [page convertRect:page.bounds toView:content];
  const CGFloat top = content.isFlipped ? NSMinY(r) : size.height - NSMaxY(r);
  frame[@"page"] = @[ @(NSMinX(r)), @(top), @(NSWidth(r)), @(NSHeight(r)) ];
  const long x0 = lround(NSMinX(r) * scale), y0 = lround(top * scale);
  const long x1 = MIN((long)w, lround(NSMaxX(r) * scale)), y1 = MIN((long)h, lround((top + NSHeight(r)) * scale));
  if (x1 - x0 < 8 || y1 - y0 < 6) return frame;
  const uint8_t *p = (const uint8_t *)pixels.bytes;
  NSMutableDictionary<NSNumber *, NSNumber *> *counts = [NSMutableDictionary dictionary];
  double sums[6][8][3] = {};
  long cells[6][8] = {}, n = 0, most = 0;
  for (long y = y0; y < y1; y++) {
    for (long x = x0; x < x1; x++) {
      const uint8_t *px = p + (y * w + x) * 4;
      NSNumber *key = @(((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3));
      const long c = counts[key].longValue + 1;
      counts[key] = @(c);
      most = MAX(most, c);
      const long gy = (y - y0) * 6 / (y1 - y0), gx = (x - x0) * 8 / (x1 - x0);
      for (int k = 0; k < 3; k++) sums[gy][gx][k] += px[k];
      cells[gy][gx]++;
      n++;
    }
  }
  NSMutableArray *grid = [NSMutableArray array];
  for (int gy = 0; gy < 6; gy++)
    for (int gx = 0; gx < 8; gx++) {
      const long c = MAX(1, cells[gy][gx]);
      [grid addObject:[NSString stringWithFormat:@"%02x%02x%02x", (int)(sums[gy][gx][0] / c), (int)(sums[gy][gx][1] / c),
                                                 (int)(sums[gy][gx][2] / c)]];
    }
  frame[@"uniform"] = @(round((double)most / n * 1000) / 1000);
  frame[@"grid"] = grid;
  return frame;
}

}  // namespace

@implementation NNChromeWindowHost (Dev)

// "lights": the close button's frame in window coordinates (x,y,w,h, bottom-left origin).
+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if (!window) return nil;
  // "fakeFullScreen:<1|0>[:<ms>]" (test instances): the window enters or leaves macOS full screen as the green button
  // would, acted out; with a duration the transition ends that much later. "fakeFullScreenMs:<ms>": the length of the
  // acted transitions page full screen starts. "fullScreen": the window's full screen and its page full screen, as JSON.
  // "fakeOcclusion:<visible|occluded|off>": macOS's occlusion state for the window; "fakeFullScreenOcclusionMs:<ms>"
  // (-1 off): acted transitions occlude the window as a real one does, visible again <ms> after it ends.
  if ([action hasPrefix:@"fakeFullScreenMs:"]) {
    if (!nncore_host::Background()) return @"test instances only";
    gActedTransition = MAX(0, [action substringFromIndex:17].doubleValue / 1000);
    return [NSString stringWithFormat:@"%.0f", gActedTransition * 1000];
  }
  // "pageCover:<1|0>" (test instances): the page's picture over it through the window's transitions (NNPageCover), or
  // not, as up to 0.2.30. "fullScreenProbe:<ms>": for <ms>, at every display frame, what AppKit's pictures of the window
  // would show in the page's place (ProbeFrame); "fullScreenProbe": those frames, as JSON.
  if ([action hasPrefix:@"pageCover:"]) {
    if (!nncore_host::Background()) return @"test instances only";
    gPageCoverOff = ![[action substringFromIndex:10] isEqualToString:@"1"];
    return @(!gPageCoverOff).stringValue;
  }
  if ([action hasPrefix:@"fullScreenProbe"]) {
    static NSMutableArray *frames;
    static NSTimer *timer;
    if ([action isEqualToString:@"fullScreenProbe"]) {
      NSData *json = [NSJSONSerialization dataWithJSONObject:frames ?: @[] options:0 error:nil];
      return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
    }
    if (!nncore_host::Background()) return @"test instances only";
    NNCoreWindow *coreWindow = [NNCoreWindowController forNSWindow:window].coreWindow;
    NNWindowFullScreen *state = coreWindow ? [NNWindowFullScreen ofWindow:coreWindow create:YES] : nil;
    if (!state) return @"not an NNCore window";
    [timer invalidate];
    frames = [NSMutableArray array];
    const CFTimeInterval start = CACurrentMediaTime(), until = start + MAX(0, [action substringFromIndex:16].doubleValue) / 1000;
    __weak NSWindow *weakWindow = window;
    timer = [NSTimer timerWithTimeInterval:1.0 / 60
                                   repeats:YES
                                     block:^(NSTimer *t) {
                                       NSWindow *w = weakWindow;
                                       if (!w || CACurrentMediaTime() > until) return [t invalidate];
                                       if (NSDictionary *frame = ProbeFrame(w, state, start)) [frames addObject:frame];
                                     }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
    return @"started";
  }
  if ([action hasPrefix:@"fakeFullScreenOcclusionMs:"]) {
    if (!nncore_host::Background()) return @"test instances only";
    const double ms = [action substringFromIndex:26].doubleValue;
    gActedOcclusionGap = ms == -1 ? NAN : ms / 1000;
    return [NSString stringWithFormat:@"%.0f", ms];
  }
  // "fakeAppActive:<1|0>" (test instances): the app reads as active or not, as when the user comes back or goes to
  // another app; the key window follows.
  if ([action hasPrefix:@"fakeAppActive:"]) {
    if (!nncore_host::Background()) return @"test instances only";
    nncore_host::SetAppActive([[action substringFromIndex:14] isEqualToString:@"1"]);
    return @(NSApp.isActive).stringValue;
  }
  if ([action hasPrefix:@"fakeOcclusion:"]) {
    if (!nncore_host::Background()) return @"test instances only";
    NSString *to = [action substringFromIndex:14];
    ActOcclusion(window, [to isEqualToString:@"off"] ? nil : @([to isEqualToString:@"visible"]));
    return @((window.occlusionState & NSWindowOcclusionStateVisible) != 0).stringValue;
  }
  if ([action hasPrefix:@"fakeFullScreen:"] || [action isEqualToString:@"fullScreen"]) {
    NNCoreWindow *coreWindow = [NNCoreWindowController forNSWindow:window].coreWindow;
    if (!coreWindow) return @"not an NNCore window";
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count > 1) {
      if (!nncore_host::Background()) return @"test instances only";
      const BOOL enter = [parts[1] isEqualToString:@"1"];
      if (enter != IsWindowFullScreen(window)) ActWindowFullScreen(coreWindow, enter, parts.count > 2 ? parts[2].doubleValue / 1000 : 0);
    }
    NSMutableDictionary *state = [@{
      @"fullScreen" : @(IsWindowFullScreen(window)),
      @"styleMask" : @((window.styleMask & NSWindowStyleMaskFullScreen) != 0),
      @"acted" : @(objc_getAssociatedObject(window, kActedFullScreenKey) != nil),
      @"chromeCounts" : @([coreWindow respondsToSelector:@selector(actedFullScreen)] && coreWindow.actedFullScreen),
    } mutableCopy];
    if (NNWindowFullScreen *page = [NNWindowFullScreen ofWindow:coreWindow create:NO]) state[@"pageFullScreen"] = [page state];
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
  }
  NSView *frameView = window.contentView.superview;
  // The window's child windows (Chrome's dropdowns, bubbles and menus attach as children): [{class, frame, visible}].
  if ([action isEqualToString:@"children"]) {
    NSMutableArray *children = [NSMutableArray array];
    for (NSWindow *child in window.childWindows)
      [children addObject:@{@"class" : NSStringFromClass(child.class), @"frame" : NSStringFromRect(child.frame),
                            @"visible" : @(child.visible), @"title" : child.title ?: @""}];
    NSData *json = [NSJSONSerialization dataWithJSONObject:children options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
  }
  if ([action hasPrefix:@"hit:"]) {
    NSPoint p = WindowPoint(window, [action substringFromIndex:4]);
    return Describe([frameView hitTest:p]);
  }
  // Window drags started since the last call, with who started them: a drag from the tab strip must not move the
  // window. The first call starts recording (AppKit's two entry points to a window drag).
  if ([action isEqualToString:@"windowDrags"]) {
    static NSMutableArray<NSString *> *drags;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      drags = [NSMutableArray array];
      for (NSString *name in @[ @"performWindowDragWithEvent:", @"performWindowDragWithEvent:completionHandler:" ]) {
        Method m = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(name));
        if (!m) continue;
        IMP original = method_getImplementation(m);
        bool handler = [name hasSuffix:@"Handler:"];
        method_setImplementation(m, handler ? imp_implementationWithBlock(^(NSWindow *w, NSEvent *e, id done) {
          [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
          ((void (*)(id, SEL, NSEvent *, id))original)(w, NSSelectorFromString(name), e, done);
        }) : imp_implementationWithBlock(^(NSWindow *w, NSEvent *e) {
          [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
          ((void (*)(id, SEL, NSEvent *))original)(w, NSSelectorFromString(name), e);
        }));
      }
    });
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)drags.count, [drags componentsJoinedByString:@"\n---\n"]];
    [drags removeAllObjects];
    return out;
  }
  // "responderChanges" (test instances): first-responder changes since the last call, each with its caller's stack
  // (who took a field's focus). The first call starts recording.
  if ([action isEqualToString:@"responderChanges"]) {
    if (!nncore_host::Background()) return @"test instances only";
    static NSMutableArray<NSString *> *changes;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      changes = [NSMutableArray array];
      SEL sel = @selector(makeFirstResponder:);
      Method m = class_getInstanceMethod(NSWindow.class, sel);
      IMP original = method_getImplementation(m);
      method_setImplementation(m, imp_implementationWithBlock(^BOOL(NSWindow *w, NSResponder *r) {
        [changes addObject:[NSString stringWithFormat:@"-> %@\n%@", Describe((NSView *)r),
                                                       [[NSThread callStackSymbols] componentsJoinedByString:@"\n"]]];
        return ((BOOL(*)(id, SEL, NSResponder *))original)(w, sel, r);
      }));
    });
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)changes.count, [changes componentsJoinedByString:@"\n---\n"]];
    [changes removeAllObjects];
    return out;
  }
  // "fakeActiveClicks" (test instances): text views and pages take a click in the key window, as in an active app. A
  // background instance's app is never really active, so AppKit keeps each first click to itself (the caret doesn't
  // move on unselected text, a click on the page doesn't focus it).
  if ([action isEqualToString:@"fakeActiveClicks"]) {
    if (!nncore_host::Background()) return @"test instances only";
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      NSMutableSet<Class> *classes = [NSMutableSet setWithObject:NSTextView.class];
      if (Class page = NSClassFromString(@"RenderWidgetHostViewCocoa")) [classes addObject:page];
      for (Class cls in classes) {
        SEL sel = @selector(acceptsFirstMouse:);
        Method m = class_getInstanceMethod(cls, sel);
        IMP original = method_getImplementation(m);
        IMP takes = imp_implementationWithBlock(^BOOL(NSView *v, NSEvent *e) {
          return v.window.isKeyWindow || ((BOOL(*)(id, SEL, NSEvent *))original)(v, sel, e);
        });
        // Its own method (a subclass may only inherit NSView's).
        if (!class_addMethod(cls, sel, takes, method_getTypeEncoding(m))) method_setImplementation(m, takes);
      }
    });
    return @"1";
  }
  if ([action hasPrefix:@"click:"]) {
    NSString *spec = [action substringFromIndex:6];
    bool right = [spec hasSuffix:@",right"];
    NSPoint p = WindowPoint(window, spec);
    NSView *target = [frameView hitTest:p];
    NSString *hit = Describe(target);
    bool page = [target isKindOfClass:NSClassFromString(@"RenderWidgetHostViewCocoa")];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!page) {
        [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown, p)];
        [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp, p)];
      } else if (right) {
        [target rightMouseDown:Mouse(window, NSEventTypeRightMouseDown, p)];
        [target rightMouseUp:Mouse(window, NSEventTypeRightMouseUp, p)];
      } else {
        [target mouseDown:Mouse(window, NSEventTypeLeftMouseDown, p)];
        [target mouseUp:Mouse(window, NSEventTypeLeftMouseUp, p)];
      }
    });
    return hit;
  }
  // "mouse:<down|up|dragged|moved>:<x>,<y>[,<clickCount>]": one left-button event posted to the app's queue, as the
  // window server delivers one. A text field's mouse-down tracks the mouse until its mouse-up comes from the queue
  // ("click:" sends both at once, which would leave it waiting), so a script sends the up when it means to.
  if ([action hasPrefix:@"mouse:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"mouse:<down|up|dragged|moved>:<x>,<y>[,<clickCount>]";
    NSDictionary<NSString *, NSNumber *> *types = @{
      @"down" : @(NSEventTypeLeftMouseDown), @"up" : @(NSEventTypeLeftMouseUp),
      @"dragged" : @(NSEventTypeLeftMouseDragged), @"moved" : @(NSEventTypeMouseMoved),
    };
    NSNumber *type = types[parts[1]];
    if (!type) return @"unknown mouse event";
    NSArray<NSString *> *n = [parts[2] componentsSeparatedByString:@","];
    NSPoint p = WindowPoint(window, parts[2]);
    const NSEventType t = (NSEventType)type.unsignedIntegerValue;
    NSEvent *event = [NSEvent mouseEventWithType:t location:p modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                                    windowNumber:window.windowNumber context:nil eventNumber:0
                                      clickCount:n.count > 2 ? n[2].integerValue : (t == NSEventTypeMouseMoved ? 0 : 1)
                                        pressure:t == NSEventTypeLeftMouseUp || t == NSEventTypeMouseMoved ? 0 : 1];
    [NSApp postEvent:event atStart:NO];
    return Describe([frameView hitTest:p]);
  }
  if ([action hasPrefix:@"drag:"]) {
    NSMutableArray<NSValue *> *points = [NSMutableArray array];
    for (NSString *spec in [[action substringFromIndex:5] componentsSeparatedByString:@";"])
      [points addObject:[NSValue valueWithPoint:WindowPoint(window, spec)]];
    if (points.count < 2) return @"drag needs two points";
    NSMutableArray<NSEvent *> *events = [NSMutableArray arrayWithObject:Mouse(window, NSEventTypeLeftMouseDown, points[0].pointValue)];
    for (NSUInteger i = 1; i < points.count; i++) {
      NSPoint a = points[i - 1].pointValue, b = points[i].pointValue;
      for (int k = 1; k <= 12; k++)
        [events addObject:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12))];
    }
    [events addObject:Mouse(window, NSEventTypeLeftMouseUp, points.lastObject.pointValue)];
    NSString *hit = Describe([frameView hitTest:points[0].pointValue]);
    for (NSUInteger i = 0; i < events.count; i++)
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((i ? 150 + i * 16 : 0) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        [window sendEvent:events[i]];
      });
    return [NSString stringWithFormat:@"%@ (%lu events)", hit, (unsigned long)events.count];
  }
  if ([action hasPrefix:@"type:"]) {
    NSString *text = [action substringFromIndex:5];
    for (NSUInteger i = 0; i < text.length; i++) {
      NSString *c = [text substringWithRange:NSMakeRange(i, 1)];
      [window.firstResponder keyDown:Key(window, NSEventTypeKeyDown, 0, c, 0)];
      [window.firstResponder keyUp:Key(window, NSEventTypeKeyUp, 0, c, 0)];
    }
    return Describe((NSView *)window.firstResponder);
  }
  if ([action hasPrefix:@"keys:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"keys:<flags>:<characters>[:<keyCode>]";
    NSEventModifierFlags flags = (NSEventModifierFlags)parts[1].longLongValue;
    unsigned short code = parts.count > 3 ? (unsigned short)parts[3].intValue : 0;
    NSEvent *down = Key(window, NSEventTypeKeyDown, flags, parts[2], code);
    NSString *handler = @"none";
    if ([window performKeyEquivalent:down]) handler = @"window";
    else if ([NSApp.mainMenu performKeyEquivalent:down]) handler = @"mainMenu";
    else {
      [window.firstResponder keyDown:down];
      handler = @"keyDown";
    }
    return [NSString stringWithFormat:@"%@ (first responder %@)", handler, Describe((NSView *)window.firstResponder)];
  }
  if ([action isEqualToString:@"ax"]) {
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    __block void (^walk)(id, NSUInteger);
    __block __weak void (^weakWalk)(id, NSUInteger);
    weakWalk = walk = ^(id element, NSUInteger depth) {
      if (lines.count > 400 || depth > 40) return;
      NSString *role = [element respondsToSelector:@selector(accessibilityRole)] ? [element accessibilityRole] : @"?";
      NSMutableArray *text = [NSMutableArray array];
      for (NSString *key in @[ @"accessibilityTitle", @"accessibilityLabel", @"accessibilityValue" ]) {
        SEL sel = NSSelectorFromString(key);
        id value = [element respondsToSelector:sel] ? [element valueForKey:key] : nil;
        if ([value isKindOfClass:NSString.class] && [value length]) [text addObject:value];
      }
      [lines addObject:[NSString stringWithFormat:@"%@%@%@", [@"" stringByPaddingToLength:depth withString:@" " startingAtIndex:0],
                                                 role ?: @"", text.count ? [@": " stringByAppendingString:[text componentsJoinedByString:@" | "]] : @""]];
      NSArray *children = [element respondsToSelector:@selector(accessibilityChildren)] ? [element accessibilityChildren] : nil;
      for (id child in children) weakWalk(child, depth + 1);
    };
    walk(window, 0);
    return [lines componentsJoinedByString:@"\n"];
  }
  if ([action isEqualToString:@"winfo"]) {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[@"frame"] = NSStringFromRect(window.frame);
    info[@"contentView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.className, NSStringFromRect(window.contentView.frame)];
    info[@"frameView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.superview.className, NSStringFromRect(window.contentView.superview.frame)];
    info[@"root"] = NSStringFromRect([NNChromeWindowHost rootViewOfWindow:window].frame);
    info[@"styleMask"] = @(window.styleMask);
    info[@"opaque"] = @(window.opaque);
    info[@"hasShadow"] = @(window.hasShadow);
    info[@"alpha"] = @(window.alphaValue);
    info[@"level"] = @(window.level);
    info[@"background"] = window.backgroundColor.description ?: @"";
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    info[@"closeButton"] = close ? NSStringFromRect([close convertRect:close.bounds toView:nil]) : @"";
    info[@"appearance"] = window.appearance.name ?: @"";
    NSWindow *sheet = window.attachedSheet;
    info[@"sheet"] = sheet ? [NSString stringWithFormat:@"%@ %@", sheet.className, NSStringFromRect(sheet.frame)] : @"";
    if ([sheet.windowController respondsToSelector:@selector(window)] || sheet) {
      NSMutableArray *texts = [NSMutableArray array];
      NSMutableArray *stack = [NSMutableArray arrayWithObject:sheet.contentView ?: [NSView new]];
      while (stack.count) {
        NSView *v = stack.lastObject;
        [stack removeLastObject];
        if ([v isKindOfClass:NSTextField.class] && [(NSTextField *)v stringValue].length) [texts addObject:[(NSTextField *)v stringValue]];
        if ([v isKindOfClass:NSButton.class] && [(NSButton *)v title].length) [texts addObject:[(NSButton *)v title]];
        [stack addObjectsFromArray:v.subviews];
      }
      info[@"sheetText"] = texts;
    }
    NSMutableArray *effects = [NSMutableArray array];
    NSMutableArray *walk = [NSMutableArray arrayWithObject:[NNChromeWindowHost rootViewOfWindow:window] ?: window.contentView];
    while (walk.count) {
      NSView *v = walk.lastObject;
      [walk removeLastObject];
      if ([v isKindOfClass:NSVisualEffectView.class]) {
        NSVisualEffectView *e = (NSVisualEffectView *)v;
        [effects addObject:[NSString stringWithFormat:@"material %ld blending %ld state %ld emphasized %d %@ hidden %d alpha %.2f",
                                                      (long)e.material, (long)e.blendingMode, (long)e.state, e.emphasized,
                                                      NSStringFromSize(e.frame.size), e.isHiddenOrHasHiddenAncestor, e.alphaValue]];
      }
      [walk addObjectsFromArray:v.subviews];
    }
    info[@"effects"] = effects;
    NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber));
    info[@"cgBounds"] = [list.firstObject objectForKey:(id)kCGWindowBounds] ?: @{};
    NSData *json = [NSJSONSerialization dataWithJSONObject:info options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action hasPrefix:@"ns:"]) {
    if ([action hasSuffix:@"out"]) [window orderOut:nil];
    else [window orderFront:nil];
    return [NSString stringWithFormat:@"visible=%d", window.visible];
  }
  if ([action isEqualToString:@"performClose"]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [window performClose:nil]; });
    return @"ok";
  }
  if ([action hasPrefix:@"style:"]) {
    window.styleMask = (NSWindowStyleMask)[action substringFromIndex:6].longLongValue;
    return @"ok";
  }
  if ([action hasPrefix:@"shadow:"]) {
    window.hasShadow = [action hasSuffix:@"1"];
    return @"ok";
  }
  if ([action hasPrefix:@"root:"]) {
    [NNChromeWindowHost rootViewOfWindow:window].hidden = [action hasSuffix:@"hide"];
    return @"ok";
  }
  if ([action hasPrefix:@"opaque:"]) {
    window.opaque = [action hasSuffix:@"1"];
    if (!window.opaque) window.backgroundColor = NSColor.clearColor;
    return [NSString stringWithFormat:@"opaque=%d", window.opaque];
  }
  if ([action hasPrefix:@"ime:"]) {
    NSArray<NSString *> *parts = [[action substringFromIndex:4] componentsSeparatedByString:@"|"];
    id<NSTextInputClient> client = (id<NSTextInputClient>)window.firstResponder;
    if (![(id)client conformsToProtocol:@protocol(NSTextInputClient)]) return @"first responder isn't a text input client";
    [client setMarkedText:parts[0] selectedRange:NSMakeRange(parts[0].length, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    const BOOL marked = client.hasMarkedText;
    const NSRange range = client.markedRange;
    if (parts.count > 1) [client insertText:parts[1] replacementRange:NSMakeRange(NSNotFound, 0)];
    return [NSString stringWithFormat:@"%@ marked=%d range=%@ after commit marked=%d", Describe((NSView *)client), marked,
                                      NSStringFromRange(range), client.hasMarkedText];
  }
  if ([action isEqualToString:@"tabviews"]) {
    NSMutableArray *out = [NSMutableArray array];
    Class tabClass = NNCoreWebView.class;
    NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:window.contentView];
    while (queue.count) {
      NSView *v = queue.lastObject;
      [queue removeLastObject];
      if ([v isKindOfClass:tabClass]) {
        if (v.hiddenOrHasHiddenAncestor) continue;
        NSMutableArray *subs = [NSMutableArray array];
        for (NSView *sub in v.subviews)
          [subs addObject:[NSString stringWithFormat:@"%@ %@%@", NSStringFromClass(sub.class), NSStringFromRect(sub.frame),
                                                     sub.hidden ? @" hidden" : @""]];
        [out addObject:@{@"frame" : NSStringFromRect(v.frame), @"subviews" : subs}];
        continue;
      }
      [queue addObjectsFromArray:v.subviews];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  if ([action isEqualToString:@"lights"]) {
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    if (!close) return nil;
    NSRect r = [close convertRect:close.bounds toView:nil];
    return [NSString stringWithFormat:@"%.1f,%.1f,%.1f,%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height];
  }
  if ([action isEqualToString:@"cover"] || [action isEqualToString:@"uncover"]) {
    // Tests: one of the app's own windows right above this one, a little larger, as an owner's window covering it
    // would be (Chrome's occlusion checker then reports it occluded). Never key, never takes clicks.
    static NSMapTable<NSWindow *, NSWindow *> *covers = [NSMapTable weakToStrongObjectsMapTable];
    NSWindow *cover = [covers objectForKey:window];
    if ([action isEqualToString:@"cover"]) {
      if (!cover) {
        cover = [[NSWindow alloc] initWithContentRect:NSInsetRect(window.frame, -4, -4)
                                            styleMask:NSWindowStyleMaskBorderless
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
        cover.releasedWhenClosed = NO;
        cover.opaque = YES;
        cover.backgroundColor = NSColor.windowBackgroundColor;
        cover.ignoresMouseEvents = YES;
        [covers setObject:cover forKey:window];
      }
      [cover orderWindow:NSWindowAbove relativeTo:window.windowNumber];
      return NSStringFromRect(cover.frame);
    }
    [cover orderOut:nil];
    [covers removeObjectForKey:window];
    return @"uncovered";
  }
  if ([action isEqualToString:@"close-button"]) {
    // The title bar's close button, as a click on it (performClose: → windowShouldClose:).
    [[window standardWindowButton:NSWindowCloseButton] performClick:nil];
    return @"clicked";
  }
  return nil;
}

@end
