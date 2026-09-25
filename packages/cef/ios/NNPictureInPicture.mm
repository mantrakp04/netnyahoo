#import "NNPictureInPicture.h"

#import "NNClient.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace nn;

namespace {

// Dia's stash: how much of a tucked-in window stays on screen, and where it
// comes back to (from the edge it was stashed at).
constexpr CGFloat kPeek = 28;
constexpr CGFloat kReturnMargin = 16;
// Chrome's title row (favicon at 8,5 and the origin label 24 pt tall at 28,5);
// the pill covers it while the pointer is over the window.
constexpr CGFloat kPillX = 6, kPillY = 5, kPillHeight = 24;
constexpr CGFloat kChromeOriginX = 28, kChromeOriginRightMargin = 80;

NSString *const kKeepOnTopDefault = @"NNPictureInPictureKeepOnTop";
const void *const kControllerKey = &kControllerKey;

BOOL KeepOnTop() {
  id value = [NSUserDefaults.standardUserDefaults objectForKey:kKeepOnTopDefault];
  return value ? [value boolValue] : YES;
}

/// Chrome's video PiP window: a frameless views window, floating on every Space.
BOOL IsChromeVideoPictureInPicture(NSWindow *window) {
  static Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow");
  return frameless && [window isKindOfClass:frameless] && window.visible && window.level >= NSFloatingWindowLevel &&
         (window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces);
}

/// The screen showing most of `frame`.
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

/// Whether some screen continues past `x` at height `y` (dragging onto the next display isn't stashing).
BOOL ScreenAt(CGFloat x, CGFloat y) {
  for (NSScreen *screen in NSScreen.screens)
    if (NSPointInRect(NSMakePoint(x, y), screen.frame)) return YES;
  return NO;
}

}  // namespace

typedef NS_ENUM(NSInteger, NNPiPEdge) { NNPiPEdgeNone = 0, NNPiPEdgeLeft = -1, NNPiPEdgeRight = 1 };

@class NNPiPController;

// MARK: - Views

/// Clicks start a window drag once the pointer moves; a click without moving is `onClick`.
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

/// The host pill: Chrome's origin row, clickable (back to the tab).
@interface NNPiPPill : NNPiPControl
@property (nonatomic, readonly) NSTextField *label;
@end

@implementation NNPiPPill

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.cornerRadius = kPillHeight / 2;
    self.layer.cornerCurve = kCACornerCurveContinuous;
    self.layer.borderWidth = 0.5;
    self.layer.borderColor = [NSColor colorWithWhite:1 alpha:0.2].CGColor;  // Dia's PiP hairline
    _label = [NSTextField labelWithString:@""];
    _label.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
    _label.textColor = [NSColor colorWithWhite:1 alpha:0.95];
    _label.alignment = NSTextAlignmentCenter;
    _label.lineBreakMode = NSLineBreakByTruncatingHead;  // Chrome elides the origin at its head too
    [self addSubview:_label];
    self.toolTip = @"Back to Tab";
    [self setHovered:NO];
  }
  return self;
}

- (void)setHovered:(BOOL)hovered {
  [super setHovered:hovered];
  self.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:hovered ? 0.78 : 0.58].CGColor;
}

- (void)layout {
  [super layout];
  CGFloat height = ceil(_label.intrinsicContentSize.height);
  _label.frame = NSMakeRect(10, floor((NSHeight(self.bounds) - height) / 2), NSWidth(self.bounds) - 20, height);
}

@end

/// The strip left on screen while stashed, with a chevron pointing back in.
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
  // Pointing back onto the screen.
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

/// Covers Chrome's content; only the pill and the handle take the mouse.
@interface NNPiPOverlay : NSView
@property (nonatomic, weak) NNPiPController *controller;
@property (nonatomic, readonly) NNPiPPill *pill;
@property (nonatomic, readonly) NNPiPHandle *handle;
@end

@interface NNPiPController : NSObject
@property (nonatomic, readonly) NSWindow *window;
@property (nonatomic, weak) NNBrowserView *view;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, readonly) NNPiPOverlay *overlay;
@property (nonatomic, readonly) NNPiPEdge stashedEdge;
@property (nonatomic) BOOL keepOnTop;
@property (nonatomic) BOOL pointerInside;
- (void)setVideoFrame:(CefRefPtr<CefFrame>)frame;
- (void)backToTab;
- (void)unstash;
- (NSMenu *)menu;
@end

@implementation NNPiPOverlay {
  NSTrackingArea *_tracking;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.zPosition = 100;  // above Chrome's compositor layers in the same content view
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _pill = [[NNPiPPill alloc] initWithFrame:NSZeroRect];
    _pill.alphaValue = 0;
    [self addSubview:_pill];
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
  if (_pill.alphaValue > 0.5 && NSPointInRect(local, _pill.frame)) return _pill;
  return nil;  // Chrome's controls and window drags
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect
                                           options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
                                             owner:self
                                          userInfo:nil];
  [self addTrackingArea:_tracking];
}

- (void)mouseEntered:(NSEvent *)event { self.controller.pointerInside = YES; }
- (void)mouseExited:(NSEvent *)event { self.controller.pointerInside = NO; }

- (void)layout {
  [super layout];
  NSSize size = self.bounds.size;
  // Wide enough to hide Chrome's own origin label (13 pt) under it.
  NSString *host = _pill.label.stringValue;
  CGFloat own = ceil([host sizeWithAttributes:@{NSFontAttributeName : _pill.label.font}].width) + 20;
  CGFloat chrome = kChromeOriginX - kPillX + ceil([host sizeWithAttributes:@{NSFontAttributeName : [NSFont systemFontOfSize:13]}].width) + 4;
  CGFloat width = MIN(MAX(own, chrome), MAX(size.width - kPillX - kChromeOriginRightMargin + 4, 60));
  _pill.frame = NSMakeRect(kPillX, kPillY, width, kPillHeight);
  _handle.frame = _handle.edge == NNPiPEdgeLeft ? NSMakeRect(size.width - kPeek, 0, kPeek, size.height)
                                                 : NSMakeRect(0, 0, kPeek, size.height);
}

@end

// MARK: - Controller

@implementation NNPiPController {
  NSMutableArray *_observers;
  CefRefPtr<CefFrame> _frame;
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
    _overlay = [[NNPiPOverlay alloc] initWithFrame:window.contentView.bounds];
    _overlay.controller = self;
    __weak NNPiPController *weakSelf = self;
    _overlay.pill.onClick = ^{ [weakSelf backToTab]; };
    _overlay.handle.onClick = ^{ [weakSelf unstash]; };
    [window.contentView addSubview:_overlay];
    objc_setAssociatedObject(window, kControllerKey, self, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    _observers = [NSMutableArray array];
    for (NSNotificationName name in @[ NSWindowDidMoveNotification, NSWindowDidResizeNotification ]) {
      [_observers addObject:[center addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *) {
                    [weakSelf windowMoved];
                  }]];
    }
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
  _frame = nullptr;
  objc_setAssociatedObject(_window, kControllerKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)setVideoFrame:(CefRefPtr<CefFrame>)frame { _frame = frame; }

- (void)setHost:(NSString *)host {
  _host = [host copy];
  _overlay.pill.label.stringValue = host ?: @"";
  _overlay.needsLayout = YES;
}

- (void)setPointerInside:(BOOL)inside {
  _pointerInside = inside;
  [self updatePill];
}

- (void)updatePill {
  BOOL show = _pointerInside && _stashedEdge == NNPiPEdgeNone && _host.length > 0;
  if (!show) _overlay.pill.hovered = NO;
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = show ? 0.15 : 0.2;
    self->_overlay.pill.animator.alphaValue = show ? 1 : 0;
  }];
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

/// Chrome's own Back to tab: the tab comes forward and the video carries on playing there.
- (void)backToTab {
  NNBrowserView *view = self.view;
  if (!view) return;
  [view emit:@"activateRequest" payload:@{@"reason" : @"pictureInPicture"}];
  // The frame that entered PiP (a video in an iframe is its own document's pictureInPictureElement).
  if (_frame && _frame->IsValid()) {
    _frame->ExecuteJavaScript("document.pictureInPictureElement && document.exitPictureInPicture()", "", 0);
  } else {
    [view exitPictureInPicture];
  }
}

// MARK: Stash

- (void)windowMoved {
  if (_animating) return;
  if (NSEvent.pressedMouseButtons & 1) _sawDrag = YES;
  // Wait for the drag (or Chrome's resize) to end.
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
}

/// Which edge the window was dragged mostly past (none if another display continues there).
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
  // Chrome moved a stashed window back on screen (the video's size changed): tuck it in again.
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
  [self updatePill];
}

/// Slides the window (0.25 s, ease-out). Stepped by hand: Chrome's window doesn't take
/// NSAnimationContext frame animations.
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

/// DEV (NETNYAHOO_PIP_SELFTEST=1): drives hover, stash, Keep on Top and Back to Tab on the
/// real window, pausing between steps for screenshots, and writes pip-selftest.json to
/// NETNYAHOO_DATA_DIR.
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
  // The window's layers at 2x over a grey stand-in for the video (the compositor's layers
  // don't render here, and screencapture fails while the screen is locked).
  auto snapshot = [=](NSString *name) {
    NSView *content = window.contentView;
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
  auto dragTo = [=](CGFloat x) {
    // What a user's drag leaves behind: the window where it was dropped, then settle.
    self->_sawDrag = YES;
    [window setFrameOrigin:NSMakePoint(x, NSMinY(window.frame))];
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
    [self settle];
  };

  record(@"attached", self.overlay.superview == window.contentView && [window.contentView.subviews.lastObject isEqual:self.overlay],
         @{@"level" : @(window.level), @"keepOnTop" : @(self.keepOnTop)});
  self.pointerInside = YES;
  after(0.6, ^{
    record(@"hover shows pill", self.overlay.pill.alphaValue > 0.99 && [self.overlay.pill.label.stringValue isEqual:self.host],
           @{@"pill" : NSStringFromRect(self.overlay.pill.frame), @"text" : self.overlay.pill.label.stringValue});
    snapshot(@"hover");
    self.overlay.pill.hovered = YES;
    snapshot(@"pill-hovered");
    self.overlay.pill.hovered = NO;
    self.pointerInside = NO;
    dragTo(NSMaxX(visible) - NSWidth(window.frame) * 0.3);
  });
  after(2.2, ^{
    record(@"drag past right edge stashes", self.stashedEdge == NNPiPEdgeRight &&
                                                 fabs(NSMinX(window.frame) - (NSMaxX(visible) - kPeek)) < 0.5 &&
                                                 !self.overlay.handle.hidden && self.overlay.handle.alphaValue > 0.99,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-right");
    // Chrome moving the window back (a new video size) keeps it tucked in.
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
    // Dragged out of the stash by hand: it stays where it was dropped.
    dragTo(NSMinX(visible) + 100);
  });
  after(7.0, ^{
    record(@"drag out of the stash", self.stashedEdge == NNPiPEdgeNone && fabs(NSMinX(window.frame) - (NSMinX(visible) + 100)) < 0.5, nil);
    NSMenu *menu = [self menu];
    BOOL onBefore = [menu itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOn;
    [self toggleKeepOnTop:nil];
    BOOL off = window.level == NSNormalWindowLevel && [[self menu] itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOff;
    [self toggleKeepOnTop:nil];
    record(@"Keep Window on Top toggles", onBefore && off && window.level == NSFloatingWindowLevel,
           @{@"menu" : [[self menu].itemArray valueForKey:@"title"]});
    [window setFrame:start display:YES];
    self.pointerInside = YES;
  });
  after(8.2, ^{
    record(@"pill click: Back to Tab", self.view != nil, nil);
    self.overlay.pill.onClick();
  });
  after(9.7, ^{
    record(@"PiP closed after Back to Tab", !window.visible, nil);
    write();
  });
}

@end

// MARK: - Glue

namespace nn::pip {

namespace {

/// Right-click anywhere on Chrome's PiP window: Back to Tab / Keep Window on Top.
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

bool Attach(NNBrowserView *view, NSString *host, CefRefPtr<CefFrame> frame) {
  for (NSWindow *window in NSApp.windows) {
    if (!IsChromeVideoPictureInPicture(window)) continue;
    NNPiPController *controller = [NNPiPController forWindow:window];
    // Chrome reuses its window when another video takes over PiP.
    BOOL fresh = !controller;
    if (fresh) controller = [[NNPiPController alloc] initWithWindow:window];
    controller.view = view;
    controller.host = host;
    [controller setVideoFrame:frame];
    InstallMenuMonitor();
    if (fresh && getenv("NETNYAHOO_PIP_SELFTEST")) [controller runSelfTest];
    return true;
  }
  return false;
}

}  // namespace

void VideoChanged(NNBrowserView *view, NSString *host, CefRefPtr<CefFrame> frame, bool active) {
  if (!active) return;  // Chrome closes its window; the controller detaches with it
  // The page hears about PiP about when Chrome shows the window: look for it for a second.
  __block int tries = 0;
  __block void (^look)(void);
  __weak NNBrowserView *weakView = view;
  look = ^{
    NNBrowserView *strongView = weakView;
    if (!strongView || Attach(strongView, host, frame) || ++tries >= 20) {
      look = nil;
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), look);
  };
  look();
}

}  // namespace nn::pip
