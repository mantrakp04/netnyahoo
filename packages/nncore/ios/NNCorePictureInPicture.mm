// packages/cef/ios/NNPictureInPicture.mm on NNCore: the same window, styling, stash and menu; the video's frame is
// a frame id (NNCoreTab's -executeJavaScript:frame:).
#import "NNCorePictureInPicture.h"

#import "NNChromeWindow.h"
#import "NNCoreWebViewInternal.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

namespace {

constexpr CGFloat kPeek = 28;
constexpr CGFloat kReturnMargin = 16;
// Chrome's corner buttons, restyled as Dia's (chrome/browser/netnyahoo/pip in engine/chromium): 28 pt squares 12 pt in.
constexpr CGFloat kButtonMargin = 12, kButtonSize = 28;
// Dia's window corners: circular, 6 pt (fitted at 2x to 0.1 px), with the shadow following them, and a 1 pt rim of
// white at 17 % just inside the edge.
constexpr CGFloat kCornerRadius = 6;
constexpr CGFloat kRimAlpha = 0.17;

NSString *const kKeepOnTopDefault = @"NNPictureInPictureKeepOnTop";
const void *const kControllerKey = &kControllerKey;

BOOL KeepOnTop() {
  id value = [NSUserDefaults.standardUserDefaults objectForKey:kKeepOnTopDefault];
  return value ? [value boolValue] : YES;
}

BOOL IsChromeVideoPictureInPicture(NSWindow *window) {
  static Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow");
  return frameless && [window isKindOfClass:frameless] && window.visible && window.level >= NSFloatingWindowLevel &&
         (window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces);
}

NSScreen *ScreenFor(NSRect frame) {
  NSScreen *best = nil;
  CGFloat bestArea = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSRect overlap = NSIntersectionRect(frame, screen.frame);
    CGFloat area = overlap.size.width * overlap.size.height;
    if (area > bestArea) best = screen, bestArea = area;
  }
  return best ?: NSScreen.mainScreen;
}

BOOL ScreenAt(CGFloat x, CGFloat y) {
  for (NSScreen *screen in NSScreen.screens)
    if (NSPointInRect(NSMakePoint(x, y), screen.frame)) return YES;
  return NO;
}

}

typedef NS_ENUM(NSInteger, NNPiPEdge) { NNPiPEdgeNone = 0, NNPiPEdgeLeft = -1, NNPiPEdgeRight = 1 };

@class NNPiPController;

// MARK: - Views

@interface NNPiPControl : NSView
@property (nonatomic, copy) void (^onClick)(void);
@property (nonatomic) BOOL hovered;
@end

@implementation NNPiPControl {
  NSEvent *_down;
  NSTrackingArea *_tracking;
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return NO; }

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect | NSTrackingCursorUpdate
             owner:self
          userInfo:nil];
  [self addTrackingArea:_tracking];
}

- (void)mouseEntered:(NSEvent *)event { self.hovered = YES; }
- (void)mouseExited:(NSEvent *)event { self.hovered = NO; }
- (void)cursorUpdate:(NSEvent *)event { [NSCursor.pointingHandCursor set]; }

- (void)mouseDown:(NSEvent *)event { _down = event; }

- (void)mouseDragged:(NSEvent *)event {
  if (!_down) return;
  NSPoint a = _down.locationInWindow, b = event.locationInWindow;
  if (hypot(b.x - a.x, b.y - a.y) < 3) return;
  NSEvent *down = _down;
  _down = nil;
  [self.window performWindowDragWithEvent:down];
}

- (void)mouseUp:(NSEvent *)event {
  if (!_down) return;
  _down = nil;
  if (self.onClick) self.onClick();
}

@end

@interface NNPiPHandle : NNPiPControl
@property (nonatomic) NNPiPEdge edge;
@end

@implementation NNPiPHandle {
  NSImageView *_chevron;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    _chevron = [[NSImageView alloc] init];
    _chevron.contentTintColor = [NSColor colorWithWhite:1 alpha:0.95];
    _chevron.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightSemibold];
    [self addSubview:_chevron];
    self.toolTip = @"Show Picture in Picture";
    [self setHovered:NO];
  }
  return self;
}

- (void)setEdge:(NNPiPEdge)edge {
  _edge = edge;
  NSString *name = edge == NNPiPEdgeLeft ? @"chevron.compact.right" : @"chevron.compact.left";
  _chevron.image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:@"Show Picture in Picture"];
  self.needsLayout = YES;
}

- (void)setHovered:(BOOL)hovered {
  [super setHovered:hovered];
  self.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:hovered ? 0.7 : 0.5].CGColor;
}

- (void)layout {
  [super layout];
  NSSize size = NSMakeSize(16, 28);
  _chevron.frame = NSMakeRect(floor((NSWidth(self.bounds) - size.width) / 2), floor((NSHeight(self.bounds) - size.height) / 2),
                              size.width, size.height);
}

@end

// Holds the stash handle over Chrome's views; the resting window shows nothing of ours.
@interface NNPiPOverlay : NSView
@property (nonatomic, readonly) NNPiPHandle *handle;
@end

@interface NNPiPController : NSObject
@property (nonatomic, readonly) NSWindow *window;
@property (nonatomic, weak) NNCoreWebView *view;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, readonly) NNPiPOverlay *overlay;
@property (nonatomic, readonly) NNPiPEdge stashedEdge;
@property (nonatomic) BOOL keepOnTop;
- (void)setVideoFrame:(NSString *)frameId;
- (void)roundCorners;
- (void)backToTab;
- (void)unstash;
- (NSMenu *)menu;
@end

@implementation NNPiPOverlay

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.zPosition = 100;  // Keep above Chrome’s compositor layers.
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _handle = [[NNPiPHandle alloc] initWithFrame:NSZeroRect];
    _handle.hidden = YES;
    _handle.alphaValue = 0;
    [self addSubview:_handle];
  }
  return self;
}

- (BOOL)isFlipped { return YES; }

- (NSView *)hitTest:(NSPoint)point {
  NSPoint local = [self convertPoint:point fromView:self.superview];
  if (!_handle.hidden && NSPointInRect(local, _handle.frame)) return _handle;
  return nil;  // Everything else is Chrome's.
}

- (void)layout {
  [super layout];
  NSSize size = self.bounds.size;
  _handle.frame = _handle.edge == NNPiPEdgeLeft ? NSMakeRect(size.width - kPeek, 0, kPeek, size.height)
                                                 : NSMakeRect(0, 0, kPeek, size.height);
}

@end

// MARK: - Controller

@implementation NNPiPController {
  NSMutableArray *_observers;
  NSString *_frameId;
  NSTimer *_slide;
  BOOL _animating;
  BOOL _sawDrag;
}

+ (instancetype)forWindow:(NSWindow *)window {
  return objc_getAssociatedObject(window, kControllerKey);
}

- (instancetype)initWithWindow:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    NSView *root = NNWindowRootView(window);
    _overlay = [[NNPiPOverlay alloc] initWithFrame:root.bounds];
    __weak NNPiPController *weakSelf = self;
    _overlay.handle.onClick = ^{ [weakSelf unstash]; };
    [root addSubview:_overlay];
    objc_setAssociatedObject(window, kControllerKey, self, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    _observers = [NSMutableArray array];
    for (NSNotificationName name in @[ NSWindowDidMoveNotification, NSWindowDidResizeNotification ]) {
      [_observers addObject:[center addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *) {
                    [weakSelf windowMoved];
                  }]];
    }
    [_observers addObject:[center addObserverForName:NSWindowDidResizeNotification
                                              object:window
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf roundCorners]; }]];
    [_observers addObject:[center addObserverForName:NSWindowWillCloseNotification
                                              object:window
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf detach]; }]];
    self.keepOnTop = KeepOnTop();
  }
  return self;
}

- (void)detach {
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [_observers removeAllObjects];
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
  [_slide invalidate];
  [_overlay removeFromSuperview];
  _frameId = nil;
  objc_setAssociatedObject(_window, kControllerKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)setVideoFrame:(NSString *)frameId { _frameId = [frameId copy]; }

// Chrome's window is square and transparent: clipping its content view rounds everything it shows (video, controls,
// the fades), and the shadow, which macOS takes from the window's alpha, follows once invalidated.
- (void)roundCorners {
  NSView *content = _window.contentView;
  content.wantsLayer = YES;
  CALayer *layer = content.layer;
  if (layer.cornerRadius != kCornerRadius || !layer.masksToBounds) {
    layer.cornerRadius = kCornerRadius;
    layer.cornerCurve = kCACornerCurveCircular;
    layer.masksToBounds = YES;
  }
  CALayer *rim = _overlay.layer;
  rim.cornerRadius = kCornerRadius;
  rim.cornerCurve = kCACornerCurveCircular;
  rim.borderWidth = 1;
  rim.borderColor = [NSColor colorWithWhite:1 alpha:kRimAlpha].CGColor;
  _window.opaque = NO;
  _window.backgroundColor = NSColor.clearColor;
  // After Chrome has drawn the new size.
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_window invalidateShadow]; });
}

- (void)setKeepOnTop:(BOOL)keepOnTop {
  _keepOnTop = keepOnTop;
  _window.level = keepOnTop ? NSFloatingWindowLevel : NSNormalWindowLevel;
}

- (void)toggleKeepOnTop:(id)sender {
  self.keepOnTop = !_keepOnTop;
  [NSUserDefaults.standardUserDefaults setBool:_keepOnTop forKey:kKeepOnTopDefault];
}

- (NSMenu *)menu {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
  NSMenuItem *back = [menu addItemWithTitle:@"Back to Tab" action:@selector(backToTabFromMenu:) keyEquivalent:@""];
  back.target = self;
  back.enabled = self.view != nil;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenuItem *top = [menu addItemWithTitle:@"Keep Window on Top" action:@selector(toggleKeepOnTop:) keyEquivalent:@""];
  top.target = self;
  top.state = _keepOnTop ? NSControlStateValueOn : NSControlStateValueOff;
  return menu;
}

- (void)backToTabFromMenu:(id)sender { [self backToTab]; }

- (void)backToTab {
  NNCoreWebView *view = self.view;
  if (!view) return;
  [view emit:@"activateRequest" payload:@{@"reason" : @"pictureInPicture"}];
  [view exitPictureInPictureInFrame:_frameId];
}

// MARK: Stash

- (void)windowMoved {
  if (_animating) return;
  if (NSEvent.pressedMouseButtons & 1) _sawDrag = YES;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
}

- (NNPiPEdge)edgeBeyond {
  NSRect frame = _window.frame;
  NSRect visible = ScreenFor(frame).visibleFrame;
  CGFloat half = NSWidth(frame) / 2;
  if (NSMaxX(frame) - NSMaxX(visible) > half && !ScreenAt(NSMaxX(visible) + 1, NSMidY(frame))) return NNPiPEdgeRight;
  if (NSMinX(visible) - NSMinX(frame) > half && !ScreenAt(NSMinX(visible) - 1, NSMidY(frame))) return NNPiPEdgeLeft;
  return NNPiPEdgeNone;
}

- (void)settle {
  if (NSEvent.pressedMouseButtons & 1) {
    [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
    return;
  }
  BOOL dragged = _sawDrag;
  _sawDrag = NO;
  NNPiPEdge edge = [self edgeBeyond];
  if (edge != NNPiPEdgeNone) return [self stashAt:edge];
  if (_stashedEdge != NNPiPEdgeNone && !dragged) return [self stashAt:_stashedEdge];
  if (_stashedEdge != NNPiPEdgeNone) [self setStashedEdge:NNPiPEdgeNone];
}

- (NSRect)frameStashedAt:(NNPiPEdge)edge {
  NSRect frame = _window.frame;
  NSRect visible = ScreenFor(frame).visibleFrame;
  frame.origin.x = edge == NNPiPEdgeRight ? NSMaxX(visible) - kPeek : NSMinX(visible) - NSWidth(frame) + kPeek;
  frame.origin.y = MIN(MAX(NSMinY(frame), NSMinY(visible)), NSMaxY(visible) - NSHeight(frame));
  return frame;
}

- (void)stashAt:(NNPiPEdge)edge {
  [self setStashedEdge:edge];
  [self animateTo:[self frameStashedAt:edge]];
}

- (void)unstash {
  NNPiPEdge edge = _stashedEdge;
  if (edge == NNPiPEdgeNone) return;
  NSRect frame = _window.frame;
  NSRect visible = ScreenFor(frame).visibleFrame;
  frame.origin.x = edge == NNPiPEdgeRight ? NSMaxX(visible) - NSWidth(frame) - kReturnMargin : NSMinX(visible) + kReturnMargin;
  [self setStashedEdge:NNPiPEdgeNone];
  [self animateTo:frame];
}

- (void)setStashedEdge:(NNPiPEdge)edge {
  _stashedEdge = edge;
  NNPiPHandle *handle = _overlay.handle;
  if (edge != NNPiPEdgeNone) {
    handle.edge = edge;
    handle.hidden = NO;
    _overlay.needsLayout = YES;
  }
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.25;
        handle.animator.alphaValue = edge != NNPiPEdgeNone ? 1 : 0;
      }
      completionHandler:^{
        if (self->_stashedEdge == NNPiPEdgeNone) handle.hidden = YES;
      }];
}

// Dia: 0.25s ease-out.
- (void)animateTo:(NSRect)target {
  [_slide invalidate];
  NSRect from = _window.frame;
  if (NSEqualRects(from, target)) return;
  _animating = YES;
  CFTimeInterval start = CACurrentMediaTime();
  __weak NNPiPController *weakSelf = self;
  _slide = [NSTimer scheduledTimerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    NNPiPController *strongSelf = weakSelf;
    double t = MIN((CACurrentMediaTime() - start) / 0.25, 1);
    double eased = 1 - pow(1 - t, 3);
    NSRect frame = NSMakeRect(round(NSMinX(from) + (NSMinX(target) - NSMinX(from)) * eased),
                              round(NSMinY(from) + (NSMinY(target) - NSMinY(from)) * eased), NSWidth(target), NSHeight(target));
    [strongSelf.window setFrame:t < 1 ? frame : target display:YES];
    if (t < 1 && strongSelf) return;
    [timer invalidate];
    if (strongSelf) strongSelf->_animating = NO, strongSelf->_sawDrag = NO;
  }];
  [NSRunLoop.currentRunLoop addTimer:_slide forMode:NSRunLoopCommonModes];
}

// MARK: Self-test

- (void)runSelfTest {
  NSMutableArray *steps = [NSMutableArray array];
  NSWindow *window = _window;
  NSRect start = window.frame;
  NSRect visible = ScreenFor(start).visibleFrame;
  auto record = [=](NSString *name, BOOL pass, NSDictionary *extra) {
    NSMutableDictionary *step = [@{@"step" : name, @"pass" : @(pass), @"frame" : NSStringFromRect(window.frame)} mutableCopy];
    [step addEntriesFromDictionary:extra ?: @{}];
    [steps addObject:step];
    NSLog(@"[pip-selftest] %@ %@ %@", name, pass ? @"PASS" : @"FAIL", step);
  };
  NSString *dir = [NSString stringWithUTF8String:getenv("NETNYAHOO_DATA_DIR") ?: "/tmp"];
  auto snapshot = [=](NSString *name) {
    NSView *content = NNWindowRootView(window);
    NSSize size = content.bounds.size;
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:size.width * 2 pixelsHigh:size.height * 2
                                                                  bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
                                                                 colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    CGContextRef cg = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep].CGContext;
    CGContextSetRGBFillColor(cg, 0.36, 0.42, 0.5, 1);
    CGContextFillRect(cg, CGRectMake(0, 0, size.width * 2, size.height * 2));
    CGContextScaleCTM(cg, 2, 2);
    if (content.isFlipped) CGContextTranslateCTM(cg, 0, size.height), CGContextScaleCTM(cg, 1, -1);
    [content.layer renderInContext:cg];
    [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}]
        writeToFile:[dir stringByAppendingPathComponent:[NSString stringWithFormat:@"pip-%@.png", name]]
         atomically:YES];
  };
  auto write = [=] {
    NSString *path = [dir stringByAppendingPathComponent:@"pip-selftest.json"];
    NSDictionary *result = @{@"windowNumber" : @(window.windowNumber), @"host" : self.host ?: @"", @"steps" : steps};
    [[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil] writeToFile:path atomically:YES];
  };
  auto after = [](double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
  };
  auto rounded = [=] {
    CALayer *layer = window.contentView.layer;
    return layer.cornerRadius == kCornerRadius && layer.masksToBounds && !window.opaque && window.hasShadow &&
           self.overlay.layer.borderWidth == 1;
  };
  auto dragTo = [=](CGFloat x) {
    self->_sawDrag = YES;
    [window setFrameOrigin:NSMakePoint(x, NSMinY(window.frame))];
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
    [self settle];
  };

  record(@"attached", self.overlay.superview == NNWindowRootView(window) && [NNWindowRootView(window).subviews.lastObject isEqual:self.overlay],
         @{@"level" : @(window.level), @"keepOnTop" : @(self.keepOnTop), @"shadow" : @(window.hasShadow)});
  after(0.6, ^{
    record(@"nothing of ours at rest", self.overlay.handle.hidden && [self.overlay hitTest:NSMakePoint(20, 20)] == nil, nil);
    record(@"rounded corners", rounded(), @{@"cornerRadius" : @(window.contentView.layer.cornerRadius)});
    snapshot(@"rest");
    dragTo(NSMaxX(visible) - NSWidth(window.frame) * 0.3);
  });
  after(2.2, ^{
    record(@"drag past right edge stashes", self.stashedEdge == NNPiPEdgeRight &&
                                                 fabs(NSMinX(window.frame) - (NSMaxX(visible) - kPeek)) < 0.5 &&
                                                 !self.overlay.handle.hidden && self.overlay.handle.alphaValue > 0.99,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-right");
    [window setFrameOrigin:NSMakePoint(NSMaxX(visible) - NSWidth(window.frame) - 40, NSMinY(window.frame))];
  });
  after(3.4, ^{
    record(@"Chrome's move re-stashes", self.stashedEdge == NNPiPEdgeRight && fabs(NSMinX(window.frame) - (NSMaxX(visible) - kPeek)) < 0.5, nil);
    self.overlay.handle.onClick();
  });
  after(4.6, ^{
    record(@"handle click brings it back", self.stashedEdge == NNPiPEdgeNone && self.overlay.handle.hidden &&
                                                fabs(NSMaxX(window.frame) - (NSMaxX(visible) - kReturnMargin)) < 0.5,
           nil);
    dragTo(NSMinX(visible) - NSWidth(window.frame) * 0.7);
  });
  after(5.8, ^{
    record(@"drag past left edge stashes", self.stashedEdge == NNPiPEdgeLeft &&
                                                fabs(NSMaxX(window.frame) - (NSMinX(visible) + kPeek)) < 0.5 &&
                                                NSMinX(self.overlay.handle.frame) == NSWidth(self.overlay.bounds) - kPeek,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-left");
    dragTo(NSMinX(visible) + 100);
  });
  after(7.0, ^{
    record(@"drag out of the stash", self.stashedEdge == NNPiPEdgeNone && fabs(NSMinX(window.frame) - (NSMinX(visible) + 100)) < 0.5, nil);
    // Chrome saves where the window was left in its user data dir, in screen DIPs from the top left of the primary
    // display (chrome/browser/netnyahoo/pip in engine/chromium).
    NSArray *saved = [NSArray arrayWithContentsOfFile:[dir stringByAppendingPathComponent:@"Chromium/NetnyahooPictureInPicture.plist"]];
    NSRect frame = window.frame;
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame) - NSMaxY(frame);
    record(@"Chrome remembers where it was left",
           saved.count == 4 && [saved[0] intValue] == (int)NSMinX(frame) && [saved[1] intValue] == (int)top &&
               [saved[2] intValue] == (int)NSWidth(frame) && [saved[3] intValue] == (int)NSHeight(frame),
           @{@"saved" : saved ?: @[]});
    NSMenu *menu = [self menu];
    BOOL onBefore = [menu itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOn;
    [self toggleKeepOnTop:nil];
    BOOL off = window.level == NSNormalWindowLevel && [[self menu] itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOff;
    [self toggleKeepOnTop:nil];
    record(@"Keep Window on Top toggles", onBefore && off && window.level == NSFloatingWindowLevel,
           @{@"menu" : [[self menu].itemArray valueForKey:@"title"]});
    [window setFrame:NSInsetRect(start, 40, 22.5) display:YES];
  });
  after(7.6, ^{
    record(@"still rounded after a resize", rounded(), nil);
    [window setFrame:start display:YES];
  });
  after(8.2, ^{
    record(@"menu: Back to Tab", self.view != nil, nil);
    [self backToTab];
  });
  after(9.7, ^{
    record(@"PiP closed after Back to Tab", !window.visible, nil);
    write();
  });
}

// NETNYAHOO_PIP_SELFTEST=close / backToTab: clicks Chrome's own close button (its X, top right) or its back-to-tab
// button (top left) as AppKit delivers a click, then records whether the window closed. What happens to the video and
// the tab is for the caller to check (CDP, the store): closing leaves the video playing where it is.
- (void)runButtonSelfTest:(NSString *)button {
  NSWindow *window = _window;
  NSString *dir = [NSString stringWithUTF8String:getenv("NETNYAHOO_DATA_DIR") ?: "/tmp"];
  CGFloat center = kButtonMargin + kButtonSize / 2;
  NSPoint point = NSMakePoint([button isEqual:@"close"] ? NSWidth(window.frame) - center : center, NSHeight(window.frame) - center);
  auto event = [=](NSEventType type) {
    return [NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                          windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:type == NSEventTypeLeftMouseDown];
  };
  auto after = [](double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
  };
  // The pointer's arrival shows Chrome's controls (its tracking area calls the content view); a click where they're
  // hidden would drag the window instead.
  after(1.5, ^{ [window.contentView mouseMoved:event(NSEventTypeMouseMoved)]; });
  after(2.1, ^{
    [window sendEvent:event(NSEventTypeLeftMouseDown)];
    [window sendEvent:event(NSEventTypeLeftMouseUp)];
    after(1, ^{
      NSDictionary *result = @{@"button" : button, @"closed" : @(!window.visible), @"point" : NSStringFromPoint(point)};
      NSLog(@"[pip-selftest] %@", result);
      [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil]
          writeToFile:[dir stringByAppendingPathComponent:@"pip-button-selftest.json"]
           atomically:YES];
    });
  });
}

// NETNYAHOO_PIP_SELFTEST=hover: keeps Chrome's controls showing for screen captures, with the pointer over the close
// button (NETNYAHOO_PIP_HOVER=close), back to tab (back) or the middle of the video (default), and writes the window
// number and frame to pip-hover.json.
- (void)runHoverSelfTest {
  NSWindow *window = _window;
  NSString *dir = [NSString stringWithUTF8String:getenv("NETNYAHOO_DATA_DIR") ?: "/tmp"];
  NSString *where = NSProcessInfo.processInfo.environment[@"NETNYAHOO_PIP_HOVER"];
  CGFloat center = kButtonMargin + kButtonSize / 2;
  NSSize size = window.frame.size;
  NSPoint point = [where isEqual:@"close"]  ? NSMakePoint(size.width - center, size.height - center)
                  : [where isEqual:@"back"] ? NSMakePoint(center, size.height - center)
                                            : NSMakePoint(size.width / 2, size.height * 0.7);
  __weak NSWindow *weakWindow = window;
  NSTimer *timer = [NSTimer timerWithTimeInterval:1 repeats:YES block:^(NSTimer *t) {
    NSWindow *strongWindow = weakWindow;
    if (!strongWindow.visible) return [t invalidate];
    NSEvent *move = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
                                      timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:strongWindow.windowNumber
                                        context:nil eventNumber:0 clickCount:0 pressure:0];
    [strongWindow.contentView mouseMoved:move];
  }];
  [NSRunLoop.currentRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
  NSDictionary *result = @{
    @"windowNumber" : @(window.windowNumber),
    @"frame" : NSStringFromRect(window.frame),
    @"hover" : where ?: @"video",
    @"cornerRadius" : @(window.contentView.layer.cornerRadius),
    @"masksToBounds" : @(window.contentView.layer.masksToBounds),
    @"opaque" : @(window.opaque),
  };
  [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil] writeToFile:[dir stringByAppendingPathComponent:@"pip-hover.json"]
                                                                       atomically:YES];
}

@end

// MARK: - Glue

namespace nncore_pip {

namespace {

void InstallMenuMonitor() {
  static id monitor;
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskRightMouseDown
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    NNPiPController *controller =
                                                        event.window ? [NNPiPController forWindow:event.window] : nil;
                                                    if (!controller) return event;
                                                    [NSMenu popUpContextMenu:[controller menu] withEvent:event forView:controller.overlay];
                                                    return nil;
                                                  }];
}

bool Attach(NNCoreWebView *view, NSString *host, NSString *frameId) {
  for (NSWindow *window in NSApp.windows) {
    if (!IsChromeVideoPictureInPicture(window)) continue;
    NNPiPController *controller = [NNPiPController forWindow:window];
    // Chrome reuses its window for successive PiP videos.
    BOOL fresh = !controller;
    if (fresh) controller = [[NNPiPController alloc] initWithWindow:window];
    controller.view = view;
    controller.host = host;
    [controller setVideoFrame:frameId];
    [controller roundCorners];
    // A hidden test instance shows nothing on the owner's screen (the engine hides it as Chrome opens it).
    if (nncore_host::Background()) {
      window.alphaValue = 0;
      window.ignoresMouseEvents = YES;
    }
    InstallMenuMonitor();
    NSString *selfTest = NSProcessInfo.processInfo.environment[@"NETNYAHOO_PIP_SELFTEST"];
    if (fresh && [@[ @"close", @"backToTab" ] containsObject:selfTest]) [controller runButtonSelfTest:selfTest];
    else if (fresh && [selfTest isEqual:@"hover"]) [controller runHoverSelfTest];
    else if (fresh && selfTest) [controller runSelfTest];
    return true;
  }
  return false;
}

}

void VideoChanged(NNCoreWebView *view, NSString *host, NSString *frameId, bool active) {
  if (!active) return;
  __block int tries = 0;
  __block void (^look)(void);
  __weak NNCoreWebView *weakView = view;
  look = ^{
    NNCoreWebView *strongView = weakView;
    if (!strongView || Attach(strongView, host, frameId) || ++tries >= 20) {
      look = nil;
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), look);
  };
  look();
}

}

// MARK: - Dev

@implementation NNCoreWebView (PictureInPictureDev)

+ (NSArray<NSDictionary<NSString *, id> *> *)devPictureInPicture {
  NSMutableArray *list = [NSMutableArray array];
  for (NSWindow *window in NSApp.windows) {
    NNPiPController *controller = [NNPiPController forWindow:window];
    if (!controller && !(window.visible && window.level >= NSFloatingWindowLevel)) continue;
    CALayer *content = window.contentView.layer;
    [list addObject:@{
      @"window" : @(window.windowNumber),
      @"class" : NSStringFromClass(window.class),
      @"title" : window.title ?: @"",
      @"video" : @(IsChromeVideoPictureInPicture(window)),
      @"frame" : NSStringFromRect(window.frame),
      @"visible" : @(window.visible),
      @"alpha" : @(window.alphaValue),
      @"ignoresMouseEvents" : @(window.ignoresMouseEvents),
      @"level" : @(window.level),
      @"styled" : @(controller != nil),
      @"rounded" : @(content.cornerRadius == kCornerRadius && content.masksToBounds && !window.opaque),
      @"rim" : @(controller.overlay.layer.borderWidth),
      @"keepOnTop" : @(controller.keepOnTop),
      @"stashed" : @(controller.stashedEdge),
      @"host" : controller.host ?: @"",
      @"backToTab" : @(controller.view != nil),
    }];
  }
  return list;
}

// "selftest" (packages/cef's NETNYAHOO_PIP_SELFTEST: rounding, stash at both edges, the handle, the saved place,
// Keep on Top, Back to Tab → $NETNYAHOO_DATA_DIR/pip-selftest.json), "close" or "backToTab" (Chrome's own buttons
// clicked → pip-button-selftest.json), "menu" (our menu's titles), on the newest styled window.
+ (NSString *)devPictureInPictureAction:(NSString *)action {
  NNPiPController *controller = nil;
  for (NSWindow *window in NSApp.windows)
    if ([NNPiPController forWindow:window] && window.visible) controller = [NNPiPController forWindow:window];
  if (!controller) return @"";
  if ([action isEqual:@"selftest"]) [controller runSelfTest];
  else if ([@[ @"close", @"backToTab" ] containsObject:action]) [controller runButtonSelfTest:action];
  else if ([action isEqual:@"menu"]) return [[controller.menu.itemArray valueForKey:@"title"] componentsJoinedByString:@"|"];
  else return @"";
  return @"started";
}

@end
