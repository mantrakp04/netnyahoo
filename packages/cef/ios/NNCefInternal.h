// Shared by the Objective-C++ sources of this pod. Objective-C++ only.
#pragma once

#import "NNCef.h"

#include <functional>
#include <string>

#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_download_handler.h"
#include "include/cef_permission_handler.h"
#include "include/cef_request_context.h"

// Tab capture (CefGetMediaCaptureSourceId) exists only in our own CEF build
// (docs/cef-source-build.md), not in the prebuilt distribution.
#if __has_include("include/cef_media_capture.h")
#define NN_TAB_CAPTURE 1
#else
#define NN_TAB_CAPTURE 0
#endif

// Tabs are Chrome tabs of each window's ghost Browser, hosted in our views
// (patched CEF, docs/cef-source-build.md "Chrome-style hosting API"). Needs
// vendor/cef to be our own build; 0 builds against the stock distribution
// (the NN_CHROME_TABS build setting, passed through NetnyahooCEF.podspec).
#ifndef NN_CHROME_TABS
#define NN_CHROME_TABS 1
#endif

// Optional hooks of our CEF build. It lists the ones it has in cef_netnyahoo.h
// (CEF_NN_EXTENSION_ACTION, CEF_NN_PASSWORD_PROMPT, CEF_NN_TAB_STRIP,
// CEF_NN_POPUP_TABS…); each is used only with NN_CHROME_TABS.
#if NN_CHROME_TABS && __has_include("include/cef_netnyahoo.h")
#include "include/cef_netnyahoo.h"
#endif
#if NN_CHROME_TABS && !defined(CEF_NN_CHROME_TABS)
#error "NN_CHROME_TABS needs our CEF build (packages/cef/scripts/setup.sh); against stock CEF (CEF_PREBUILT=1) build with NN_CHROME_TABS=0"
#endif
// CefBrowserHost::ExecuteExtensionAction: a toolbar click runs the extension's action.
#if NN_CHROME_TABS && defined(CEF_NN_EXTENSION_ACTION)
#define NN_EXTENSION_ACTION 1
#else
#define NN_EXTENSION_ACTION 0
#endif
// CefBrowserHost::GetPasswordPrompt / ResolvePasswordPrompt: our save/update prompt.
#if NN_CHROME_TABS && defined(CEF_NN_PASSWORD_PROMPT)
#define NN_PASSWORD_PROMPT 1
#else
#define NN_PASSWORD_PROMPT 0
#endif
// Tab strip changes Chrome makes (extensions activating, moving, pinning tabs).
#if NN_CHROME_TABS && defined(CEF_NN_TAB_STRIP)
#define NN_TAB_STRIP 1
#else
#define NN_TAB_STRIP 0
#endif
// CefBrowserSettings.hidden_from_extensions: our hidden WebUI pages aren't windows to extensions.
#if NN_CHROME_TABS && defined(CEF_NN_HIDDEN_BROWSER)
#define NN_HIDDEN_BROWSER 1
#else
#define NN_HIDDEN_BROWSER 0
#endif
// CefRequestContextHandler::OnExtensionInstallPrompt: our install dialog instead of Chrome's.
#if NN_CHROME_TABS && defined(CEF_NN_INSTALL_PROMPT)
#define NN_INSTALL_PROMPT 1
#else
#define NN_INSTALL_PROMPT 0
#endif
// Reopened and duplicated tabs keep their back/forward list (CefBrowserHost::RestoreTabInBrowser,
// DuplicateTab, GetNavigationState).
#if NN_CHROME_TABS && defined(CEF_NN_TAB_HISTORY)
#define NN_TAB_HISTORY 1
#else
#define NN_TAB_HISTORY 0
#endif
// Sleeping tabs are Chrome's discarded tabs (CefBrowserHost::DiscardTab, OnTabDiscardedChanged).
#if NN_CHROME_TABS && defined(CEF_NN_TAB_DISCARD)
#define NN_TAB_DISCARD 1
#else
#define NN_TAB_DISCARD 0
#endif
// CefRequestContext::ClearBrowsingData: Chrome's BrowsingDataRemover.
#if NN_CHROME_TABS && defined(CEF_NN_BROWSING_DATA)
#define NN_BROWSING_DATA 1
#else
#define NN_BROWSING_DATA 0
#endif
// Allowed popups of a hosted tab join its Browser as tabs (not new Chrome windows).
#if NN_CHROME_TABS && defined(CEF_NN_POPUP_TABS)
#define NN_POPUP_TABS 1
#else
#define NN_POPUP_TABS 0
#endif

namespace nn {

constexpr bool kTabCaptureSupported = NN_TAB_CAPTURE;

inline NSString *ToNS(const CefString &s) {
  std::string utf8 = s.ToString();
  return [[NSString alloc] initWithBytes:utf8.data() length:utf8.size() encoding:NSUTF8StringEncoding] ?: @"";
}
inline CefString ToCef(NSString *s) { return CefString(s ? s.UTF8String : ""); }

/// JSON text for a Foundation object ("null" if it can't be encoded).
NSString *ToJSON(id object);
/// Parses JSON text; nil on failure.
id FromJSON(NSString *json);

/// "https://example.com:8443" for a URL (nil for opaque/non-network URLs).
NSString *OriginOf(NSString *url);
/// Lowercase host of a URL ("" if none).
NSString *HostOf(NSString *url);

/// Request context for a profile id ("" = global/default; "incognito:*" = in memory).
CefRefPtr<CefRequestContext> ContextForProfile(NSString *profile);
inline bool IsIncognito(NSString *profile) { return [profile hasPrefix:@"incognito"]; }
/// The profile a request context belongs to (nil if unknown).
NSString *ProfileForContext(CefRefPtr<CefRequestContext> context);
/// Application Support root for CEF data (NETNYAHOO_DATA_DIR aware).
NSString *DataRoot();
/// A persistent profile's data directory ("" = Default).
NSString *ProfileDirectory(NSString *profile);
/// Downloads a favicon with `browser`'s image downloader (NNFavicons, in NNBrowsingData.mm).
void DownloadFavicon(CefRefPtr<CefBrowser> browser, NSString *url, NSString *name, void (^completion)(NSDictionary *));
/// Any image (Media Session artwork, notification icons) the same way, at most `maxPixels` on
/// its longer side, as a data: URI only: nothing is written to disk, whatever the profile.
void DownloadImage(CefRefPtr<CefBrowser> browser, NSString *url, int maxPixels, void (^completion)(NSDictionary *));

/// Whether pages' getDisplayMedia() goes through the app's source picker.
bool DisplayMediaPickerEnabled();

namespace activation {
/// NETNYAHOO_BACKGROUND=1: this instance never activates (see NNActivation.mm).
bool Background();
/// Whether a request to activate the app (`what`, for the log) may go through: never in the
/// background, never from Chromium while the app is inactive.
bool Allow(NSString *what);
/// Guards activation paths that don't go through NNApplication. Call once, early.
void Install();
}  // namespace activation

/// True from the start of +[NNCef shutdown].
bool ShuttingDown();

/// Drops the task-manager handle (before CefShutdown).
void ReleaseDiagnostics();

/// Global event sink (downloads, permissions, content blocker…).
void EmitGlobal(NSString *name, NSDictionary *payload);

// Downloads (called from every client's CefDownloadHandler).
bool OnBeforeDownload(CefRefPtr<CefDownloadItem> item, const CefString &suggested_name,
                      CefRefPtr<CefBeforeDownloadCallback> callback);
/// `profile`: the engine profile of the browser that started it ("" default, "incognito:*").
void OnDownloadUpdated(CefRefPtr<CefDownloadItem> item, CefRefPtr<CefDownloadItemCallback> callback, NSString *profile);

// Navigations that turned into downloads. Remembered (7 days) so that
// reloading such a URL without a user gesture — restoring a tab, recreating a
// discarded one — doesn't download the file again.
void NoteNavigationDownload(NSString *url, bool persist);
bool WasNavigationDownload(NSString *url);
/// The user asked for `url` (link click into a new tab, typed URL…): its next
/// load may download again.
void AllowUserNavigation(NSString *url);
bool ConsumeUserNavigation(NSString *url);

// Permissions (called from every client's CefPermissionHandler).
bool RequestPermission(CefRefPtr<CefBrowser> browser, const CefString &origin, uint32_t permissions,
                       CefRefPtr<CefPermissionPromptCallback> callback);
bool RequestMediaAccess(CefRefPtr<CefBrowser> browser, const CefString &origin, uint32_t permissions,
                        CefRefPtr<CefMediaAccessCallback> callback);
void DismissPermissions(CefRefPtr<CefBrowser> browser);

// Live browser bookkeeping (for shutdown and leak checks).
void BrowserCreated(CefRefPtr<CefBrowser> browser);
void BrowserClosed(CefRefPtr<CefBrowser> browser);
size_t LiveBrowserCount();

/// Every NNBrowserView that currently has a browser.
NSArray<NNBrowserView *> *LiveViews();
void RegisterView(NNBrowserView *view);

/// A tab is moving between windows (NNBrowserView transferKey): its browser must outlive
/// the window it leaves for a few seconds.
bool TabTransfersPending();

/// Hidden window that parents popup browsers until a view adopts them.
NSView *ParkingView();

/// A window of ours or Chrome's that must never be seen, clicked, made key, or
/// activate the app (hidden Chrome windows, ghosts). See NNWindowHost.mm.
void MakeWindowInert(NSWindow *window);

/// Calls the page script's receive(kind, json) in `frame`.
void CallPage(CefRefPtr<CefFrame> frame, NSString *kind, id payload);

/// Runs a DevTools protocol method on `browser`; `completion` (optional) gets
/// the result object, or nil on error.
void DevToolsCall(CefRefPtr<CefBrowser> browser, NSString *method, NSDictionary *params,
                  void (^completion)(NSDictionary *result));
/// Runtime.evaluate with a user gesture (media, PiP, window.open replays).
/// Drops a closed browser's DevTools observer.
void DevToolsForget(int browserId);
void EvaluateWithGesture(CefRefPtr<CefBrowser> browser, NSString *expression,
                         void (^completion)(id value));
/// Opens (or focuses) `browser`'s DevTools window; `panel` ("console"…, nil = its
/// last panel) is selected, `inspectAt` (view coordinates) inspects that element.
void ShowDevTools(CefRefPtr<CefBrowser> browser, NSString *panel, CefPoint inspectAt = CefPoint());

}  // namespace nn
