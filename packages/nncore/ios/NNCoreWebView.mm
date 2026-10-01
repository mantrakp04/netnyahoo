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

namespace {

constexpr CFTimeInterval kTransferWindow = 3;

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
  NSString *_lastFavicon;
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

- (BOOL)discarded {
  return NO;
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
  if ([_adoptId hasPrefix:@"nncore:"]) {
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
  _moving = YES;
  controller.hostChanges++;
  [controller.coreWindow adoptTab:_tab];
  controller.hostChanges--;
  _moving = NO;
  if (_tabIndex >= 0) [self placeTab];
}

- (void)attach:(NNCoreTab *)tab {
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
  if (_pendingURL) {
    [self loadNow:_pendingURL userInitiated:NO];
    _pendingURL = nil;
  }
  [self emit:@"ready" payload:@{@"browserId" : @(nncore_host::BrowserId(tab)), @"tabId" : @(tab.tabId)}];
  [self emitNavigation];
  [self tabDidChangeFavicon:tab];
  if (_tabIndex >= 0) [self placeTab];
  if (_visible) [self activate];
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
  [self detach];
  [tab close];
}

- (void)activate {
  NNCoreWindowController *controller = self.controller;
  if (!_tab || !controller) return;
  controller.hostChanges++;
  [controller.coreWindow activateTab:_tab];
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
  // window.open makes its contents before it navigates them: wait (briefly) for the URL it is going to.
  __weak NNCoreWebView *weakSelf = self;
  __block int tries = 0;
  __block void (^send)(void);
  void (^attempt)(void) = ^{
    NNCoreWebView *view = weakSelf;
    if (!view) return;
    NSString *url = tab.url;
    if (!tab.closed && (!url.length || [url isEqualToString:@"about:blank"]) && tries++ < 20) {
      void (^again)(void) = send;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), again);
      return;
    }
    send = nil;
    [view emit:@"openWindow"
        payload:@{
          @"url" : url ?: @"",
          @"disposition" : disposition,
          @"adoptId" : adoptId,
          @"userGesture" : @YES,
          @"postBody" : @NO,
        }];
  };
  send = attempt;
  attempt();
}

- (void)tabRemovedFromWindow:(NNCoreWindow *)window {
  if (_moving || _closing || !_tab) return;
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
  if (visible) [self activate];
}

- (void)setFrozen:(BOOL)frozen {
  _frozen = frozen;
}

// MARK: Events

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
  [self.delegate webView:self event:name payload:payload];
}

- (void)emitNavigation {
  _navigationQueued = NO;
  if (!_tab) return;
  NSString *theme = [_tab respondsToSelector:@selector(themeColor)] ? _tab.themeColor : nil;
  [self emit:@"navigation"
      payload:@{
        @"url" : _tab.url ?: @"",
        @"title" : _tab.title ?: @"",
        @"canGoBack" : @(_tab.canGoBack),
        @"canGoForward" : @(_tab.canGoForward),
        @"isLoading" : @(_tab.loading),
        @"themeColor" : theme ?: NSNull.null,
        @"themeColorSource" : theme ? @"meta" : NSNull.null,
      }];
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

- (void)tabDidChangeProgress:(NNCoreTab *)tab {
  [self emit:@"progress" payload:@{@"progress" : @(tab.progress)}];
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

- (void)tab:(NNCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json {
  if ([kind isEqualToString:@"hello"]) {
    if ([tab respondsToSelector:@selector(callPage:json:)]) [tab callPage:@"config" json:@"{}"];
  } else if ([kind isEqualToString:@"selection"]) {
    [self emit:@"pageMessage" payload:@{@"kind" : @"selection", @"data" : JSONValue(json) ?: NSNull.null}];
  } else if ([kind isEqualToString:@"pip"]) {
    NSDictionary *d = JSONValue(json);
    if ([d isKindOfClass:NSDictionary.class] && [d[@"active"] isKindOfClass:NSNumber.class])
      [self emit:@"pictureInPicture" payload:@{@"kind" : [d[@"kind"] isEqual:@"document"] ? @"document" : @"video", @"active" : d[@"active"]}];
  }
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
  const BOOL audible = [tab respondsToSelector:@selector(audible)] && tab.audible;
  [self emit:@"media" payload:@{@"playing" : @(audible), @"muted" : @(_muted)}];
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
}

- (void)zoomStep:(NSInteger)direction {
}

- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext {
  [_tab find:text forward:forward];
}

- (void)stopFinding:(BOOL)clearSelection {
  [_tab stopFinding];
}

- (void)print {
}

- (void)showDevTools {
  [_tab showDevTools];
}

- (void)showDevToolsPanel:(NSString *)panel {
  [_tab showDevTools];
}

- (void)runPageCommand:(NSString *)name {
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
  if ([_tab respondsToSelector:@selector(callPage:json:)])
    [_tab callPage:@"media" json:JSONString(@{@"action" : action ?: @"", @"seconds" : @(seconds)})];
}

- (void)requestPictureInPicture:(void (^)(BOOL))completion {
  completion(NO);
}

- (void)exitPictureInPicture {
}

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSString *url = _tab.url ?: @"";
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  NSString *level = [scheme isEqualToString:@"https"] ? @"secure" : [scheme isEqualToString:@"http"] ? @"insecure" : @"local";
  completion(@{@"level" : level, @"url" : url, @"origin" : NSNull.null});
}

- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always {
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
  [self placeTab];
}

- (NSString *)executeExtensionAction:(NSString *)extensionId {
  return nil;
}

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(NSString *)sourceId {
}

- (NSString *)mediaCaptureSourceId {
  return nil;
}

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action {
}

- (void)resolveUnresponsive:(BOOL)terminate {
}

- (BOOL)discard:(BOOL)unload {
  return NO;
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
  NSString *adoptId = [NSString stringWithFormat:@"nncore:%d", nncore_host::BrowserId(tab)];
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
