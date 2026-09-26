#import "NNPopupWindow.h"

#import "NNChromeWindow.h"
#import "NNClient.h"
#import "NNWindowHost.h"

using namespace nn;

/// A little window hosting one popup browser: the title bar shows the page's
/// title and host, and it closes with the page (window.close()). It's a Chrome
/// window of its own (NNChromeWindowHost), so Chrome's dialogs, autofill and menus
/// for the page show over it; with stock CEF, a plain window.
@interface NNPopupWindowController : NSObject <NSWindowDelegate, NNBrowserViewDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) NNBrowserView *browserView;
@property (nonatomic, weak) NNBrowserView *opener;
@property (nonatomic, strong) id closeObserver;
@end

namespace {
NSMutableSet<NNPopupWindowController *> *gControllers;
}

@implementation NNPopupWindowController

- (instancetype)initWithRequest:(const PopupRequest &)request {
  if (!(self = [super init])) return nil;
  _opener = request.opener;
  NSSize size = NSMakeSize(MAX(request.size.width, 200), MAX(request.size.height, 150));
  _browserView = [[NNBrowserView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
  _browserView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _browserView.profile = request.profile;
  _browserView.delegate = self;
  _browserView.adoptId = request.adoptId;  // adopted once it joins the window
  // Chrome's window delegate stays Chrome's: its close comes as a notification.
  _window = [NNChromeWindowHost makePopupWindowForProfile:request.profile ?: @"" root:_browserView];
  if (_window) {
    [_window setContentSize:size];
    __weak NNPopupWindowController *weakSelf = self;
    _closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                     object:_window
                                                                      queue:nil
                                                                 usingBlock:^(NSNotification *note) {
      [weakSelf windowWillClose:note];
    }];
  } else {
    _window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)
                                          styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                    NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                            backing:NSBackingStoreBuffered
                                              defer:NO];
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _browserView.frame = _window.contentView.bounds;
    [_window.contentView addSubview:_browserView];
  }
  _window.tabbingMode = NSWindowTabbingModeDisallowed;
  _window.minSize = NSMakeSize(200, 150);
  _window.title = HostOf(request.url);

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
    // A Chrome window closes through the engine (its Browser mustn't go from under a tab).
    if (!host::CloseWindow(_window)) [_window close];
  } else if ([name isEqualToString:@"openWindow"] || [name isEqualToString:@"popupBlocked"] ||
             [name isEqualToString:@"command"]) {
    // Links the popup opens in tabs belong to the window it came from.
    [_opener emit:name payload:payload];
  }
}

- (void)windowWillClose:(NSNotification *)notification {
  if (_closeObserver) [NSNotificationCenter.defaultCenter removeObserver:_closeObserver];
  _closeObserver = nil;
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
