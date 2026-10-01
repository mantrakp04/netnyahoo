// The WebView on NNCore. It hosts one live tab, an NNCoreTab: Chrome's WebContents in the Browser of its window
// and profile, with its page view placed straight in this view.
//
// Where packages/cef adopts popups by id after the fact (OnBeforePopup → JS → a new browser adopts the popup,
// with a 30 s orphan timer and a replay of the navigation), Chrome here has already made the tab with its
// navigation (POST body included): the app gets onOpenWindow with "nncore:<id>", and the WebView it mounts
// takes that live tab.
#import "NNCoreWebView.h"
#import "NNCoreWebViewInternal.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include <climits>
#include <cmath>

namespace {

constexpr CFTimeInterval kTransferWindow = 3;

NSHashTable<NNCoreWebView *> *LiveViews() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}

NSMutableDictionary<NSString *, NSNumber *> *TransferRequests() {
  static NSMutableDictionary *requests = [NSMutableDictionary dictionary];
  return requests;
}

bool TransferRequested(NSString *key) {
  if (!key.length) return false;
  NSNumber *at = TransferRequests()[key];
  return at && CACurrentMediaTime() - at.doubleValue < kTransferWindow;
}

// A tab whose view unmounted while it moves to another window (prepareTransfer), until its new view takes it.
NSMutableDictionary<NSString *, NNCoreTab *> *Parked() {
  static NSMutableDictionary *parked = [NSMutableDictionary dictionary];
  return parked;
}

NSView *ParkingView() {
  static NSView *view = [[NSView alloc] initWithFrame:NSZeroRect];
  return view;
}

bool SamePage(NSString *a, NSString *b) {
  auto strip = [](NSString *url) {
    NSRange hash = [url rangeOfString:@"#"];
    return hash.location == NSNotFound ? url : [url substringToIndex:hash.location];
  };
  return a && b && [strip(a) isEqualToString:strip(b)];
}

NSString *PNGDataURL(NSImage *image) {
  CGImageRef cg = [image CGImageForProposedRect:nil context:nil hints:nil];
  if (!cg) return nil;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return png.length ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : nil;
}

id JSONValue(NSString *json) {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
}

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max) {
  NSString *s = Field<NSString>(d, key);
  if (s.length <= max) return s;
  return [s substringToIndex:[s rangeOfComposedCharacterSequenceAtIndex:max].location];
}

bool Flag(NSDictionary *d, NSString *key) {
  return Field<NSNumber>(d, key).boolValue;
}

bool Finite(NSDictionary *d, NSString *key, double *out) {
  NSNumber *n = Field<NSNumber>(d, key);
  if (!n || !std::isfinite(n.doubleValue)) return false;
  *out = n.doubleValue;
  return true;
}

NSString *OriginOf(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url ?: @""];
  if (!c.scheme.length || !c.host.length) return nil;
  return c.port ? [NSString stringWithFormat:@"%@://%@:%@", c.scheme, c.host, c.port] : [NSString stringWithFormat:@"%@://%@", c.scheme, c.host];
}

NSDictionary *NowPlayingState(NSDictionary *d) {
  NSString *state = Field<NSString>(d, @"playbackState");
  if (![@[ @"none", @"paused", @"playing" ] containsObject:state]) state = @"none";
  NSMutableArray *actions = [NSMutableArray array];
  for (id action in Field<NSArray>(d, @"actions"))
    if ([action isKindOfClass:NSString.class] && [action length] <= 64 && actions.count < 32) [actions addObject:action];
  double position = 0, duration = 0, rate = 1, timestamp = 0;
  Finite(d, @"position", &position);
  const bool hasDuration = Finite(d, @"duration", &duration) && duration >= 0;
  Finite(d, @"playbackRate", &rate);
  Finite(d, @"timestamp", &timestamp);
  return @{
    @"frame" : Text(d, @"frame", 64) ?: @"",
    @"title" : Text(d, @"title", 1024) ?: @"",
    @"artist" : Text(d, @"artist", 1024) ?: @"",
    @"album" : Text(d, @"album", 1024) ?: @"",
    @"artwork" : Text(d, @"artwork", 1 << 20) ?: NSNull.null,
    @"playbackState" : state,
    @"position" : @(MAX(position, 0)),
    @"duration" : hasDuration ? @(duration) : NSNull.null,
    @"playbackRate" : @(rate),
    @"timestamp" : @(timestamp),
    @"hasVideo" : @(Flag(d, @"hasVideo")),
    @"actions" : actions,
  };
}

NSDictionary *SelectionState(NSDictionary *d) {
  NSString *text = Text(d, @"text", 4000);
  NSDictionary *rect = Field<NSDictionary>(d, @"rect");
  double x, y, width, height;
  if (!text || !Finite(rect, @"x", &x) || !Finite(rect, @"y", &y) || !Finite(rect, @"width", &width) ||
      !Finite(rect, @"height", &height))
    return nil;
  return @{@"text" : text, @"rect" : @{@"x" : @(x), @"y" : @(y), @"width" : @(width), @"height" : @(height)}};
}

// The last events each tab's view sent (names and payloads), for tests (devEvents).
NSMutableDictionary<NSNumber *, NSMutableArray *> *RecentEvents() {
  static NSMutableDictionary *events = [NSMutableDictionary dictionary];
  return events;
}

void NoteEvent(int browserId, NSString *name, NSDictionary *payload) {
#if DEBUG
  NSMutableArray *list = RecentEvents()[@(browserId)];
  if (!list) RecentEvents()[@(browserId)] = list = [NSMutableArray array];
  NSMutableDictionary *brief = [NSMutableDictionary dictionary];
  for (NSString *key in payload) {
    id value = payload[key];
    brief[key] = [value isKindOfClass:NSString.class] && [value length] > 200 ? [value substringToIndex:200] : value;
  }
  [list addObject:@{@"name" : name, @"payload" : brief}];
  if (list.count > 80) [list removeObjectAtIndex:0];
#endif
}

NSString *JSONString(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

}  // namespace

@interface NNCoreWebView () <NNCoreTabDelegate>
@end

@implementation NNCoreWebView {
  NNCoreTab *_tab;
  BOOL _creating;
  BOOL _closing;
  BOOL _moving;
  NSString *_pendingURL;
  // The URL a new tab opens with: the page's first loadURL asks for it again (ContentCard), and loading it twice
  // would run the page twice.
  NSString *_creatingURL;
  CFTimeInterval _creatingAt;
  NSString *_transferredURL;
  BOOL _muted;
  NSInteger _tabIndex;
  BOOL _pinned;
  NSView *_devtoolsView;
  BOOL _navigationQueued;
  NSDictionary *_sentNavigation;
  NSString *_lastFavicon;
  CFTimeInterval _sentProgressAt;
  double _sentProgress;
  BOOL _progressQueued;
  // The page script's reports, per frame (as packages/cef's NNClient keeps them).
  NSMutableDictionary<NSString *, NSNumber *> *_mediaFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_nowPlaying;
  NSString *_nowPlayingFrame;
  NSMutableDictionary<NSString *, NSString *> *_notificationFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_displayRequests;
  double _pinchScale;
}

+ (void)prepareTransfer:(NSString *)transferKey {
  if (transferKey.length) TransferRequests()[transferKey] = @(CACurrentMediaTime());
}

- (instancetype)initWithFrame:(NSRect)frameRect {
  if ((self = [super initWithFrame:frameRect])) {
    _profile = @"";
    _visible = YES;
    _tabIndex = -1;
    self.wantsLayer = YES;
  }
  return self;
}

- (void)dealloc {
  [self closeBrowser];
}

- (BOOL)isFlipped {
  return YES;
}

- (int)browserId {
  return _tab ? nncore_host::BrowserId(_tab) : 0;
}

- (int)chromeTabId {
  return _tab ? _tab.tabId : 0;
}

- (NNCoreWindowController *)controller {
  return [NNCoreWindowController forNSWindow:self.window];
}

// MARK: The tab

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (!self.window) return;
  if (_tab) [self adoptIntoWindow];
  else [self ensureTab];
}

- (void)setAdoptId:(NSString *)adoptId {
  _adoptId = [adoptId copy];
  if (self.window) [self ensureTab];
}

- (void)ensureTab {
  if (_tab || _creating || !self.window || !NNCoreHost.isStarted || !self.controller) return;
  if (TransferRequested(_transferKey) && [self takeTransferredTab]) return;
  if ([_adoptId hasPrefix:@"nncore:"] || [_adoptId hasPrefix:@"tab:"]) {
    NNCoreTab *offered = [NNCoreTabs takeOffered:_adoptId];
    _adoptId = nil;
    if (offered && !offered.closed) return [self attach:offered];
  }
  _adoptId = nil;
  _creating = YES;
  __weak NNCoreWebView *weakSelf = self;
  nncore_host::WithProfile(_profile, ^(NNCoreProfile *profile) {
    NNCoreWebView *view = weakSelf;
    if (!view) return;
    view->_creating = NO;
    NNCoreWindowController *controller = view.controller;
    if (!profile || view->_tab || !controller) return;
    NSString *url = view->_pendingURL ?: view->_initialURL;
    view->_pendingURL = nil;
    view->_creatingURL = url;
    view->_creatingAt = CACurrentMediaTime();
    controller.hostChanges++;
    NNCoreTab *tab = [controller.coreWindow openTab:url.length ? url : @"about:blank" profile:profile foreground:NO];
    controller.hostChanges--;
    if (tab) [view attach:tab];
  });
}

- (BOOL)takeTransferredTab {
  NNCoreTab *tab = Parked()[_transferKey];
  if (tab) [Parked() removeObjectForKey:_transferKey];
  // The new view can mount before the old one unmounts: take the tab from it.
  if (!tab) {
    for (NNCoreWebView *other in LiveViews()) {
      if (other == self || ![other.transferKey isEqualToString:_transferKey] || other.window == self.window || !other->_tab) continue;
      tab = other->_tab;
      [other detach];
      break;
    }
  }
  if (!tab || tab.closed) return NO;
  [TransferRequests() removeObjectForKey:_transferKey];
  _adoptId = nil;
  _transferredURL = tab.url;
  if (SamePage(_pendingURL, _transferredURL)) _pendingURL = nil;
  [self attach:tab];
  return YES;
}

// The tab's Browser is its window's: a tab this view takes from elsewhere (a popup Chrome opened in another
// window's Browser, a tab moved between windows) moves into this window's Browser for its profile.
- (void)adoptIntoWindow {
  NNCoreWindowController *controller = self.controller;
  if (!controller || ![controller.coreWindow respondsToSelector:@selector(adoptTab:)]) return;
  if ([[controller.coreWindow tabsForProfile:_tab.profile] containsObject:_tab]) return;
  NNCoreWindowController *source = [NNCoreWindowController holding:_tab];
  _moving = YES;
  controller.hostChanges++;
  source.hostChanges++;
  [controller.coreWindow adoptTab:_tab];
  source.hostChanges--;
  controller.hostChanges--;
  _moving = NO;
  if (_tabIndex >= 0) [self placeTab];
}

- (void)attach:(NNCoreTab *)tab {
  [LiveViews() addObject:self];
  _tab = tab;
  tab.delegate = self;
  [NNCoreTabs setView:self forTab:tab];
  [self adoptIntoWindow];
  NSView *page = tab.view;
  if (page.superview != self) {
    [page removeFromSuperview];
    [self addSubview:page];
  }
  if (NSView *devtools = tab.devToolsView) [self devToolsChanged:devtools];
  [self layoutPage];
  [self applyPainting];
  if (_muted && [tab respondsToSelector:@selector(setMuted:)]) tab.muted = YES;
  if (_pageBackgroundColor && [tab respondsToSelector:@selector(setPageBackgroundColor:)]) tab.pageBackgroundColor = _pageBackgroundColor;
  if (_pendingURL) {
    [self loadNow:_pendingURL userInitiated:NO];
    _pendingURL = nil;
  }
  [self emit:@"ready" payload:@{@"browserId" : @(nncore_host::BrowserId(tab)), @"tabId" : @(tab.tabId)}];
  [self emitNavigation];
  [self tabDidChangeFavicon:tab];
  if (_tabIndex >= 0) [self placeTab];
  if (_visible && !NNCoreTabStrip.commandsSeen) [self activate];
  // The strip names the tab by this view's key from now on (re-sent as Chrome's report, cmd null).
  if (NNCoreWindowController *controller = self.controller)
    [NNCoreTabStrip changedInWindow:controller profile:tab.profile cause:NSNull.null];
}

- (void)detach {
  if (!_tab) return;
  if (_tab.delegate == self) _tab.delegate = nil;
  [NNCoreTabs setView:nil forTab:_tab];
  if (_tab.view.superview == self) [_tab.view removeFromSuperview];
  [self dropDevTools];
  _tab = nil;
}

- (void)closeBrowser {
  if (!_tab) return;
  NNCoreTab *tab = _tab;
  if (TransferRequested(_transferKey) && !tab.closed) {
    // Moving to another window: the new view takes it within kTransferWindow, else it closes.
    [self detach];
    [ParkingView() addSubview:tab.view];
    NSString *key = [_transferKey copy];
    Parked()[key] = tab;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kTransferWindow * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (Parked()[key] != tab) return;
      [Parked() removeObjectForKey:key];
      [tab close];
    });
    return;
  }
  _closing = YES;
  [[NNCoreWindowController holding:tab] noteClosing:tab];
  [self detach];
  // As CEF's CloseBrowser(true): the app already dropped the tab, so no beforeunload keeps it alive unseen.
  if ([tab respondsToSelector:@selector(closeNow)]) [tab closeNow];
  else [tab close];
}

- (void)activate {
  NNCoreWindowController *controller = self.controller;
  if (!_tab || !controller) return;
  controller.hostChanges++;
  [controller.coreWindow activateTab:_tab];
  [NNCoreTabStrip activated:_tab inWindow:controller];
  controller.hostChanges--;
}

- (void)placeTab {
  NNCoreWindowController *controller = self.controller;
  if (!_tab || !controller || ![controller.coreWindow respondsToSelector:@selector(placeTab:index:pinned:)]) return;
  controller.hostChanges++;
  [controller.coreWindow placeTab:_tab index:(int)_tabIndex pinned:_pinned];
  controller.hostChanges--;
}

// MARK: From the window

- (void)openedTab:(NNCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition {
  [self announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:0];
}

// window.open makes its contents before it navigates them: wait (briefly) for the URL it is going to.
- (void)announceOpenedTab:(NNCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition tries:(int)tries {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    __weak NNCoreWebView *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:tries + 1];
    });
    return;
  }
  [self emit:@"openWindow"
      payload:@{
        @"url" : url ?: @"",
        @"disposition" : disposition,
        @"adoptId" : adoptId,
        @"userGesture" : @YES,
        @"postBody" : @NO,
      }];
}

- (void)tabRemovedFromWindow:(NNCoreWindow *)window {
  if (_moving || _closing || !_tab) return;
  // A stage 1 engine says when Chrome closes a tab (tabWillClose:); a removal is then a move (an extension's
  // tabs.move to another window), which keeps the tab.
  if (nncore_host::EngineHasTabModel()) return;
  // Chrome closed it (window.close(), an extension): the app closes the tab (onWindowClose).
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

- (void)tabActivatedByChrome:(BOOL)chromes {
  [self emit:@"tabStrip"
      payload:@{
        @"index" : @(MAX(_tabIndex, 0)),
        @"active" : @YES,
        @"pinned" : @(_pinned),
        @"activated" : @YES,
        @"byApp" : @(!chromes),
      }];
}

- (void)devToolsChanged:(NSView *)devToolsView {
  if (_devtoolsView && _devtoolsView != devToolsView && _devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = devToolsView;
  if (devToolsView && devToolsView.superview != self) {
    [devToolsView removeFromSuperview];
    NSView *page = _tab.view;
    if (page.superview == self) [self addSubview:devToolsView positioned:NSWindowBelow relativeTo:page];
    else [self addSubview:devToolsView];
  }
  [self layoutPage];
}

- (void)dropDevTools {
  if (_devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = nil;
}

// MARK: Layout and painting

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  [self layoutPage];
}

- (void)layoutPage {
  NSView *page = _tab.view;
  if (!page || page.superview != self) return;
  if (_devtoolsView) {
    NSRect devtools = NSZeroRect, pageFrame = self.bounds;
    [_tab devToolsLayoutForSize:self.bounds.size devTools:&devtools page:&pageFrame];
    _devtoolsView.frame = devtools;
    page.frame = pageFrame;
  } else {
    page.frame = self.bounds;
  }
}

- (BOOL)paints {
  return _visible || _warm;
}

- (void)applyPainting {
  self.alphaValue = _visible || !_warm ? 1 : 0;
  const BOOL shown = self.paints;
  for (NSView *sub in self.subviews) sub.hidden = !shown;
}

- (void)setWarm:(BOOL)warm {
  if (_warm == warm) return;
  _warm = warm;
  [self applyPainting];
}

- (void)setVisible:(BOOL)visible {
  if (_visible == visible) return;
  _visible = visible;
  [self applyPainting];
  // With tab-strip commands, only they (and Chrome) change the active tab.
  if (visible && !NNCoreTabStrip.commandsSeen) [self activate];
}

- (void)setFrozen:(BOOL)frozen {
  _frozen = frozen;
  if ([_tab respondsToSelector:@selector(setFrozen:)]) _tab.frozen = frozen;
}

- (void)setPageBackgroundColor:(NSColor *)color {
  _pageBackgroundColor = color;
  if ([_tab respondsToSelector:@selector(setPageBackgroundColor:)]) _tab.pageBackgroundColor = color;
}

// MARK: Events

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
  // Events reach JS in the order they happened: a held navigation report goes first.
  if (_navigationQueued && ![name isEqualToString:@"navigation"]) [self emitNavigation];
  if (_tab) NoteEvent(nncore_host::BrowserId(_tab), name, payload);
  [self.delegate webView:self event:name payload:payload];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)devEventsForBrowser:(int)browserId {
  return RecentEvents()[@(browserId)] ?: @[];
}

+ (NSInteger)devWindowNumberForBrowser:(int)browserId {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  NNCoreWebView *view = tab ? [NNCoreTabs viewForTab:tab] : nil;
  return view.window.windowNumber;
}

- (void)emitNavigation {
  _navigationQueued = NO;
  if (!_tab) return;
  NSString *theme = [_tab respondsToSelector:@selector(themeColor)] ? _tab.themeColor : nil;
  NSDictionary *navigation = @{
        @"url" : _tab.url ?: @"",
        @"title" : _tab.title ?: @"",
        @"canGoBack" : @(_tab.canGoBack),
        @"canGoForward" : @(_tab.canGoForward),
        @"isLoading" : @(_tab.loading),
        @"themeColor" : theme ?: NSNull.null,
        @"themeColorSource" : theme ? @"meta" : NSNull.null,
  };
  // As packages/cef (NNClient): a report that changes nothing isn't sent.
  if ([navigation isEqualToDictionary:_sentNavigation]) return;
  _sentNavigation = navigation;
  [self emit:@"navigation" payload:navigation];
}

// Title, URL, loading and history change together during a navigation: one report per run-loop turn.
- (void)queueNavigation {
  if (_navigationQueued) return;
  _navigationQueued = YES;
  __weak NNCoreWebView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    NNCoreWebView *view = weakSelf;
    if (view && view->_navigationQueued) [view emitNavigation];
  });
}

- (void)tabDidChangeTitle:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeURL:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeLoading:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeNavigationState:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeThemeColor:(NNCoreTab *)tab {
  [self queueNavigation];
}

// Load progress at most 10 times a second; its start and end at once (as packages/cef's NNClient).
- (void)tabDidChangeProgress:(NNCoreTab *)tab {
  const double progress = tab.progress;
  const CFTimeInterval wait = _sentProgressAt + 0.1 - CACurrentMediaTime();
  if (progress <= 0.1 || progress >= 1 || wait <= 0) return [self sendProgress];
  if (_progressQueued) return;
  _progressQueued = YES;
  __weak NNCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NNCoreWebView *view = weakSelf;
    if (view && view->_progressQueued) [view sendProgress];
  });
}

- (void)sendProgress {
  _progressQueued = NO;
  if (!_tab || _tab.progress == _sentProgress) return;
  _sentProgress = _tab.progress;
  _sentProgressAt = CACurrentMediaTime();
  [self emit:@"progress" payload:@{@"progress" : @(_sentProgress)}];
}

// A browser page's link to an app page (netnyahoo:) opens in its tab as if typed: the app maps it (core/appUrls).
- (void)tab:(NNCoreTab *)tab didRequestAppURL:(NSString *)url userGesture:(BOOL)userGesture {
  [self emit:@"openWindow" payload:@{@"url" : url ?: @"", @"disposition" : @"current", @"userGesture" : @(userGesture)}];
}

- (void)tabDidChangeFavicon:(NNCoreTab *)tab {
  NSImage *image = tab.favicon;
  if (!image) return;
  NSString *url = [tab respondsToSelector:@selector(faviconURL)] ? tab.faviconURL : nil;
  if (url.length) [NNCoreFavicons noteImage:image forURL:url];
  else url = PNGDataURL(image);
  if (!url.length || [url isEqualToString:_lastFavicon]) return;
  _lastFavicon = url;
  [self emit:@"favicon" payload:@{@"url" : url, @"urls" : @[ url ]}];
}

- (void)tab:(NNCoreTab *)tab didFindMatches:(int)count active:(int)active final:(BOOL)final {
  [self emit:@"find" payload:@{@"count" : @(count), @"active" : @(active), @"final" : @(final)}];
}

// The page script's messages from every frame (packages/cef/helper/page_script.js; NNClient::OnPageMessage on CEF).
// The page runs it in its own world, so every field is untrusted.
- (void)tab:(NNCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json frame:(NSString *)frameId main:(BOOL)main {
  id data = JSONValue(json);
  NSDictionary *dict = [data isKindOfClass:NSDictionary.class] ? data : nil;
  frameId = frameId ?: @"";
  if ([kind isEqualToString:@"hello"]) {
    [self callFrame:frameId kind:@"config" json:@"{}"];
  } else if ([kind isEqualToString:@"selection"] && main) {
    [self emit:@"pageMessage" payload:@{@"kind" : @"selection", @"data" : SelectionState(dict) ?: NSNull.null}];
  } else if ([kind isEqualToString:@"media"] && dict) {
    NSString *mediaFrame = Text(dict, @"frame", 64);
    if (!mediaFrame) return;
    if (!_mediaFrames) _mediaFrames = [NSMutableDictionary dictionary];
    NSString *key = [NSString stringWithFormat:@"%@:%@", frameId, mediaFrame];
    if (_mediaFrames.count >= 256 && !_mediaFrames[key]) return;
    _mediaFrames[key] = @(Flag(dict, @"playing"));
    [self emitMedia];
  } else if ([kind isEqualToString:@"nowPlaying"]) {
    if (!_nowPlaying) _nowPlaying = [NSMutableDictionary dictionary];
    if (dict) _nowPlaying[frameId] = NowPlayingState(dict);
    else [_nowPlaying removeObjectForKey:frameId];
    _nowPlayingFrame = dict ? frameId : _nowPlaying.allKeys.firstObject;
    for (NSString *f in _nowPlaying)
      if ([_nowPlaying[f][@"playbackState"] isEqual:@"playing"]) _nowPlayingFrame = f;
    NSMutableDictionary *state = [_nowPlaying[_nowPlayingFrame ?: @""] mutableCopy];
    [state removeObjectForKey:@"frame"];
    [self emit:@"nowPlaying" payload:@{@"state" : state ?: NSNull.null}];
  } else if ([kind isEqualToString:@"theme"]) {
    [self queueNavigation];
  } else if ([kind isEqualToString:@"pinch"] && main && dict) {
    double scale;
    if (!Finite(dict, @"scale", &scale) || scale <= 0) return;
    _pinchScale = MIN(scale, 100);
    [self emitZoom];
  } else if ([kind isEqualToString:@"pip"] && dict) {
    NSNumber *active = [dict[@"active"] isKindOfClass:NSNumber.class] ? dict[@"active"] : nil;
    if (active) [self emit:@"pictureInPicture" payload:@{@"kind" : [dict[@"kind"] isEqual:@"document"] ? @"document" : @"video", @"active" : active}];
  } else if ([kind isEqualToString:@"notification"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    NSString *origin = OriginOf(tab.url);
    if (!nid.length || !Text(dict, @"title", 1024) || !origin) return;
    if (!_notificationFrames || _notificationFrames.count > 500) _notificationFrames = [NSMutableDictionary dictionary];
    _notificationFrames[nid] = frameId;
    [self emit:@"notification"
        payload:@{
          @"id" : nid,
          @"title" : Text(dict, @"title", 1024),
          @"body" : Text(dict, @"body", 4096) ?: @"",
          @"icon" : Text(dict, @"icon", 1 << 20) ?: NSNull.null,
          @"tag" : Text(dict, @"tag", 1024) ?: @"",
          @"silent" : @(Flag(dict, @"silent")),
          @"requireInteraction" : @(Flag(dict, @"requireInteraction")),
          @"origin" : origin,
          @"browserId" : @(nncore_host::BrowserId(tab)),
          @"isMainFrame" : @(main),
        }];
  } else if ([kind isEqualToString:@"notificationClose"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    if (!nid.length) return;
    [_notificationFrames removeObjectForKey:nid];
    [self emit:@"notificationClose" payload:@{@"id" : nid}];
  } else if ([kind isEqualToString:@"displayMedia"] && dict) {
    double pageId;
    if (!Finite(dict, @"id", &pageId) || pageId < 1 || pageId > INT_MAX || pageId != floor(pageId)) return;
    if (!_displayRequests) _displayRequests = [NSMutableDictionary dictionary];
    if (_displayRequests.count >= 16) return;
    NSString *requestId = NSUUID.UUID.UUIDString;
    _displayRequests[requestId] = @{@"frame" : frameId, @"id" : @((int)pageId), @"audio" : @(Flag(dict, @"audio"))};
    [self emit:@"displayMediaRequest"
        payload:@{@"id" : requestId, @"origin" : OriginOf(tab.url) ?: @"", @"audio" : @(Flag(dict, @"audio")), @"sources" : @[]}];
  }
}

// Engines without per-frame messages: main-frame posts only.
- (void)tab:(NNCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json {
  [self tab:tab didReceivePageMessage:kind json:json frame:@"" main:YES];
}

- (void)callFrame:(NSString *)frameId kind:(NSString *)kind json:(NSString *)json {
  if (frameId.length && [_tab respondsToSelector:@selector(callFrame:kind:json:)]) [_tab callFrame:frameId kind:kind json:json];
  else if ([_tab respondsToSelector:@selector(callPage:json:)]) [_tab callPage:kind json:json];
}

- (void)emitMedia {
  BOOL playing = NO;
  for (NSNumber *p in _mediaFrames.allValues) playing |= p.boolValue;
  if ([_tab respondsToSelector:@selector(audible)]) playing |= _tab.audible;
  [self emit:@"media" payload:@{@"playing" : @(playing), @"muted" : @(_muted)}];
}

- (void)emitZoom {
  const double zoom = [_tab respondsToSelector:@selector(zoomFactor)] ? _tab.zoomFactor : 1;
  [self emit:@"zoom"
      payload:@{
        @"zoom" : @(round(zoom * 100) / 100),
        @"host" : [NSURL URLWithString:_tab.url ?: @""].host.lowercaseString ?: @"",
        @"isDefault" : @(fabs(zoom - 1) < 0.001),
        @"pinchScale" : @(_pinchScale ?: 1),
      }];
}

- (void)tabDidChangeZoom:(NNCoreTab *)tab {
  [self emitZoom];
}

- (void)tabDidChangeSecurity:(NNCoreTab *)tab {
  if (NSDictionary *info = tab.securityInfo) [self emit:@"security" payload:info];
}

- (void)tabWillClose:(NNCoreTab *)tab {
  if (_closing || tab != _tab) return;
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

- (void)tab:(NNCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  [self emit:@"crashed" payload:@{@"status" : @(code), @"reason" : status ?: @"unknown", @"code" : @(code)}];
}

- (void)tab:(NNCoreTab *)tab didFailLoad:(NSString *)url code:(int)code description:(NSString *)text {
  [self emit:@"loadError" payload:@{@"url" : url ?: @"", @"code" : @(code), @"text" : text ?: @""}];
}

- (void)tab:(NNCoreTab *)tab didChangeStatusText:(NSString *)text {
  [self emit:@"status" payload:@{@"text" : text ?: @""}];
}

- (void)tabDidGainFocus:(NNCoreTab *)tab {
  [self emit:@"focus" payload:@{}];
}

- (void)tabDidChangeAudio:(NNCoreTab *)tab {
  [self emitMedia];
}

// MARK: Commands

- (void)loadURL:(NSString *)url {
  [self loadURL:url userInitiated:NO];
}

- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated {
  if (!url.length) return;
  NSString *transferred = _transferredURL;
  _transferredURL = nil;
  NSString *creating = _creatingURL;
  _creatingURL = nil;
  if (_tab && SamePage(url, transferred)) return;
  // Only the page's own first request, which follows the view's creation at once.
  if ((_tab || _creating) && [url isEqualToString:creating] && CACurrentMediaTime() - _creatingAt < 2) return;
  if (_tab) return [self loadNow:url userInitiated:userInitiated];
  _pendingURL = url;
  if (self.window) [self ensureTab];
}

- (void)loadNow:(NSString *)url userInitiated:(BOOL)userInitiated {
  if ([_tab respondsToSelector:@selector(loadURL:userInitiated:)]) [_tab loadURL:url userInitiated:userInitiated];
  else [_tab loadURL:url];
}

- (void)loadOpenedURL:(NSInteger)openedId url:(NSString *)url {
  // NNCore never keeps navigations for later ("open:<id>" is CEF's): load the URL.
  [self loadURL:url userInitiated:NO];
}

- (void)goBack {
  [_tab goBack];
}

- (void)goForward {
  [_tab goForward];
}

- (void)goToHistoryOffset:(NSInteger)offset {
  if ([_tab respondsToSelector:@selector(goToOffset:)]) [_tab goToOffset:(int)offset];
  else if (offset == -1) [_tab goBack];
  else if (offset == 1) [_tab goForward];
}

- (void)reload {
  [_tab reload];
}

- (void)reloadIgnoringCache {
  if ([_tab respondsToSelector:@selector(reloadIgnoringCache)]) [_tab reloadIgnoringCache];
  else [_tab reload];
}

- (void)stopLoading {
  [_tab stop];
}

- (void)focusPage {
  [_tab focus];
}

- (void)setMuted:(BOOL)muted {
  _muted = muted;
  if ([_tab respondsToSelector:@selector(setMuted:)]) _tab.muted = muted;
}

- (void)setZoomFactor:(double)factor {
  if ([_tab respondsToSelector:@selector(setZoomFactor:)]) _tab.zoomFactor = factor;
}

- (void)zoomStep:(NSInteger)direction {
  if ([_tab respondsToSelector:@selector(zoomStep:)]) [_tab zoomStep:(int)direction];
}

- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext {
  [_tab find:text forward:forward];
}

- (void)stopFinding:(BOOL)clearSelection {
  [_tab stopFinding];
}

- (void)print {
  [self runChromeCommand:35003];  // IDC_PRINT
}

- (void)runChromeCommand:(int)command {
  if ([_tab respondsToSelector:@selector(executeChromeCommand:)]) [_tab executeChromeCommand:command];
}

- (void)showDevTools {
  [_tab showDevTools];
}

- (void)showDevToolsPanel:(NSString *)panel {
  [_tab showDevTools];
}

- (void)runPageCommand:(NSString *)name {
  const int command = [name isEqualToString:@"savePage"]        ? 35004   // IDC_SAVE_PAGE
                      : [name isEqualToString:@"systemPrint"]   ? 35007   // IDC_BASIC_PRINT
                      : [name isEqualToString:@"caretBrowsing"] ? 40260   // IDC_CARET_BROWSING_TOGGLE
                                                                : 0;
  if (command) [self runChromeCommand:command];
}

- (void)executeJavaScript:(NSString *)code {
  if ([_tab respondsToSelector:@selector(executeJavaScript:)]) [_tab executeJavaScript:code];
}

- (void)evaluate:(NSString *)code completion:(void (^)(NSString *))completion {
  if (![_tab respondsToSelector:@selector(evaluate:completion:)]) return completion(nil);
  [_tab evaluate:code completion:completion];
}

- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  completion([_tab respondsToSelector:@selector(navigationEntries)] ? _tab.navigationEntries : @[]);
}

- (void)downloadFavicon:(NSString *)url name:(NSString *)name completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [NNCoreFavicons fetch:url profile:_profile name:name completion:completion];
}

- (void)downloadImage:(NSString *)url maxPixels:(NSInteger)maxPixels completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [NNCoreFavicons fetch:url profile:_profile name:nil completion:completion];
}

- (void)mediaCommand:(NSString *)action seconds:(double)seconds {
  [self callFrame:_nowPlayingFrame ?: @"" kind:@"media" json:JSONString(@{@"action" : action ?: @"", @"seconds" : @(seconds)})];
}

- (void)requestPictureInPicture:(void (^)(BOOL))completion {
  if (![_tab respondsToSelector:@selector(evaluate:completion:)]) return completion(NO);
  [_tab evaluate:@"(async () => {"
                  "  const videos = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && !v.disablePictureInPicture);"
                  "  videos.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);"
                  "  if (!videos.length) return post('result', 'false');"
                  "  if (document.pictureInPictureElement === videos[0]) return post('result', 'true');"
                  "  try { await videos[0].requestPictureInPicture(); post('result', 'true'); } catch (e) { post('result', 'false'); }"
                  "})()"
      completion:^(NSString *json) { completion([json isEqualToString:@"true"]); }];
}

- (void)exitPictureInPicture {
  [self executeJavaScript:@"document.pictureInPictureElement && document.exitPictureInPicture();"
                           "window.documentPictureInPicture && documentPictureInPicture.window && documentPictureInPicture.window.close()"];
}

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *))completion {
  if ([_tab respondsToSelector:@selector(securityInfo)] && _tab.securityInfo) return completion(_tab.securityInfo);
  NSString *url = _tab.url ?: @"";
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  NSString *level = [scheme isEqualToString:@"https"] ? @"secure" : [scheme isEqualToString:@"http"] ? @"insecure" : @"local";
  completion(@{@"level" : level, @"url" : url, @"origin" : NSNull.null});
}

- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always {
  if ([_tab respondsToSelector:@selector(openBlockedPopup:always:)]) [_tab openBlockedPopup:popupId always:always];
}

- (void)tab:(NNCoreTab *)tab didBlockPopup:(NSDictionary<NSString *, NSString *> *)popup {
  [self emit:@"popupBlocked" payload:popup];
}

- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *))completion {
  completion(@{@"cookies" : @NO, @"storage" : @NO});
}

- (void)resolvePasswordPrompt:(NSString *)action username:(NSString *)username password:(NSString *)password {
  if ([action isEqualToString:@"save"] || [action isEqualToString:@"update"]) [_tab savePendingPassword];
  else [_tab dismissPendingPassword];
}

- (void)setTabStripIndex:(NSInteger)index pinned:(BOOL)pinned {
  _tabIndex = index;
  _pinned = pinned;
  if (_tab) [NNCoreTabStrip setPinned:pinned tab:_tab];
  [self placeTab];
}

- (NSString *)executeExtensionAction:(NSString *)extensionId {
  return [_tab respondsToSelector:@selector(executeExtensionAction:)] ? [_tab executeExtensionAction:extensionId] : nil;
}

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(NSString *)sourceId {
  NSDictionary *request = requestId ? _displayRequests[requestId] : nil;
  if (!request) return;
  [_displayRequests removeObjectForKey:requestId];
  // No desktop sources on NNCore yet: the page's own getDisplayMedia goes ahead with Chrome's picker.
  [self callFrame:request[@"frame"] kind:@"displayMedia"
             json:JSONString(@{@"id" : request[@"id"], @"sourceId" : sourceId.length ? sourceId : NSNull.null})];
}

- (NSString *)mediaCaptureSourceId {
  return nil;
}

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action {
  NSString *frame = notificationId ? _notificationFrames[notificationId] : nil;
  if (!frame) return;
  if (![action isEqualToString:@"click"]) [_notificationFrames removeObjectForKey:notificationId];
  [self callFrame:frame kind:@"notification" json:JSONString(@{@"id" : notificationId, @"action" : action ?: @""})];
}

- (void)resolveUnresponsive:(BOOL)terminate {
  if ([_tab respondsToSelector:@selector(resolveUnresponsive:)]) [_tab resolveUnresponsive:terminate];
}

- (BOOL)discard:(BOOL)unload {
  return [_tab respondsToSelector:@selector(discard)] && [_tab discard];
}

- (BOOL)discarded {
  return [_tab respondsToSelector:@selector(discarded)] && _tab.discarded;
}

- (void)tabDidChangeDiscarded:(NNCoreTab *)tab {
  // As CEF's onDiscarded: the page's URL, to load again when it shows.
  if (tab.discarded) [self emit:@"discarded" payload:@{@"url" : tab.url ?: @""}];
}

- (void)tabBecameUnresponsive:(NNCoreTab *)tab {
  [self emit:@"unresponsive" payload:@{}];
}

- (void)tabBecameResponsive:(NNCoreTab *)tab {
  [self emit:@"responsive" payload:@{}];
}

- (void)tab:(NNCoreTab *)tab didChangeMediaAccess:(NSDictionary<NSString *, NSNumber *> *)access {
  [self emit:@"mediaAccess" payload:access ?: @{}];
}

- (void)tab:(NNCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  [self emit:@"externalApp" payload:request ?: @{}];
}

@end

// MARK: - Tabs

namespace {

NSMapTable<NNCoreTab *, NNCoreWebView *> *Views() {
  static NSMapTable *views = [NSMapTable weakToWeakObjectsMapTable];
  return views;
}

NSMutableDictionary<NSString *, NNCoreTab *> *Offered() {
  static NSMutableDictionary *offered = [NSMutableDictionary dictionary];
  return offered;
}

// A tab Chrome opened that the app never adopts (it chose to open the URL fresh, in a private window, say).
constexpr int64_t kOfferSeconds = 30;

}  // namespace

@implementation NNCoreTabs

+ (void)setView:(NNCoreWebView *)view forTab:(NNCoreTab *)tab {
  if (view) [Views() setObject:view forKey:tab];
  else [Views() removeObjectForKey:tab];
}

+ (NNCoreWebView *)viewForTab:(NNCoreTab *)tab {
  return [Views() objectForKey:tab];
}

+ (NSString *)offerTab:(NNCoreTab *)tab {
  return [self offerTab:tab prefix:@"nncore"];
}

+ (NSString *)offerTab:(NNCoreTab *)tab prefix:(NSString *)prefix {
  NSString *adoptId = [NSString stringWithFormat:@"%@:%d", prefix, nncore_host::BrowserId(tab)];
  Offered()[adoptId] = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kOfferSeconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (Offered()[adoptId] != tab) return;
    [Offered() removeObjectForKey:adoptId];
    if (![NNCoreTabs viewForTab:tab]) [tab close];
  });
  return adoptId;
}

+ (NNCoreTab *)takeOffered:(NSString *)adoptId {
  NNCoreTab *tab = Offered()[adoptId];
  if (tab) [Offered() removeObjectForKey:adoptId];
  return tab;
}

+ (void)forget:(NNCoreTab *)tab {
  [Views() removeObjectForKey:tab];
  for (NSString *key in [Offered() allKeysForObject:tab]) [Offered() removeObjectForKey:key];
}

@end

namespace nncore_host {

bool EngineHasTabModel() {
  static const bool has = [NNCoreWindow instancesRespondToSelector:@selector(adoptTab:)];
  return has;
}

namespace {
const void *kBrowserIdKey = &kBrowserIdKey;
NSMapTable<NSNumber *, NNCoreTab *> *TabsById() {
  static NSMapTable *tabs = [NSMapTable strongToWeakObjectsMapTable];
  return tabs;
}
}  // namespace

int BrowserId(NNCoreTab *tab) {
  static int next = 0;
  NSNumber *id_ = objc_getAssociatedObject(tab, kBrowserIdKey);
  if (!id_) {
    id_ = @(++next);
    objc_setAssociatedObject(tab, kBrowserIdKey, id_, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [TabsById() setObject:tab forKey:id_];
  }
  return id_.intValue;
}

NNCoreTab *TabWithBrowserId(int browserId) {
  return [TabsById() objectForKey:@(browserId)];
}

}  // namespace nncore_host
