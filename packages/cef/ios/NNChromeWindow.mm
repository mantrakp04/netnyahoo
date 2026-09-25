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

/// BrowserWindow's traffic lights: 18 pt in from the left, centred in the 53 pt titlebar (CEF centres
/// them vertically in GetTitlebarHeight; its frame puts them further in).
constexpr CGFloat kTrafficLightInsetX = 18;

void LayoutTrafficLights(NSWindow *window) {
  if (window.styleMask & NSWindowStyleMaskFullScreen) return;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *mini = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  if (!close || !mini || !zoom) return;
  const CGFloat spacing = NSMinX(mini.frame) - NSMinX(close.frame);
  // In window coordinates: CEF's titlebar container sits a little in from the window's edge.
  const CGFloat offset = [close.superview convertPoint:NSZeroPoint toView:nil].x;
  const CGFloat x = kTrafficLightInsetX - offset;
  if (fabs(NSMinX(close.frame) - x) < 0.5) return;
  NSArray<NSButton *> *buttons = @[ close, mini, zoom ];
  for (NSUInteger i = 0; i < buttons.count; i++)
    [buttons[i] setFrameOrigin:NSMakePoint(x + i * spacing, NSMinY(buttons[i].frame))];
}

/// CefThemeFrame lays the buttons out again on resizes, key changes and full-screen exits.
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

void ConfigureHostingWindow(NSWindow *window) {
  window.minSize = NSMakeSize(720, 460);
  window.title = @"Netnyahoo";
  KeepTrafficLightsInset(window);
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
  objc_setAssociatedObject(from, kRootKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  ((id<NNEmbeddingContentView>)from.contentView).netnyahooEmbeddedView = nil;
  [NNChromeWindowHost embedRootView:root inWindow:to];
  [CATransaction flush];
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

}  // namespace

NSView *NNWindowRootView(NSWindow *window) {
  return [NNChromeWindowHost rootViewOfWindow:window] ?: window.contentView;
}

@implementation NNChromeWindowHost

+ (BOOL)enabled {
  static BOOL requested = [NSProcessInfo.processInfo.environment[@"NETNYAHOO_CHROME_WINDOW"] isEqualToString:@"1"];
  return requested && NN_CLIENT_WINDOW && [NNCef isStarted];
}

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  if (!self.enabled) return nil;
  NSWindow *window = nn::host::MakeHostingWindow(profile ?: @"");
  if (!window) return nil;
  // An engine without the content view hook can't take our views.
  if (!TakesEmbeddedView(window.contentView)) {
    [window close];
    return nil;
  }
  ConfigureHostingWindow(window);
  return window;
}

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window {
  if (![self rootViewOfWindow:window]) return;
  // Full screen owns a Space per window: the swap waits until the window leaves it (meanwhile the
  // profile's pages show in this window).
  if (window.styleMask & NSWindowStyleMaskFullScreen) {
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
    return;
  }
  NSWindow *to = nn::host::GroupWindowForProfile(window, profile);
  if (!to || to == window) return;
  if (!objc_getAssociatedObject(to, kConfiguredKey)) {
    ConfigureHostingWindow(to);
    objc_setAssociatedObject(to, kConfiguredKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  Swap(window, to);
}

+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window {
  if (![self rootViewOfWindow:window]) return;
  for (NSString *profile in profiles) {
    NSWindow *made = nn::host::GroupWindowForProfile(window, profile);
    if (made && !objc_getAssociatedObject(made, kConfiguredKey)) {
      ConfigureHostingWindow(made);
      objc_setAssociatedObject(made, kConfiguredKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
  }
}

+ (void)setSwappedHandler:(void (^)(NSWindow *, NSWindow *))handler {
  gSwapped = [handler copy];
}

+ (void (^)(NSWindow *, NSWindow *))swappedHandler {
  return gSwapped;
}

+ (void)closeWindow:(NSWindow *)window {
  if (!nn::host::CloseHostingWindow(window)) [window close];
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
    NSWindow *probe = nn::host::MakeHostingWindow(@"");
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
      nn::host::HostingWindowAction(probe, @"close");
    });
    return [NSString stringWithFormat:@"swapped in %.2f ms, back in %.0f ms", (t1 - t0) * 1000, ms];
  }
  if ([action hasPrefix:@"cef:"]) return nn::host::HostingWindowAction(window, [action substringFromIndex:4]);
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
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  return nil;
}

@end
