#import "NNClient.h"

#import "NNChromeUI.h"
#import "NNSiteSettings.h"
#import "NNWindowHost.h"
#import "NNZoom.h"

#include "include/cef_command_ids.h"
#include "include/cef_parser.h"
#if NN_TAB_CAPTURE
#include "include/cef_media_capture.h"
#endif

using namespace nn;

namespace {

class EntriesVisitor : public CefNavigationEntryVisitor {
 public:
  explicit EntriesVisitor(void (^block)(NSArray *)) : block_([block copy]), entries_([NSMutableArray array]) {}
  ~EntriesVisitor() override {
    NSArray *entries = [entries_ copy];
    auto block = block_;
    dispatch_async(dispatch_get_main_queue(), ^{ block(entries); });
  }
  bool Visit(CefRefPtr<CefNavigationEntry> entry, bool current, int index, int total) override {
    [entries_ addObject:@{@"url" : ToNS(entry->GetURL()), @"title" : ToNS(entry->GetTitle()), @"current" : @(current)}];
    return true;
  }

 private:
  void (^block_)(NSArray *);
  NSMutableArray *entries_;
  IMPLEMENT_REFCOUNTING(EntriesVisitor);
};

int gEvalSeq = 0;


// MARK: Tabs moving between windows

constexpr CFTimeInterval kTransferWindow = 3;
NSMutableDictionary<NSString *, NSNumber *> *gTransferRequests;  // Lock transfer history; Chrome callbacks can arrive on any thread.

struct ParkedBrowser {
  CefRefPtr<Client> client;
  CefRefPtr<CefBrowser> browser;
};
std::map<std::string, ParkedBrowser> gParked;

bool TransferRequested(NSString *key) {
  if (!key.length) return false;
  @synchronized(NSNull.null) {
    NSNumber *at = gTransferRequests[key];
    return at && CACurrentMediaTime() - at.doubleValue < kTransferWindow;
  }
}

void TransferDone(NSString *key) {
  @synchronized(NSNull.null) {
    [gTransferRequests removeObjectForKey:key];
  }
}

}

bool nn::TabTransfersPending() {
  if (!gParked.empty()) return true;
  @synchronized(NSNull.null) {
    for (NSNumber *at in gTransferRequests.allValues)
      if (CACurrentMediaTime() - at.doubleValue < kTransferWindow) return true;
  }
  return false;
}

namespace {

// MARK: Closed tabs' history

constexpr NSUInteger kClosedTabStates = 50;
constexpr NSUInteger kClosedTabStateBytes = 32 * 1024 * 1024;
NSMutableArray<NSString *> *gClosedTabOrder;
NSMutableDictionary<NSString *, NSString *> *gClosedTabStates;

void NoteClosedTabState(NSString *key, NSString *state) {
  if (!key.length || !state.length) return;
  if (!gClosedTabStates) {
    gClosedTabStates = [NSMutableDictionary dictionary];
    gClosedTabOrder = [NSMutableArray array];
  }
  [gClosedTabOrder removeObject:key];
  [gClosedTabOrder addObject:key];
  gClosedTabStates[key] = state;
  NSUInteger bytes = 0;
  for (NSString *s in gClosedTabStates.allValues) bytes += s.length;
  while (gClosedTabOrder.count > kClosedTabStates || (bytes > kClosedTabStateBytes && gClosedTabOrder.count > 1)) {
    NSString *oldest = gClosedTabOrder.firstObject;
    bytes -= gClosedTabStates[oldest].length;
    [gClosedTabStates removeObjectForKey:oldest];
    [gClosedTabOrder removeObjectAtIndex:0];
  }
}

NSString *TakeClosedTabState(NSString *key) {
  NSString *state = key.length ? gClosedTabStates[key] : nil;
  if (state) {
    [gClosedTabStates removeObjectForKey:key];
    [gClosedTabOrder removeObject:key];
  }
  return state;
}

bool SamePage(NSString *a, NSString *b) {
  auto strip = [](NSString *url) {
    NSRange hash = [url rangeOfString:@"#"];
    return hash.location == NSNotFound ? url : [url substringToIndex:hash.location];
  };
  return a && b && [strip(a) isEqualToString:strip(b)];
}

NSString *const kPictureInPictureScript =
    @"(async () => {"
     "  const videos = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && !v.disablePictureInPicture);"
     "  videos.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);"
     "  if (!videos.length) return false;"
     "  if (document.pictureInPictureElement === videos[0]) return true;"
     "  try { await videos[0].requestPictureInPicture(); return true; } catch (e) { return false; }"
     "})()";

NSString *const kExitPictureInPictureScript =
    @"document.pictureInPictureElement && document.exitPictureInPicture();"
     "window.documentPictureInPicture && documentPictureInPicture.window && documentPictureInPicture.window.close()";

}

@implementation NNBrowserView {
  CefRefPtr<Client> _client;
  CefRefPtr<CefBrowser> _browser;
  BOOL _creating;
  BOOL _closingByRequest;
  NSString *_pendingURL;
  // The URL a new browser opens with. The page's first loadURL asks for it again, often after the browser
  // exists; loading it twice ran the page twice and, for a tab opened behind, focused it (Client::OnSetFocus).
  NSString *_creatingURL;
  CFTimeInterval _creatingAt;
  NSString *_discardedURL;
  NSString *_transferredURL;
  BOOL _chromeDiscarded;
  BOOL _autoPictureInPictureActive;
  BOOL _muted;
  BOOL _hidePending;
  id _frameObserver;
  NSView *_devtoolsView;
  NSRect _inspectedBounds;
}

+ (void)prepareTransfer:(NSString *)transferKey {
  if (!transferKey.length) return;
  @synchronized(NSNull.null) {
    if (!gTransferRequests) gTransferRequests = [NSMutableDictionary dictionary];
    gTransferRequests[transferKey] = @(CACurrentMediaTime());
  }
}

- (instancetype)initWithFrame:(NSRect)frameRect {
  if ((self = [super initWithFrame:frameRect])) {
    _profile = @"";
    _visible = YES;
    self.wantsLayer = YES;
  }
  return self;
}

- (void)dealloc {
  [self closeBrowser];
  if (_frameObserver) [NSNotificationCenter.defaultCenter removeObserver:_frameObserver];
}

- (BOOL)closingByRequest {
  return _closingByRequest;
}

- (CefRefPtr<Client>)client {
  return _browser ? _client : nullptr;
}

- (BOOL)isFlipped {
  return YES;
}

- (int)browserId {
  return _browser ? _browser->GetIdentifier() : 0;
}

- (int)chromeTabId {
  return _browser ? host::TabId(_browser) : 0;
}

- (BOOL)discarded {
  return _discardedURL != nil || _chromeDiscarded;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (!self.window) return;
  if (_browser) {
    host::TabMoved(self);
    host::LayoutChanged(self.window);
  } else if (!_discardedURL) {
    [self ensureBrowser];
  }
}

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  for (NSView *sub in self.subviews) sub.frame = self.bounds;
  if (_devtoolsView) [self layoutDockedDevTools];
  if (self.window) host::LayoutChanged(self.window);
}

- (NSRect)pageFrame {
  return _devtoolsView ? _inspectedBounds : self.bounds;
}

- (void)layoutDockedDevTools {
#if NN_DOCKED_DEVTOOLS
  NSView *page = _browser ? host::ContentsView(_browser) : nil;
  CefRect bounds;
  NSView *devtools =
      _browser && host::IsChromeTab(_browser)
          ? (__bridge NSView *)_browser->GetHost()->GetDockedDevTools(
                CefSize((int)NSWidth(self.bounds), (int)NSHeight(self.bounds)), bounds)
          : nil;
  if (!devtools && !_devtoolsView) return;
  if (_devtoolsView && _devtoolsView != devtools && _devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = devtools;
  if (devtools) {
    if (devtools.superview != self || (page && [self.subviews indexOfObject:devtools] > [self.subviews indexOfObject:page])) {
      [devtools removeFromSuperview];
      if (page.superview == self) [self addSubview:devtools positioned:NSWindowBelow relativeTo:page];
      else [self addSubview:devtools];
    }
    devtools.frame = self.bounds;
    devtools.hidden = !self.paints;
    _inspectedBounds = NSMakeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  if (page.superview == self) {
    page.frame = self.pageFrame;
    page.hidden = !self.paints || (devtools && NSIsEmptyRect(page.frame));
  }
#endif
}

- (void)dropDockedDevTools {
  if (_devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = nil;
}

- (void)setFrameOrigin:(NSPoint)newOrigin {
  [super setFrameOrigin:newOrigin];
  if (self.window) host::LayoutChanged(self.window);
}

- (void)ensureBrowser {
  if (_browser || _creating || ![NNCef isStarted]) return;
  if (TransferRequested(_transferKey) && [self takeTransferredBrowser]) return;
  _creating = YES;
  _closingByRequest = NO;

  if (_adoptId.length) {
    auto it = Popups().find(_adoptId.UTF8String);
    if (it != Popups().end()) {
      if (it->second.browser) {
        CefRefPtr<Client> client = it->second.client;
        CefRefPtr<CefBrowser> browser = it->second.browser;
        Popups().erase(it);
        client->SetView(self);
        _client = client;
        [self browserCreated:browser];
      } else {
        it->second.adopter = self;
        _client = it->second.client;
      }
      return;
    }
    if ([self createTabWithHistory]) return;
  }

  _client = new Client(self, _profile);
  NSString *url = _pendingURL ?: _initialURL;
  _pendingURL = nil;
  _creatingURL = url;
  _creatingAt = CACurrentMediaTime();
  host::CreateTab(self, _client, url.length ? url : @"about:blank", [self browserSettings]);
}

- (CefBrowserSettings)browserSettings {
  CefBrowserSettings settings;
  NSColor *bg = [_pageBackgroundColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  if (bg) {
    settings.background_color = CefColorSetARGB(255, (int)round(bg.redComponent * 255), (int)round(bg.greenComponent * 255),
                                                (int)round(bg.blueComponent * 255));
  }
  return settings;
}

- (BOOL)createTabWithHistory {
  NSRange colon = [_adoptId rangeOfString:@":"];
  if (colon.location == NSNotFound) return NO;
  NSString *kind = [_adoptId substringToIndex:colon.location], *key = [_adoptId substringFromIndex:NSMaxRange(colon)];
  CefRefPtr<CefBrowser> source;
  NSString *state = nil;
  if ([kind isEqualToString:@"clone"]) {
    for (NNBrowserView *view in LiveViews())
      if (view != self && [view.transferKey isEqualToString:key] && view.client) source = view.client->Browser();
  } else if ([kind isEqualToString:@"restore"]) {
    state = TakeClosedTabState(key);
  } else {
    return NO;
  }
  _client = new Client(self, _profile);
  NSString *url = _pendingURL ?: _initialURL;
  _pendingURL = nil;
  if (!host::CreateTabWithHistory(self, _client, source, state, url.length ? url : @"about:blank", [self browserSettings])) {
    _client = nullptr;
    _pendingURL = url == _initialURL ? nil : url;
    return NO;
  }
  _adoptId = nil;
  return YES;
}

- (BOOL)takeTransferredBrowser {
  CefRefPtr<Client> client;
  CefRefPtr<CefBrowser> browser;
  auto parked = gParked.find(_transferKey.UTF8String);
  if (parked != gParked.end()) {
    client = parked->second.client;
    browser = parked->second.browser;
    gParked.erase(parked);
  } else {
    for (NNBrowserView *other in LiveViews()) {
      if (other == self || ![other.transferKey isEqualToString:_transferKey] || other.window == self.window) continue;
      client = other.client;
      browser = client ? client->Browser() : nullptr;
      if (browser) [other relinquishBrowser];
      break;
    }
  }
  if (!client || !browser) return NO;
  TransferDone(_transferKey);
  _adoptId = nil;
  _closingByRequest = NO;
  _transferredURL = client->URL();
  if (SamePage(_pendingURL, _transferredURL)) _pendingURL = nil;
  client->SetView(self);
  _client = client;
  [self browserCreated:browser];
  return YES;
}

- (void)relinquishBrowser {
  if (!_browser) return;
  [self keepPageFrame:nil];
  [self dropDockedDevTools];
  NSView *browserView = host::ContentsView(_browser);
  if (browserView.superview == self) [browserView removeFromSuperview];
  if (_client && _client->View() == self) _client->SetView(nil);
  _browser = nullptr;
  _client = nullptr;
  _creating = NO;
}

- (void)parkBrowserForTransfer {
  [self keepPageFrame:nil];
  [self dropDockedDevTools];
  std::string key = _transferKey.UTF8String;
  CefRefPtr<Client> client = _client;
  CefRefPtr<CefBrowser> browser = _browser;
  NSView *browserView = host::ContentsView(browser);
  [ParkingView() addSubview:browserView];
  client->SetView(nil);
  _browser = nullptr;
  _client = nullptr;
  _creating = NO;
  gParked[key] = {client, browser};
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kTransferWindow * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    auto it = gParked.find(key);
    if (it == gParked.end() || !it->second.browser->IsSame(browser)) return;
    gParked.erase(it);
    client->closingByEngine_ = true;
    browser->GetHost()->CloseBrowser(true);
  });
}

- (void)browserCreated:(CefRefPtr<CefBrowser>)browser {
  _browser = browser;
  _creating = NO;
  _frozen = NO;
  RegisterView(self);
  NSView *browserView = host::ContentsView(browser);
  if (browserView && browserView.superview != self) {
    [browserView removeFromSuperview];
    [self addSubview:browserView];
  }
  browserView.frame = NSInsetRect(self.bounds, 0, 1);
  browserView.frame = self.bounds;
  browserView.hidden = !self.paints;
  [self keepPageFrame:browserView];
  if (_muted) _client->SetUserMuted(true);
#if NN_TAB_DISCARD
  _chromeDiscarded = host::IsChromeTab(browser) && browser->GetHost()->IsTabDiscarded();
#endif
  browser->GetHost()->WasResized();
  if (_pendingURL) {
    browser->GetMainFrame()->LoadURL(ToCef(_pendingURL));
    _pendingURL = nil;
  }
  _client->EmitNavigation();
  [self emit:@"ready" payload:@{@"browserId" : @(browser->GetIdentifier()), @"tabId" : @(host::TabId(browser))}];
  host::TabMoved(self);
  if (_visible) host::TabShown(self);
  host::LayoutChanged(self.window);
  [self layoutDockedDevTools];
}

- (void)keepPageFrame:(NSView *)pageView {
  if (_frameObserver) [NSNotificationCenter.defaultCenter removeObserver:_frameObserver];
  _frameObserver = nil;
  if (!pageView || !host::IsChromeTab(_browser)) return;
  pageView.postsFrameChangedNotifications = YES;
  __weak NNBrowserView *weakSelf = self;
  __weak NSView *weakPage = pageView;
  _frameObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSViewFrameDidChangeNotification
                                                                   object:pageView
                                                                    queue:nil
                                                               usingBlock:^(NSNotification *) {
    NNBrowserView *view = weakSelf;
    NSView *page = weakPage;
    if (!view || page.superview != view || NSEqualRects(page.frame, view.pageFrame)) return;
// Run after Chrome finishes laying out the hosted page.
    dispatch_async(dispatch_get_main_queue(), ^{
      if (page.superview == view && !NSEqualRects(page.frame, view.pageFrame)) page.frame = view.pageFrame;
    });
  }];
}

// The popup this view was to adopt was never made (OnBeforePopupAborted): open the page in a browser of its own.
- (void)adoptionFailed {
  if (_browser || !_adoptId.length) return;
  _adoptId = nil;
  _creating = NO;
  _client = nullptr;
  if (self.window) [self ensureBrowser];
}

- (void)browserClosed {
  [self keepPageFrame:nil];
  [self dropDockedDevTools];
  _chromeDiscarded = NO;
  _browser = nullptr;
  _creating = NO;
  _creatingURL = nil;
}

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
  [self.delegate browserView:self event:name payload:payload];
}

- (BOOL)paints {
  return _visible || _warm;
}

// Delay hiding until painting updates settle to avoid a blank frame.
- (void)applyPainting {
  self.alphaValue = _visible || !_warm ? 1 : 0;
  if (!self.paints) {
    if (_hidePending) return;
    _hidePending = YES;
    __weak NNBrowserView *weakSelf = self;
    CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{
      NNBrowserView *view = weakSelf;
      if (!view) return;
      view->_hidePending = NO;
      if (!view.paints) [view showPage:NO];
    });
    CFRunLoopWakeUp(CFRunLoopGetMain());
    return;
  }
  if (_frozen) self.frozen = NO;
  [self showPage:YES];
}

- (void)showPage:(BOOL)shown {
  for (NSView *sub in self.subviews) sub.hidden = !shown;
  if (_devtoolsView) [self layoutDockedDevTools];
}

- (void)setWarm:(BOOL)warm {
  if (_warm == warm) return;
  _warm = warm;
  [self applyPainting];
}

- (void)setVisible:(BOOL)visible {
  if (_visible == visible) return;
  _visible = visible;
  // Switching away from a full-screen page takes it out of full screen, as in Chrome.
  if (!visible && _browser && _client->Fullscreen()) _browser->GetHost()->ExitFullscreen(true);
  [self applyPainting];
  if (visible) host::TabShown(self);
  if (self.window) host::LayoutChanged(self.window);
  if (visible && _discardedURL && self.window) {
    _pendingURL = _pendingURL ?: _discardedURL;
    _discardedURL = nil;
    [self ensureBrowser];
  }
  [self updateAutoPictureInPicture];
}

- (void)setAutoPictureInPicture:(BOOL)autoPictureInPicture {
  _autoPictureInPicture = autoPictureInPicture;
  [self updateAutoPictureInPicture];
}

- (void)updateAutoPictureInPicture {
  if (!_browser) return;
  if (!_visible && _autoPictureInPicture) {
    if (_client->WantsDocumentPictureInPicture()) {
      _autoPictureInPictureActive = YES;
// Grant a user gesture before requesting Document PiP.
      CefRefPtr<Client> client = _client;
      EvaluateWithGesture(_browser, @"0", ^(id) { client->MediaCommand(@"enterpictureinpicture", 0); });
    } else if (_client->PlayingVideo()) {
      _autoPictureInPictureActive = YES;
      EvaluateWithGesture(_browser, kPictureInPictureScript, nil);
    }
  } else if (_visible && _autoPictureInPictureActive) {
    _autoPictureInPictureActive = NO;
    [self exitPictureInPicture];
  }
}

- (void)setAdoptId:(NSString *)adoptId {
  _adoptId = [adoptId copy];
  if (self.window) [self ensureBrowser];
}

// MARK: Commands

- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated {
  if (userInitiated) AllowUserNavigation(url);
  [self loadURL:url];
}

- (void)loadURL:(NSString *)url {
  if (!url.length) return;
  NSString *transferred = _transferredURL;
  _transferredURL = nil;
  NSString *creating = _creatingURL;
  _creatingURL = nil;
  if (_browser && SamePage(url, transferred)) return;
  // Only the page's own first request, which follows the view's creation at once (not a revived tab's later one).
  if ((_browser || _creating) && [url isEqualToString:creating] && CACurrentMediaTime() - _creatingAt < 2) return;
  if (_browser) {
    _browser->GetMainFrame()->LoadURL(ToCef(url));
  } else {
    _pendingURL = url;
    _discardedURL = nil;
    if (self.window) [self ensureBrowser];
  }
}

- (void)goBack {
  if (_browser) _browser->GoBack();
}
- (void)goForward {
  if (_browser) _browser->GoForward();
}
- (void)goToHistoryOffset:(NSInteger)offset {
  if (_browser) _browser->GetMainFrame()->ExecuteJavaScript(ToCef([NSString stringWithFormat:@"history.go(%ld)", (long)offset]), "", 0);
}
- (void)reload {
  if (_browser) _browser->Reload();
}
- (void)reloadIgnoringCache {
  if (_browser) _browser->ReloadIgnoreCache();
}
- (void)stopLoading {
  if (_browser) _browser->StopLoad();
}

- (void)focusPage {
  if (!_browser) return;
  host::TabShown(self);
  NSView *browserView = host::ContentsView(_browser);
  if (browserView) [self.window makeFirstResponder:browserView];
  _browser->GetHost()->SetFocus(true);
}

- (void)setMuted:(BOOL)muted {
  _muted = muted;
  if (_client) _client->SetUserMuted(muted);
}

- (void)setZoomFactor:(double)factor {
  if (!_browser || factor <= 0) return;
  _browser->GetHost()->SetZoomLevel(fabs(factor - 1) < 0.001 ? 0 : zoom::LevelForFactor(factor));
  zoom::Changed(_profile, HostOf(_client->URL()));
}

- (void)zoomStep:(NSInteger)direction {
  if (!_browser) return;
  _browser->GetHost()->Zoom(direction > 0 ? CEF_ZOOM_COMMAND_IN : direction < 0 ? CEF_ZOOM_COMMAND_OUT : CEF_ZOOM_COMMAND_RESET);
  zoom::Changed(_profile, HostOf(_client->URL()));
}

- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext {
  if (!_browser) return;
  if (!text.length) {
    _browser->GetHost()->StopFinding(true);
    return;
  }
  _browser->GetHost()->Find(ToCef(text), forward, false, findNext);
}

- (void)stopFinding:(BOOL)clearSelection {
  if (_browser) _browser->GetHost()->StopFinding(clearSelection);
}

- (void)print {
  if (_browser) _browser->GetHost()->Print();
}

- (void)showDevTools {
  [self showDevToolsPanel:nil];
}

- (void)showDevToolsPanel:(NSString *)panel {
  if (!_browser) return;
#if NN_CHROME_TABS
  if (host::IsChromeTab(_browser)) {
    if ([panel isEqualToString:@"toggle"] && nn::CloseKeyDevToolsWindow()) return;
    int command = [panel isEqualToString:@"console"]   ? IDC_DEV_TOOLS_CONSOLE
                  : [panel isEqualToString:@"inspect"] ? IDC_DEV_TOOLS_INSPECT
                  : [panel isEqualToString:@"toggle"]  ? IDC_DEV_TOOLS_TOGGLE
                                                       : IDC_DEV_TOOLS;
    _browser->GetHost()->ActivateTab();
    _browser->GetHost()->ExecuteChromeCommand(command, CEF_WOD_CURRENT_TAB);
    return;
  }
#endif
  if ([panel isEqualToString:@"toggle"]) {
    if (nn::CloseKeyDevToolsWindow()) return;
    panel = nil;
  }
  nn::ShowDevTools(_browser, [panel isEqualToString:@"inspect"] ? @"elements" : panel);
}

- (void)runPageCommand:(NSString *)name {
#if NN_CHROME_TABS
  int command = [name isEqualToString:@"savePage"]        ? IDC_SAVE_PAGE
                : [name isEqualToString:@"systemPrint"]   ? IDC_BASIC_PRINT
                : [name isEqualToString:@"caretBrowsing"] ? IDC_CARET_BROWSING_TOGGLE
                                                          : 0;
  if (!command || !_browser || !host::IsChromeTab(_browser)) return;
  _browser->GetHost()->ActivateTab();
  _browser->GetHost()->ExecuteChromeCommand(command, CEF_WOD_CURRENT_TAB);
#endif
}

- (void)executeJavaScript:(NSString *)code {
  if (_browser) _browser->GetMainFrame()->ExecuteJavaScript(ToCef(code), "", 0);
}

- (void)evaluate:(NSString *)code completion:(void (^)(NSString *))completion {
  if (!_browser) {
    completion(nil);
    return;
  }
  int id = ++gEvalSeq;
  _client->AddEval(id, completion);
  CefRefPtr<CefProcessMessage> message = CefProcessMessage::Create("nn-eval");
  message->GetArgumentList()->SetInt(0, id);
  message->GetArgumentList()->SetString(1, ToCef(code));
  _browser->GetMainFrame()->SendProcessMessage(PID_RENDERER, message);
}

- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  if (!_browser) {
    completion(@[]);
    return;
  }
  _browser->GetHost()->GetNavigationEntries(new EntriesVisitor(completion), false);
}

- (void)downloadFavicon:(NSString *)url name:(NSString *)name completion:(void (^)(NSDictionary *))completion {
  if (!_browser) return completion(nil);
  DownloadFavicon(_browser, url, name, completion);
}

- (void)downloadImage:(NSString *)url maxPixels:(NSInteger)maxPixels completion:(void (^)(NSDictionary *))completion {
  if (!_browser) return completion(nil);
  DownloadImage(_browser, url, (int)maxPixels, completion);
}

// MARK: Media

- (void)mediaCommand:(NSString *)action seconds:(double)seconds {
  if (_client) _client->MediaCommand(action, seconds);
}

- (void)requestPictureInPicture:(void (^)(BOOL))completion {
  if (!_browser) {
    if (completion) completion(NO);
    return;
  }
  EvaluateWithGesture(_browser, kPictureInPictureScript, ^(id value) {
    if (completion) completion([value isKindOfClass:NSNumber.class] && [value boolValue]);
  });
}

- (void)exitPictureInPicture {
  if (_browser) EvaluateWithGesture(_browser, kExitPictureInPictureScript, nil);
}

// MARK: Site controls

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *))completion {
  completion(_browser ? site::SecurityInfo(_browser) : @{@"level" : @"none"});
}

- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always {
  if (_browser) site::OpenBlockedPopup(_browser, popupId, always, _profile);
}

- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSString *origin = _client ? OriginOf(_client->URL()) : nil;
  if (!origin) {
    completion(@{@"cookies" : @NO, @"storage" : @NO});
    return;
  }
  [NNSiteSettings clearSiteDataForProfile:_profile origin:origin completion:completion];
}

// MARK: Chrome UI surfaces

- (void)resolvePasswordPrompt:(NSString *)action username:(NSString *)username password:(NSString *)password {
  if (_browser) chromeui::ResolvePasswordPrompt(_browser, action, username, password);
}

- (void)setTabStripIndex:(NSInteger)index pinned:(BOOL)pinned {
#if NN_TAB_STRIP
  if (!host::IsChromeTab(_browser)) return;
  _browser->GetHost()->SetTabPinned(pinned);
  _browser->GetHost()->SetTabIndex((int)index);
#endif
}

- (NSString *)executeExtensionAction:(NSString *)extensionId {
  return _browser ? chromeui::ExecuteExtensionAction(_browser, extensionId) : nil;
}

// MARK: Screen sharing

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(NSString *)sourceId {
  if (_client) _client->ResolveDisplayMedia(requestId, sourceId);
}

- (NSString *)mediaCaptureSourceId {
#if NN_TAB_CAPTURE
  NSString *sourceId = _browser ? ToNS(CefGetMediaCaptureSourceId(_browser)) : nil;
  return sourceId.length ? sourceId : nil;
#else
  return nil;
#endif
}

// MARK: Notifications

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action {
  if (_client) _client->NotificationAction(notificationId, action);
}

// MARK: Lifecycle

- (void)resolveUnresponsive:(BOOL)terminate {
  if (!_browser) return;
  CefRefPtr<CefUnresponsiveProcessCallback> callback = site::UnresponsiveCallback(_browser->GetIdentifier());
  if (!callback) return;
  site::SetUnresponsiveCallback(_browser->GetIdentifier(), nullptr);
  if (terminate) callback->Terminate();
  else callback->Wait();
}

- (void)setFrozen:(BOOL)frozen {
  if (frozen == _frozen || (frozen && self.paints)) return;
  _frozen = frozen;
  if (_browser) DevToolsCall(_browser, @"Page.setWebLifecycleState", @{@"state" : frozen ? @"frozen" : @"active"}, nil);
}

- (BOOL)discard:(BOOL)unload {
  if (!_browser || _discardedURL) return _discardedURL != nil;
#if NN_TAB_DISCARD
  if (!unload && host::IsChromeTab(_browser)) {
    if (!_chromeDiscarded) _browser->GetHost()->DiscardTab();
    return NO;
  }
#endif
  NSString *url = _client->URL();
  [self closeBrowser];
  _discardedURL = url.length ? url : @"about:blank";
  [self emit:@"discarded" payload:@{@"url" : _discardedURL}];
  return YES;
}

- (void)tabDiscardedChanged:(BOOL)discarded {
  if (_chromeDiscarded == discarded) return;
  _chromeDiscarded = discarded;
  _frozen = NO;
  if (discarded) [self emit:@"discarded" payload:@{@"url" : _client ? _client->URL() : @""}];
  else if (_browser) [self emit:@"ready" payload:@{@"browserId" : @(_browser->GetIdentifier()), @"tabId" : @(host::TabId(_browser))}];
}

- (void)closeBrowser {
  if (_adoptId.length && !_browser) {
    auto it = Popups().find(_adoptId.UTF8String);
    if (it != Popups().end()) {
      if (it->second.browser) it->second.browser->GetHost()->CloseBrowser(true);
      Popups().erase(it);
    }
  }
  _adoptId = nil;
  if (_browser && TransferRequested(_transferKey)) return [self parkBrowserForTransfer];
#if NN_TAB_HISTORY
  if (_browser && host::IsChromeTab(_browser) && !ShuttingDown())
    NoteClosedTabState(_transferKey, ToNS(_browser->GetHost()->GetNavigationState()));
#endif
  if (_browser) {
    _closingByRequest = YES;
    host::NoteClosingTab(_browser);
    _browser->GetHost()->CloseBrowser(true);
    _browser = nullptr;
  }
  _creating = NO;
  _frozen = NO;
  if (_client) _client->SetView(nil);
  _client = nullptr;
}

@end
