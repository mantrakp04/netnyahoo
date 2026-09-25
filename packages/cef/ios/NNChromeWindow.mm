#import "NNChromeWindow.h"

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

bool TakesEmbeddedView(NSView *content) {
  return [content respondsToSelector:@selector(setNetnyahooEmbeddedView:)];
}

}  // namespace

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
  window.minSize = NSMakeSize(720, 460);
  window.title = @"Netnyahoo";
  return window;
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
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  return nil;
}

@end
