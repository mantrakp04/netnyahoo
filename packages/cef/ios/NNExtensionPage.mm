#import "NNExtensionPage.h"

#import "NNEngine.h"
#import "NNExtensionPackage.h"

#include <map>
#include <memory>
#include <vector>

using namespace nn;
using namespace nn::extpage;

namespace {

// MARK: - A page we script

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

}

namespace nn::extpage {

NSString *Script(NSString *format, NSArray *args) {
  NSMutableString *out = [NSMutableString string];
  NSArray<NSString *> *parts = [format componentsSeparatedByString:@"%@"];
  for (NSUInteger i = 0; i < parts.count; i++) {
    [out appendString:parts[i]];
    if (i + 1 < parts.count) [out appendString:ToJSON(i < args.count ? args[i] : [NSNull null])];
  }
  return out;
}

void Eval(NSString *profile, NSString *extensionId, NSString *expression, EvalCompletion completion) {
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

void Close(NSString *profile, NSString *extensionId) {
  auto it = gExtensionContexts.find(ContextKey(profile, extensionId).UTF8String);
  if (it == gExtensionContexts.end()) return;
  CefRefPtr<ExtensionContext> context = it->second;
  gExtensionContexts.erase(it);
  context->Close();
}

void CloseAll() {
  auto contexts = gExtensionContexts;
  gExtensionContexts.clear();
  for (auto &[_, context] : contexts) context->Close();
}

}
