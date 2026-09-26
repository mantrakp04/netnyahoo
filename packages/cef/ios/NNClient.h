// The per-browser CefClient behind every NNBrowserView (and popups and tabs
// Chrome made, waiting to be adopted). Feature modules (site settings, zoom…)
// hook into it through the small headers next to this one.
#pragma once

#import "NNCefInternal.h"

#include <map>
#include <set>
#include <string>
#include <vector>

#include "include/cef_command_handler.h"
#include "include/cef_jsdialog_handler.h"
#include "include/cef_keyboard_handler.h"

namespace nn {

class Client : public CefClient,
               public CefDisplayHandler,
               public CefLoadHandler,
               public CefLifeSpanHandler,
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
  Client(NNBrowserView *view, NSString *profile);

  void SetView(NNBrowserView *view) { view_ = view; }
  NNBrowserView *View() const { return view_; }
  CefRefPtr<CefBrowser> Browser() const { return browser_; }
  NSString *Profile() const { return profile_; }
  bool Incognito() const { return IsIncognito(profile_); }
  /// Main frame URL ("" before the first commit).
  NSString *URL() const;

  void Emit(NSString *name, NSDictionary *payload);
  void EmitNavigation();
  void EmitMedia();
  void EmitSecurity();
  void EmitZoom(bool force = false);

  void AddEval(int id, void (^completion)(NSString *)) { evals_[id] = [completion copy]; }
  /// Resolves pending evaluate() calls with nil (their document went away).
  void FlushEvals();

  // Media: the frame whose now-playing state is current, and transport commands.
  void MediaCommand(NSString *action, double seconds);
  NSDictionary *NowPlaying() const;
  bool PlayingVideo() const;
  /// The page handles Media Session "enterpictureinpicture" and is playing or capturing (Meet).
  bool WantsDocumentPictureInPicture() const;

  /// Mute is the user's choice OR the site's "sound: block" setting, and is
  /// re-applied after navigations (Chromium can drop it when the renderer swaps).
  void SetUserMuted(bool muted);
  void SetSiteMuted(bool muted);
  void ApplyMute();

  /// Answers a "displayMediaRequest" (nil source = deny).
  void ResolveDisplayMedia(NSString *requestId, NSString *sourceId);
  /// Tells the page a notification was clicked or closed in the app ("click" | "close").
  void NotificationAction(NSString *notificationId, NSString *action);

  bool Fullscreen() const { return fullscreen_; }
  /// Called on the UI thread for each request the content blocker blocked.
  void NoteBlocked(NSString *url);

  // CefClient
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefFindHandler> GetFindHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
  CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override { return this; }
  CefRefPtr<CefFocusHandler> GetFocusHandler() override { return this; }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }
  CefRefPtr<CefCommandHandler> GetCommandHandler() override { return this; }
  CefRefPtr<CefJSDialogHandler> GetJSDialogHandler() override { return this; }
  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source,
                                CefRefPtr<CefProcessMessage> message) override;

  // CefDisplayHandler
  void OnAddressChange(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &url) override;
  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString &title) override;
  void OnFaviconURLChange(CefRefPtr<CefBrowser> browser, const std::vector<CefString> &icon_urls) override;
  void OnFullscreenModeChange(CefRefPtr<CefBrowser> browser, bool fullscreen) override;
  void OnStatusMessage(CefRefPtr<CefBrowser> browser, const CefString &value) override;
#if NN_DOCKED_DEVTOOLS
  void OnDevToolsDockChanged(CefRefPtr<CefBrowser> browser) override;
#endif
  void OnLoadingProgressChange(CefRefPtr<CefBrowser> browser, double progress) override;
  void OnMediaAccessChange(CefRefPtr<CefBrowser> browser, bool has_video_access, bool has_audio_access) override;

  // CefLoadHandler
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool isLoading, bool canGoBack, bool canGoForward) override;
  void OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, TransitionType transition) override;
  void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode errorCode,
                   const CefString &errorText, const CefString &failedUrl) override;

  // CefLifeSpanHandler
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                     const CefString &target_url, const CefString &target_frame_name,
                     cef_window_open_disposition_t disposition, bool user_gesture, const CefPopupFeatures &features,
                     CefWindowInfo &windowInfo, CefRefPtr<CefClient> &client, CefBrowserSettings &settings,
                     CefRefPtr<CefDictionaryValue> &extra_info, bool *no_javascript_access) override;
  void OnBeforeDevToolsPopup(CefRefPtr<CefBrowser> browser, CefWindowInfo &windowInfo, CefRefPtr<CefClient> &client,
                             CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra_info,
                             bool *use_default_window) override;
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;
#if NN_TAB_STRIP
  void OnTabStripChanged(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) override;
#endif
#if NN_TAB_DISCARD
  void OnTabDiscardedChanged(CefRefPtr<CefBrowser> browser, bool discarded) override;
#endif

  // CefRequestHandler
  bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request,
                      bool user_gesture, bool is_redirect) override;
  bool OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &target_url,
                        cef_window_open_disposition_t disposition, bool user_gesture) override;
  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(
      CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request, bool is_navigation,
      bool is_download, const CefString &request_initiator, bool &disable_default_handling) override;
  bool OnRenderProcessUnresponsive(CefRefPtr<CefBrowser> browser,
                                   CefRefPtr<CefUnresponsiveProcessCallback> callback) override;
  void OnRenderProcessResponsive(CefRefPtr<CefBrowser> browser) override;
  void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status, int error_code,
                                 const CefString &error_string) override;
  bool OnCertificateError(CefRefPtr<CefBrowser> browser, cef_errorcode_t cert_error, const CefString &request_url,
                          CefRefPtr<CefSSLInfo> ssl_info, CefRefPtr<CefCallback> callback) override;

  // CefDownloadHandler
  bool OnBeforeDownload(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                        const CefString &suggested_name, CefRefPtr<CefBeforeDownloadCallback> callback) override;
  void OnDownloadUpdated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                         CefRefPtr<CefDownloadItemCallback> callback) override;

  // CefFindHandler
  void OnFindResult(CefRefPtr<CefBrowser> browser, int identifier, int count, const CefRect &rect, int active,
                    bool finalUpdate) override;

  // CefPermissionHandler
  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                      const CefString &origin, uint32_t permissions,
                                      CefRefPtr<CefMediaAccessCallback> callback) override;
  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id, const CefString &origin,
                              uint32_t permissions, CefRefPtr<CefPermissionPromptCallback> callback) override;

  // CefContextMenuHandler
  void OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                           CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) override;
  bool OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefContextMenuParams> params, int command_id,
                            cef_event_flags_t event_flags) override;
  bool RunContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefContextMenuParams> params,
                      CefRefPtr<CefMenuModel> model, CefRefPtr<CefRunContextMenuCallback> callback) override;

  // CefFocusHandler
  void OnGotFocus(CefRefPtr<CefBrowser> browser) override;

  // CefKeyboardHandler
  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                     bool *is_keyboard_shortcut) override;
  bool OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) override;

  // CefCommandHandler (Chrome style: commands Chrome runs for the active tab)
  bool OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) override;

  // CefJSDialogHandler (Chrome's own dialogs, except "Leave site?" for a tab the app closed)
  bool OnJSDialog(CefRefPtr<CefBrowser>, const CefString &, JSDialogType, const CefString &, const CefString &,
                  CefRefPtr<CefJSDialogCallback>, bool &) override {
    return false;
  }
  bool OnBeforeUnloadDialog(CefRefPtr<CefBrowser> browser, const CefString &message_text, bool is_reload,
                            CefRefPtr<CefJSDialogCallback> callback) override;

  /// Set for popup browsers created by OnBeforePopup until a view adopts them.
  std::string adoptId_;
  /// A popup Chrome made from this browser id's tab: it joins that tab's Browser (host::TabOpenedFrom).
  int openerBrowserId_ = 0;
  /// The engine closed this browser itself (no windowClose event).
  bool closingByEngine_ = false;

 private:
  void OnPageMessage(CefRefPtr<CefFrame> frame, const std::string &kind, id data);
  void ChromeTabContextMenu(CefRefPtr<CefFrame> frame, CefRefPtr<CefContextMenuParams> params,
                            CefRefPtr<CefMenuModel> model);

  __weak NNBrowserView *view_;
  NSString *profile_;
  CefRefPtr<CefBrowser> browser_;
  NSString *title_ = nil;
  NSString *themeColor_ = nil;
  NSString *themeSource_ = nil;
  NSString *committedOrigin_ = nil;
  bool capturing_ = false;
  bool userMuted_ = false;
  bool siteMuted_ = false;
  bool fullscreen_ = false;
  bool enteredFullscreen_ = false;
  /// While the page is full screen: the full-screen window leaving full screen takes the page
  /// out of it too (Chrome would, but only tracks the state of our tabs; see OnFullscreenModeChange).
  id fullscreenExitObserver_ = nil;
  void WatchFullscreenExit(NSWindow *window);
  bool unresponsive_ = false;
  double lastZoom_ = -1;
  double pinchScale_ = 1;
  int blockedCount_ = 0;
  bool blockedEmitQueued_ = false;
  NSString *lastBlocked_ = nil;
  // URLs of the main-frame navigation in flight (first request + redirects),
  // to recognise a navigation that turns into a download.
  std::vector<std::string> pendingNavigation_;
  std::map<std::string, std::string> notificationFrames_;
  std::map<std::string, std::pair<std::string, int>> displayRequests_;  // request id → (frame id, page id)  // notification id → frame id
  bool committedPage_ = false;
  // Last reported place in Chrome's tab strip (NN_TAB_STRIP).
  int tabStripIndex_ = -1;
  bool tabStripActive_ = false;
  bool tabStripPinned_ = false;
  std::map<std::string, bool> mediaFrames_;
  std::map<std::string, NSDictionary *> nowPlaying_;  // by frame identifier
  std::string nowPlayingFrame_;
  std::map<int, void (^)(NSString *)> evals_;
  IMPLEMENT_REFCOUNTING(Client);
};

/// Popup browsers created for new tabs/windows, waiting for a view to adopt them.
struct PendingPopup {
  CefRefPtr<Client> client;
  CefRefPtr<CefBrowser> browser;
  __weak NNBrowserView *adopter = nil;
};
std::map<std::string, PendingPopup> &Popups();

}  // namespace nn

@interface NNBrowserView ()
- (void)emit:(NSString *)name payload:(NSDictionary *)payload;
- (void)browserCreated:(CefRefPtr<CefBrowser>)browser;
- (void)browserClosed;
/// DevTools docked next to the page appeared, went or changed their layout (Chrome-hosted windows).
- (void)layoutDockedDevTools;
/// Chrome discarded the tab, or it's loading again after that.
- (void)tabDiscardedChanged:(BOOL)discarded;
@property (nonatomic, readonly) BOOL closingByRequest;
/// nullptr until the browser exists.
@property (nonatomic, readonly) CefRefPtr<nn::Client> client;
@end
