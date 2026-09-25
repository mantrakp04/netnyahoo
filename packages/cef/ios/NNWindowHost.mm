#import "NNWindowHost.h"

#import "NNChromePages.h"
#import "NNClient.h"
#import "NNExtensionsInternal.h"

#include <algorithm>
#include <map>
#include <mutex>
#include <vector>

#include "include/cef_command_handler.h"
#include "include/cef_command_ids.h"
#include "include/views/cef_box_layout.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"

using namespace nn;

/// Selectors of Chromium's NativeWidgetMacNSWindow (components/remote_cocoa).
@protocol NNChromiumWindow
- (void)setActivationIndependence:(BOOL)independence;
- (void)setPreventKeyWindow:(BOOL)prevent;
@end

namespace nn {

void MakeWindowInert(NSWindow *window) {
  if (!window) return;
  window.alphaValue = 0;
  window.ignoresMouseEvents = YES;
  window.excludedFromWindowsMenu = YES;
  window.hasShadow = NO;
  // Chrome activates the app when it shows or focuses a Browser window; these
  // keep that from ever taking focus from the user: no [NSApp activate…], never key.
  if ([window respondsToSelector:@selector(setActivationIndependence:)])
    [(id<NNChromiumWindow>)window setActivationIndependence:YES];
  if ([window respondsToSelector:@selector(setPreventKeyWindow:)]) [(id<NNChromiumWindow>)window setPreventKeyWindow:YES];
}

}  // namespace nn

namespace {

class Ghost;
std::vector<CefRefPtr<Ghost>> gGhosts;
/// Browser id → the ghost whose Browser holds that Chrome tab (checked against gGhosts).
std::map<int, Ghost *> gTabGhost;
/// The ghost CreateTabInBrowser is adding a tab to (the tab's OnAfterCreated runs inside it).
Ghost *gCreatingIn = nullptr;

Ghost *GhostFor(NSWindow *window, NSString *profile);
Ghost *GhostOf(CefRefPtr<CefBrowser> browser);
bool Live(Ghost *ghost);

/// NNBrowserViews of `window`, the visible ones first.
NSArray<NNBrowserView *> *ViewsIn(NSWindow *window) {
  NSMutableArray *visible = [NSMutableArray array], *hidden = [NSMutableArray array];
  for (NNBrowserView *view in LiveViews())
    if (view.window == window) [view.visible ? visible : hidden addObject:view];
  return [visible arrayByAddingObjectsFromArray:hidden];
}

// MARK: - Chrome-created tabs
//
// Every tab of a Browser CEF created gets the client of its first tab (the
// ghost's first tab, below) when Chrome made it itself: extensions' tabs.create,
// session restore, "reopen closed tab"… The router gives each such tab its own
// Client, hands it to the app like a popup (an openWindow event with an adoptId)
// and forwards the tab's events to that Client.
//
// The first tab is either one of ours (with Chrome tabs: the view that made the
// ghost; the router forwards to its Client too) or a placeholder about:blank
// "anchor" that only keeps the Browser alive (stock CEF, where our tabs are
// Alloy browsers outside it, and briefly while a moved tab founds a ghost).

class TabRouter : public CefClient,
                  public CefLifeSpanHandler,
                  public CefDisplayHandler,
                  public CefLoadHandler,
                  public CefRequestHandler,
                  public CefDownloadHandler,
                  public CefFindHandler,
                  public CefPermissionHandler,
                  public CefContextMenuHandler,
                  public CefFocusHandler,
                  public CefKeyboardHandler,
                  public CefCommandHandler {
 public:
  TabRouter(Ghost *ghost, NSString *profile) : ghost_(ghost), profile_([profile copy]) {}
  void Detach() { ghost_ = nullptr; }
  /// The placeholder first tab, if the Browser was made with one.
  CefRefPtr<CefBrowser> Anchor() const { return anchor_; }
  /// The first tab will be `client`'s (the view that made the ghost) instead of a placeholder.
  void SetFounder(CefRefPtr<Client> client) { founder_ = client; }
  /// Any tab the router knows (its own and the founder's) still in its Browser, for
  /// CreateTabInBrowser & co. (Tabs keep their router when they move to another window.)
  CefRefPtr<CefBrowser> AnyTab();

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefFindHandler> GetFindHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
  CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override { return this; }
  CefRefPtr<CefFocusHandler> GetFocusHandler() override { return this; }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }
  CefRefPtr<CefCommandHandler> GetCommandHandler() override { return this; }

  // Lifespan: the first browser is the founder's tab or the anchor; any other is a tab Chrome made.
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override {
    if (Client *c = Tab(browser)) return c->DoClose(browser);
    return false;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    if (Client *c = Tab(browser)) c->OnBeforeClose(browser);
    std::lock_guard<std::mutex> lock(mutex_);
    tabs_.erase(browser->GetIdentifier());
    if (anchor_ && anchor_->IsSame(browser)) anchor_ = nullptr;
    BrowserClosed(browser);
  }
#if NN_TAB_STRIP
  void OnTabStripChanged(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) override {
    if (Client *c = Tab(browser)) c->OnTabStripChanged(browser, index, active, pinned);
  }
#endif
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id, const CefString &url,
                     const CefString &name, cef_window_open_disposition_t disposition, bool gesture,
                     const CefPopupFeatures &features, CefWindowInfo &info, CefRefPtr<CefClient> &client,
                     CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra, bool *no_js) override {
    if (Client *c = Tab(browser))
      return c->OnBeforePopup(browser, frame, popup_id, url, name, disposition, gesture, features, info, client, settings,
                              extra, no_js);
    return true;  // the anchor opens nothing
  }

#define NN_FORWARD(call) \
  if (Client *c = Tab(browser)) c->call;
#define NN_FORWARD_RETURN(call, fallback) \
  if (Client *c = Tab(browser)) return c->call; \
  return fallback;

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source,
                                CefRefPtr<CefProcessMessage> message) override {
    NN_FORWARD_RETURN(OnProcessMessageReceived(browser, frame, source, message), false)
  }
  void OnAddressChange(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &url) override {
    NN_FORWARD(OnAddressChange(browser, frame, url))
  }
  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString &title) override {
    NN_FORWARD(OnTitleChange(browser, title))
  }
  void OnFaviconURLChange(CefRefPtr<CefBrowser> browser, const std::vector<CefString> &urls) override {
    NN_FORWARD(OnFaviconURLChange(browser, urls))
  }
  void OnFullscreenModeChange(CefRefPtr<CefBrowser> browser, bool fullscreen) override {
    NN_FORWARD(OnFullscreenModeChange(browser, fullscreen))
  }
  void OnStatusMessage(CefRefPtr<CefBrowser> browser, const CefString &value) override {
    NN_FORWARD(OnStatusMessage(browser, value))
  }
  void OnLoadingProgressChange(CefRefPtr<CefBrowser> browser, double progress) override {
    NN_FORWARD(OnLoadingProgressChange(browser, progress))
  }
  void OnMediaAccessChange(CefRefPtr<CefBrowser> browser, bool video, bool audio) override {
    NN_FORWARD(OnMediaAccessChange(browser, video, audio))
  }
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool loading, bool back, bool forward) override {
    NN_FORWARD(OnLoadingStateChange(browser, loading, back, forward))
  }
  void OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, TransitionType transition) override {
    NN_FORWARD(OnLoadStart(browser, frame, transition))
  }
  void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode code, const CefString &text,
                   const CefString &url) override {
    NN_FORWARD(OnLoadError(browser, frame, code, text, url))
  }
  bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request,
                      bool gesture, bool redirect) override {
    NN_FORWARD_RETURN(OnBeforeBrowse(browser, frame, request, gesture, redirect), false)
  }
  bool OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &url,
                        cef_window_open_disposition_t disposition, bool gesture) override {
    NN_FORWARD_RETURN(OnOpenURLFromTab(browser, frame, url, disposition, gesture), false)
  }
  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(CefRefPtr<CefBrowser> browser,
                                                                 CefRefPtr<CefFrame> frame,
                                                                 CefRefPtr<CefRequest> request, bool navigation,
                                                                 bool download, const CefString &initiator,
                                                                 bool &disable_default) override {
    // IO thread.
    NN_FORWARD_RETURN(GetResourceRequestHandler(browser, frame, request, navigation, download, initiator, disable_default),
                      nullptr)
  }
  bool OnRenderProcessUnresponsive(CefRefPtr<CefBrowser> browser,
                                   CefRefPtr<CefUnresponsiveProcessCallback> callback) override {
    NN_FORWARD_RETURN(OnRenderProcessUnresponsive(browser, callback), false)
  }
  void OnRenderProcessResponsive(CefRefPtr<CefBrowser> browser) override { NN_FORWARD(OnRenderProcessResponsive(browser)) }
  void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status, int code,
                                 const CefString &text) override {
    NN_FORWARD(OnRenderProcessTerminated(browser, status, code, text))
  }
  bool OnCertificateError(CefRefPtr<CefBrowser> browser, cef_errorcode_t error, const CefString &url,
                          CefRefPtr<CefSSLInfo> info, CefRefPtr<CefCallback> callback) override {
    NN_FORWARD_RETURN(OnCertificateError(browser, error, url, info, callback), false)
  }
  bool OnBeforeDownload(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item, const CefString &name,
                        CefRefPtr<CefBeforeDownloadCallback> callback) override {
    if (Client *c = Tab(browser)) return c->OnBeforeDownload(browser, item, name, callback);
    return nn::OnBeforeDownload(item, name, callback);
  }
  void OnDownloadUpdated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                         CefRefPtr<CefDownloadItemCallback> callback) override {
    if (Client *c = Tab(browser)) return c->OnDownloadUpdated(browser, item, callback);
    nn::OnDownloadUpdated(item, callback, profile_);
  }
  void OnFindResult(CefRefPtr<CefBrowser> browser, int identifier, int count, const CefRect &rect, int active,
                    bool final) override {
    NN_FORWARD(OnFindResult(browser, identifier, count, rect, active, final))
  }
  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &origin,
                                      uint32_t permissions, CefRefPtr<CefMediaAccessCallback> callback) override {
    NN_FORWARD_RETURN(OnRequestMediaAccessPermission(browser, frame, origin, permissions, callback), false)
  }
  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id, const CefString &origin,
                              uint32_t permissions, CefRefPtr<CefPermissionPromptCallback> callback) override {
    NN_FORWARD_RETURN(OnShowPermissionPrompt(browser, prompt_id, origin, permissions, callback), false)
  }
  void OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                           CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) override {
    NN_FORWARD(OnBeforeContextMenu(browser, frame, params, model))
  }
  bool OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefContextMenuParams> params, int command, cef_event_flags_t flags) override {
    NN_FORWARD_RETURN(OnContextMenuCommand(browser, frame, params, command, flags), false)
  }
  void OnGotFocus(CefRefPtr<CefBrowser> browser) override { NN_FORWARD(OnGotFocus(browser)) }
  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                     bool *is_keyboard_shortcut) override {
    NN_FORWARD_RETURN(OnPreKeyEvent(browser, event, os_event, is_keyboard_shortcut), false)
  }
  bool OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) override {
    NN_FORWARD_RETURN(OnKeyEvent(browser, event, os_event), false)
  }
  bool OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) override {
    NN_FORWARD_RETURN(OnChromeCommand(browser, command_id, disposition), false)
  }
#undef NN_FORWARD
#undef NN_FORWARD_RETURN

 private:
  Client *Tab(CefRefPtr<CefBrowser> browser) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = tabs_.find(browser->GetIdentifier());
    return it == tabs_.end() ? nullptr : it->second.get();
  }
  void AddTab(int browserId, CefRefPtr<Client> client) {
    std::lock_guard<std::mutex> lock(mutex_);
    tabs_[browserId] = client;
  }

  Ghost *ghost_;
  NSString *profile_;
  CefRefPtr<Client> founder_;
  CefRefPtr<CefBrowser> anchor_;
  bool anchored_ = false;
  std::map<int, CefRefPtr<Client>> tabs_;  // read on the IO thread too
  std::mutex mutex_;
  IMPLEMENT_REFCOUNTING(TabRouter);
};

// MARK: - Ghost

class Ghost : public CefWindowDelegate, public CefBrowserViewDelegate {
 public:
  Ghost(NSWindow *parent, NSString *profile) : parent_(parent), profile_([profile copy]) {}

  NSWindow *Parent() const { return parent_; }
  NSString *Profile() const { return profile_; }
  NSWindow *Window() const { return window_ ? ((__bridge NSView *)window_->GetWindowHandle()).window : nil; }
  CefRefPtr<CefBrowser> Anchor() const { return router_ ? router_->Anchor() : nullptr; }
  bool Closed() const { return closing_; }

  /// Creates the Browser. Its first tab is `founder`'s (a view's tab, loading `url` with
  /// `settings`), or a placeholder anchor without one.
  void Start(CefRefPtr<Client> founder = nullptr, NSString *url = nil, const CefBrowserSettings *settings = nullptr) {
    router_ = new TabRouter(this, profile_);
    if (founder) router_->SetFounder(founder);
    CefBrowserSettings browserSettings = settings ? *settings : CefBrowserSettings();
    NSString *firstURL = founder && url.length ? url : @"about:blank";
    CefRefPtr<Ghost> self(this);
    pages::WhenProfileReady(profile_, ^(CefRefPtr<CefRequestContext> context) {
      if (self->closing_ || !self->parent_) return;
      CefBrowserSettings first = browserSettings;
#if NN_CHROME_TABS
      // A normal (tabbed) Browser whose tabs we host in our views.
      first.native_contents_hosting = STATE_ENABLED;
#endif
      self->view_ = CefBrowserView::CreateBrowserView(self->router_, ToCef(firstURL), first, nullptr, context, self.get());
      self->window_ = CefWindow::CreateTopLevelWindow(self.get());
    });
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    auto observe = [&](NSNotificationName name, void (^block)(void)) {
      [observers_ addObject:[center addObserverForName:name object:parent_ queue:nil usingBlock:^(NSNotification *) { block(); }]];
    };
    observers_ = [NSMutableArray array];
    for (NSNotificationName name in @[
           NSWindowDidResizeNotification, NSWindowDidMoveNotification, NSWindowDidEndLiveResizeNotification,
           NSWindowDidChangeScreenNotification, NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification,
           NSWindowDidDeminiaturizeNotification, NSWindowDidChangeOcclusionStateNotification
         ])
      observe(name, ^{ self->Align(); });
    observe(NSWindowWillCloseNotification, ^{ self->Close(); });
    observe(NSWindowDidBecomeKeyNotification, ^{ self->SetActive(true); });
    observe(NSWindowDidResignKeyNotification, ^{ self->SetActive(false); });
  }

  /// The Browser has its first tab: queued work (more tabs, moves) can run.
  void FirstTabCreated() {
    // OnAfterCreated runs before Chrome puts the tab in its tab strip: the Browser
    // can take more tabs (or moved ones) once this call stack has unwound.
    CefRefPtr<Ghost> self(this);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->closing_) return;
      self->ready_ = true;
      self->SetActive(self->parent_.isKeyWindow);
      self->ScheduleLayout();
      NSArray *pending = self->pending_;
      self->pending_ = nil;
      for (void (^block)(Ghost *) in pending) block(self.get());
    });
  }

  /// Runs `block` once the Browser exists (now if it does).
  void WhenReady(void (^block)(Ghost *)) {
    if (ready_) return block(this);
    if (!pending_) pending_ = [NSMutableArray array];
    [pending_ addObject:[block copy]];
  }

  /// A tab of this Browser (to add tabs next to, or move tabs into), nullptr if it has none left.
  CefRefPtr<CefBrowser> AnyTab(CefRefPtr<CefBrowser> except = nullptr) {
    auto usable = [&](CefRefPtr<CefBrowser> b) { return b && (!except || !b->IsSame(except)); };
    if (CefRefPtr<CefBrowser> tab = router_ ? router_->AnyTab() : nullptr; usable(tab)) return tab;
    for (NNBrowserView *view in LiveViews()) {
      CefRefPtr<Client> client = view.client;
      CefRefPtr<CefBrowser> tab = client ? client->Browser() : nullptr;
      if (usable(tab) && GhostOf(tab) == this) return tab;
    }
    return nullptr;
  }

  /// A placeholder first tab has served its purpose once a real tab joined (Chrome tabs only).
  void DropAnchor() {
#if NN_CHROME_TABS
    CefRefPtr<CefBrowser> anchor = Anchor();
    if (!anchor || !AnyTab(anchor) || droppingAnchor_) return;
    droppingAnchor_ = true;
    // Once the tab that replaces it has settled in the Browser.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      anchor->GetHost()->CloseBrowser(true);
    });
#endif
  }

  void Close() {
    if (closing_) return;
    closing_ = true;
    for (id observer in observers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
    observers_ = nil;
    // The app window is going: its tabs close with the Browser, which the app already knows.
    for (NNBrowserView *view in LiveViews())
      if (CefRefPtr<Client> client = view.client;
          client && client->Browser() && view.window == parent_ && GhostOf(client->Browser()) == this)
        client->closingByEngine_ = true;
    NSWindow *ghost = Window();
    if (ghost.parentWindow) [ghost.parentWindow removeChildWindow:ghost];
    // A tab leaving with the window (its last tab moved elsewhere) must get out of this
    // Browser first; Chrome closes the window itself once it's empty.
    if (window_ && TabTransfersPending()) {
      CefRefPtr<CefWindow> window = window_;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ window->Close(); });
    } else if (window_) {
      window_->Close();
    }
    // Released in OnWindowDestroyed (CEF still calls the delegate until then).
    Forget();
  }

  /// Exactly behind the app window: same frame, same Space, just below it.
  void Align() {
    NSWindow *ghost = Window(), *parent = parent_;
    if (!ghost || !parent || closing_) return;
    if (!NSEqualRects(ghost.frame, parent.frame)) [ghost setFrame:parent.frame display:NO];
    // Child windows go with their parent (moves, Spaces, full screen, minimising);
    // AppKit drops the link when the parent is ordered out, so restore it.
    if (ghost.parentWindow != parent && parent.isVisible) {
      [parent addChildWindow:ghost ordered:NSWindowBelow];
      // Through Chromium's override too, so its widget knows it's on screen (its
      // child dialogs and bubbles only show over a visible Browser window).
      [ghost orderWindow:NSWindowBelow relativeTo:parent.windowNumber];
    }
    if (ghost.alphaValue != 0) ghost.alphaValue = 0;
    ScheduleLayout();
  }

  /// The page the window shows now (Chrome's dialogs center on it).
  void SetShown(NNBrowserView *view) {
    shown_ = view;
    ScheduleLayout();
  }

  void ScheduleLayout() {
    if (layoutQueued_) return;
    layoutQueued_ = true;
    CefRefPtr<Ghost> self(this);
    dispatch_async(dispatch_get_main_queue(), ^{
      self->layoutQueued_ = false;
      self->Layout();
    });
  }

  /// Lays the Browser's view (where Chrome puts web-modal dialogs, the find bar and
  /// page-anchored bubbles) over the page the window shows, rather than the whole window.
  void Layout() {
    NSWindow *parent = parent_;
    if (!window_ || !view_ || !parent || closing_) return;
    NNBrowserView *page = shown_;
    if (page.window != parent || !page.visible || page.hidden) page = nil;
    if (!page) {
      for (NNBrowserView *view in ViewsIn(parent))
        if (view.visible && [view.profile isEqualToString:profile_]) {
          page = view;
          break;
        }
    }
    NSSize size = parent.frame.size;
    NSRect r = page ? [page convertRect:page.bounds toView:nil] : NSMakeRect(0, 0, size.width, size.height);
    CefInsets insets(MAX(0, (int)round(size.height - NSMaxY(r))), MAX(0, (int)round(NSMinX(r))),
                     MAX(0, (int)round(NSMinY(r))), MAX(0, (int)round(size.width - NSMaxX(r))));
    if (laidOut_ && insets.top == insets_.top && insets.left == insets_.left && insets.bottom == insets_.bottom &&
        insets.right == insets_.right)
      return;
    laidOut_ = true;
    insets_ = insets;
    CefBoxLayoutSettings settings;
    settings.horizontal = false;
    settings.inside_border_insets = insets;
    settings.cross_axis_alignment = CEF_AXIS_ALIGNMENT_STRETCH;
    window_->SetToBoxLayout(settings)->SetFlexForView(view_, 1);
    window_->Layout();
  }

  void SetActive(bool active) {
    active_ = active;
#if NN_CHROME_TABS
    // Chrome's "current window" (extensions, chrome.commands, Chrome commands) is this Browser.
    if (CefRefPtr<CefBrowser> tab = AnyTab()) tab->GetHost()->SetWindowActive(active);
#endif
  }

  NSDictionary *State() {
    NSWindow *ghost = Window(), *parent = parent_;
    CefRefPtr<CefBrowser> tab = AnyTab();
    return @{
      @"profile" : profile_,
      @"parentWindow" : @(parent.windowNumber),
      @"window" : @(ghost.windowNumber),
      @"frame" : NSStringFromRect(ghost.frame),
      @"parentFrame" : NSStringFromRect(parent.frame),
      @"aligned" : @(ghost && NSEqualRects(ghost.frame, parent.frame)),
      @"alpha" : @(ghost.alphaValue),
      @"key" : @(ghost.isKeyWindow),
      @"canBecomeKey" : @(ghost.canBecomeKeyWindow),
      @"visible" : @(ghost.isVisible),
      @"ignoresMouse" : @(ghost.ignoresMouseEvents),
      @"childOfParent" : @(ghost.parentWindow == parent),
      @"belowParent" : @(ghost && [parent.childWindows containsObject:ghost]),
      @"anchorBrowserId" : @(Anchor() ? Anchor()->GetIdentifier() : 0),
      @"anyTabBrowserId" : @(tab ? tab->GetIdentifier() : 0),
      @"ready" : @(ready_),
      @"active" : @(active_),
      @"pageInsets" : @[ @(insets_.top), @(insets_.left), @(insets_.bottom), @(insets_.right) ],
    };
  }

  // CefWindowDelegate
  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    // Called from inside CreateTopLevelWindow, before `window_` is set.
    window_ = window;
    window->AddChildView(view_);
    NSWindow *ghost = Window();
    MakeWindowInert(ghost);
    ghost.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle |
                               NSWindowCollectionBehaviorFullScreenDisallowsTiling;
    Align();
  }
  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    view_ = nullptr;
    window_ = nullptr;
    if (router_) router_->Detach();
    router_ = nullptr;
    // Chrome closed it itself (its last tab went): the window's next tab makes a new one.
    if (!closing_) {
      closing_ = true;
      for (id observer in observers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
      observers_ = nil;
      CefRefPtr<Ghost> self(this);
      dispatch_async(dispatch_get_main_queue(), ^{ self->Forget(); });
    }
  }
  bool CanClose(CefRefPtr<CefWindow> window) override {
    // Stock: the ghost lives as long as the app window does (Chrome would close it
    // with its anchor tab, or on chrome.windows.remove). Chrome tabs: it's a Chrome
    // window like any other, closing when its last tab does.
    return closing_ || ShuttingDown() || NN_CHROME_TABS;
  }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override { return CEF_SHOW_STATE_HIDDEN; }
  CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override {
    NSRect f = parent_.frame;
    NSRect primary = NSScreen.screens.firstObject.frame;
    return CefRect((int)f.origin.x, (int)(NSMaxY(primary) - NSMaxY(f)), (int)f.size.width, (int)f.size.height);
  }
  bool IsFrameless(CefRefPtr<CefWindow> window) override { return true; }
  bool CanResize(CefRefPtr<CefWindow> window) override { return false; }
  bool CanMaximize(CefRefPtr<CefWindow> window) override { return false; }
  bool CanMinimize(CefRefPtr<CefWindow> window) override { return false; }

  // CefBrowserViewDelegate
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override { return CEF_CTT_NONE; }

 private:
  void Forget() {
    for (auto it = gTabGhost.begin(); it != gTabGhost.end();) it = it->second == this ? gTabGhost.erase(it) : std::next(it);
    gGhosts.erase(std::remove(gGhosts.begin(), gGhosts.end(), CefRefPtr<Ghost>(this)), gGhosts.end());
  }

  __weak NSWindow *parent_;
  NSString *profile_;
  CefRefPtr<TabRouter> router_;
  CefRefPtr<CefBrowserView> view_;
  CefRefPtr<CefWindow> window_;
  NSMutableArray *observers_;
  NSMutableArray *pending_;
  __weak NNBrowserView *shown_;
  CefInsets insets_;
  bool laidOut_ = false;
  bool droppingAnchor_ = false;
  bool layoutQueued_ = false;
  bool ready_ = false;
  bool closing_ = false;
  bool active_ = false;
  IMPLEMENT_REFCOUNTING(Ghost);
};

bool Live(Ghost *ghost) {
  if (!ghost || ghost->Closed()) return false;
  for (auto &g : gGhosts)
    if (g.get() == ghost) return true;
  return false;
}

Ghost *GhostFor(NSWindow *window, NSString *profile) {
  profile = profile ?: @"";
  for (auto &ghost : gGhosts)
    if (ghost->Parent() == window && [ghost->Profile() isEqualToString:profile] && !ghost->Closed()) return ghost.get();
  return nullptr;
}

/// A new ghost for `window` and `profile` (not started).
Ghost *NewGhost(NSWindow *window, NSString *profile) {
  CefRefPtr<Ghost> ghost = new Ghost(window, profile ?: @"");
  gGhosts.push_back(ghost);
  return ghost.get();
}

Ghost *GhostOf(CefRefPtr<CefBrowser> browser) {
  if (!browser) return nullptr;
  auto it = gTabGhost.find(browser->GetIdentifier());
  if (it != gTabGhost.end() && Live(it->second)) return it->second;
  if (gCreatingIn && Live(gCreatingIn)) return gTabGhost[browser->GetIdentifier()] = gCreatingIn;
#if NN_CHROME_TABS
  // Tabs we didn't place ourselves (popups, tabs Chrome made): the Browser window
  // CEF reports for a Chrome tab is its ghost.
  if (browser->GetHost()->GetRuntimeStyle() == CEF_RUNTIME_STYLE_CHROME) {
    NSWindow *window = ((__bridge NSView *)browser->GetHost()->GetWindowHandle()).window;
    for (auto &ghost : gGhosts)
      if (window && ghost->Window() == window && !ghost->Closed()) {
        gTabGhost[browser->GetIdentifier()] = ghost.get();
        return ghost.get();
      }
  }
#endif
  return nullptr;
}

CefRefPtr<CefBrowser> TabRouter::AnyTab() {
  std::vector<CefRefPtr<CefBrowser>> tabs;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (anchor_) tabs.push_back(anchor_);
    for (auto &[id, client] : tabs_)
      if (client->Browser()) tabs.push_back(client->Browser());
  }
  for (auto &tab : tabs)
    if (GhostOf(tab) == ghost_) return tab;
  return nullptr;
}

void TabRouter::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  BrowserCreated(browser);
  if (ghost_) gTabGhost[browser->GetIdentifier()] = ghost_;
  if (!anchored_) {
    anchored_ = true;
    if (CefRefPtr<Client> founder = founder_) {
      // The view that made the ghost: its tab, its client.
      founder_ = nullptr;
      AddTab(browser->GetIdentifier(), founder);
      founder->OnAfterCreated(browser);
      // Its view went away while the Browser was being made.
      if (!founder->View()) {
        founder->closingByEngine_ = true;
        browser->GetHost()->CloseBrowser(true);
      }
    } else {
      anchor_ = browser;
    }
    if (ghost_) ghost_->FirstTabCreated();
    return;
  }
  // A tab Chrome made in this Browser: the app adopts it as a new tab of this window.
  NSString *adoptId = [NSString stringWithFormat:@"tab:%d", browser->GetIdentifier()];
  CefRefPtr<Client> client = new Client(nil, profile_);
  client->adoptId_ = adoptId.UTF8String;
  AddTab(browser->GetIdentifier(), client);
  Popups()[client->adoptId_] = {client, nullptr, nil};
  client->OnAfterCreated(browser);
  NSWindow *window = ghost_ ? ghost_->Parent() : nil;
  NNBrowserView *any = ViewsIn(window).firstObject;
  NSString *url = ToNS(browser->GetMainFrame()->GetURL());
  if (any) [any emit:@"openWindow" payload:@{@"url" : url, @"adoptId" : adoptId, @"disposition" : @"foreground"}];
  else ext::EmitOpenTab(url, profile_);
}

// MARK: - Browsers Chrome makes outside our ghosts
//
// New Chrome windows (extensions' windows.create, or tabs.create while no
// window of the profile is a normal one): the page becomes one of our tabs
// and the window closes unseen.

class StrayWindowClient : public CefClient, public CefLifeSpanHandler, public CefRequestHandler {
 public:
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    BrowserCreated(browser);
    Hide(browser);
  }
  bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request, bool,
                      bool) override {
    if (!frame->IsMain()) return false;
    Hide(browser);
    NSString *url = ToNS(request->GetURL());
    if (url.length && ![url hasPrefix:@"chrome://newtab"] && ![url isEqualToString:@"about:blank"])
      ext::EmitOpenTab(url, ProfileForContext(browser->GetHost()->GetRequestContext()) ?: @"");
    // Closing just the browser leaves Chrome's emptied window behind: close the window.
    CefRefPtr<CefBrowser> doomed = browser;
    dispatch_async(dispatch_get_main_queue(), ^{
      doomed->GetHost()->ExecuteChromeCommand(IDC_CLOSE_WINDOW, CEF_WOD_CURRENT_TAB);
    });
    return true;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override { BrowserClosed(browser); }

 private:
  void Hide(CefRefPtr<CefBrowser> browser) {
    MakeWindowInert(((__bridge NSView *)browser->GetHost()->GetWindowHandle()).window);
  }

  IMPLEMENT_REFCOUNTING(StrayWindowClient);
};

// MARK: - Extension commands

struct Keybinding {
  NSEventModifierFlags modifiers;
  NSString *key;
};
std::map<std::string, std::vector<Keybinding>> gKeybindings;  // by profile
std::map<std::string, CFTimeInterval> gKeybindingsLoaded;
NSMutableSet<NSString *> *gKeybindingsLoading;
// Shortcuts also change in Chrome's own UI (chrome://extensions/shortcuts): re-read now and then.
constexpr CFTimeInterval kKeybindingsTTL = 20;

/// Chrome's shortcut text on macOS ("⇧⌘Y", "⌥⌘Left"…).
bool ParseKeybinding(NSString *text, Keybinding &out) {
  static NSDictionary<NSString *, NSNumber *> *symbols = @{
    @"⌃" : @(NSEventModifierFlagControl), @"⌥" : @(NSEventModifierFlagOption), @"⇧" : @(NSEventModifierFlagShift),
    @"⌘" : @(NSEventModifierFlagCommand),
  };
  NSEventModifierFlags modifiers = 0;
  NSUInteger i = 0;
  for (; i < text.length; i++) {
    NSNumber *flag = symbols[[text substringWithRange:NSMakeRange(i, 1)]];
    if (!flag) break;
    modifiers |= flag.unsignedIntegerValue;
  }
  NSString *key = [text substringFromIndex:i].lowercaseString;
  if (!key.length || !modifiers) return false;
  static NSDictionary *named = @{@"left" : @"", @"right" : @"", @"up" : @"", @"down" : @"",
                                 @"space" : @" ", @"comma" : @",", @"period" : @"."};
  out = {modifiers, named[key] ?: key};
  return true;
}

void LoadKeybindings(NSString *profile) {
  if (!gKeybindingsLoading) gKeybindingsLoading = [NSMutableSet set];
  if ([gKeybindingsLoading containsObject:profile]) return;
  [gKeybindingsLoading addObject:profile];
  NSString *js = @"chrome.developerPrivate.getExtensionsInfo({ includeDisabled: false }).then((infos) =>"
                  "  infos.flatMap((i) => i.commands.filter((c) => c.isActive && c.keybinding).map((c) => c.keybinding)))";
  pages::WebUIEval(profile, @"chrome://extensions/", js, ^(id value, NSString *error) {
    [gKeybindingsLoading removeObject:profile];
    std::vector<Keybinding> bindings;
    for (NSString *text in [value isKindOfClass:NSArray.class] ? value : @[]) {
      Keybinding binding;
      if ([text isKindOfClass:NSString.class] && ParseKeybinding(text, binding)) bindings.push_back(binding);
    }
    gKeybindings[profile.UTF8String] = bindings;
    gKeybindingsLoaded[profile.UTF8String] = CACurrentMediaTime();
  });
}

}  // namespace

// MARK: - nn::host

namespace nn::host {

bool ChromeTabs() { return NN_CHROME_TABS; }

bool Hostable(NNBrowserView *view) {
  NSWindow *window = view.window;
  // Only app windows: popup and PiP windows (and extension popups) are their own business.
  return window && [NNCef isStarted] && !view.standalone && ![window isKindOfClass:NSPanel.class] && !window.parentWindow;
}

void Attach(NNBrowserView *view) {
  // With Chrome tabs, a window's first tab of a profile makes its ghost (CreateTab).
  if (NN_CHROME_TABS || !Hostable(view)) return;
  if (GhostFor(view.window, view.profile)) return;
  NewGhost(view.window, view.profile)->Start();
}

void CreateTab(NNBrowserView *view, CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings) {
  CefRefPtr<CefRequestContext> context = ContextForProfile(view.profile);
#if NN_CHROME_TABS
  if (Hostable(view)) {
    Ghost *ghost = GhostFor(view.window, view.profile);
    if (!ghost) return NewGhost(view.window, view.profile)->Start(client, url, &settings);
    NSWindow *window = view.window;
    NSString *profile = view.profile;
    CefBrowserSettings tabSettings = settings;
    ghost->WhenReady(^(Ghost *g) {
      if (!client->View()) return;  // the view went away meanwhile
      CefRefPtr<CefBrowser> any = g->AnyTab();
      if (!any) {
        // The Browser lost its last tab and is closing: this tab starts the window's next one.
        g->Close();
        return NewGhost(window, profile)->Start(client, url, &tabSettings);
      }
      gCreatingIn = g;
      CefRefPtr<CefBrowser> tab = CefBrowserHost::CreateTabInBrowser(any, client, ToCef(url), tabSettings, nullptr, false);
      gCreatingIn = nullptr;
      if (tab) gTabGhost[tab->GetIdentifier()] = g;
      g->DropAnchor();
    });
    return;
  }
#endif
  CefWindowInfo info;
  NSRect bounds = view.bounds;
  info.SetAsChild((__bridge CefWindowHandle)view,
                  CefRect(0, 0, MAX(1, (int)bounds.size.width), MAX(1, (int)bounds.size.height)));
  info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
  CefBrowserHost::CreateBrowser(info, client, ToCef(url), settings, nullptr, context);
}

void ConfigurePopup(CefWindowInfo &info, NSSize size) {
  // Chrome adds it to the opener's Browser as a tab; the app adopts it (as a tab, or
  // into its popup window).
  if (NN_POPUP_TABS) return;
  info.SetAsChild((__bridge CefWindowHandle)ParkingView(), CefRect(0, 0, MAX(1, (int)size.width), MAX(1, (int)size.height)));
  info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
}

NSView *ContentsView(CefRefPtr<CefBrowser> browser) {
#if NN_CHROME_TABS
  if (IsChromeTab(browser)) return (__bridge NSView *)browser->GetHost()->GetContentsView();
#endif
  return (__bridge NSView *)browser->GetHost()->GetWindowHandle();
}

bool IsChromeTab(CefRefPtr<CefBrowser> browser) {
#if NN_CHROME_TABS
  return browser && browser->GetHost()->GetRuntimeStyle() == CEF_RUNTIME_STYLE_CHROME;
#else
  return false;
#endif
}

void TabShown(NNBrowserView *view) {
  CefRefPtr<Client> client = view.client;
  CefRefPtr<CefBrowser> browser = client ? client->Browser() : nullptr;
  if (!IsChromeTab(browser) || !Hostable(view)) return;
  Ghost *ghost = GhostOf(browser);
  if (!ghost || ghost->Parent() != view.window) return;
  ghost->SetShown(view);
#if NN_CHROME_TABS
  // Later in this turn: a tab being created isn't in Chrome's tab strip yet.
  dispatch_async(dispatch_get_main_queue(), ^{
    if (view.visible && view.client && view.client->Browser() && view.client->Browser()->IsSame(browser))
      browser->GetHost()->ActivateTab();
  });
#endif
}

void TabMoved(NNBrowserView *view) {
#if NN_CHROME_TABS
  CefRefPtr<Client> client = view.client;
  CefRefPtr<CefBrowser> browser = client ? client->Browser() : nullptr;
  if (!IsChromeTab(browser) || !Hostable(view)) return;
  Ghost *from = GhostOf(browser), *to = GhostFor(view.window, view.profile);
  if (from && from == to) return;
  // A window without a Browser of this profile yet gets one, founded by a placeholder
  // the move replaces (a Browser can't be made around an existing tab).
  if (!to) (to = NewGhost(view.window, view.profile))->Start();
  __weak NNBrowserView *weakView = view;
  to->WhenReady(^(Ghost *target) {
    NNBrowserView *moved = weakView;
    if (!moved || moved.client != client || !client->Browser()) return;
    CefRefPtr<CefBrowser> into = target->AnyTab(browser);
    if (!into || !browser->GetHost()->MoveToBrowser(into, -1, moved.visible)) return;
    gTabGhost[browser->GetIdentifier()] = target;
    target->DropAnchor();
    if (moved.visible) TabShown(moved);
  });
#endif
}

void LayoutChanged(NSWindow *window) {
  for (auto &ghost : gGhosts)
    if (ghost->Parent() == window) ghost->ScheduleLayout();
}

int TabId(CefRefPtr<CefBrowser> browser) {
#if NN_CHROME_TABS
  if (IsChromeTab(browser)) return MAX(0, browser->GetHost()->GetTabId());
#endif
  return 0;
}

bool ForwardKeyEvent(NSEvent *event, NSString *profile) {
  profile = pages::DataProfile(profile);
  auto it = gKeybindings.find(profile.UTF8String);
  if (it == gKeybindings.end() || CACurrentMediaTime() - gKeybindingsLoaded[profile.UTF8String] > kKeybindingsTTL)
    LoadKeybindings(profile);
  if (it == gKeybindings.end()) return false;
  NSEventModifierFlags mods = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption |
                                                     NSEventModifierFlagShift | NSEventModifierFlagControl);
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  bool bound = false;
  for (const Keybinding &b : it->second) bound |= b.modifiers == mods && [b.key isEqualToString:key];
  if (!bound) return false;
  Ghost *ghost = GhostFor(event.window, profile);
  NSWindow *target = ghost ? ghost->Window() : nil;
  if (!target) return false;
  // Chrome's accelerators (extension commands among them) live on the Browser
  // window's focus manager, which Chrome finds through the event's window.
  NSEvent *retargeted = [NSEvent keyEventWithType:event.type
                                         location:NSZeroPoint
                                    modifierFlags:event.modifierFlags
                                        timestamp:event.timestamp
                                     windowNumber:target.windowNumber
                                          context:nil
                                       characters:event.characters
                      charactersIgnoringModifiers:event.charactersIgnoringModifiers
                                        isARepeat:event.isARepeat
                                          keyCode:event.keyCode];
  return [target performKeyEquivalent:retargeted];
}

void InvalidateExtensionCommands(NSString *profile) { gKeybindings.erase(pages::DataProfile(profile).UTF8String); }

CefRefPtr<CefClient> DefaultClient() { return new StrayWindowClient(); }

NSUInteger GhostCount() { return gGhosts.size(); }

NSArray<NSDictionary *> *GhostStates() {
  NSMutableArray *states = [NSMutableArray array];
  for (auto &ghost : gGhosts) [states addObject:ghost->State()];
  return states;
}

NSString *DevWindowAction(NSInteger windowNumber, NSString *action) {
  NSWindow *window = [NSApp windowWithWindowNumber:windowNumber];
  if ([action hasPrefix:@"key:"]) {
    // "key:<modifier flags>:<character>": the path an unhandled key takes (ForwardKeyEvent).
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    NSEventModifierFlags flags = (NSEventModifierFlags)parts[1].longLongValue;
    NSEvent *event = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:flags timestamp:0
                                  windowNumber:windowNumber context:nil characters:parts[2]
                   charactersIgnoringModifiers:parts[2] isARepeat:NO keyCode:0];
    NSString *profile = @"";
    for (auto &ghost : gGhosts)
      if (ghost->Parent() == window) profile = ghost->Profile();
    return ForwardKeyEvent(event, profile) ? @"forwarded" : @"not bound";
  }
  if ([action hasPrefix:@"active:"]) {
    // "active:1|0": the window's key state as its ghosts report it to Chrome (test instances never become key).
    for (auto &ghost : gGhosts)
      if (ghost->Parent() == window) ghost->SetActive([action hasSuffix:@"1"]);
    return @"ok";
  }
  if ([action hasPrefix:@"frame:"]) {
    NSArray<NSString *> *n = [[action substringFromIndex:6] componentsSeparatedByString:@","];
    if (n.count == 4) [window setFrame:NSMakeRect(n[0].doubleValue, n[1].doubleValue, n[2].doubleValue, n[3].doubleValue) display:YES];
  } else if ([action isEqualToString:@"miniaturize"]) {
    [window miniaturize:nil];
  } else if ([action isEqualToString:@"deminiaturize"]) {
    [window deminiaturize:nil];
  }
  return @"ok";
}

void CloseAll() {
  auto ghosts = gGhosts;
  for (auto &ghost : ghosts) ghost->Close();
}

}  // namespace nn::host
