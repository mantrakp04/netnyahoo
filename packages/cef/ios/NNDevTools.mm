// DevTools protocol calls on our own browsers (Runtime.evaluate with a user
// gesture, Storage.clearDataForOrigin…). An observer is attached lazily, the
// first time a browser needs one.
#import "NNCefInternal.h"

#include <map>

#include "include/cef_devtools_message_observer.h"
#include "include/cef_load_handler.h"
#include "include/cef_parser.h"

namespace nn {

namespace {

std::map<int, void (^)(NSDictionary *)> gCalls;  // by message id
std::map<int, CefRefPtr<CefRegistration>> gRegistrations;  // by browser id

class Observer : public CefDevToolsMessageObserver {
 public:
  void OnDevToolsMethodResult(CefRefPtr<CefBrowser> browser, int message_id, bool success, const void *result,
                              size_t result_size) override {
    auto it = gCalls.find(message_id);
    if (it == gCalls.end()) return;
    auto completion = it->second;
    gCalls.erase(it);
    NSData *data = [NSData dataWithBytes:result length:result_size];
    id object = success ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    completion([object isKindOfClass:NSDictionary.class] ? object : nil);
  }

 private:
  IMPLEMENT_REFCOUNTING(Observer);
};

// The DevTools window of each inspected browser (by its id), to switch panels
// in a window that's already open.
std::map<int, CefRefPtr<CefBrowser>> gFrontends;

/// Shows `panel` ("console", "elements"…) in a DevTools frontend. Its inspector
/// view comes up a while after the page loads (and picks its last panel), so
/// this retries until the panel is the selected one, for up to five seconds.
void ShowPanel(CefRefPtr<CefBrowser> frontend, NSString *panel) {
  NSString *js = [NSString stringWithFormat:
      @"(async function show(panel, n) {"
       "  let view = null;"
       // Absolute: this script has no URL of its own to resolve a relative import against.
       "  const legacy = new URL('ui/legacy/legacy.js', location.href).href;"
       "  try { view = (await import(legacy)).InspectorView.InspectorView.maybeGetInspectorViewInstance(); } catch (e) {}"
       "  try {"
       "    if (view && view.tabbedPane.selectedTabId === panel) return;"
       "    if (view) DevToolsAPI.showPanel(panel);"
       "  } catch (e) {}"
       "  if (n > 0) setTimeout(() => show(panel, n - 1), 100);"
       "  else if (!view) DevToolsAPI.showPanel(panel);"
       "})(%@, 50);",
      ToJSON(panel)];
  CefRefPtr<CefFrame> frame = frontend->GetMainFrame();
  frame->ExecuteJavaScript(ToCef(js), frame->GetURL(), 0);
}

/// Client of a DevTools window we open: remembers it, and opens a panel once loaded.
class FrontendClient : public CefClient, public CefLifeSpanHandler, public CefLoadHandler {
 public:
  FrontendClient(int inspectedId, NSString *panel) : inspectedId_(inspectedId), panel_([panel copy]) {}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override { gFrontends[inspectedId_] = browser; }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    auto it = gFrontends.find(inspectedId_);
    if (it != gFrontends.end() && it->second->IsSame(browser)) gFrontends.erase(it);
  }
  void OnLoadEnd(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int) override {
    if (!frame->IsMain() || !panel_.length) return;
    ShowPanel(browser, panel_);
    panel_ = nil;
  }

 private:
  int inspectedId_;
  NSString *panel_;
  IMPLEMENT_REFCOUNTING(FrontendClient);
};

}  // namespace

void DevToolsForget(int browserId) {
  gRegistrations.erase(browserId);
  gFrontends.erase(browserId);
}

void ShowDevTools(CefRefPtr<CefBrowser> browser, NSString *panel, CefPoint inspectAt) {
  if (!browser) return;
  auto open = gFrontends.find(browser->GetIdentifier());
  if (open != gFrontends.end() && panel.length) ShowPanel(open->second, panel);
  CefWindowInfo info;
  CefBrowserSettings settings;
  // Ignored (the window is just focused) when it's already open.
  browser->GetHost()->ShowDevTools(info, new FrontendClient(browser->GetIdentifier(), panel), settings, inspectAt);
}

void DevToolsCall(CefRefPtr<CefBrowser> browser, NSString *method, NSDictionary *params,
                  void (^completion)(NSDictionary *result)) {
  if (!browser) {
    if (completion) completion(nil);
    return;
  }
  int bid = browser->GetIdentifier();
  if (!gRegistrations.count(bid)) gRegistrations[bid] = browser->GetHost()->AddDevToolsMessageObserver(new Observer());
  CefRefPtr<CefDictionaryValue> dict;
  if (params.count) {
    CefRefPtr<CefValue> value = CefParseJSON(ToCef(ToJSON(params)), JSON_PARSER_RFC);
    if (value && value->GetType() == VTYPE_DICTIONARY) dict = value->GetDictionary();
  }
  int id = browser->GetHost()->ExecuteDevToolsMethod(0, ToCef(method), dict);
  if (!id) {
    if (completion) completion(nil);
    return;
  }
  gCalls[id] = completion ? (void (^)(NSDictionary *))[completion copy] : ^(NSDictionary *) {};
}

void EvaluateWithGesture(CefRefPtr<CefBrowser> browser, NSString *expression, void (^completion)(id value)) {
  NSDictionary *params =
      @{@"expression" : expression, @"userGesture" : @YES, @"awaitPromise" : @YES, @"returnByValue" : @YES};
  DevToolsCall(browser, @"Runtime.evaluate", params, ^(NSDictionary *result) {
    if (completion) completion(result[@"result"][@"value"]);
  });
}

}  // namespace nn
