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
  NSString *URL() const;

  void Emit(NSString *name, NSDictionary *payload);
  void EmitNavigation();
  void EmitMedia();
  void EmitSecurity();
  void EmitZoom(bool force = false);

  void AddEval(int id, void (^completion)(NSString *)) { evals_[id] = [completion copy]; }
  void FlushEvals();

  void MediaCommand(NSString *action, double seconds);
  NSDictionary *NowPlaying() const;
  bool PlayingVideo() const;
  bool WantsDocumentPictureInPicture() const;

  void SetUserMuted(bool muted);
  void SetSiteMuted(bool muted);
  void ApplyMute();

  void ResolveDisplayMedia(NSString *requestId, NSString *sourceId);
  void NotificationAction(NSString *notificationId, NSString *action);

  bool Fullscreen() const { return fullscreen_; }
  bool CommittedPage() const { return committedPage_; }
  void NoteBlocked(NSString *url, int count = 1);

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

  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool isLoading, bool canGoBack, bool canGoForward) override;
  void OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, TransitionType transition) override;
  void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode errorCode,
                   const CefString &errorText, const CefString &failedUrl) override;

  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                     const CefString &target_url, const CefString &target_frame_name,
                     cef_window_open_disposition_t disposition, bool user_gesture, const CefPopupFeatures &features,
                     CefWindowInfo &windowInfo, CefRefPtr<CefClient> &client, CefBrowserSettings &settings,
                     CefRefPtr<CefDictionaryValue> &extra_info, bool *no_javascript_access) override;
  void OnBeforeDevToolsPopup(CefRefPtr<CefBrowser> browser, CefWindowInfo &windowInfo, CefRefPtr<CefClient> &client,
                             CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra_info,
                             bool *use_default_window) override;
  void OnBeforePopupAborted(CefRefPtr<CefBrowser> browser, int popup_id) override;
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;
#if NN_TAB_STRIP
  void OnTabStripChanged(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) override;
#endif
#if NN_TAB_DISCARD
  void OnTabDiscardedChanged(CefRefPtr<CefBrowser> browser, bool discarded) override;
#endif

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

  bool OnBeforeDownload(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                        const CefString &suggested_name, CefRefPtr<CefBeforeDownloadCallback> callback) override;
  void OnDownloadUpdated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                         CefRefPtr<CefDownloadItemCallback> callback) override;

  void OnFindResult(CefRefPtr<CefBrowser> browser, int identifier, int count, const CefRect &rect, int active,
                    bool finalUpdate) override;

  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                      const CefString &origin, uint32_t permissions,
                                      CefRefPtr<CefMediaAccessCallback> callback) override;
  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id, const CefString &origin,
                              uint32_t permissions, CefRefPtr<CefPermissionPromptCallback> callback) override;

  void OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                           CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) override;
  bool OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefContextMenuParams> params, int command_id,
                            cef_event_flags_t event_flags) override;
  bool RunContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefContextMenuParams> params,
                      CefRefPtr<CefMenuModel> model, CefRefPtr<CefRunContextMenuCallback> callback) override;

  void OnGotFocus(CefRefPtr<CefBrowser> browser) override;
  bool OnSetFocus(CefRefPtr<CefBrowser> browser, FocusSource source) override;

  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                     bool *is_keyboard_shortcut) override;
  bool OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) override;

  bool OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) override;

  bool OnJSDialog(CefRefPtr<CefBrowser>, const CefString &, JSDialogType, const CefString &, const CefString &,
                  CefRefPtr<CefJSDialogCallback>, bool &) override {
    return false;
  }
  bool OnBeforeUnloadDialog(CefRefPtr<CefBrowser> browser, const CefString &message_text, bool is_reload,
                            CefRefPtr<CefJSDialogCallback> callback) override;

  std::string adoptId_;
  int openerBrowserId_ = 0;
  bool closingByEngine_ = false;

 private:
  void OnPageMessage(CefRefPtr<CefFrame> frame, const std::string &kind, id data);
  void OpenAppLink(CefRefPtr<CefFrame> frame, NSString *url, bool user_gesture);
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
  // The window the page went full screen in, whether it entered macOS full screen for the page, and
  // whether it is leaving it for the page.
  __weak NSWindow *fullscreenWindow_ = nil;
  bool enteredFullscreen_ = false;
  bool leavingFullscreen_ = false;
  NSArray *fullscreenObservers_ = nil;
  __weak NSWindow *observedFullscreenWindow_ = nil;
  void SyncWindowFullScreen();
  void WatchFullscreenWindow(NSWindow *window);
  void FullscreenWindowSettled(bool entered);
  bool unresponsive_ = false;
  double lastZoom_ = -1;
  double pinchScale_ = 1;
  int blockedCount_ = 0;
  bool blockedEmitQueued_ = false;
  NSString *lastBlocked_ = nil;
  std::vector<std::string> pendingNavigation_;
  std::map<std::string, std::string> notificationFrames_;
  struct DisplayRequest {
    std::string frameId;
    int pageId;
    bool audio;
  };
  std::map<std::string, DisplayRequest> displayRequests_;
  bool committedPage_ = false;
  int tabStripIndex_ = -1;
  bool tabStripActive_ = false;
  bool tabStripPinned_ = false;
  std::map<std::string, bool> mediaFrames_;
  std::map<std::string, NSDictionary *> nowPlaying_;
  std::string nowPlayingFrame_;
  std::map<int, void (^)(NSString *)> evals_;
  // Popups this page opened (popup_id → adoptId), for OnBeforePopupAborted.
  std::map<int, std::string> pendingPopups_;
  IMPLEMENT_REFCOUNTING(Client);
};

struct PendingPopup {
  CefRefPtr<Client> client;
  CefRefPtr<CefBrowser> browser;
  __weak NNBrowserView *adopter = nil;
};
std::map<std::string, PendingPopup> &Popups();

bool MenuBarTakesChromeShortcut(int command_id);
// A navigation Chrome asked to open elsewhere (OnOpenURLFromTab), with its POST body and referrer.
int OpenedURLId();
bool LoadOpenedURL(CefRefPtr<CefBrowser> browser, int id);

}

@interface NNBrowserView ()
- (void)emit:(NSString *)name payload:(NSDictionary *)payload;
- (void)browserCreated:(CefRefPtr<CefBrowser>)browser;
- (void)browserClosed;
- (void)adoptionFailed;
- (void)layoutDockedDevTools;
- (void)tabDiscardedChanged:(BOOL)discarded;
@property (nonatomic, readonly) BOOL closingByRequest;
@property (nonatomic, readonly) CefRefPtr<nn::Client> client;
@end
