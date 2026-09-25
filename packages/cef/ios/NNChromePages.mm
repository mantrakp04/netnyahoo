#import "NNChromePages.h"

#import "NNContentBlocker.h"
#import "NNExtensionPackage.h"
#import "NNExtensionsInternal.h"

#include <map>
#include <memory>
#include <vector>

#include "include/cef_dialog_handler.h"
#include "include/cef_request_context_handler.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"

using namespace nn;
using namespace nn::pages;

namespace {

// MARK: - A page we script
//
// Loads one page and runs DevTools Runtime.evaluate in it; work queues until
// the page has loaded.

class Page {
 public:
  explicit Page(NSString *expectedPrefix) : prefix_([expectedPrefix copy]) {}

  void Eval(NSString *expression, EvalCompletion completion) {
    EvalCompletion job = [completion copy];
    if (!ready_ || !browser_) {
      queue_.push_back({[expression copy], job});
      return;
    }
    NSDictionary *params =
        @{@"expression" : expression, @"userGesture" : @YES, @"awaitPromise" : @YES, @"returnByValue" : @YES};
    // Every job answers exactly once: when DevTools does, when the page goes away, or on timeout
    // (a promise that never settles, e.g. an extension worker that restarted mid-message).
    uint64_t jobId = ++jobSeq_;
    inflight_[jobId] = job;
    auto finish = [this, jobId](id value, NSString *error) {
      auto it = inflight_.find(jobId);
      if (it == inflight_.end()) return;
      EvalCompletion done = it->second;
      inflight_.erase(it);
      done(value, error);
    };
    std::shared_ptr<bool> alive = alive_;
    DevToolsCall(browser_, @"Runtime.evaluate", params, ^(NSDictionary *result) {
      if (!*alive) return;
      if (!result) return finish(nil, @"DevTools call failed");
      NSDictionary *exception = result[@"exceptionDetails"];
      if (exception) return finish(nil, exception[@"exception"][@"description"] ?: exception[@"text"] ?: @"error");
      finish(result[@"result"][@"value"], nil);
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kEvalTimeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (*alive) finish(nil, @"timed out");
    });
  }

  bool Busy() const { return !inflight_.empty() || !queue_.empty(); }
  ~Page() {
    *alive_ = false;
    FailInflight(@"closed");
  }

  void Created(CefRefPtr<CefBrowser> browser) {
    browser_ = browser;
    BrowserCreated(browser);
  }
  void Closed(CefRefPtr<CefBrowser> browser) {
    BrowserClosed(browser);
    browser_ = nullptr;
    ready_ = false;
    Fail(@"closed");
    FailInflight(@"closed");
  }
  void Loaded(CefRefPtr<CefBrowser> browser) {
    if (ready_) return;
    NSString *url = ToNS(browser->GetMainFrame()->GetURL());
    if (![url hasPrefix:prefix_]) return Fail([@"page unavailable: " stringByAppendingString:url]);
    ready_ = true;
    auto queue = std::move(queue_);
    queue_.clear();
    for (auto &[expression, job] : queue) Eval(expression, job);
  }
  void Fail(NSString *error) {
    auto queue = std::move(queue_);
    queue_.clear();
    for (auto &[_, job] : queue) job(nil, error);
  }

  CefRefPtr<CefBrowser> Browser() const { return browser_; }

 private:
  static constexpr double kEvalTimeout = 30;

  void FailInflight(NSString *error) {
    auto inflight = std::move(inflight_);
    inflight_.clear();
    for (auto &[_, job] : inflight) job(nil, error);
  }

  NSString *prefix_;
  CefRefPtr<CefBrowser> browser_;
  bool ready_ = false;
  std::vector<std::pair<NSString *, EvalCompletion>> queue_;
  std::map<uint64_t, EvalCompletion> inflight_;
  uint64_t jobSeq_ = 0;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};

/// Runs `expired` after `seconds` without another Touch().
class IdleTimer {
 public:
  void Touch(double seconds, void (^expired)(void)) {
    uint64_t token = ++*token_;
    std::shared_ptr<uint64_t> current = token_;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (*current == token) expired();
    });
  }
  ~IdleTimer() { ++*token_; }

 private:
  std::shared_ptr<uint64_t> token_ = std::make_shared<uint64_t>(0);
};

class ContextReady : public CefRequestContextHandler {
 public:
  explicit ContextReady(void (^ready)(CefRefPtr<CefRequestContext>)) : ready_([ready copy]) {}
  void OnRequestContextInitialized(CefRefPtr<CefRequestContext> context) override {
    auto ready = ready_;
    ready_ = nil;
    // Not re-entrantly inside CreateContext.
    if (ready) dispatch_async(dispatch_get_main_queue(), ^{ ready(context); });
  }

 private:
  void (^ready_)(CefRefPtr<CefRequestContext>);
  IMPLEMENT_REFCOUNTING(ContextReady);
};

// MARK: - chrome:// WebUI hosts
//
// WebUI pages with private APIs only load in a Chrome-style browser, which on
// macOS lives in a CEF Views window. One per profile and page, created on
// demand, never shown, closed after a minute without work.

constexpr double kHostIdleSeconds = 60;

class HostWindowDelegate : public CefWindowDelegate {
 public:
  explicit HostWindowDelegate(CefRefPtr<CefBrowserView> view) : view_(view) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->AddChildView(view_);
    // Belt and braces: never visible, clickable, activating or in the Window menu.
    MakeWindowInert(((__bridge NSView *)window->GetWindowHandle()).window);
  }
  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override { view_ = nullptr; }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override { return CEF_SHOW_STATE_HIDDEN; }
  CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override { return CefRect(-30000, -30000, 900, 700); }
  bool CanMaximize(CefRefPtr<CefWindow>) override { return false; }
  bool CanMinimize(CefRefPtr<CefWindow>) override { return false; }

 private:
  CefRefPtr<CefBrowserView> view_;
  IMPLEMENT_REFCOUNTING(HostWindowDelegate);
};

class HostViewDelegate : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override { return CEF_CTT_NONE; }

 private:
  IMPLEMENT_REFCOUNTING(HostViewDelegate);
};

class Host;
std::map<std::string, CefRefPtr<Host>> gHosts;  // "<profile>|<url>"

class Host : public CefClient, public CefLifeSpanHandler, public CefLoadHandler, public CefDialogHandler {
 public:
  Host(NSString *key, NSString *profile, NSString *url)
      : key_([key copy]), profile_([profile copy]), url_([url copy]), page_(url) {}

  void Start() {
    CefRefPtr<Host> self(this);
    WhenProfileReady(profile_, ^(CefRefPtr<CefRequestContext> context) { self->CreateView(context); });
    Touch();
  }

  void Close() {
    closed_ = true;
    page_.Fail(@"closed");
    if (window_) window_->Close();
    window_ = nullptr;
    view_ = nullptr;
  }

  void Eval(NSString *expression, EvalCompletion completion) {
    Touch();
    page_.Eval(expression, completion);
  }

  void SetDialogPath(NSString *path) { dialogPath_ = [path copy]; }

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDialogHandler> GetDialogHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override { page_.Created(browser); }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    page_.Closed(browser);
    Forget();
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int, const CefString &target_url, const CefString &,
                     cef_window_open_disposition_t, bool, const CefPopupFeatures &, CefWindowInfo &,
                     CefRefPtr<CefClient> &, CefBrowserSettings &, CefRefPtr<CefDictionaryValue> &, bool *) override {
    // Pages extensions open (tabs.create, openOptionsPage…) while this is the
    // profile's only Chrome window arrive here: make them our tabs.
    ext::EmitOpenTab(ToNS(target_url), profile_);
    return true;
  }
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool isLoading, bool, bool) override {
    if (!isLoading) page_.Loaded(browser);
  }
  void OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, ErrorCode code, const CefString &text,
                   const CefString &) override {
    if (frame->IsMain() && code != ERR_ABORTED) page_.Fail([NSString stringWithFormat:@"%@ (%d)", ToNS(text), code]);
  }
  bool OnFileDialog(CefRefPtr<CefBrowser>, FileDialogMode, const CefString &, const CefString &,
                    const std::vector<CefString> &, const std::vector<CefString> &, const std::vector<CefString> &,
                    CefRefPtr<CefFileDialogCallback> callback) override {
    NSString *path = dialogPath_;
    dialogPath_ = nil;
    if (path.length) callback->Continue({ToCef(path)});
    else callback->Cancel();
    return true;
  }

 private:
  void CreateView(CefRefPtr<CefRequestContext> context) {
    if (closed_) return;
    CefBrowserSettings settings;
#if NN_HIDDEN_BROWSER
    // Not one of the user's windows: extensions' chrome.windows / chrome.tabs don't list it.
    settings.hidden_from_extensions = STATE_ENABLED;
#endif
    view_ = CefBrowserView::CreateBrowserView(this, ToCef(url_), settings, nullptr, context, new HostViewDelegate());
    // The browser is created without the window ever being shown (Show() would
    // put a window on screen, and Chrome may activate it).
    window_ = CefWindow::CreateTopLevelWindow(new HostWindowDelegate(view_));
  }

  void Touch() {
    CefRefPtr<Host> self(this);
    idle_.Touch(kHostIdleSeconds, ^{
      if (self->page_.Busy()) return self->Touch();
      self->Forget();
      self->Close();
    });
  }
  void Forget() {
    auto it = gHosts.find(key_.UTF8String);
    if (it != gHosts.end() && it->second.get() == this) gHosts.erase(it);
  }

  NSString *key_;
  NSString *profile_;
  NSString *url_;
  Page page_;
  IdleTimer idle_;
  CefRefPtr<CefBrowserView> view_;
  CefRefPtr<CefWindow> window_;
  bool closed_ = false;
  NSString *dialogPath_ = nil;
  IMPLEMENT_REFCOUNTING(Host);
};

CefRefPtr<Host> HostFor(NSString *profile, NSString *url) {
  profile = DataProfile(profile);
  NSString *key = [NSString stringWithFormat:@"%@|%@", profile, url];
  auto it = gHosts.find(key.UTF8String);
  if (it != gHosts.end()) return it->second;
  CefRefPtr<Host> host = new Host(key, profile, url);
  gHosts[key.UTF8String] = host;
  host->Start();
  return host;
}

// MARK: - Extension contexts

constexpr double kContextIdleSeconds = 30;

class ExtensionContext;
std::map<std::string, CefRefPtr<ExtensionContext>> gExtensionContexts;

class ExtensionContext : public CefClient, public CefLifeSpanHandler, public CefLoadHandler {
 public:
  ExtensionContext(NSString *key, NSString *profile, NSString *extensionId)
      : key_([key copy]),
        profile_([profile copy]),
        extensionId_([extensionId copy]),
        page_([NSString stringWithFormat:@"chrome-extension://%@/", extensionId]) {}

  void Start() {
    CefWindowInfo info;
    info.SetAsChild((__bridge CefWindowHandle)ParkingView(), CefRect(0, 0, 100, 100));
    info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
    CefBrowserSettings settings;
    NSString *url = [NSString stringWithFormat:@"chrome-extension://%@/manifest.json", extensionId_];
    CefBrowserHost::CreateBrowser(info, this, ToCef(url), settings, nullptr, ContextForProfile(profile_));
    Touch();
  }

  void Eval(NSString *expression, EvalCompletion completion) {
    Touch();
    page_.Eval(expression, completion);
  }

  void Close() {
    page_.Fail(@"closed");
    if (CefRefPtr<CefBrowser> browser = page_.Browser()) browser->GetHost()->CloseBrowser(true);
    else closeWhenCreated_ = true;
  }

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    page_.Created(browser);
    if (closeWhenCreated_) browser->GetHost()->CloseBrowser(true);
  }
  bool DoClose(CefRefPtr<CefBrowser> browser) override {
    // Returning false would make CEF close the parking window that hosts us.
    NSView *view = (__bridge NSView *)browser->GetHost()->GetWindowHandle();
    [NSRunLoop.mainRunLoop performBlock:^{ [view removeFromSuperview]; }];
    return true;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    page_.Closed(browser);
    Forget();
  }
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool isLoading, bool, bool) override {
    if (!isLoading) page_.Loaded(browser);
  }
  void OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, ErrorCode code, const CefString &text,
                   const CefString &) override {
    // A disabled or removed extension's pages don't load.
    if (!frame->IsMain() || code == ERR_ABORTED) return;
    page_.Fail([NSString stringWithFormat:@"%@ (%d)", ToNS(text), code]);
    Forget();
    Close();
  }

 private:
  void Touch() {
    CefRefPtr<ExtensionContext> self(this);
    idle_.Touch(kContextIdleSeconds, ^{
      if (self->page_.Busy()) return self->Touch();
      self->Forget();
      self->Close();
    });
  }
  void Forget() {
    auto it = gExtensionContexts.find(key_.UTF8String);
    if (it != gExtensionContexts.end() && it->second.get() == this) gExtensionContexts.erase(it);
  }

  NSString *key_;
  NSString *profile_;
  NSString *extensionId_;
  Page page_;
  IdleTimer idle_;
  bool closeWhenCreated_ = false;
  IMPLEMENT_REFCOUNTING(ExtensionContext);
};

NSString *ContextKey(NSString *profile, NSString *extensionId) {
  return [NSString stringWithFormat:@"%@|%@", DataProfile(profile), extensionId];
}

}  // namespace

// MARK: - nn::pages

namespace nn::pages {

NSString *DataProfile(NSString *profile) { return IsIncognito(profile) ? @"" : (profile ?: @""); }

NSString *Script(NSString *format, NSArray *args) {
  NSMutableString *out = [NSMutableString string];
  NSArray<NSString *> *parts = [format componentsSeparatedByString:@"%@"];
  for (NSUInteger i = 0; i < parts.count; i++) {
    [out appendString:parts[i]];
    if (i + 1 < parts.count) [out appendString:ToJSON(i < args.count ? args[i] : [NSNull null])];
  }
  return out;
}

void WebUIEval(NSString *profile, NSString *url, NSString *expression, EvalCompletion completion) {
  if (![NNCef isStarted]) return completion(nil, @"engine not started");
  HostFor(profile, url)->Eval(expression, completion);
}

void SetWebUIDialogPath(NSString *profile, NSString *url, NSString *path) { HostFor(profile, url)->SetDialogPath(path); }

void ExtensionEval(NSString *profile, NSString *extensionId, NSString *expression, EvalCompletion completion) {
  if (![NNCef isStarted] || !ext::IsExtensionId(extensionId)) return completion(nil, @"unavailable");
  NSString *key = ContextKey(profile, extensionId);
  auto it = gExtensionContexts.find(key.UTF8String);
  CefRefPtr<ExtensionContext> context;
  if (it != gExtensionContexts.end()) {
    context = it->second;
  } else {
    context = new ExtensionContext(key, DataProfile(profile), extensionId);
    gExtensionContexts[key.UTF8String] = context;
    context->Start();
  }
  context->Eval(expression, completion);
}

void CloseExtensionContext(NSString *profile, NSString *extensionId) {
  auto it = gExtensionContexts.find(ContextKey(profile, extensionId).UTF8String);
  if (it == gExtensionContexts.end()) return;
  CefRefPtr<ExtensionContext> context = it->second;
  gExtensionContexts.erase(it);
  context->Close();
}

void CloseAll() {
  auto hosts = gHosts;
  gHosts.clear();
  for (auto &[_, host] : hosts) host->Close();
  auto contexts = gExtensionContexts;
  gExtensionContexts.clear();
  for (auto &[_, context] : contexts) context->Close();
}

void WhenProfileReady(NSString *profile, void (^ready)(CefRefPtr<CefRequestContext> context)) {
  // A context sharing the profile's storage is created just to get the callback.
  ready = [ready copy];
  CefRequestContext::CreateContext(ContextForProfile(profile), new ContextReady(^(CefRefPtr<CefRequestContext> context) {
    // Our hidden Chrome windows are normal windows to Chrome's session service:
    // "continue where you left off" would reopen every one of them, visibly.
    static NSMutableSet<NSString *> *prepared = [NSMutableSet set];
    if (![prepared containsObject:profile]) {
      [prepared addObject:profile];
      CefRefPtr<CefValue> startup = CefValue::Create();
      startup->SetInt(5);  // the New Tab page
      CefString error;
      if (!context->SetPreference("session.restore_on_startup", startup, error))
        NSLog(@"[cef] session.restore_on_startup: %@", ToNS(error));
      // Downloads show in our popover: Chrome's own bubble would pop up over the page.
      CefRefPtr<CefValue> off = CefValue::Create();
      off->SetBool(false);
      if (!IsIncognito(profile) && !context->SetPreference("download_bubble.partial_view_enabled", off, error))
        NSLog(@"[cef] download_bubble.partial_view_enabled: %@", ToNS(error));
      // The content blocker, before the profile's first tab (incognito uses its original profile's).
      if (IsIncognito(profile)) {
        WhenProfileReady(DataProfile(profile), ^(CefRefPtr<CefRequestContext>) {});
      } else {
        // A profile created just now finishes setting up its extension system after this:
        // load again once it has (loading replaces the earlier copy).
        NSString *prefs = [ProfileDirectory(profile) stringByAppendingPathComponent:@"Preferences"];
        bool fresh = ![NSFileManager.defaultManager fileExistsAtPath:prefs];
        blocker::LoadIntoProfile(context);
        if (fresh)
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            blocker::LoadIntoProfile(context);
          });
      }
    }
    ready(context);
  }));
}

}  // namespace nn::pages
