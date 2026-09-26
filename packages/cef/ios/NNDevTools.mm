// DevTools protocol calls on our own browsers (Runtime.evaluate with a user
// gesture, Storage.clearDataForOrigin…). An observer is attached lazily, the
// first time a browser needs one.
#import "NNCefInternal.h"

#include <algorithm>
#include <map>
#include <optional>
#include <vector>

#include "include/cef_devtools_message_observer.h"
#include "include/cef_display_handler.h"
#include "include/cef_keyboard_handler.h"
#include "include/cef_load_handler.h"
#include "include/cef_navigation_entry.h"
#include "include/cef_parser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_display.h"
#include "include/views/cef_window.h"

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
// Every DevTools window open (F12 in one closes it).
std::vector<CefRefPtr<CefBrowser>> gWindows;

/// Dia's title for its DevTools window, "Developer Tools - <url>": the frontend's own title, which
/// follows the inspected page (our engine's; stock Chrome's says "DevTools - <url>").
CefString WindowTitle(const CefString &frontendTitle) {
  NSString *title = ToNS(frontendTitle);
  NSString *stock = @"DevTools - ";
  if ([title hasPrefix:stock]) return ToCef([@"Developer Tools - " stringByAppendingString:[title substringFromIndex:stock.length]]);
  return [title hasPrefix:@"Developer Tools"] ? frontendTitle : ToCef(@"Developer Tools");
}

/// The window of an undocked DevTools browser (ours, OpenDevToolsWindow), if it has one.
CefRefPtr<CefWindow> WindowOf(CefRefPtr<CefBrowser> browser) {
  CefRefPtr<CefBrowserView> view = CefBrowserView::GetForBrowser(browser);
  return view ? view->GetWindow() : nullptr;
}

/// Closes a DevTools window: through our window when it has one (which closes the browser first),
/// else its browser (Chrome's own DevTools window closes with it).
void CloseFrontend(CefRefPtr<CefBrowser> browser) {
  if (CefRefPtr<CefWindow> window = WindowOf(browser)) window->Close();
  else browser->GetHost()->CloseBrowser(false);
}

/// F12 (no modifiers), Chrome's DevTools toggle key.
bool IsF12(const CefKeyEvent &event) {
  const int modifiers = EVENTFLAG_SHIFT_DOWN | EVENTFLAG_CONTROL_DOWN | EVENTFLAG_ALT_DOWN | EVENTFLAG_COMMAND_DOWN;
  return event.type == KEYEVENT_RAWKEYDOWN && event.windows_key_code == 0x7B /* VKEY_F12 */ && !(event.modifiers & modifiers);
}

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

/// Client of a DevTools window: remembers it, opens a panel once loaded, titles its window
/// like Dia's and closes it on F12, as Chrome's DevTools window does (IDC_DEV_TOOLS_TOGGLE).
class FrontendClient : public CefClient,
                       public CefLifeSpanHandler,
                       public CefLoadHandler,
                       public CefDisplayHandler,
                       public CefKeyboardHandler {
 public:
  FrontendClient(int inspectedId, NSString *panel) : inspectedId_(inspectedId), panel_([panel copy]) {}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    gFrontends[inspectedId_] = browser;
    gWindows.push_back(browser);
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    auto it = gFrontends.find(inspectedId_);
    if (it != gFrontends.end() && it->second->IsSame(browser)) gFrontends.erase(it);
    std::erase_if(gWindows, [&](const CefRefPtr<CefBrowser> &b) { return b->IsSame(browser); });
  }
  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString &title) override {
    if (CefRefPtr<CefWindow> window = WindowOf(browser)) window->SetTitle(WindowTitle(title));
  }
  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle, bool *) override {
    if (!IsF12(event)) return false;
    CloseFrontend(browser);
    return true;
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

/// Where the profile's undocked DevTools window was left: Chrome's own record
/// (`browser.app_window_placement` › DevToolsApp: left, top, right, bottom in screen points), which
/// Chrome's DevTools window reads and writes too (DevTools of a tab Chrome made, rather than the
/// window's first one, open in Chrome's window).
constexpr char kPlacementPref[] = "browser.app_window_placement";
constexpr char kDevToolsApp[] = "DevToolsApp";

std::optional<CefRect> SavedPlacement(CefRefPtr<CefRequestContext> context) {
  CefRefPtr<CefValue> all = context ? context->GetPreference(kPlacementPref) : nullptr;
  CefRefPtr<CefDictionaryValue> dict = all && all->GetType() == VTYPE_DICTIONARY ? all->GetDictionary() : nullptr;
  CefRefPtr<CefDictionaryValue> saved = dict && dict->HasKey(kDevToolsApp) ? dict->GetDictionary(kDevToolsApp) : nullptr;
  if (!saved || !saved->HasKey("left") || !saved->HasKey("top") || !saved->HasKey("right") || !saved->HasKey("bottom"))
    return std::nullopt;
  const int left = saved->GetInt("left"), top = saved->GetInt("top");
  return CefRect(left, top, saved->GetInt("right") - left, saved->GetInt("bottom") - top);
}

void SavePlacement(CefRefPtr<CefRequestContext> context, const CefRect &bounds, const CefRect &workArea) {
  CefRefPtr<CefValue> all = context ? context->GetPreference(kPlacementPref) : nullptr;
  if (!all) return;
  CefRefPtr<CefDictionaryValue> dict =
      all->GetType() == VTYPE_DICTIONARY ? all->GetDictionary()->Copy(false) : CefDictionaryValue::Create();
  CefRefPtr<CefDictionaryValue> saved =
      dict->HasKey(kDevToolsApp) ? dict->GetDictionary(kDevToolsApp)->Copy(false) : CefDictionaryValue::Create();
  saved->SetInt("left", bounds.x);
  saved->SetInt("top", bounds.y);
  saved->SetInt("right", bounds.x + bounds.width);
  saved->SetInt("bottom", bounds.y + bounds.height);
  saved->SetBool("maximized", false);
  saved->SetInt("work_area_left", workArea.x);
  saved->SetInt("work_area_top", workArea.y);
  saved->SetInt("work_area_right", workArea.x + workArea.width);
  saved->SetInt("work_area_bottom", workArea.y + workArea.height);
  dict->SetDictionary(kDevToolsApp, saved);
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetDictionary(dict);
  CefString error;
  if (!context->SetPreference(kPlacementPref, value, error)) NSLog(@"[devtools] placement: %@", ToNS(error));
}

/// The undocked DevTools window of a tab the window's own browser view hosts: Dia's title, and
/// the frame the profile's DevTools window was left at (Chrome's default the first time: 640 ×
/// 640, 100 pt in from the work area's corner; and again after a window under 400 pt either way).
class WindowDelegate : public CefWindowDelegate {
 public:
  explicit WindowDelegate(CefRefPtr<CefBrowserView> view) : view_(view) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->AddChildView(view_);
    // Undocking moves a loaded frontend here: its title (OnTitleChange) came before the window.
    CefRefPtr<CefBrowser> browser = view_->GetBrowser();
    CefRefPtr<CefNavigationEntry> entry = browser ? browser->GetHost()->GetVisibleNavigationEntry() : nullptr;
    window->SetTitle(WindowTitle(entry ? entry->GetTitle() : CefString()));
    window->Show();
    view_->RequestFocus();
  }
  void OnWindowDestroyed(CefRefPtr<CefWindow>) override { view_ = nullptr; }
  bool CanClose(CefRefPtr<CefWindow>) override {
    CefRefPtr<CefBrowser> browser = view_ ? view_->GetBrowser() : nullptr;
    // The browser closes first (beforeunload); CEF closes the window again once it's gone.
    return browser && browser->IsValid() ? browser->GetHost()->TryCloseBrowser() : true;
  }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return view_->GetRuntimeStyle(); }
  CefRect GetInitialBounds(CefRefPtr<CefWindow>) override {
    if (std::optional<CefRect> saved = SavedPlacement(Context())) {
      const CefRect rect = *saved;
      CefRefPtr<CefDisplay> display = CefDisplay::GetDisplayMatchingBounds(rect, false);
      CefRect area = display ? display->GetWorkArea() : CefRect();
      const int shownWidth = std::min(rect.x + rect.width, area.x + area.width) - std::max(rect.x, area.x);
      const int shownHeight = std::min(rect.y + rect.height, area.y + area.height) - std::max(rect.y, area.y);
      // Also back to the default: a window left mostly off screen (a display since unplugged).
      if (rect.width >= 400 && rect.height >= 400 && shownWidth >= 100 && shownHeight >= 100) return rect;
    }
    CefRect area = CefDisplay::GetPrimaryDisplay()->GetWorkArea();
    return CefRect(area.x + 100, area.y + 100, 640, 640);
  }
  void OnWindowBoundsChanged(CefRefPtr<CefWindow> window, const CefRect &bounds) override {
    if (window->IsMinimized() || window->IsFullscreen() || window->IsMaximized() || bounds.IsEmpty()) return;
    CefRefPtr<CefDisplay> display = window->GetDisplay();
    SavePlacement(Context(), bounds, display ? display->GetWorkArea() : CefRect());
  }
  bool CanResize(CefRefPtr<CefWindow>) override { return true; }
  bool CanMaximize(CefRefPtr<CefWindow>) override { return true; }
  bool CanMinimize(CefRefPtr<CefWindow>) override { return true; }

 private:
  CefRefPtr<CefRequestContext> Context() {
    CefRefPtr<CefBrowser> browser = view_ ? view_->GetBrowser() : nullptr;
    return browser ? browser->GetHost()->GetRequestContext() : nullptr;
  }

  CefRefPtr<CefBrowserView> view_;
  IMPLEMENT_REFCOUNTING(WindowDelegate);
};

}  // namespace

bool OpenDevToolsWindow(CefRefPtr<CefBrowserView> view) {
  if (!view) return false;
  CefWindow::CreateTopLevelWindow(new WindowDelegate(view));
  return true;
}

bool CloseKeyDevToolsWindow() {
  NSWindow *key = NSApp.keyWindow;
  if (!key) return false;
  for (auto &browser : gWindows) {
    NSView *view = (__bridge NSView *)browser->GetHost()->GetWindowHandle();
    if (view.window != key) continue;
    CloseFrontend(browser);
    return true;
  }
  return false;
}

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

CefRefPtr<CefClient> DevToolsFrontendClient(CefRefPtr<CefBrowser> inspected) {
  return new FrontendClient(inspected->GetIdentifier(), nil);
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
