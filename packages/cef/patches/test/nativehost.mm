// Acceptance test for the patched CEF (WP1): Chrome-style tabs hosted in our own NSView.
//
// A Chrome-style CefBrowserView with CefBrowserSettings.native_contents_hosting lives in an
// invisible "ghost" CefWindow (alpha 0, click-through). Each tab's native view
// (CefBrowserHost::GetContentsView) goes into a plain AppKit window of ours. Checks:
//   - the tab keeps its own compositor: a CALayerHost under RenderWidgetHostViewCocoa, and
//     the page's requestAnimationFrame rate while hosted;
//   - CefBrowserHost::CreateTabInBrowser adds a second tab (own client) to the same Chrome
//     window, also hostable; SetWindowActive doesn't crash;
//   - CefGetMediaCaptureSourceId returns a web-contents-media-stream:// id;
//   - H.264/AAC support (MediaSource.isTypeSupported / canPlayType).
// Never takes focus: activation policy Prohibited, our window is ordered back.
// Prints "RESULT <name> <value>" lines and exits.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/cef_client.h"
#include "include/cef_media_capture.h"
#include "include/cef_netnyahoo.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_library_loader.h"

static void Log(NSString *fmt, ...) NS_FORMAT_FUNCTION(1, 2);
static void Log(NSString *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  NSString *s = [[NSString alloc] initWithFormat:fmt arguments:ap];
  va_end(ap);
  fprintf(stdout, "[nativehost %.3f] %s\n", CACurrentMediaTime(), s.UTF8String);
  fflush(stdout);
}

@interface TestApp : NSApplication <CefAppProtocol> {
  BOOL _h;
}
@end
@implementation TestApp
- (BOOL)isHandlingSendEvent { return _h; }
- (void)setHandlingSendEvent:(BOOL)v { _h = v; }
- (void)sendEvent:(NSEvent *)e {
  CefScopedSendingEvent s;
  [super sendEvent:e];
}
@end

static NSWindow *gOurWindow;
static NSView *gSlot1, *gSlot2;
static CefRefPtr<CefWindow> gCefWindow;
static CefRefPtr<CefBrowserView> gBrowserView;
static CefRefPtr<CefBrowser> gBrowser1, gBrowser2;

static NSView *FindClass(NSView *v, NSString *cls) {
  if ([NSStringFromClass(v.class) isEqual:cls]) return v;
  for (NSView *s in v.subviews)
    if (NSView *r = FindClass(s, cls)) return r;
  return nil;
}
static CALayer *FindLayerHost(CALayer *l) {
  if ([l isKindOfClass:NSClassFromString(@"CALayerHost")]) return l;
  for (CALayer *s in l.sublayers)
    if (CALayer *h = FindLayerHost(s)) return h;
  return nil;
}

static int gTabStripEvents = 0;
static int gCreated = 0;
static CefRefPtr<CefBrowser> gPopup;

class Client : public CefClient, public CefDisplayHandler, public CefLifeSpanHandler {
 public:
  explicit Client(const char *name) : name_(name) {}
  void OnTabStripChanged(CefRefPtr<CefBrowser> b, int index, bool active, bool pinned) override {
    gTabStripEvents++;
    Log(@"OnTabStripChanged %s id=%d index=%d active=%d pinned=%d", name_, b->GetIdentifier(), index, active, pinned);
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int, const CefString &url, const CefString &,
                     WindowOpenDisposition, bool, const CefPopupFeatures &, CefWindowInfo &,
                     CefRefPtr<CefClient> &client, CefBrowserSettings &, CefRefPtr<CefDictionaryValue> &,
                     bool *) override {
    Log(@"OnBeforePopup %s -> %s", name_, url.ToString().c_str());
    client = new Client("popup");
    return false;  // allow: becomes a tab of the opener's Chrome window
  }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> b) override {
    Log(@"OnAfterCreated %s id=%d url=%s", name_, b->GetIdentifier(),
        b->GetMainFrame() ? b->GetMainFrame()->GetURL().ToString().c_str() : "");
    gCreated++;
    if (!gBrowser1) gBrowser1 = b;
    if (!strcmp(name_, "popup")) gPopup = b;
  }
  bool OnConsoleMessage(CefRefPtr<CefBrowser> b, cef_log_severity_t, const CefString &m, const CefString &,
                        int) override {
    // The page reports results as console messages starting with "RESULT ".
    std::string s = m.ToString();
    if (s.rfind("RESULT ", 0) == 0) {
      fprintf(stdout, "%s [%s]\n", s.c_str(), name_);
      fflush(stdout);
    }
    return true;
  }
  const char *name_;
  IMPLEMENT_REFCOUNTING(Client);
};

class BVDelegate : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override { return CEF_CTT_NONE; }
  IMPLEMENT_REFCOUNTING(BVDelegate);
};

class WinDelegate : public CefWindowDelegate {
 public:
  void OnWindowCreated(CefRefPtr<CefWindow> w) override {
    w->AddChildView(gBrowserView);
    NSWindow *nw = ((__bridge NSView *)w->GetWindowHandle()).window;
    nw.alphaValue = 0;  // the ghost: never visible, never clickable
    nw.ignoresMouseEvents = YES;
    w->Show();
    [nw orderWindow:NSWindowBelow relativeTo:gOurWindow.windowNumber];
  }
  bool CanClose(CefRefPtr<CefWindow>) override { return true; }
  CefRect GetInitialBounds(CefRefPtr<CefWindow>) override { return CefRect(2400, 40, 600, 400); }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  IMPLEMENT_REFCOUNTING(WinDelegate);
};

static void Host(CefRefPtr<CefBrowser> browser, NSView *slot, const char *name) {
  NSView *view = (__bridge NSView *)browser->GetHost()->GetContentsView();
  Log(@"%s GetContentsView -> %@", name, view ? NSStringFromClass(view.class) : @"(null)");
  if (!view) return;
  [view removeFromSuperview];
  view.frame = slot.bounds;
  view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [slot addSubview:view];
  browser->GetHost()->WasResized();
}

static void Check(CefRefPtr<CefBrowser> browser, NSView *slot, const char *name) {
  NSView *rw = FindClass(slot, @"RenderWidgetHostViewCocoa");
  CALayer *host = rw ? FindLayerHost(rw.layer) : nil;
  fprintf(stdout, "RESULT layerhost %s [%s]\n",
          host ? [NSString stringWithFormat:@"contextId=%u", [[host valueForKey:@"contextId"] unsignedIntValue]].UTF8String
               : "MISSING",
          name);
  CefString sid = CefGetMediaCaptureSourceId(browser);
  fprintf(stdout, "RESULT capture_id %s [%s]\n", sid.ToString().c_str(), name);
  fflush(stdout);
  // rAF rate over one second + codec support, reported via console.
  browser->GetMainFrame()->ExecuteJavaScript(
      "(() => { let n = 0; const t0 = performance.now();"
      "  const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f);"
      "    else console.log('RESULT raf_fps ' + n); }; requestAnimationFrame(f);"
      "  console.log('RESULT h264_mse ' + MediaSource.isTypeSupported('video/mp4; codecs=\"avc1.42E01E\"'));"
      "  console.log('RESULT aac_mse ' + MediaSource.isTypeSupported('audio/mp4; codecs=\"mp4a.40.2\"'));"
      "  console.log('RESULT h264_canplay ' + document.createElement('video').canPlayType('video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"'));"
      "  console.log('RESULT visibility ' + document.visibilityState); })()",
      "", 0);
}

class App : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnBeforeCommandLineProcessing(const CefString &type, CefRefPtr<CefCommandLine> cl) override {
    if (type.empty()) {
      cl->AppendSwitch("use-mock-keychain");
      cl->AppendSwitch("disable-popup-blocking");
    }
  }
  void OnContextInitialized() override {
    gOurWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 900, 400)
                                             styleMask:NSWindowStyleMaskBorderless
                                               backing:NSBackingStoreBuffered
                                                 defer:NO];
    gOurWindow.contentView.wantsLayer = YES;
    gSlot1 = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 450, 400)];
    gSlot2 = [[NSView alloc] initWithFrame:NSMakeRect(450, 0, 450, 400)];
    gSlot1.wantsLayer = gSlot2.wantsLayer = YES;
    [gOurWindow.contentView addSubview:gSlot1];
    [gOurWindow.contentView addSubview:gSlot2];
    [gOurWindow setFrameOrigin:NSMakePoint(2400, 40)];
    [gOurWindow orderBack:nil];

    CefBrowserSettings bs;
    bs.native_contents_hosting = STATE_ENABLED;
    gBrowserView = CefBrowserView::CreateBrowserView(new Client("tab1"), url_, bs, nullptr, nullptr, new BVDelegate());
    gCefWindow = CefWindow::CreateTopLevelWindow(new WinDelegate());

    if (getenv("STORE_TEST")) {
      // Chrome Web Store: the page gets chrome.webstorePrivate; the external
      // extension JSON placed by the caller exercises update check + CRX download.
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!gBrowser1) gBrowser1 = gBrowserView->GetBrowser();
        Host(gBrowser1, gSlot1, "tab1");
      });
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        gBrowser1->GetMainFrame()->ExecuteJavaScript(
            "console.log('RESULT webstorePrivate ' + typeof (window.chrome && chrome.webstorePrivate));"
            "console.log('RESULT store_button ' + JSON.stringify([...document.querySelectorAll('button')]"
            ".map(b => b.innerText.trim()).filter(t => /chrome|add|remove/i.test(t)).slice(0, 3)));"
            "console.log('RESULT store_url ' + location.host);",
            "", 0);
      });
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        exit(0);
      });
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      if (!gBrowser1) gBrowser1 = gBrowserView->GetBrowser();
      Host(gBrowser1, gSlot1, "tab1");
      CefBrowserSettings bs2;
      bs2.native_contents_hosting = STATE_ENABLED;
      gBrowser2 = CefBrowserHost::CreateTabInBrowser(gBrowser1, new Client("tab2"), url_, bs2, nullptr,
                                                     /*foreground=*/getenv("TAB2_FOREGROUND") != nullptr);
      fprintf(stdout, "RESULT create_tab %s\n", gBrowser2 ? "ok" : "FAILED");
      if (gBrowser2) Host(gBrowser2, gSlot2, "tab2");
      gBrowser1->GetHost()->SetWindowActive(true);
      fprintf(stdout, "RESULT set_window_active ok\n");
      fflush(stdout);
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      Check(gBrowser1, gSlot1, "tab1");
      if (gBrowser2) Check(gBrowser2, gSlot2, "tab2");
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 7 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      if (!gBrowser2) return;
      auto h2 = gBrowser2->GetHost();
      fprintf(stdout, "RESULT tab_ids %d %d\n", gBrowser1->GetHost()->GetTabId(), h2->GetTabId());
      h2->ActivateTab();
      h2->SetTabPinned(true);
      h2->SetTabIndex(0);
      fprintf(stdout, "RESULT password_prompt %s\n", h2->GetPasswordPrompt() ? "present" : "none");
      CefString ext = gBrowser2->GetHost()->GetRequestContext()->LoadComponentExtension(
          "/Users/barreloflube/chromium-build/tests/ext");
      fprintf(stdout, "RESULT component_extension %s\n", ext.empty() ? "FAILED" : ext.ToString().c_str());
      fflush(stdout);
      // window.open from a hosted tab: expect a background tab in the same Chrome window.
      gBrowser2->GetMainFrame()->ExecuteJavaScript("window.open('about:blank#popup')", "", 0);
      std::string extId = ext.ToString();
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!extId.empty())
          fprintf(stdout, "RESULT extension_action %d\n", gBrowser2->GetHost()->ExecuteExtensionAction(extId));
        fprintf(stdout, "RESULT popup_tab %s tab_id=%d\n", gPopup ? "created" : "MISSING",
                gPopup ? gPopup->GetHost()->GetTabId() : -1);
        fprintf(stdout, "RESULT tab_strip_events %d\n", gTabStripEvents);
        fprintf(stdout, "RESULT browsers_created %d (tab1, tab2, popup, tabs.create)\n", gCreated);
        fflush(stdout);
        // Close the first (CefBrowserView) tab: the Chrome window must stay alive for the others.
        gBrowser1->GetHost()->CloseBrowser(true);
      });
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        CefBrowserSettings bs3;
        bs3.native_contents_hosting = STATE_ENABLED;
        auto b3 = CefBrowserHost::CreateTabInBrowser(gBrowser2, new Client("tab3"), "about:blank", bs3, nullptr, true);
        fprintf(stdout, "RESULT after_first_tab_closed %s\n", b3 ? "window alive, new tab ok" : "FAILED");
        fflush(stdout);
        exit(0);  // results are printed; skip orderly shutdown
      });
    });
  }
  std::string url_;
  IMPLEMENT_REFCOUNTING(App);
};

int main(int argc, char *argv[]) {
  @autoreleasepool {
    CefScopedLibraryLoader loader;
    if (!loader.LoadInMain()) return 1;
    CefMainArgs mainArgs(argc, argv);
    [TestApp sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSString *root =
        [[NSBundle.mainBundle.executablePath stringByDeletingLastPathComponent] stringByDeletingLastPathComponent];
    CefSettings s;
    s.no_sandbox = true;
    s.log_severity = LOGSEVERITY_WARNING;
    CefString(&s.root_cache_path) = "/tmp/nn-chromium-nativehost";
    CefString(&s.cache_path) = "/tmp/nn-chromium-nativehost/Default";
    CefString(&s.browser_subprocess_path) =
        [root stringByAppendingPathComponent:@"Frameworks/nativehost Helper.app/Contents/MacOS/nativehost Helper"]
            .UTF8String;
    CefRefPtr<App> app = new App();
    app->url_ = argc > 1 && argv[1][0] != '-' ? argv[1] : "file:///Users/barreloflube/chromium-build/tests/page.html";
    if (!CefInitialize(mainArgs, s, app, nullptr)) return 2;
    CefRunMessageLoop();
    CefShutdown();
  }
  return 0;
}
