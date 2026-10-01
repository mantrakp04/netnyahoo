#import "NNWindowHost.h"

#import "NNChromeWindow.h"
#import "NNClient.h"
#import "NNEngine.h"
#import "NNExtensionsInternal.h"
#import "NNTabStrip.h"

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
  // Never activate or key a test window; it steals user focus.
  if ([window respondsToSelector:@selector(setActivationIndependence:)])
    [(id<NNChromiumWindow>)window setActivationIndependence:YES];
  if ([window respondsToSelector:@selector(setPreventKeyWindow:)]) [(id<NNChromiumWindow>)window setPreventKeyWindow:YES];
}

}

namespace {

class ChromeWindow;
std::vector<CefRefPtr<ChromeWindow>> gWindows;
std::map<int, ChromeWindow *> gTabWindow;
ChromeWindow *gCreatingIn = nullptr;
int gLastStripId = 0;

ChromeWindow *WindowOfTab(CefRefPtr<CefBrowser> browser);
bool Live(ChromeWindow *window);
ChromeWindow *ChromeWindowOf(NSWindow *window);
bool TranslucentSwap() { return [nn::host::SwapStrategy() isEqualToString:@"transparent"]; }
ChromeWindow *WindowForTab(NSWindow *window, NSString *profile);

NSArray<NNBrowserView *> *ViewsIn(NSWindow *window) {
  NSMutableArray *visible = [NSMutableArray array], *hidden = [NSMutableArray array];
  for (NNBrowserView *view in LiveViews())
    if (view.window == window) [view.visible ? visible : hidden addObject:view];
  return [visible arrayByAddingObjectsFromArray:hidden];
}

// MARK: - Chrome-created tabs

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
  CefRefPtr<CefBrowser> Anchor() const { return anchor_; }
  void SetFounder(CefRefPtr<Client> client) { founder_ = client; }
  void ExpectAnchor() { expectAnchor_ = true; }
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

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeDevToolsPopup(CefRefPtr<CefBrowser> browser, CefWindowInfo &windowInfo, CefRefPtr<CefClient> &client,
                             CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra_info,
                             bool *use_default_window) override {
    if (client.get() == this) client = DevToolsFrontendClient(browser);
  }
  bool DoClose(CefRefPtr<CefBrowser> browser) override {
    if (Client *c = Tab(browser)) return c->DoClose(browser);
    return false;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    if (Client *c = Tab(browser)) c->OnBeforeClose(browser);
    std::lock_guard<std::mutex> lock(mutex_);
    tabs_.erase(browser->GetIdentifier());
    if (anchor_ && anchor_->IsSame(browser)) anchor_ = nullptr;
    strip::Closed(browser);
    BrowserClosed(browser);
  }
  void OnTabStripChanged(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) override {
    strip::Report(browser, index, active, pinned);
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id, const CefString &url,
                     const CefString &name, cef_window_open_disposition_t disposition, bool gesture,
                     const CefPopupFeatures &features, CefWindowInfo &info, CefRefPtr<CefClient> &client,
                     CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra, bool *no_js) override {
    if (Client *c = Tab(browser))
      return c->OnBeforePopup(browser, frame, popup_id, url, name, disposition, gesture, features, info, client, settings,
                              extra, no_js);
    return true;
  }
  void OnBeforePopupAborted(CefRefPtr<CefBrowser> browser, int popup_id) override {
    if (Client *c = Tab(browser)) c->OnBeforePopupAborted(browser, popup_id);
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
  void OnDevToolsDockChanged(CefRefPtr<CefBrowser> browser) override { NN_FORWARD(OnDevToolsDockChanged(browser)) }
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
    CefRefPtr<CefFrame> page = browser->GetMainFrame();
    return nn::OnBeforeDownload(item, name, callback, profile_, page ? ToNS(page->GetURL()) : nil);
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
  bool OnSetFocus(CefRefPtr<CefBrowser> browser, FocusSource source) override {
    NN_FORWARD_RETURN(OnSetFocus(browser, source), false)
  }
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
  void OnTabDiscardedChanged(CefRefPtr<CefBrowser> browser, bool discarded) override {
    NN_FORWARD(OnTabDiscardedChanged(browser, discarded))
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

  ChromeWindow *owner_;
  NSString *profile_;
  CefRefPtr<Client> founder_;
  CefRefPtr<CefBrowser> anchor_;
  bool anchored_ = false;
  bool expectAnchor_ = false;
  std::map<int, CefRefPtr<Client>> tabs_;  // Read on the IO thread too.
  std::mutex mutex_;
  IMPLEMENT_REFCOUNTING(TabRouter);
};

// MARK: - ChromeWindow

class ChromeWindow : public CefWindowDelegate, public CefBrowserViewDelegate {
 public:
  ChromeWindow(NSString *profile, bool popup) : profile_([profile copy]), popup_(popup), id_(++gLastStripId) {}

  NSWindow *Window() const { return nswindow_; }
  int Id() const { return id_; }
  NSString *Profile() const { return profile_; }
  CefRefPtr<CefBrowser> Anchor() const { return router_ ? router_->Anchor() : nullptr; }
  bool Closed() const { return closing_; }

  NSWindow *Start() {
    router_ = new TabRouter(this, profile_);
    CefWindow::CreateTopLevelWindow(this);
    NSWindow *window = Window();
    if (!window) return nil;
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

  bool BrowserStarted() const { return browserStarted_; }

  void StartBrowser(CefRefPtr<Client> founder = nullptr, NSString *url = nil, const CefBrowserSettings *settings = nullptr) {
    if (browserStarted_) return;
    browserStarted_ = true;
    if (founder) router_->SetFounder(founder);
    CefBrowserSettings first = settings ? *settings : CefBrowserSettings();
    first.native_contents_hosting = STATE_ENABLED;
    first.client_window = STATE_ENABLED;
    first.chrome_status_bubble = STATE_DISABLED;
    NSString *firstURL = founder && url.length ? url : @"about:blank";
    CefRefPtr<ChromeWindow> self(this);
    WhenProfileReady(profile_, ^(CefRefPtr<CefRequestContext> context) {
      if (self->closing_ || !self->window_) return;
      self->view_ = CefBrowserView::CreateBrowserView(self->router_, ToCef(firstURL), first, nullptr, context, self.get());
      self->window_->AddChildView(self->view_);
      self->laidOut_ = false;
      self->ScheduleLayout();
    });
  }

  CefRefPtr<CefBrowser> CreateTab(CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings) {
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
  }

  CefRefPtr<CefBrowser> AnyTabOrAnchor(CefRefPtr<CefBrowser> except = nullptr) {
    if (CefRefPtr<CefBrowser> tab = AnyTab(except)) return tab;
    return CreateTab(nullptr, nil, CefBrowserSettings());
  }

  bool InMyGroup(NSWindow *window) const {
    ChromeWindow *other = group_ ? ChromeWindowOf(window) : nullptr;
    return other && other->Group() == group_;
  }

  NSObject *Group() const { return group_; }
  void SetGroup(NSObject *group) { group_ = group; }

  void FirstTabCreated() {
    // Defer tab additions until OnAfterCreated returns.
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

  void WhenReady(void (^block)(ChromeWindow *)) {
    if (ready_) return block(this);
    if (!pending_) pending_ = [NSMutableArray array];
    [pending_ addObject:[block copy]];
  }

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

  void DropAnchor() {
    CefRefPtr<CefBrowser> anchor = Anchor();
    if (!anchor || !AnyTab(anchor) || droppingAnchor_) return;
    droppingAnchor_ = true;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      anchor->GetHost()->CloseBrowser(true);
    });
  }

  void Close() {
    if (closing_) return;
    closing_ = true;
    for (id observer in observers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
    observers_ = nil;
    for (NNBrowserView *view in LiveViews())
      if (CefRefPtr<Client> client = view.client; client && client->Browser() &&
                                                  (!view.window || view.window == nswindow_ || InMyGroup(view.window)) &&
                                                  WindowOfTab(client->Browser()) == this)
        client->closingByEngine_ = true;
    Forget();
  }

  NNBrowserView *Shown() const { return shown_; }

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

  void SetActive(bool active) {
    active_ = active;
    if (CefRefPtr<CefBrowser> tab = AnyTab()) tab->GetHost()->SetWindowActive(active);
  }

  void CloseLater() {
    NSWindow *window = Window();
    if (!window_ || closing_ || closeRequested_) return;
    closeRequested_ = true;
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
      @"hosting" : @YES,
      @"group" : group_ ? [NSString stringWithFormat:@"%p", group_] : @"",
      @"hasRoot" : @([NNChromeWindowHost rootViewOfWindow:window] != nil),
      @"translucent" : @(window && !window.opaque),
    };
  }

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window_ = window;
    nswindow_ = ((__bridge NSView *)window->GetWindowHandle()).window;
    WindowCreated(window);
  }
  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    WindowDestroyed(window);
    view_ = nullptr;
    window_ = nullptr;
    if (router_) router_->Detach();
    router_ = nullptr;
    if (!closing_) {
      closing_ = true;
      for (id observer in observers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
      observers_ = nil;
      CefRefPtr<ChromeWindow> self(this);
      dispatch_async(dispatch_get_main_queue(), ^{ self->Forget(); });
    }
  }
  bool CanClose(CefRefPtr<CefWindow> window) override {
    if (!popup_ && !closing_ && !closeRequested_ && !ShuttingDown()) return [NNChromeWindowHost windowShouldClose:Window()];
    return true;
  }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override { return CEF_SHOW_STATE_HIDDEN; }
  CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override { return CefRect(0, 0, 1360, 860); }
  bool IsFrameless(CefRefPtr<CefWindow> window) override { return !popup_; }
  bool IsTranslucent(CefRefPtr<CefWindow> window) override { return Translucent(); }
  bool WithStandardWindowButtons(CefRefPtr<CefWindow> window) override { return true; }
  bool GetTitlebarHeight(CefRefPtr<CefWindow> window, float *height) override {
    if (popup_) return false;
    *height = 54;
    return true;
  }
  bool CanResize(CefRefPtr<CefWindow> window) override { return true; }
  bool CanMaximize(CefRefPtr<CefWindow> window) override { return true; }
  bool CanMinimize(CefRefPtr<CefWindow> window) override { return true; }

  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override { return CEF_CTT_NONE; }
  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView>, CefRefPtr<CefBrowserView> popup, bool is_devtools) override {
    return is_devtools && OpenDevToolsWindow(popup);
  }

 private:
  bool Translucent() const { return !popup_ && TranslucentSwap(); }

  void Forget() {
    strip::WindowClosed(id_);
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
  // Its tab strip's id in transactions (NNTabStrip).
  const int id_;
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

ChromeWindow *GroupWindow(NSObject *group, NSString *profile) {
  if (!group) return nullptr;
  for (auto &w : gWindows)
    if (w->Group() == group && [w->Profile() isEqualToString:profile] && !w->Closed()) return w.get();
  return nullptr;
}

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

bool HiddenChromeUICommand(int command_id) {
  switch (command_id) {
    case IDC_SHOW_AVATAR_MENU: case IDC_SHOW_APP_MENU: case IDC_FOCUS_TOOLBAR: case IDC_FOCUS_LOCATION:
    case IDC_FOCUS_SEARCH: case IDC_FOCUS_MENU_BAR: case IDC_FOCUS_NEXT_PANE: case IDC_FOCUS_PREVIOUS_PANE:
    case IDC_FOCUS_BOOKMARKS: case IDC_FOCUS_INACTIVE_POPUP_FOR_ACCESSIBILITY: case IDC_FOCUS_WEB_CONTENTS_PANE:
    case IDC_SHOW_DOWNLOADS: case IDC_ADD_NEW_TAB_TO_GROUP: case IDC_CREATE_NEW_TAB_GROUP:
    case IDC_FOCUS_NEXT_TAB_GROUP: case IDC_FOCUS_PREV_TAB_GROUP: case IDC_CLOSE_TAB_GROUP: case IDC_MOVE_TAB_NEXT:
    case IDC_MOVE_TAB_PREVIOUS: case IDC_SHOW_READING_MODE_SIDE_PANEL:
      return true;
    default:
      return false;
  }
}

bool TabRouter::OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) {
  if (Client *c = Tab(browser)) return c->OnChromeCommand(browser, command_id, disposition);
  return MenuBarTakesChromeShortcut(command_id) || HiddenChromeUICommand(command_id);
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
      founder_ = nullptr;
      AddTab(browser->GetIdentifier(), founder);
      founder->OnAfterCreated(browser);
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

}

// MARK: - nn::host

namespace nn::host {

bool Hostable(NNBrowserView *view) {
  return [NNCef isStarted] && !view.standalone && ChromeWindowOf(view.window);
}

void CreateTab(NNBrowserView *view, CefRefPtr<Client> client, NSString *url, const CefBrowserSettings &settings) {
  if (ChromeWindow *window = Hostable(view) ? WindowForTab(view.window, view.profile) : nullptr) {
    if (!window->BrowserStarted()) return window->StartBrowser(client, url, &settings);
    CefBrowserSettings tabSettings = settings;
    window->WhenReady(^(ChromeWindow *w) {
      if (!client->View()) return;
      CefRefPtr<CefBrowser> any = w->AnyTab();
      if (!any) {
        strip::AsApp(^{ w->CreateTab(client, url, tabSettings); });
        return;
      }
      strip::AsApp(^{
        gCreatingIn = w;
        CefRefPtr<CefBrowser> tab = CefBrowserHost::CreateTabInBrowser(any, client, ToCef(url), tabSettings, nullptr, false);
        gCreatingIn = nullptr;
        if (tab) gTabWindow[tab->GetIdentifier()] = w;
      });
      w->DropAnchor();
    });
    return;
  }
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
  if (!Hostable(view) || (source && !IsChromeTab(source))) return false;
  ChromeWindow *window = WindowForTab(view.window, view.profile);
  if (!window) return false;
  if (source && WindowOfTab(source) != window) {
    state = ToNS(source->GetHost()->GetNavigationState());
    source = nullptr;
  }
  if (!source && !state.length) return false;
  window->StartBrowser();
  NSString *navigationState = [state copy], *fallbackURL = [url copy];
  CefBrowserSettings tabSettings = settings;
  __weak NNBrowserView *weakView = view;
  window->WhenReady(^(ChromeWindow *w) {
    NNBrowserView *target = weakView;
    if (!target || !client->View()) return;
    CefRefPtr<CefBrowser> any = w->AnyTabOrAnchor();
    __block CefRefPtr<CefBrowser> tab;
    strip::AsApp(^{
      gCreatingIn = w;
      if (source && source->IsValid() && WindowOfTab(source) == w)
        tab = source->GetHost()->DuplicateTab(client, tabSettings, nullptr);
      else if (any && navigationState.length)
        tab = CefBrowserHost::RestoreTabInBrowser(any, client, ToCef(navigationState), tabSettings, nullptr);
      gCreatingIn = nullptr;
    });
    if (tab) {
      gTabWindow[tab->GetIdentifier()] = w;
      w->DropAnchor();
      return;
    }
    CreateTab(target, client, fallbackURL.length ? fallbackURL : @"about:blank", tabSettings);
  });
  return true;
}

void ConfigurePopup(CefWindowInfo &info, NSSize size, CefRefPtr<CefBrowser> opener) {
  if (IsChromeTab(opener)) return;
  info.SetAsChild((__bridge CefWindowHandle)ParkingView(), CefRect(0, 0, MAX(1, (int)size.width), MAX(1, (int)size.height)));
  info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
}

NSView *ContentsView(CefRefPtr<CefBrowser> browser) {
  if (IsChromeTab(browser)) return (__bridge NSView *)browser->GetHost()->GetContentsView();
  return (__bridge NSView *)browser->GetHost()->GetWindowHandle();
}

bool IsChromeTab(CefRefPtr<CefBrowser> browser) {
  return browser && browser->GetHost()->GetRuntimeStyle() == CEF_RUNTIME_STYLE_CHROME;
}

// The page on screen decides where Chrome's views go (layout); which tab is Chrome's active one is the app's
// `activate` command (NNTabStrip), never a side effect of showing a page.
void TabShown(NNBrowserView *view) {
  CefRefPtr<Client> client = view.client;
  CefRefPtr<CefBrowser> browser = client ? client->Browser() : nullptr;
  if (!IsChromeTab(browser) || !Hostable(view)) return;
  ChromeWindow *window = WindowOfTab(browser);
  if (!window || window->Window() != view.window) return;
  window->SetShown(view);
}

int StripOf(CefRefPtr<CefBrowser> browser) {
  ChromeWindow *window = IsChromeTab(browser) ? WindowOfTab(browser) : nullptr;
  return window ? window->Id() : 0;
}

bool StripInfo(int strip, NSString **profile, int *window) {
  for (auto &w : gWindows) {
    if (w->Id() != strip || w->Closed()) continue;
    // The strips of one app window (its profiles' Chrome windows) share their group's number.
    static NSMapTable<NSObject *, NSNumber *> *numbers = [NSMapTable weakToStrongObjectsMapTable];
    static int last = 0;
    NSNumber *number = [numbers objectForKey:w->Group()];
    if (!number) [numbers setObject:(number = @(++last)) forKey:w->Group()];
    *profile = w->Profile();
    *window = number.intValue;
    return true;
  }
  return false;
}

void NoteStrip(int browserId, int strip) {
  for (auto &w : gWindows)
    if (w->Id() == strip && !w->Closed()) gTabWindow[browserId] = w.get();
}

void TabMoved(NNBrowserView *view) {
  CefRefPtr<Client> client = view.client;
  CefRefPtr<CefBrowser> browser = client ? client->Browser() : nullptr;
  if (!IsChromeTab(browser) || !Hostable(view)) return;
  ChromeWindow *from = WindowOfTab(browser), *to = WindowForTab(view.window, view.profile);
  if (!to || from == to) return;
  to->StartBrowser();
  __weak NNBrowserView *weakView = view;
  to->WhenReady(^(ChromeWindow *target) {
    NNBrowserView *moved = weakView;
    if (!moved || moved.client != client || !client->Browser()) return;
    CefRefPtr<CefBrowser> into = target->AnyTabOrAnchor(browser);
    // In the background: the app's activate command shows it there. The tab's reports during the move are the
    // target's already.
    ChromeWindow *before = WindowOfTab(browser);
    gTabWindow[browser->GetIdentifier()] = target;
    __block bool movedIn = false;
    strip::AsApp(^{ movedIn = into && browser->GetHost()->MoveToBrowser(into, -1, false); });
    if (!movedIn) {
      if (before) gTabWindow[browser->GetIdentifier()] = before;
      return;
    }
    target->DropAnchor();
    if (moved.visible) TabShown(moved);
  });
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
  if (IsChromeTab(browser)) return MAX(0, browser->GetHost()->GetTabId());
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
  NSString *adoptId = [NSString stringWithFormat:@"tab:%d", browser->GetIdentifier()];
  client->adoptId_ = adoptId.UTF8String;
  Popups()[client->adoptId_] = {client, browser, nil};
  [any emit:@"openWindow" payload:@{@"url" : client->URL(), @"adoptId" : adoptId, @"disposition" : @"foreground"}];
  return true;
}

CefRefPtr<CefClient> DefaultClient() { return new StrayWindowClient(); }

NSWindow *MakeChromeWindow(NSString *profile, bool popup) {
  if (![NNCef isStarted] || ShuttingDown()) return nil;
  ChromeWindow *window = NewChromeWindow(profile ?: @"", nil, popup);
  return window ? window->Window() : nil;
}

NSString *SwapStrategy() {
  static NSString *strategy = [] {
    NSString *requested = NSProcessInfo.processInfo.environment[@"NETNYAHOO_PROFILE_SWAP"];
    if ([requested isEqualToString:@"snapshot"] || [requested isEqualToString:@"naive"]) return requested;
    return @"transparent";
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

void WindowShown(NSWindow *window) {
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

}
