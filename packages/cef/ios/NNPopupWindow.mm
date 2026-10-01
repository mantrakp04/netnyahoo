#import "NNPopupWindow.h"

#import "NNChromeWindow.h"
#import "NNClient.h"
#import "NNExtensionsInternal.h"
#import "NNExternalApps.h"
#import "NNWindowHost.h"

using namespace nn;

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
  _browserView.adoptId = request.adoptId;
  // Loaded only if the popup is never made (OnBeforePopupAborted).
  _browserView.initialURL = request.url;
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
  NSRect visible = screen.visibleFrame;
  frame.origin.x = MAX(NSMinX(visible), MIN(frame.origin.x, NSMaxX(visible) - frame.size.width));
  frame.origin.y = MAX(NSMinY(visible), MIN(frame.origin.y, NSMaxY(visible) - frame.size.height));
  [_window setFrame:frame display:NO];
}

- (void)browserView:(NNBrowserView *)view event:(NSString *)name payload:(NSDictionary *)payload {
  // A page of ours a WebUI page here links to opens as a tab (Client::OnBeforeBrowse), not in the opener's.
  if ([name isEqualToString:@"openWindow"] && [payload[@"disposition"] isEqual:@"current"]) {
    NSMutableDictionary *tab = [payload mutableCopy];
    tab[@"disposition"] = @"foreground";
    payload = tab;
  }
  if ([name isEqualToString:@"navigation"]) {
    NSString *host = HostOf(payload[@"url"]);
    NSString *title = payload[@"title"];
    _window.title = title.length && ![title isEqualToString:payload[@"url"]] ? title : host;
    _window.subtitle = [_window.title isEqualToString:host] ? @"" : host;
  } else if ([name isEqualToString:@"externalApp"]) {
    external::ShowSheet(_window, payload);
  } else if ([name isEqualToString:@"windowClose"]) {
    // Close Chrome windows through CEF so tabs outlive the close.
    if (!host::CloseWindow(_window)) [_window close];
  } else if ([name isEqualToString:@"openWindow"] && !_opener) {
    // The tab that opened this popup is gone: its links open as a tab of the profile's window (a private
    // window's popup has none to go to).
    if (!IsIncognito(_browserView.profile)) ext::EmitOpenTab(payload[@"url"], _browserView.profile);
  } else if ([name isEqualToString:@"openWindow"] || [name isEqualToString:@"popupBlocked"] ||
             [name isEqualToString:@"command"]) {
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

}
