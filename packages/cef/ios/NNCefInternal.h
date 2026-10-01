#pragma once

#import "NNCef.h"

#include <functional>
#include <string>

#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_download_handler.h"
#include "include/cef_permission_handler.h"
#include "include/cef_request_context.h"
#include "include/views/cef_window.h"

// The engine is our own CEF build (packages/cef/patches, docs/cef-source-build.md), never stock CEF. Its API
// additions are marked in cef_netnyahoo.h; this fails the build at once against a distribution that lacks one.
#if !__has_include("include/cef_netnyahoo.h")
#error "packages/cef/vendor/cef isn't our CEF build: run packages/cef/scripts/setup.sh (docs/cef-source-build.md)"
#endif
#include "include/cef_netnyahoo.h"
#if !defined(CEF_NN_CHROME_TABS) || !defined(CEF_NN_EXTENSION_ACTION) || !defined(CEF_NN_PASSWORD_PROMPT) || \
    !defined(CEF_NN_TAB_STRIP) || !defined(CEF_NN_HIDDEN_BROWSER) || !defined(CEF_NN_INSTALL_PROMPT) || \
    !defined(CEF_NN_TAB_HISTORY) || !defined(CEF_NN_TAB_DISCARD) || !defined(CEF_NN_BROWSING_DATA) || \
    !defined(CEF_NN_CLIENT_WINDOW) || !defined(CEF_NN_TRANSLUCENT_WINDOW) || !defined(CEF_NN_DOCKED_DEVTOOLS) || \
    !defined(CEF_NN_POPUP_TABS) || !defined(CEF_NN_TAB_CAPTURE) || !defined(CEF_NN_CHROME_UI) || \
    !defined(CEF_NN_CAPTURE_STOP) || !defined(CEF_NN_AUTOFILL_TRIGGER) || !defined(CEF_NN_MEDIA_REQUEST_SOURCE) || \
    !defined(CEF_NN_OPEN_URL_PARAMS) || !defined(CEF_NN_POPUP_OPENER_SUPPRESSED) || !defined(CEF_NN_PUMP_SCHEDULE) || \
    !defined(CEF_NN_SAFE_STORAGE)
#error "packages/cef/vendor/cef is older than this app: run packages/cef/scripts/setup.sh (docs/cef-source-build.md)"
#endif

class CefBrowserView;

namespace nn {

inline NSString *ToNS(const CefString &s) {
  std::string utf8 = s.ToString();
  return [[NSString alloc] initWithBytes:utf8.data() length:utf8.size() encoding:NSUTF8StringEncoding] ?: @"";
}
inline CefString ToCef(NSString *s) { return CefString(s ? s.UTF8String : ""); }

NSString *ToJSON(id object);
id FromJSON(NSString *json);

NSString *OriginOf(NSString *url);
NSString *HostOf(NSString *url);

CefRefPtr<CefRequestContext> ContextForProfile(NSString *profile);
inline bool IsIncognito(NSString *profile) { return [profile hasPrefix:@"incognito"]; }
NSString *ProfileForContext(CefRefPtr<CefRequestContext> context);
NSString *DataRoot();
NSString *ProfileDirectory(NSString *profile);
void DownloadFavicon(CefRefPtr<CefBrowser> browser, NSString *url, void (^completion)(NSDictionary *));
void DownloadImage(CefRefPtr<CefBrowser> browser, NSString *url, int maxPixels, void (^completion)(NSDictionary *));

bool DisplayMediaPickerEnabled();

namespace activation {
bool Background();
bool Allow(NSString *what);
void Install();
}

bool ShuttingDown();

void ReleaseDiagnostics();

void EmitGlobal(NSString *name, NSDictionary *payload);

bool OnBeforeDownload(CefRefPtr<CefDownloadItem> item, const CefString &suggested_name,
                      CefRefPtr<CefBeforeDownloadCallback> callback, NSString *profile, NSString *origin);
void OnDownloadUpdated(CefRefPtr<CefDownloadItem> item, CefRefPtr<CefDownloadItemCallback> callback, NSString *profile);

void NoteNavigationDownload(NSString *url, NSString *profile);
bool WasNavigationDownload(NSString *url, NSString *profile);
void AllowUserNavigation(NSString *url);
bool ConsumeUserNavigation(NSString *url);

bool RequestPermission(CefRefPtr<CefBrowser> browser, const CefString &origin, uint32_t permissions,
                       CefRefPtr<CefPermissionPromptCallback> callback);
bool RequestMediaAccess(CefRefPtr<CefBrowser> browser, const CefString &origin, uint32_t permissions,
                        CefRefPtr<CefMediaAccessCallback> callback);
void DismissPermissions(CefRefPtr<CefBrowser> browser);

void BrowserCreated(CefRefPtr<CefBrowser> browser);
void BrowserClosed(CefRefPtr<CefBrowser> browser);
// Close Chrome windows before CefShutdown tears down profile services.
void WindowCreated(CefRefPtr<CefWindow> window);
void WindowDestroyed(CefRefPtr<CefWindow> window);

NSArray<NNBrowserView *> *LiveViews();
void RegisterView(NNBrowserView *view);

bool TabTransfersPending();

NSView *ParkingView();

void MakeWindowInert(NSWindow *window);

void CallPage(CefRefPtr<CefFrame> frame, NSString *kind, id payload);

void DevToolsCall(CefRefPtr<CefBrowser> browser, NSString *method, NSDictionary *params,
                  void (^completion)(NSDictionary *result));
void DevToolsForget(int browserId);
void EvaluateWithGesture(CefRefPtr<CefBrowser> browser, NSString *expression,
                         void (^completion)(id value));
void ShowDevTools(CefRefPtr<CefBrowser> browser, NSString *panel, CefPoint inspectAt = CefPoint());
CefRefPtr<CefClient> DevToolsFrontendClient(CefRefPtr<CefBrowser> inspected);
bool OpenDevToolsWindow(CefRefPtr<CefBrowserView> view);
bool CloseKeyDevToolsWindow();

}
