#import "NNChromeWindow.h"

#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>
#import <objc/runtime.h>

#import "NNWindowHost.h"

/// Chromium's BridgedContentView with chromium-window-hosted.patch: hit testing and accessibility
/// ask this view first. Chrome's views cover the whole window, so without it no click would reach
/// our views and assistive technologies would see only Chrome's hidden ones.
@protocol NNEmbeddingContentView
@property(nonatomic, weak) NSView *netnyahooEmbeddedView;
@end

namespace {

const void *kRootKey = &kRootKey;
const void *kConfiguredKey = &kConfiguredKey;

bool TakesEmbeddedView(NSView *content) {
  return [content respondsToSelector:@selector(setNetnyahooEmbeddedView:)];
}

BOOL (^gShouldClose)(NSWindow *);

/// Dia 1.50.1's traffic lights (a 2x capture: button centres 24.75, 47.75 and 70.75 pt in, 26.75 pt
/// down; ours measure the same): buttons 18 pt in from the window's left edge, centred in the 54 pt
/// titlebar (CEF centres them vertically in GetTitlebarHeight; its frame puts them further in).
constexpr CGFloat kTrafficLightInsetX = 18;

const void *kFollowedKey = &kFollowedKey;

void LayoutTrafficLights(NSWindow *window) {
  if (window.styleMask & NSWindowStyleMaskFullScreen) return;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *mini = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  if (!close || !mini || !zoom) return;
  // CefThemeFrame centres the buttons again whenever it lays its titlebar out (showing the window,
  // resizes, key changes, full screen): put them back each time it moves one.
  if (!objc_getAssociatedObject(close, kFollowedKey)) {
    objc_setAssociatedObject(close, kFollowedKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    close.postsFrameChangedNotifications = YES;
    __weak NSWindow *weakWindow = window;
    [NSNotificationCenter.defaultCenter addObserverForName:NSViewFrameDidChangeNotification object:close queue:nil
                                                usingBlock:^(NSNotification *) { LayoutTrafficLights(weakWindow); }];
  }
  const CGFloat spacing = NSMinX(mini.frame) - NSMinX(close.frame);
  // In window coordinates: CEF's titlebar container sits a little in from the window's edge.
  const CGFloat offset = [close.superview convertPoint:NSZeroPoint toView:nil].x;
  const CGFloat x = kTrafficLightInsetX - offset;
  if (fabs(NSMinX(close.frame) - x) < 0.5) return;
  NSArray<NSButton *> *buttons = @[ close, mini, zoom ];
  for (NSUInteger i = 0; i < buttons.count; i++)
    [buttons[i] setFrameOrigin:NSMakePoint(x + i * spacing, NSMinY(buttons[i].frame))];
}

/// CefThemeFrame lays the buttons out again on resizes, key changes and full-screen exits (and
/// LayoutTrafficLights follows the close button's frame).
void KeepTrafficLightsInset(NSWindow *window) {
  __weak NSWindow *weakWindow = window;
  for (NSNotificationName name in @[
         NSWindowDidResizeNotification, NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification,
         NSWindowDidExitFullScreenNotification, NSWindowDidBecomeMainNotification
       ])
    [NSNotificationCenter.defaultCenter addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *) {
      LayoutTrafficLights(weakWindow);
      dispatch_async(dispatch_get_main_queue(), ^{ LayoutTrafficLights(weakWindow); });
    }];
  dispatch_async(dispatch_get_main_queue(), ^{ LayoutTrafficLights(weakWindow); });
}

void (^gSwapped)(NSWindow *, NSWindow *);
const void *kPendingProfileKey = &kPendingProfileKey;
/// On a full-screen window while it leaves full screen.
const void *kExitingFullScreenKey = &kExitingFullScreenKey;
/// On a window shown over a full-screen one: its collection behaviour before.
const void *kNestedBehaviorKey = &kNestedBehaviorKey;

void ForwardFullScreenToggles(NSWindow *window);
void ReturnRootBeforeFullScreenExit(NSWindow *window);

/// An app window's Chrome window, once.
void ConfigureHostingWindow(NSWindow *window) {
  if (objc_getAssociatedObject(window, kConfiguredKey)) return;
  objc_setAssociatedObject(window, kConfiguredKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.minSize = NSMakeSize(720, 460);
  window.title = @"Netnyahoo";
  KeepTrafficLightsInset(window);
  ForwardFullScreenToggles(window);
  __weak NSWindow *weakWindow = window;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserverForName:NSWindowWillExitFullScreenNotification object:window queue:nil usingBlock:^(NSNotification *) {
    ReturnRootBeforeFullScreenExit(weakWindow);
  }];
  [center addObserverForName:NSWindowDidExitFullScreenNotification object:window queue:nil usingBlock:^(NSNotification *) {
    objc_setAssociatedObject(weakWindow, kExitingFullScreenKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }];
}

/// BrowserWindow's colour (what a Chrome-hosted window shows before our views paint).
NSColor *WindowColor() {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    const bool dark = [[appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
        isEqualToString:NSAppearanceNameDarkAqua];
    return dark ? [NSColor colorWithSRGBRed:0.17 green:0.12 blue:0.14 alpha:1] : [NSColor colorWithSRGBRed:0.93 green:0.91 blue:0.90 alpha:1];
  }];
}

/// "snapshot": a picture of `window` as it is now, in a borderless window over it (nil if it can't
/// be taken). CGWindowListCreateImage is looked up at run time: the SDK marks it obsolete.
NSWindow *CoverWindow(NSWindow *window) {
  using CreateImage = CGImageRef (*)(CGRect, uint32_t, uint32_t, uint32_t);
  static auto create = (CreateImage)dlsym(RTLD_DEFAULT, "CGWindowListCreateImage");
  if (!create) return nil;
  // kCGWindowListOptionIncludingWindow, kCGWindowImageBoundsIgnoreFraming | kCGWindowImageBestResolution
  CGImageRef image = create(CGRectNull, 1 << 3, (uint32_t)window.windowNumber, (1 << 0) | (1 << 3));
  if (!image) return nil;
  NSWindow *cover = [[NSWindow alloc] initWithContentRect:window.frame styleMask:NSWindowStyleMaskBorderless
                                                  backing:NSBackingStoreBuffered defer:NO];
  cover.releasedWhenClosed = NO;
  cover.opaque = NO;
  cover.backgroundColor = NSColor.clearColor;
  cover.hasShadow = NO;
  cover.ignoresMouseEvents = YES;
  cover.animationBehavior = NSWindowAnimationBehaviorNone;
  cover.level = window.level;
  cover.collectionBehavior = NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
  NSView *view = cover.contentView;
  view.wantsLayer = YES;
  view.layer.contents = (__bridge id)image;
  view.layer.contentsGravity = kCAGravityResize;
  CGImageRelease(image);
  [cover orderWindow:NSWindowAbove relativeTo:window.windowNumber];
  return cover;
}

/// Our root leaves `from` for `to` (both of one app window), committed.
void MoveRoot(NSView *root, NSWindow *from, NSWindow *to) {
  objc_setAssociatedObject(from, kRootKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  ((id<NNEmbeddingContentView>)from.contentView).netnyahooEmbeddedView = nil;
  [NNChromeWindowHost embedRootView:root inWindow:to];
  [CATransaction flush];
}

/// Moves our views from `from` to `to` (another window of the same app window) and puts `to` on
/// screen in its place.
void Swap(NSWindow *from, NSWindow *to) {
  NSView *root = [NNChromeWindowHost rootViewOfWindow:from];
  if (!root || from == to) return;
  NSString *strategy = nn::host::SwapStrategy();
  const BOOL key = from.isKeyWindow;
  to.appearance = from.appearance;
  to.level = from.level;
  to.title = from.title;
  // A cut: AppKit fades document windows in and out.
  from.animationBehavior = to.animationBehavior = NSWindowAnimationBehaviorNone;
  [to setFrame:from.frame display:NO];
  NSWindow *cover = [strategy isEqualToString:@"snapshot"] ? CoverWindow(from) : nil;
  [to orderWindow:NSWindowBelow relativeTo:from.windowNumber];
  // Transparent: once our views leave, the window leaving shows nothing (its compositor clears to
  // transparent), so the window behind, already showing them, is what's on screen.
  if ([strategy isEqualToString:@"transparent"]) from.backgroundColor = NSColor.clearColor;
  MoveRoot(root, from, to);
  [from orderOut:nil];
  from.backgroundColor = WindowColor();
  if (key) [to makeKeyWindow];
  nn::host::WindowShown(to);
  if (gSwapped) gSwapped(from, to);
  // The picture goes once the window under it has drawn a frame or two.
  if (cover)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [cover orderOut:nil];
    });
}

// MARK: Full screen
//
// Full screen gives each NSWindow a Space of its own, so another profile's window can't take the
// full-screen window's place. While the window is in full screen, another profile's window of it
// shows over it instead: a full-screen auxiliary child window at the same frame, without traffic
// lights, our views in it. Its Chrome dialogs and bubbles are its children, so they show on the
// full-screen Space as they would anywhere. When the window leaves full screen, our views go back
// to it first, and the usual swap follows.

/// DEV: a window that acts as if in full screen (the "fakeFullScreen:" action).
const void *kDevFullScreenKey = &kDevFullScreenKey;

bool IsFullScreen(NSWindow *window) {
  return (window.styleMask & NSWindowStyleMaskFullScreen) || objc_getAssociatedObject(window, kDevFullScreenKey);
}

/// The full-screen window `window` is, or is shown over (nil: neither).
NSWindow *FullScreenHost(NSWindow *window) {
  if (!window) return nil;
  if (IsFullScreen(window)) return window;
  NSWindow *parent = window.parentWindow;
  if (parent && IsFullScreen(parent) && objc_getAssociatedObject(window, kNestedBehaviorKey)) return parent;
  return nil;
}

void SetTrafficLightsHidden(NSWindow *window, BOOL hidden) {
  for (NSWindowButton b : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton})
    [window standardWindowButton:b].hidden = hidden;
}

/// `window` shows over the full-screen `host`, on its Space.
void Nest(NSWindow *window, NSWindow *host) {
  if (!objc_getAssociatedObject(window, kNestedBehaviorKey))
    objc_setAssociatedObject(window, kNestedBehaviorKey, @(window.collectionBehavior), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.collectionBehavior = (window.collectionBehavior & ~NSWindowCollectionBehaviorFullScreenPrimary) |
                              NSWindowCollectionBehaviorFullScreenAuxiliary;
  window.movable = NO;
  window.hasShadow = NO;
  SetTrafficLightsHidden(window, YES);
  [window setFrame:host.frame display:NO];
  [host addChildWindow:window ordered:NSWindowAbove];
}

/// `window` no longer shows over a full-screen window.
void Unnest(NSWindow *window) {
  NSNumber *behavior = objc_getAssociatedObject(window, kNestedBehaviorKey);
  if (!behavior) return;
  [window.parentWindow removeChildWindow:window];
  [window orderOut:nil];
  objc_setAssociatedObject(window, kNestedBehaviorKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.collectionBehavior = behavior.unsignedIntegerValue;
  window.movable = YES;
  window.hasShadow = YES;
  SetTrafficLightsHidden(window, NO);
}

/// Swap for a window in full screen (`host`): `to` shows over it (or, being `host`, alone again).
void FullScreenSwap(NSWindow *from, NSWindow *to, NSWindow *host) {
  NSView *root = [NNChromeWindowHost rootViewOfWindow:from];
  if (!root || from == to) return;
  const BOOL key = from.isKeyWindow;
  to.appearance = host.appearance;
  to.title = from.title;
  from.animationBehavior = to.animationBehavior = NSWindowAnimationBehaviorNone;
  if (to != host) Nest(to, host);
  MoveRoot(root, from, to);
  if (from != host) Unnest(from);
  // The full-screen window shows nothing under the one over it (its corners are square, the
  // other's round).
  host.backgroundColor = to == host ? WindowColor() : NSColor.clearColor;
  if (key) [to makeKeyWindow];
  nn::host::WindowShown(to);
  if (gSwapped) gSwapped(from, to);
}

/// Swaps the full-screen `window` to `profile`'s window once it has left full screen.
void SwapAfterFullScreen(NSWindow *window, NSString *profile) {
  const bool waiting = objc_getAssociatedObject(window, kPendingProfileKey) != nil;
  objc_setAssociatedObject(window, kPendingProfileKey, profile ?: @"", OBJC_ASSOCIATION_COPY_NONATOMIC);
  if (waiting) return;
  __block id observer = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidExitFullScreenNotification
                                                                        object:window
                                                                         queue:nil
                                                                    usingBlock:^(NSNotification *) {
    [NSNotificationCenter.defaultCenter removeObserver:observer];
    NSString *pending = objc_getAssociatedObject(window, kPendingProfileKey);
    objc_setAssociatedObject(window, kPendingProfileKey, nil, OBJC_ASSOCIATION_COPY_NONATOMIC);
    dispatch_async(dispatch_get_main_queue(), ^{ [NNChromeWindowHost showProfile:pending inWindow:window]; });
  }];
}

/// `window` starts leaving full screen: our views come back to it from the window shown over it
/// (that one would stay screen-sized through the animation), and that profile's window takes over
/// once it's out.
void ReturnRootBeforeFullScreenExit(NSWindow *window) {
  if (!window) return;
  objc_setAssociatedObject(window, kExitingFullScreenKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  for (NSWindow *child in window.childWindows) {
    if (FullScreenHost(child) != window || ![NNChromeWindowHost rootViewOfWindow:child]) continue;
    NSString *profile = nn::host::WindowProfile(child);
    FullScreenSwap(child, window, window);
    if (profile) SwapAfterFullScreen(window, profile);
    return;
  }
}

/// Toggle Full Screen (the View menu, ⌃⌘F) goes to the key window: shown over a full-screen
/// window, that's the full-screen one's to toggle.
void ForwardFullScreenToggles(NSWindow *window) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class cls = window.class;
    SEL sel = @selector(toggleFullScreen:);
    IMP original = method_getImplementation(class_getInstanceMethod(cls, sel));
    class_addMethod(cls, sel, imp_implementationWithBlock(^(NSWindow *target, id sender) {
                      NSWindow *host = FullScreenHost(target);
                      ((void (*)(id, SEL, id))original)(host ?: target, sel, sender);
                    }),
                    "v@:@");
  });
}

}  // namespace

NSView *NNWindowRootView(NSWindow *window) {
  return [NNChromeWindowHost rootViewOfWindow:window] ?: window.contentView;
}

@implementation NNChromeWindowHost

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  NSWindow *window = nn::host::MakeChromeWindow(profile ?: @"");
  if (!window) return nil;
  // An engine without the content view hook can't take our views.
  if (!TakesEmbeddedView(window.contentView)) {
    [window close];
    return nil;
  }
  ConfigureHostingWindow(window);
  return window;
}

+ (NSWindow *)makePopupWindowForProfile:(NSString *)profile root:(NSView *)root {
  NSWindow *window = nn::host::MakeChromeWindow(profile ?: @"", true);
  if (!window) return nil;
  if (!TakesEmbeddedView(window.contentView)) {
    [window close];
    return nil;
  }
  window.backgroundColor = WindowColor();
  [self embedRootView:root inWindow:window];
  return window;
}

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window {
  if (![self rootViewOfWindow:window]) return;
  NSWindow *host = FullScreenHost(window);
  // Leaving full screen: the swap waits until it's out (meanwhile the profile's pages show in the
  // window).
  if (host && objc_getAssociatedObject(host, kExitingFullScreenKey)) {
    if (host == window) SwapAfterFullScreen(host, profile);
    return;
  }
  NSWindow *to = nn::host::GroupWindowForProfile(window, profile);
  if (!to || to == window) return;
  ConfigureHostingWindow(to);
  if (host) FullScreenSwap(window, to, host);
  else Swap(window, to);
}

+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window {
  if (![self rootViewOfWindow:window]) return;
  for (NSString *profile in profiles) {
    NSWindow *made = nn::host::GroupWindowForProfile(window, profile);
    if (made) ConfigureHostingWindow(made);
  }
}

+ (void)setSwappedHandler:(void (^)(NSWindow *, NSWindow *))handler {
  gSwapped = [handler copy];
}

+ (void (^)(NSWindow *, NSWindow *))swappedHandler {
  return gSwapped;
}

+ (void)closeWindow:(NSWindow *)window {
  if (!nn::host::CloseWindow(window)) [window close];
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
  // Inside Chrome's BridgedContentView, over its views: Chromium keeps the widget's geometry
  // through that view, and looks for the page under it (RenderWidgetHostViewCocoa's
  // -shouldIgnoreMouseEvent:, the occlusion checker).
  NSView *content = window.contentView;
  if (!TakesEmbeddedView(content)) return;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  root.frame = content.bounds;
  [content addSubview:root];
  ((id<NNEmbeddingContentView>)content).netnyahooEmbeddedView = root;
  objc_setAssociatedObject(window, kRootKey, root, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

+ (NSView *)rootViewOfWindow:(NSWindow *)window {
  return objc_getAssociatedObject(window, kRootKey);
}

+ (void)removeRootViewOfWindow:(NSWindow *)window {
  NSView *root = objc_getAssociatedObject(window, kRootKey);
  [root removeFromSuperview];
  objc_setAssociatedObject(window, kRootKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

@end

namespace nn::host {

NSWindow *FullScreenWindow(NSWindow *window) {
  return FullScreenHost(window);
}

}  // namespace nn::host

// MARK: - DEV input

namespace {

NSString *Describe(NSView *view) {
  // A window's first responder may be the window itself.
  if (view && ![view isKindOfClass:NSView.class]) return NSStringFromClass([(id)view class]);
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = view; v && chain.count < 6; v = v.superview) [chain addObject:NSStringFromClass(v.class)];
  return [chain componentsJoinedByString:@" < "];
}

NSPoint WindowPoint(NSWindow *window, NSString *spec) {
  NSArray<NSString *> *n = [spec componentsSeparatedByString:@","];
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

}  // namespace

@implementation NNChromeWindowHost (Dev)

+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if (!window) return nil;
  NSView *frameView = window.contentView.superview;
  if ([action hasPrefix:@"hit:"]) {
    NSPoint p = WindowPoint(window, [action substringFromIndex:4]);
    return Describe([frameView hitTest:p]);
  }
  if ([action hasPrefix:@"click:"]) {
    NSString *spec = [action substringFromIndex:6];
    bool right = [spec hasSuffix:@",right"];
    NSPoint p = WindowPoint(window, spec);
    NSView *target = [frameView hitTest:p];
    NSString *hit = Describe(target);
    // Through the window (React Native's touch handler is a gesture recognizer NSWindow drives),
    // but straight to a page's view: a test instance is never active, and NSWindow turns an
    // inactive window's first click on it into activation only. After this call returns: a
    // context menu runs a nested loop until it closes.
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
    // "keys:<flags>:<char>[:<keyCode>]", in NSApplication's order for a key window (a test
    // instance never has one): the window's key equivalents (for Chrome's window, its command
    // dispatcher), then the main menu, then the first responder.
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
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
    // The window's accessibility tree as assistive technologies walk it (NSAccessibility),
    // roles and labels, depth-first. For screen-locked test machines, where the AX server
    // answers nothing.
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
    // The window as AppKit and the window server see it.
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
    // The window treatment (WindowBackdrop's behind-window vibrancy) as configured.
    NSMutableArray *effects = [NSMutableArray array];
    NSMutableArray *walk = [NSMutableArray arrayWithObject:NNWindowRootView(window) ?: window.contentView];
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
  if ([action hasPrefix:@"swapProbe:"]) {
    // "swapProbe:<ms>": the naive per-profile window swap (docs/research/chrome-hosted-window.md ›
    // phase 3 "Profiles: hosted per-profile windows"), for swapcap/swapscan to measure. A second
    // Chrome window at the same frame is ordered in behind, our root moves into it, the layer
    // tree commits, the first window orders out; <ms> later it swaps back and the probe window
    // closes. Both windows show the same root, so any frame unlike the settled state is the seam.
    NSView *root = [NNChromeWindowHost rootViewOfWindow:window];
    NSWindow *probe = nn::host::MakeChromeWindow(@"");
    if (!root || !probe || !TakesEmbeddedView(probe.contentView)) return @"no probe window";
    const double ms = [action substringFromIndex:10].doubleValue;
    probe.appearance = window.appearance;
    // A cut, not AppKit's fade in/out of document windows.
    const NSWindowAnimationBehavior behavior = window.animationBehavior;
    window.animationBehavior = probe.animationBehavior = NSWindowAnimationBehaviorNone;
    auto swap = ^(NSWindow *from, NSWindow *to) {
      [to setFrame:from.frame display:NO];
      [to orderWindow:NSWindowBelow relativeTo:from.windowNumber];
      objc_setAssociatedObject(from, kRootKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      ((id<NNEmbeddingContentView>)from.contentView).netnyahooEmbeddedView = nil;
      [NNChromeWindowHost embedRootView:root inWindow:to];
      [CATransaction flush];
      [from orderOut:nil];
    };
    const CFTimeInterval t0 = CACurrentMediaTime();
    swap(window, probe);
    const CFTimeInterval t1 = CACurrentMediaTime();
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
      swap(probe, window);
      window.animationBehavior = behavior;
      nn::host::ChromeWindowAction(probe, @"close");
    });
    return [NSString stringWithFormat:@"swapped in %.2f ms, back in %.0f ms", (t1 - t0) * 1000, ms];
  }
  if ([action hasPrefix:@"cef:"]) return nn::host::ChromeWindowAction(window, [action substringFromIndex:4]);
  if ([action hasPrefix:@"ns:"]) {
    // "ns:out" / "ns:front": AppKit ordering, to compare with CEF's.
    if ([action hasSuffix:@"out"]) [window orderOut:nil];
    else [window orderFront:nil];
    return [NSString stringWithFormat:@"visible=%d", window.visible];
  }
  if ([action isEqualToString:@"performClose"]) {
    // The close button's path (windowShouldClose → the app's close warning).
    dispatch_async(dispatch_get_main_queue(), ^{ [window performClose:nil]; });
    return @"ok";
  }
  if ([action hasPrefix:@"style:"]) {
    // "style:<styleMask>" / "shadow:0|1" (DEV experiments on the window server's view of the window).
    window.styleMask = (NSWindowStyleMask)[action substringFromIndex:6].longLongValue;
    return @"ok";
  }
  if ([action hasPrefix:@"shadow:"]) {
    window.hasShadow = [action hasSuffix:@"1"];
    return @"ok";
  }
  if ([action hasPrefix:@"root:"]) {
    // "root:hide|show": what the window shows without our views (Chrome's own drawing).
    [NNChromeWindowHost rootViewOfWindow:window].hidden = [action hasSuffix:@"hide"];
    return @"ok";
  }
  if ([action hasPrefix:@"opaque:"]) {
    window.opaque = [action hasSuffix:@"1"];
    if (!window.opaque) window.backgroundColor = NSColor.clearColor;
    return [NSString stringWithFormat:@"opaque=%d", window.opaque];
  }
  if ([action hasPrefix:@"ime:"]) {
    // "ime:<marked>|<committed>": an input method composing in the first responder through
    // NSTextInputClient (as the system's IMEs do), then committing.
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
  if ([action hasPrefix:@"fakeFullScreen:"]) {
    // "fakeFullScreen:1|0": our full-screen handling without AppKit's (which a test instance
    // mustn't run: it opens a Space on the user's screen, and AppKit owns the style bit). 0 posts
    // will/did-exit around clearing it.
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    if ([action hasSuffix:@"1"]) {
      objc_setAssociatedObject(window, kDevFullScreenKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    } else {
      [center postNotificationName:NSWindowWillExitFullScreenNotification object:window];
      objc_setAssociatedObject(window, kDevFullScreenKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      [center postNotificationName:NSWindowDidExitFullScreenNotification object:window];
    }
    return [NSString stringWithFormat:@"fullScreen=%d", IsFullScreen(window)];
  }
  if ([action isEqualToString:@"tabviews"]) {
    // Each shown tab view's subviews (the page, and DevTools docked next to it): class, frame, hidden.
    NSMutableArray *out = [NSMutableArray array];
    Class tabClass = NSClassFromString(@"NNBrowserView");
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
  return nil;
}

@end
