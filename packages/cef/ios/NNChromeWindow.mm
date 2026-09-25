#import "NNChromeWindow.h"

#import <objc/runtime.h>

#import "NNWindowHost.h"

namespace {

const void *kRootKey = &kRootKey;

/// NETNYAHOO_CHROME_WINDOW_ROOT=frame: the root goes in the window's frame view, next to Chrome's
/// content view, instead of inside it. Kept to show why not: Chromium looks for the page under
/// window.contentView (RenderWidgetHostViewCocoa's -shouldIgnoreMouseEvent: hit-tests from it,
/// and the occlusion checker only walks it), so the page ignores every click there.
bool RootInFrameView() {
  static bool frame = [NSProcessInfo.processInfo.environment[@"NETNYAHOO_CHROME_WINDOW_ROOT"] isEqualToString:@"frame"];
  return frame;
}

/// Our root inside Chrome's content view, if `content` is one.
NSView *EmbeddedRoot(NSView *content) {
  NSView *root = content.window ? objc_getAssociatedObject(content.window, kRootKey) : nil;
  return root.superview == content ? root : nil;
}

/// Chrome's BridgedContentView claims every point one of its views covers (-hitTest: returns
/// itself), and its views cover the whole window; for accessibility its only child is Chrome's
/// views tree. With our root inside it, points our root covers go to our views first, and our
/// views are its accessibility children (in front of Chrome's hidden ones). A product build would
/// do this in Chromium itself (docs/research/chrome-hosted-window.md).
void LetRootComeFirst() {
  static bool done = false;
  if (done) return;
  done = true;
  Class cls = NSClassFromString(@"BridgedContentView");
  if (!cls) return;
  if (Method method = class_getInstanceMethod(cls, @selector(hitTest:))) {
    auto original = (NSView * (*)(id, SEL, NSPoint)) method_getImplementation(method);
    method_setImplementation(method, imp_implementationWithBlock(^NSView *(NSView *content, NSPoint point) {
      if (NSView *root = EmbeddedRoot(content))
        if (NSView *hit = [root hitTest:[content convertPoint:point fromView:content.superview]]) return hit;
      return original(content, @selector(hitTest:), point);
    }));
  }
  if (Method method = class_getInstanceMethod(cls, @selector(accessibilityChildren))) {
    auto original = (NSArray * (*)(id, SEL)) method_getImplementation(method);
    method_setImplementation(method, imp_implementationWithBlock(^NSArray *(NSView *content) {
      if (NSView *root = EmbeddedRoot(content)) return NSAccessibilityUnignoredChildren(@[ root ]);
      return original(content, @selector(accessibilityChildren));
    }));
  }
  if (Method method = class_getInstanceMethod(cls, @selector(accessibilityHitTest:))) {
    auto original = (id (*)(id, SEL, NSPoint)) method_getImplementation(method);
    method_setImplementation(method, imp_implementationWithBlock(^id(NSView *content, NSPoint point) {
      if (NSView *root = EmbeddedRoot(content))
        if (id hit = [root accessibilityHitTest:point]) return hit;
      return original(content, @selector(accessibilityHitTest:), point);
    }));
  }
}

}  // namespace

@implementation NNChromeWindowHost

+ (BOOL)enabled {
  static BOOL requested = [NSProcessInfo.processInfo.environment[@"NETNYAHOO_CHROME_WINDOW"] isEqualToString:@"1"];
  return requested && nn::host::ChromeTabs() && [NNCef isStarted];
}

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  if (!self.enabled) return nil;
  NSWindow *window = nn::host::MakeHostingWindow(profile ?: @"");
  if (!window) return nil;
  window.minSize = NSMakeSize(720, 460);
  window.title = @"Netnyahoo";
  return window;
}

+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window {
  // Chrome's BridgedContentView stays the window's content view: Chromium keeps the widget's
  // geometry through it (-setFrameSize:) and draws its views into its layer.
  NSView *content = window.contentView;
  NSView *frameView = content.superview;
  if (!frameView) return;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  objc_setAssociatedObject(window, kRootKey, root, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  if (RootInFrameView()) {
    root.frame = frameView.bounds;
    [frameView addSubview:root positioned:NSWindowAbove relativeTo:content];
    return;
  }
  // Inside Chrome's content view (where Chromium expects the page), over its views.
  LetRootComeFirst();
  root.frame = content.bounds;
  [content addSubview:root];
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
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  return nil;
}

@end
