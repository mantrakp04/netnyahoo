#import "NNPopupWindow.h"

#import "NNClient.h"

using namespace nn;

/// A little window hosting one popup browser: the title bar shows the page's
/// title and host, and it closes with the page (window.close()).
@interface NNPopupWindowController : NSObject <NSWindowDelegate, NNBrowserViewDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) NNBrowserView *browserView;
@property (nonatomic, weak) NNBrowserView *opener;
@end

namespace {
NSMutableSet<NNPopupWindowController *> *gControllers;
}

@implementation NNPopupWindowController

- (instancetype)initWithRequest:(const PopupRequest &)request {
  if (!(self = [super init])) return nil;
  _opener = request.opener;
  NSSize size = NSMakeSize(MAX(request.size.width, 200), MAX(request.size.height, 150));
  _window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)
                                        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                  NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                          backing:NSBackingStoreBuffered
                                            defer:NO];
  _window.releasedWhenClosed = NO;
  _window.delegate = self;
  _window.tabbingMode = NSWindowTabbingModeDisallowed;
  _window.minSize = NSMakeSize(200, 150);
  _window.title = HostOf(request.url);

  _browserView = [[NNBrowserView alloc] initWithFrame:_window.contentView.bounds];
  _browserView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _browserView.profile = request.profile;
  _browserView.delegate = self;
  _browserView.adoptId = request.adoptId;  // adopted once it joins the window
  [_window.contentView addSubview:_browserView];

  [self placeWithRequest:request];
  [_window makeKeyAndOrderFront:nil];
  return self;
}

/// window.open(…, "left=…,top=…") positions are screen pixels from the top-left;
/// otherwise cascade from the opener's window like Chrome.
- (void)placeWithRequest:(const PopupRequest &)request {
  NSWindow *parent = request.opener.window;
  NSScreen *screen = parent.screen ?: NSScreen.mainScreen;
  NSRect frame = _window.frame;
  if (request.hasOrigin) {
    NSRect primary = NSScreen.screens.firstObject.frame;
    frame.origin = NSMakePoint(request.origin.x, NSMaxY(primary) - request.origin.y - frame.size.height);
  } else if (parent) {
    NSRect p = parent.frame;
    frame.origin = NSMakePoint(NSMidX(p) - frame.size.width / 2, NSMaxY(p) - frame.size.height - 60);
  } else {
    [_window center];
    frame = _window.frame;
  }
  // Keep it on screen.
  NSRect visible = screen.visibleFrame;
  frame.origin.x = MAX(NSMinX(visible), MIN(frame.origin.x, NSMaxX(visible) - frame.size.width));
  frame.origin.y = MAX(NSMinY(visible), MIN(frame.origin.y, NSMaxY(visible) - frame.size.height));
  [_window setFrame:frame display:NO];
}

- (void)browserView:(NNBrowserView *)view event:(NSString *)name payload:(NSDictionary *)payload {
  if ([name isEqualToString:@"navigation"]) {
    NSString *host = HostOf(payload[@"url"]);
    NSString *title = payload[@"title"];
    _window.title = title.length && ![title isEqualToString:payload[@"url"]] ? title : host;
    _window.subtitle = [_window.title isEqualToString:host] ? @"" : host;
  } else if ([name isEqualToString:@"windowClose"]) {
    [_window close];
  } else if ([name isEqualToString:@"openWindow"] || [name isEqualToString:@"popupBlocked"] ||
             [name isEqualToString:@"command"]) {
    // Links the popup opens in tabs belong to the window it came from.
    [_opener emit:name payload:payload];
  }
}

- (void)windowWillClose:(NSNotification *)notification {
  [_browserView closeBrowser];
  _browserView.delegate = nil;
  [gControllers removeObject:self];
}

@end

namespace nn {

void OpenPopupWindow(const PopupRequest &request) {
  if (!gControllers) gControllers = [NSMutableSet set];
  [gControllers addObject:[[NNPopupWindowController alloc] initWithRequest:request]];
}

NSUInteger PopupWindowCount() { return gControllers.count; }

}  // namespace nn
