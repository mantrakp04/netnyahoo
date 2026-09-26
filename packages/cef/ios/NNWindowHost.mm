#import "NNWindowHost.h"

#import "NNChromePages.h"
#import "NNChromeWindow.h"
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

class ChromeWindow;
std::vector<CefRefPtr<ChromeWindow>> gWindows;
/// Browser id → the Chrome window whose Browser holds that tab (checked against gWindows).
std::map<int, ChromeWindow *> gTabWindow;
/// The Chrome window CreateTab & co. are adding a tab to (the tab's OnAfterCreated runs inside it).
ChromeWindow *gCreatingIn = nullptr;
/// Inside TabShown's ActivateTab (Chrome focuses the tab it activates).
bool gActivatingTab = false;

ChromeWindow *WindowOfTab(CefRefPtr<CefBrowser> browser);
bool Live(ChromeWindow *window);
/// The Chrome window `window` is (nullptr: not a Chrome-hosted window).
ChromeWindow *ChromeWindowOf(NSWindow *window);
/// Chrome-hosted windows swap out transparent (host::SwapStrategy "transparent").
bool TranslucentSwap() { return [nn::host::SwapStrategy() isEqualToString:@"transparent"]; }
/// A tab of `profile` in the app window `window` shows: the Chrome window of its group for that
/// profile, made (off screen) if needed. nullptr if `window` isn't Chrome-hosted.
ChromeWindow *WindowForTab(NSWindow *window, NSString *profile);

/// NNBrowserViews of `window`, the visible ones first.
NSArray<NNBrowserView *> *ViewsIn(NSWindow *window) {
  NSMutableArray *visible = [NSMutableArray array], *hidden = [NSMutableArray array];
  for (NNBrowserView *view in LiveViews())
    if (view.window == window) [view.visible ? visible : hidden addObject:view];
  return [visible arrayByAddingObjectsFromArray:hidden];
}

// MARK: - Chrome-created tabs
//
// Every tab of a Browser CEF created gets the client of its first tab (below)
// when Chrome made it itself: extensions' tabs.create, session restore, "reopen
// closed tab"… The router gives each such tab its own Client, hands it to the
// app like a popup (an openWindow event with an adoptId) and forwards the tab's
// events to that Client.
//
// The first tab is either one of ours (the view whose tab started the Browser;
// the router forwards to its Client too) or a placeholder about:blank "anchor"
// that only lets the app address a Browser without tabs (CreateTabInBrowser,
// MoveToBrowser), dropped once a real tab joins.

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
                  public CefCommandHandler,
                  public CefJSDialogHandler {
 public:
  TabRouter(ChromeWindow *owner, NSString *profile) : owner_(owner), profile_([profile copy]) {}
  void Detach() { owner_ = nullptr; }
  /// The placeholder first tab, if the Browser was made with one.
  CefRefPtr<CefBrowser> Anchor() const { return anchor_; }
  /// The first tab will be `client`'s (the view whose tab starts the Browser) instead of a placeholder.
  void SetFounder(CefRefPtr<Client> client) { founder_ = client; }
  /// The next tab created is a placeholder anchor (a Browser without tabs).
  void ExpectAnchor() { expectAnchor_ = true; }
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
  CefRefPtr<CefJSDialogHandler> GetJSDialogHandler() override { return this; }

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
  bool RunContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefContextMenuParams> params,
                      CefRefPtr<CefMenuModel> model, CefRefPtr<CefRunContextMenuCallback> callback) override {
    NN_FORWARD_RETURN(RunContextMenu(browser, frame, params, model, callback), false)
  }
  void OnGotFocus(CefRefPtr<CefBrowser> browser) override { NN_FORWARD(OnGotFocus(browser)) }
  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                     bool *is_keyboard_shortcut) override {
    NN_FORWARD_RETURN(OnPreKeyEvent(browser, event, os_event, is_keyboard_shortcut), false)
  }
  bool OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) override {
    NN_FORWARD_RETURN(OnKeyEvent(browser, event, os_event), false)
  }
  bool OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) override;
  bool OnJSDialog(CefRefPtr<CefBrowser> browser, const CefString &origin, JSDialogType type, const CefString &text,
                  const CefString &prompt, CefRefPtr<CefJSDialogCallback> callback, bool &suppress) override {
    NN_FORWARD_RETURN(OnJSDialog(browser, origin, type, text, prompt, callback, suppress), false)
  }
  bool OnBeforeUnloadDialog(CefRefPtr<CefBrowser> browser, const CefString &text, bool is_reload,
                            CefRefPtr<CefJSDialogCallback> callback) override {
    NN_FORWARD_RETURN(OnBeforeUnloadDialog(browser, text, is_reload, callback), false)
  }
#if NN_TAB_DISCARD
  void OnTabDiscardedChanged(CefRefPtr<CefBrowser> browser, bool discarded) override {
    NN_FORWARD(OnTabDiscardedChanged(browser, discarded))
  }
#endif
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

  ChromeWindow *owner_;
  NSString *profile_;
  CefRefPtr<Client> founder_;
  CefRefPtr<CefBrowser> anchor_;
  bool anchored_ = false;
  bool expectAnchor_ = false;
  std::map<int, CefRefPtr<Client>> tabs_;  // read on the IO thread too
  std::mutex mutex_;
  IMPLEMENT_REFCOUNTING(TabRouter);
};

// MARK: - ChromeWindow

/// One Chrome-hosted window: a Chrome-style CefWindow whose NSWindow is the app's window for one
/// profile (CefBrowserSettings.client_window), our React root laid over Chrome's views
/// (NNChromeWindow.mm). An app window is a group of them, one per profile it shows, one on screen
/// (docs/research/chrome-hosted-window.md › Profiles). The window is made empty, for the app to
/// put its views in; its Browser comes with the window's first tab (StartBrowser) and stays when
/// its last tab closes. A `popup` one is a sized popup's window (NNPopupWindow.mm): titled,
/// opaque, a group of its own.
class ChromeWindow : public CefWindowDelegate, public CefBrowserViewDelegate {
 public:
  ChromeWindow(NSString *profile, bool popup) : profile_([profile copy]), popup_(popup) {}

  NSWindow *Window() const { return nswindow_; }
  NSString *Profile() const { return profile_; }
  CefRefPtr<CefBrowser> Anchor() const { return router_ ? router_->Anchor() : nullptr; }
  bool Closed() const { return closing_; }

  /// Makes the window (hidden; the app places and shows it). nil if CEF couldn't.
  NSWindow *Start() {
    router_ = new TabRouter(this, profile_);
    CefWindow::CreateTopLevelWindow(this);  // OnWindowCreated sets window_ and nswindow_
    NSWindow *window = Window();
    if (!window) return nil;
    // What shows for a frame before our views paint: BrowserWindow's colours, as the window's and
    // (unless the window swaps out transparent) as the colour Chrome's compositor clears its views
    // to (else white).
    const bool dark = [[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[
      NSAppearanceNameDarkAqua, NSAppearanceNameAqua
    ]] isEqualToString:NSAppearanceNameDarkAqua];
    window.backgroundColor = [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
      const bool d = [[appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
          isEqualToString:NSAppearanceNameDarkAqua];
      return d ? [NSColor colorWithSRGBRed:0.17 green:0.12 blue:0.14 alpha:1] : [NSColor colorWithSRGBRed:0.93 green:0.91 blue:0.90 alpha:1];
    }];
    window_->SetBackgroundColor(Translucent() ? CefColorSetARGB(0, 0, 0, 0)
                                : dark        ? CefColorSetARGB(255, 43, 31, 36)
                                              : CefColorSetARGB(255, 237, 232, 230));
    CefRefPtr<ChromeWindow> self(this);
    observers_ = [NSMutableArray array];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    auto observe = [&](NSNotificationName name, void (^block)(void)) {
      [observers_ addObject:[center addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *) { block(); }]];
    };
    for (NSNotificationName name in @[ NSWindowDidResizeNotification, NSWindowDidEndLiveResizeNotification ])
      observe(name, ^{ self->ScheduleLayout(); });
    observe(NSWindowWillCloseNotification, ^{ self->Close(); });
    observe(NSWindowDidBecomeKeyNotification, ^{ self->SetActive(true); });
    observe(NSWindowDidResignKeyNotification, ^{ self->SetActive(false); });
    return window;
  }

  /// The window's Browser is being or has been made.
  bool BrowserStarted() const { return browserStarted_; }

  /// Makes the window's Browser. Its first tab is `founder`'s (a view's tab, loading `url` with
  /// `settings`), or a placeholder anchor (dropped once a real tab joins).
  void StartBrowser(CefRefPtr<Client> founder = nullptr, NSString *url = nil, const CefBrowserSettings *settings = nullptr) {
#if NN_CLIENT_WINDOW
    if (browserStarted_) return;
    browserStarted_ = true;
    if (founder) router_->SetFounder(founder);
    CefBrowserSettings first = settings ? *settings : CefBrowserSettings();
    first.native_contents_hosting = STATE_ENABLED;
    first.client_window = STATE_ENABLED;
    // Chrome draws its link-status bubble as a window over the page; ours shows instead.
    first.chrome_status_bubble = STATE_DISABLED;
    NSString *firstURL = founder && url.length ? url : @"about:blank";
    CefRefPtr<ChromeWindow> self(this);
    pages::WhenProfileReady(profile_, ^(CefRefPtr<CefRequestContext> context) {
      if (self->closing_ || !self->window_) return;
      self->view_ = CefBrowserView::CreateBrowserView(self->router_, ToCef(firstURL), first, nullptr, context, self.get());
      self->window_->AddChildView(self->view_);
      self->laidOut_ = false;
      self->ScheduleLayout();
    });
#endif
  }

  /// A new tab of the window's Browser, also when it has no tabs left (nullptr if it isn't
  /// ready). A null `client` makes a placeholder anchor, which the next DropAnchor closes.
  CefRefPtr<CefBrowser> CreateTab(CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings) {
#if NN_CLIENT_WINDOW
    if (!view_ || !ready_) return nullptr;
    const bool anchor = !client;
    if (anchor) router_->ExpectAnchor();
    ChromeWindow *previous = gCreatingIn;
    gCreatingIn = this;
    CefRefPtr<CefBrowser> tab =
        view_->CreateTab(anchor ? CefRefPtr<CefClient>(router_) : CefRefPtr<CefClient>(client),
                         ToCef(anchor ? @"about:blank" : url), settings, nullptr, false);
    gCreatingIn = previous;
    if (tab) gTabWindow[tab->GetIdentifier()] = this;
    return tab;
#else
    return nullptr;
#endif
  }

  /// A tab to address this Browser by (CreateTabInBrowser, MoveToBrowser…): any of its tabs, or
  /// without tabs a new placeholder anchor. nullptr if there's none.
  CefRefPtr<CefBrowser> AnyTabOrAnchor(CefRefPtr<CefBrowser> except = nullptr) {
    if (CefRefPtr<CefBrowser> tab = AnyTab(except)) return tab;
    return CreateTab(nullptr, nil, CefBrowserSettings());
  }

  /// `window` is one of this window's group (the same app window).
  bool InMyGroup(NSWindow *window) const {
    ChromeWindow *other = group_ ? ChromeWindowOf(window) : nullptr;
    return other && other->Group() == group_;
  }

  /// The app window this Chrome window belongs to.
  NSObject *Group() const { return group_; }
  void SetGroup(NSObject *group) { group_ = group; }

  /// The Browser has its first tab: queued work (more tabs, moves) can run.
  void FirstTabCreated() {
    // OnAfterCreated runs before Chrome puts the tab in its tab strip: the Browser
    // can take more tabs (or moved ones) once this call stack has unwound.
    CefRefPtr<ChromeWindow> self(this);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->closing_) return;
      self->ready_ = true;
      self->SetActive(self->nswindow_.isKeyWindow);
      self->ScheduleLayout();
      NSArray *pending = self->pending_;
      self->pending_ = nil;
      for (void (^block)(ChromeWindow *) in pending) block(self.get());
    });
  }

  /// Runs `block` once the Browser exists (now if it does).
  void WhenReady(void (^block)(ChromeWindow *)) {
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
      if (usable(tab) && WindowOfTab(tab) == this) return tab;
    }
    return nullptr;
  }

  /// A placeholder first tab has served its purpose once a real tab joined.
  void DropAnchor() {
    CefRefPtr<CefBrowser> anchor = Anchor();
    if (!anchor || !AnyTab(anchor) || droppingAnchor_) return;
    droppingAnchor_ = true;
    // Once the tab that replaces it has settled in the Browser.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      anchor->GetHost()->CloseBrowser(true);
    });
  }

  /// The window is closing (its NSWindowWillCloseNotification, or shutdown).
  void Close() {
    if (closing_) return;
    closing_ = true;
    for (id observer in observers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
    observers_ = nil;
    // Its tabs close with the Browser, which the app already knows (they stay in the session). A
    // tab already shown in another window is moving out instead.
    for (NNBrowserView *view in LiveViews())
      if (CefRefPtr<Client> client = view.client; client && client->Browser() &&
                                                  (!view.window || view.window == nswindow_ || InMyGroup(view.window)) &&
                                                  WindowOfTab(client->Browser()) == this)
        client->closingByEngine_ = true;
    Forget();
  }

  NNBrowserView *Shown() const { return shown_; }

  /// The page the window shows now (Chrome's dialogs center on it).
  void SetShown(NNBrowserView *view) {
    shown_ = view;
    ScheduleLayout();
  }

  void ScheduleLayout() {
    if (layoutQueued_) return;
    layoutQueued_ = true;
    CefRefPtr<ChromeWindow> self(this);
    dispatch_async(dispatch_get_main_queue(), ^{
      self->layoutQueued_ = false;
      self->Layout();
    });
  }

  /// Lays the Browser's view (where Chrome puts web-modal dialogs, the find bar and
  /// page-anchored bubbles) over the page the window shows, rather than the whole window.
  void Layout() {
    NSWindow *window = nswindow_;
    if (!window_ || !view_ || !window || closing_) return;
    NNBrowserView *page = shown_;
    if (page.window != window || !page.visible || page.hidden) page = nil;
    if (!page) {
      for (NNBrowserView *view in ViewsIn(window))
        if (view.visible && [view.profile isEqualToString:profile_]) {
          page = view;
          break;
        }
    }
    NSSize size = window.frame.size;
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

  /// Tells Chrome whether this Browser's window is the active one ("current window" for
  /// extensions and chrome.commands, JS dialogs). The window's own key state does too; this
  /// also covers test instances, which are never key (the DEV "active:" action).
  void SetActive(bool active) {
    active_ = active;
#if NN_CHROME_TABS
    if (CefRefPtr<CefBrowser> tab = AnyTab()) tab->GetHost()->SetWindowActive(active);
#endif
  }

  /// The app closes the window. It hides now; its Browser closes (through CEF) once no tab is on
  /// its way out of it to another window, at most 4 s later. A tab dragged out as the window's
  /// last one: the app closes the window before React has parked the tab for its new window, so
  /// the check starts a second later.
  void CloseLater() {
    NSWindow *window = Window();
    if (!window_ || closing_ || closeRequested_) return;
    closeRequested_ = true;  // Close() still runs when the window does close
    window.animationBehavior = NSWindowAnimationBehaviorNone;
    [window orderOut:nil];
    CefRefPtr<ChromeWindow> self(this);
    const CFTimeInterval deadline = CACurrentMediaTime() + 4;
    __block void (^attempt)(void);
    __block __weak void (^weakAttempt)(void);
    weakAttempt = attempt = ^{
      if (!self->window_) return;
      if (TabTransfersPending() && CACurrentMediaTime() < deadline) {
        void (^again)(void) = weakAttempt;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC), dispatch_get_main_queue(), again);
        return;
      }
      self->window_->Close();
    };
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), attempt);
  }

  /// DEV: "hide" / "show" / "close" through CEF (the widget), not the NSWindow.
  NSString *CefWindowAction(NSString *action) {
    if (!window_) return @"no window";
    if ([action isEqualToString:@"hide"]) window_->Hide();
    else if ([action isEqualToString:@"show"]) window_->Show();
    else if ([action isEqualToString:@"close"]) window_->Close();
    else return @"unknown";
    return @"ok";
  }

  NSDictionary *State() {
    NSWindow *window = Window();
    CefRefPtr<CefBrowser> tab = AnyTab();
    return @{
      @"profile" : profile_,
      @"window" : @(window.windowNumber),
      @"frame" : NSStringFromRect(window.frame),
      @"alpha" : @(window.alphaValue),
      @"key" : @(window.isKeyWindow),
      @"canBecomeKey" : @(window.canBecomeKeyWindow),
      @"visible" : @(window.isVisible),
      @"parentWindow" : @(window.parentWindow.windowNumber),
      @"chromeWindows" : @(window.childWindows.count),
      @"anchorBrowserId" : @(Anchor() ? Anchor()->GetIdentifier() : 0),
      @"anyTabBrowserId" : @(tab ? tab->GetIdentifier() : 0),
      @"ready" : @(ready_),
      @"active" : @(active_),
      @"pageInsets" : @[ @(insets_.top), @(insets_.left), @(insets_.bottom), @(insets_.right) ],
      // Every Chrome window is a Chrome-hosted one (kept for the research scripts' checks).
      @"hosting" : @YES,
      @"group" : group_ ? [NSString stringWithFormat:@"%p", group_] : @"",
      @"hasRoot" : @([NNChromeWindowHost rootViewOfWindow:window] != nil),
      @"translucent" : @(window && !window.opaque),
    };
  }

  // CefWindowDelegate
  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    // Called from inside CreateTopLevelWindow.
    window_ = window;
    nswindow_ = ((__bridge NSView *)window->GetWindowHandle()).window;
  }
  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    view_ = nullptr;
    window_ = nullptr;
    if (router_) router_->Detach();
    router_ = nullptr;
    // Chrome closed it itself (chrome.windows.remove, say): the window's next tab makes a new one.
    if (!closing_) {
      closing_ = true;
      for (id observer in observers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
      observers_ = nil;
      CefRefPtr<ChromeWindow> self(this);
      dispatch_async(dispatch_get_main_queue(), ^{ self->Forget(); });
    }
  }
  bool CanClose(CefRefPtr<CefWindow> window) override {
    // The close button (or performClose:) on an app window: the app decides, as its window
    // delegate would (Dia's "warn before closing a window"), and closes the window itself.
    if (!popup_ && !closing_ && !closeRequested_ && !ShuttingDown()) return [NNChromeWindowHost windowShouldClose:Window()];
    return true;
  }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override { return CEF_SHOW_STATE_HIDDEN; }
  CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override { return CefRect(0, 0, 1360, 860); }  // the app places it
  // Dia's hidden titlebar, traffic lights over the sidebar; a popup's is a plain title bar.
  bool IsFrameless(CefRefPtr<CefWindow> window) override { return !popup_; }
#if NN_TRANSLUCENT_WINDOW
  // A Chrome-hosted window that leaves the screen transparent (host::SwapStrategy).
  bool IsTranslucent(CefRefPtr<CefWindow> window) override { return Translucent(); }
#endif
  bool WithStandardWindowButtons(CefRefPtr<CefWindow> window) override { return true; }
  bool GetTitlebarHeight(CefRefPtr<CefWindow> window, float *height) override {
    if (popup_) return false;
    *height = 54;  // Dia's traffic lights sit 20 pt down, centred in this (NNChromeWindow.mm)
    return true;
  }
  bool CanResize(CefRefPtr<CefWindow> window) override { return true; }
  bool CanMaximize(CefRefPtr<CefWindow> window) override { return true; }
  bool CanMinimize(CefRefPtr<CefWindow> window) override { return true; }

  // CefBrowserViewDelegate
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override { return CEF_CTT_NONE; }

 private:
  /// An app window's Chrome window that swaps out transparent (a popup never swaps).
  bool Translucent() const { return !popup_ && TranslucentSwap(); }

  void Forget() {
    for (auto it = gTabWindow.begin(); it != gTabWindow.end();) it = it->second == this ? gTabWindow.erase(it) : std::next(it);
    gWindows.erase(std::remove(gWindows.begin(), gWindows.end(), CefRefPtr<ChromeWindow>(this)), gWindows.end());
  }

  __weak NSWindow *nswindow_;
  NSString *profile_;
  CefRefPtr<TabRouter> router_;
  CefRefPtr<CefBrowserView> view_;
  CefRefPtr<CefWindow> window_;
  NSMutableArray *observers_;
  NSMutableArray *pending_;
  __weak NNBrowserView *shown_;
  CefInsets insets_;
  NSObject *group_;
  bool laidOut_ = false;
  bool droppingAnchor_ = false;
  bool layoutQueued_ = false;
  bool ready_ = false;
  bool closing_ = false;
  bool active_ = false;
  bool browserStarted_ = false;
  bool closeRequested_ = false;
  const bool popup_;
  IMPLEMENT_REFCOUNTING(ChromeWindow);
};

bool Live(ChromeWindow *window) {
  if (!window || window->Closed()) return false;
  for (auto &w : gWindows)
    if (w.get() == window) return true;
  return false;
}

ChromeWindow *ChromeWindowOf(NSWindow *window) {
  if (!window) return nullptr;
  for (auto &w : gWindows)
    if (w->Window() == window && !w->Closed()) return w.get();
  return nullptr;
}

/// The Chrome window of `profile` in `group` (an app window's), if there is one.
ChromeWindow *GroupWindow(NSObject *group, NSString *profile) {
  if (!group) return nullptr;
  for (auto &w : gWindows)
    if (w->Group() == group && [w->Profile() isEqualToString:profile] && !w->Closed()) return w.get();
  return nullptr;
}

/// A new Chrome window for `profile` in `group` (a new group without one), not on screen.
ChromeWindow *NewChromeWindow(NSString *profile, NSObject *group, bool popup = false) {
  CefRefPtr<ChromeWindow> window = new ChromeWindow(profile ?: @"", popup);
  gWindows.push_back(window);
  window->SetGroup(group ?: [NSObject new]);
  if (!window->Start()) {
    window->Close();
    return nullptr;
  }
  return window.get();
}

ChromeWindow *WindowForTab(NSWindow *window, NSString *profile) {
  ChromeWindow *shown = ChromeWindowOf(window);
  if (!shown) return nullptr;
  profile = profile ?: @"";
  return GroupWindow(shown->Group(), profile) ?: NewChromeWindow(profile, shown->Group());
}

ChromeWindow *WindowOfTab(CefRefPtr<CefBrowser> browser) {
  if (!browser) return nullptr;
  auto it = gTabWindow.find(browser->GetIdentifier());
  if (it != gTabWindow.end() && Live(it->second)) return it->second;
  if (gCreatingIn && Live(gCreatingIn)) return gTabWindow[browser->GetIdentifier()] = gCreatingIn;
  // Every Chrome tab is recorded as it's made (our tabs, tabs Chrome makes in a Browser: TabRouter,
  // popups: TabOpenedFrom) and as it moves. CEF's window handle for a tab is no help: in a
  // Chrome-hosted window it's wherever we show the tab, not its Browser's window.
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
    if (WindowOfTab(tab) == owner_) return tab;
  return nullptr;
}

/// Chrome's commands for its own UI (toolbar, tab strip, profile menu, app menu, tab groups),
/// which a visible Browser window runs from Chrome's shortcut table for keys our menus don't take.
/// Our menus cover the rest. Many are disabled anyway in a client window (no main UI).
bool HiddenChromeUICommand(int command_id) {
  switch (command_id) {
    case IDC_SHOW_AVATAR_MENU: case IDC_SHOW_APP_MENU: case IDC_FOCUS_TOOLBAR: case IDC_FOCUS_LOCATION:
    case IDC_FOCUS_SEARCH: case IDC_FOCUS_MENU_BAR: case IDC_FOCUS_NEXT_PANE: case IDC_FOCUS_PREVIOUS_PANE:
    case IDC_FOCUS_BOOKMARKS: case IDC_FOCUS_INACTIVE_POPUP_FOR_ACCESSIBILITY: case IDC_FOCUS_WEB_CONTENTS_PANE:
    case IDC_SHOW_DOWNLOADS: case IDC_DEV_TOOLS_INSPECT: case IDC_ADD_NEW_TAB_TO_GROUP: case IDC_CREATE_NEW_TAB_GROUP:
    case IDC_FOCUS_NEXT_TAB_GROUP: case IDC_FOCUS_PREV_TAB_GROUP: case IDC_CLOSE_TAB_GROUP: case IDC_MOVE_TAB_NEXT:
    case IDC_MOVE_TAB_PREVIOUS: case IDC_SHOW_READING_MODE_SIDE_PANEL:
      return true;
    default:
      return false;
  }
}

bool TabRouter::OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) {
  if (Client *c = Tab(browser)) return c->OnChromeCommand(browser, command_id, disposition);
  return HiddenChromeUICommand(command_id);
}

void TabRouter::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  BrowserCreated(browser);
  if (owner_) gTabWindow[browser->GetIdentifier()] = owner_;
  if (expectAnchor_) {
    expectAnchor_ = false;
    anchor_ = browser;
    return;
  }
  if (!anchored_) {
    anchored_ = true;
    if (CefRefPtr<Client> founder = founder_) {
      // The view whose tab started the Browser: its tab, its client.
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
    if (owner_) owner_->FirstTabCreated();
    return;
  }
  // A tab Chrome made in this Browser: the app adopts it as a new tab of this window.
  NSString *adoptId = [NSString stringWithFormat:@"tab:%d", browser->GetIdentifier()];
  CefRefPtr<Client> client = new Client(nil, profile_);
  client->adoptId_ = adoptId.UTF8String;
  AddTab(browser->GetIdentifier(), client);
  Popups()[client->adoptId_] = {client, nullptr, nil};
  client->OnAfterCreated(browser);
  NSWindow *window = owner_ ? owner_->Window() : nil;
  NNBrowserView *any = ViewsIn(window).firstObject;
  NSString *url = ToNS(browser->GetMainFrame()->GetURL());
  if (any) [any emit:@"openWindow" payload:@{@"url" : url, @"adoptId" : adoptId, @"disposition" : @"foreground"}];
  else ext::EmitOpenTab(url, profile_);
}

// MARK: - Browsers Chrome makes outside our windows
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

}  // namespace

// MARK: - nn::host

namespace nn::host {

bool ChromeTabs() { return NN_CHROME_TABS; }

bool ActivatingTab() { return gActivatingTab; }

bool Hostable(NNBrowserView *view) {
  // Only the app's browser windows: popup and PiP windows (and extension popups) are their own
  // business.
  return [NNCef isStarted] && !view.standalone && ChromeWindowOf(view.window);
}

void CreateTab(NNBrowserView *view, CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings) {
#if NN_CHROME_TABS
  if (ChromeWindow *window = Hostable(view) ? WindowForTab(view.window, view.profile) : nullptr) {
    // A Chrome window's first tab makes its Browser.
    if (!window->BrowserStarted()) return window->StartBrowser(client, url, &settings);
    CefBrowserSettings tabSettings = settings;
    window->WhenReady(^(ChromeWindow *w) {
      if (!client->View()) return;  // the view went away meanwhile
      CefRefPtr<CefBrowser> any = w->AnyTab();
      // The Browser outlives its tabs: without one, CefBrowserView::CreateTab.
      if (!any) {
        w->CreateTab(client, url, tabSettings);
        return;
      }
      gCreatingIn = w;
      CefRefPtr<CefBrowser> tab = CefBrowserHost::CreateTabInBrowser(any, client, ToCef(url), tabSettings, nullptr, false);
      gCreatingIn = nullptr;
      if (tab) gTabWindow[tab->GetIdentifier()] = w;
      w->DropAnchor();
    });
    return;
  }
#endif
  // Popup and PiP windows, extension popups and side panels; every tab with stock CEF.
  CefRefPtr<CefRequestContext> context = ContextForProfile(view.profile);
  CefWindowInfo info;
  NSRect bounds = view.bounds;
  info.SetAsChild((__bridge CefWindowHandle)view,
                  CefRect(0, 0, MAX(1, (int)bounds.size.width), MAX(1, (int)bounds.size.height)));
  info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
  CefBrowserHost::CreateBrowser(info, client, ToCef(url), settings, nullptr, context);
}

bool CreateTabWithHistory(NNBrowserView *view, CefRefPtr<Client> client, CefRefPtr<CefBrowser> source, NSString *state,
                          NSString *url, const CefBrowserSettings &settings) {
#if NN_TAB_HISTORY
  if (!Hostable(view) || (source && !IsChromeTab(source))) return false;
  ChromeWindow *window = WindowForTab(view.window, view.profile);
  if (!window) return false;
  // Only a tab of this window's Browser can be copied in place; any other gives its list.
  if (source && WindowOfTab(source) != window) {
    state = ToNS(source->GetHost()->GetNavigationState());
    source = nullptr;
  }
  if (!source && !state.length) return false;
  // A window without a Browser yet gets one, founded by a placeholder (a restored tab can't
  // found it), as when a tab moves in.
  window->StartBrowser();
  NSString *navigationState = [state copy], *fallbackURL = [url copy];
  CefBrowserSettings tabSettings = settings;
  __weak NNBrowserView *weakView = view;
  window->WhenReady(^(ChromeWindow *w) {
    NNBrowserView *target = weakView;
    if (!target || !client->View()) return;
    CefRefPtr<CefBrowser> any = w->AnyTabOrAnchor();
    CefRefPtr<CefBrowser> tab;
    gCreatingIn = w;
    if (source && source->IsValid() && WindowOfTab(source) == w)
      tab = source->GetHost()->DuplicateTab(client, tabSettings, nullptr);
    else if (any && navigationState.length)
      tab = CefBrowserHost::RestoreTabInBrowser(any, client, ToCef(navigationState), tabSettings, nullptr);
    gCreatingIn = nullptr;
    if (tab) {
      gTabWindow[tab->GetIdentifier()] = w;
      w->DropAnchor();
      return;
    }
    // The engine refused (source gone, bad state): a plain tab at the URL.
    CreateTab(target, client, fallbackURL.length ? fallbackURL : @"about:blank", tabSettings);
  });
  return true;
#else
  return false;
#endif
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
  ChromeWindow *window = WindowOfTab(browser);
  if (!window || window->Window() != view.window) return;
  window->SetShown(view);
#if NN_CHROME_TABS
  // Later in this turn: a tab being created isn't in Chrome's tab strip yet. Only the last view
  // shown (two split panes are shown together; the focused one comes last).
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!view.visible || !view.client || !view.client->Browser() || !view.client->Browser()->IsSame(browser)) return;
    if (!Live(window) || window->Shown() != view) return;
    gActivatingTab = true;
    browser->GetHost()->ActivateTab();
    gActivatingTab = false;
  });
#endif
}

void TabMoved(NNBrowserView *view) {
#if NN_CHROME_TABS
  CefRefPtr<Client> client = view.client;
  CefRefPtr<CefBrowser> browser = client ? client->Browser() : nullptr;
  if (!IsChromeTab(browser) || !Hostable(view)) return;
  ChromeWindow *from = WindowOfTab(browser), *to = WindowForTab(view.window, view.profile);
  if (!to || from == to) return;
  // A window without a Browser yet gets one, founded by a placeholder the move replaces (a
  // Browser can't be made around an existing tab).
  to->StartBrowser();
  __weak NNBrowserView *weakView = view;
  to->WhenReady(^(ChromeWindow *target) {
    NNBrowserView *moved = weakView;
    if (!moved || moved.client != client || !client->Browser()) return;
    CefRefPtr<CefBrowser> into = target->AnyTabOrAnchor(browser);
    if (!into || !browser->GetHost()->MoveToBrowser(into, -1, moved.visible)) return;
    gTabWindow[browser->GetIdentifier()] = target;
    target->DropAnchor();
    if (moved.visible) TabShown(moved);
  });
#endif
}

void TabOpenedFrom(CefRefPtr<CefBrowser> browser, int openerBrowserId) {
  CefRefPtr<CefBrowser> opener = CefBrowserHost::GetBrowserByIdentifier(openerBrowserId);
  if (ChromeWindow *window = IsChromeTab(browser) && opener ? WindowOfTab(opener) : nullptr)
    gTabWindow[browser->GetIdentifier()] = window;
}

void LayoutChanged(NSWindow *window) {
  if (ChromeWindow *w = ChromeWindowOf(window)) w->ScheduleLayout();
}

int TabId(CefRefPtr<CefBrowser> browser) {
#if NN_CHROME_TABS
  if (IsChromeTab(browser)) return MAX(0, browser->GetHost()->GetTabId());
#endif
  return 0;
}

NSWindow *OpenWindowOf(CefRefPtr<CefBrowser> browser) {
  ChromeWindow *window = IsChromeTab(browser) ? WindowOfTab(browser) : nullptr;
  NSWindow *shown = window ? window->Window() : nil;
  return shown.isVisible && ViewsIn(shown).count ? shown : nil;
}

bool ReadoptTab(CefRefPtr<CefBrowser> browser, CefRefPtr<Client> client) {
  NNBrowserView *any = ViewsIn(OpenWindowOf(browser)).firstObject;
  if (!any || !client) return false;
  // As a tab Chrome made (TabRouter::OnAfterCreated): the app adopts the live browser.
  NSString *adoptId = [NSString stringWithFormat:@"tab:%d", browser->GetIdentifier()];
  client->adoptId_ = adoptId.UTF8String;
  Popups()[client->adoptId_] = {client, browser, nil};
  [any emit:@"openWindow" payload:@{@"url" : client->URL(), @"adoptId" : adoptId, @"disposition" : @"foreground"}];
  return true;
}

CefRefPtr<CefClient> DefaultClient() { return new StrayWindowClient(); }

NSWindow *MakeChromeWindow(NSString *profile, bool popup) {
#if NN_CLIENT_WINDOW
  if (![NNCef isStarted] || ShuttingDown()) return nil;
  ChromeWindow *window = NewChromeWindow(profile ?: @"", nil, popup);
  return window ? window->Window() : nil;
#else
  return nil;
#endif
}

NSString *SwapStrategy() {
  static NSString *strategy = [] {
    NSString *requested = NSProcessInfo.processInfo.environment[@"NETNYAHOO_PROFILE_SWAP"];
    if ([requested isEqualToString:@"snapshot"] || [requested isEqualToString:@"naive"]) return requested;
    return NN_TRANSLUCENT_WINDOW ? @"transparent" : @"snapshot";
  }();
  return strategy;
}

NSWindow *GroupWindowForProfile(NSWindow *window, NSString *profile) {
  ChromeWindow *w = ShuttingDown() ? nullptr : WindowForTab(window, profile);
  return w ? w->Window() : nil;
}

NSString *WindowProfile(NSWindow *window) {
  ChromeWindow *w = ChromeWindowOf(window);
  return w ? w->Profile() : nil;
}

NSArray<NSWindow *> *GroupWindows(NSWindow *window) {
  NSMutableArray *windows = [NSMutableArray array];
  ChromeWindow *shown = ChromeWindowOf(window);
  for (auto &w : gWindows)
    if (shown && w->Group() == shown->Group() && !w->Closed() && w->Window()) [windows addObject:w->Window()];
  return windows;
}

void WindowShown(NSWindow *window) {
  // Its pages now in their own profile's window: Chrome's active tab, dialogs' placement.
  for (NNBrowserView *view in ViewsIn(window))
    if (view.visible) TabShown(view);
  LayoutChanged(window);
}

bool BlocksChromeCommand(CefRefPtr<CefBrowser> browser, int command_id) {
  return HiddenChromeUICommand(command_id) && IsChromeTab(browser) && WindowOfTab(browser);
}

bool CloseWindow(NSWindow *window) {
  ChromeWindow *shown = ChromeWindowOf(window);
  if (!shown) return false;
  // The app window goes: every profile's Chrome window of it.
  NSObject *group = shown->Group();
  auto windows = gWindows;
  for (auto &w : windows)
    if (w->Group() == group && !w->Closed()) w->CloseLater();
  return true;
}

NSString *ChromeWindowAction(NSWindow *window, NSString *action) {
  ChromeWindow *w = ChromeWindowOf(window);
  return w ? w->CefWindowAction(action) : @"not a Chrome window";
}

NSUInteger WindowCount() { return gWindows.size(); }

NSArray<NSDictionary *> *WindowStates() {
  NSMutableArray *states = [NSMutableArray array];
  for (auto &w : gWindows) [states addObject:w->State()];
  return states;
}

NSString *DevWindowAction(NSInteger windowNumber, NSString *action) {
  NSWindow *window = [NSApp windowWithWindowNumber:windowNumber];
  if (NSString *handled = [NNChromeWindowHost devAction:action window:window]) return handled;
  if ([action hasPrefix:@"active:"]) {
    // "active:1|0": the window's key state as Chrome hears of it (test instances never become key).
    if (ChromeWindow *w = ChromeWindowOf(window)) w->SetActive([action hasSuffix:@"1"]);
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
  auto windows = gWindows;
  for (auto &w : windows) w->Close();
}

}  // namespace nn::host
