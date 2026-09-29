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

#if __has_include("include/cef_media_capture.h")
#define NN_TAB_CAPTURE 1
#else
#define NN_TAB_CAPTURE 0
#endif

#ifndef NN_CHROME_TABS
#define NN_CHROME_TABS 1
#endif

#if NN_CHROME_TABS && __has_include("include/cef_netnyahoo.h")
#include "include/cef_netnyahoo.h"
#endif
#if NN_CHROME_TABS && !defined(CEF_NN_CHROME_TABS)
#error "NN_CHROME_TABS needs our CEF build (packages/cef/scripts/setup.sh); against stock CEF (CEF_PREBUILT=1) build with NN_CHROME_TABS=0"
#endif
#if NN_CHROME_TABS && defined(CEF_NN_EXTENSION_ACTION)
#define NN_EXTENSION_ACTION 1
#else
#define NN_EXTENSION_ACTION 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_PASSWORD_PROMPT)
#define NN_PASSWORD_PROMPT 1
#else
#define NN_PASSWORD_PROMPT 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_TAB_STRIP)
#define NN_TAB_STRIP 1
#else
#define NN_TAB_STRIP 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_HIDDEN_BROWSER)
#define NN_HIDDEN_BROWSER 1
#else
#define NN_HIDDEN_BROWSER 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_INSTALL_PROMPT)
#define NN_INSTALL_PROMPT 1
#else
#define NN_INSTALL_PROMPT 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_TAB_HISTORY)
#define NN_TAB_HISTORY 1
#else
#define NN_TAB_HISTORY 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_TAB_DISCARD)
#define NN_TAB_DISCARD 1
#else
#define NN_TAB_DISCARD 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_BROWSING_DATA)
#define NN_BROWSING_DATA 1
#else
#define NN_BROWSING_DATA 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_CLIENT_WINDOW)
#define NN_CLIENT_WINDOW 1
#else
#define NN_CLIENT_WINDOW 0
#endif
#if NN_CLIENT_WINDOW && defined(CEF_NN_TRANSLUCENT_WINDOW)
#define NN_TRANSLUCENT_WINDOW 1
#else
#define NN_TRANSLUCENT_WINDOW 0
#endif
#if NN_CLIENT_WINDOW && defined(CEF_NN_DOCKED_DEVTOOLS)
#define NN_DOCKED_DEVTOOLS 1
#else
#define NN_DOCKED_DEVTOOLS 0
#endif
#if NN_CHROME_TABS && defined(CEF_NN_POPUP_TABS)
#define NN_POPUP_TABS 1
#else
#define NN_POPUP_TABS 0
#endif

class CefBrowserView;

namespace nn {

constexpr bool kTabCaptureSupported = NN_TAB_CAPTURE;

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
void DownloadFavicon(CefRefPtr<CefBrowser> browser, NSString *url, NSString *name, void (^completion)(NSDictionary *));
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
                      CefRefPtr<CefBeforeDownloadCallback> callback);
void OnDownloadUpdated(CefRefPtr<CefDownloadItem> item, CefRefPtr<CefDownloadItemCallback> callback, NSString *profile);

void NoteNavigationDownload(NSString *url, bool persist);
bool WasNavigationDownload(NSString *url);
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
