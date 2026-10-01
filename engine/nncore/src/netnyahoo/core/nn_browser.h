// NNCore's Chromium-side model: the window host that several per-profile Browsers share,
// the Browser delegate Chrome's hooks call, the WebContentsDelegate that keeps every new
// tab in our window, and the per-tab bridge that reports a tab's state to the host.

#ifndef NETNYAHOO_CORE_NN_BROWSER_H_
#define NETNYAHOO_CORE_NN_BROWSER_H_

#include <map>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/observer_list.h"
#include "cef/libcef/browser/chrome/browser_delegate.h"
#include "chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/favicon/core/favicon_driver_observer.h"
#include "components/find_in_page/find_result_observer.h"
#include "components/zoom/zoom_controller.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/blocked_content/url_list_manager.h"
#include "base/time/time.h"
#include "components/zoom/zoom_observer.h"
#include "components/web_modal/web_contents_modal_dialog_host.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_install_prompt_client.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"

@class NNCoreTab;
@class NSDictionary;
@class NNCoreWindow;
@class NSView;
@class NSWindow;

class Browser;
class BrowserWindow;
class Profile;

namespace extensions {
class InstallPromptData;
}

namespace views {
class Widget;
class WidgetDelegate;
}  // namespace views

namespace nncore {

class NNBrowserWindow;

const char* DispositionName(WindowOpenDisposition disposition);

// One NSWindow (a Views widget, so Chrome's bubbles and sheets attach to it) and the
// Browsers of every profile shown in it.
class WindowHost : public TabStripModelObserver,
                   public web_modal::WebContentsModalDialogHost {
 public:
  WindowHost(NNCoreWindow* owner, const gfx::Rect& bounds);
  WindowHost(const WindowHost&) = delete;
  WindowHost& operator=(const WindowHost&) = delete;
  ~WindowHost() override;

  NSWindow* ns_window() const;
  NSView* host_view() const { return host_view_; }
  views::Widget* widget() const { return widget_.get(); }
  NNCoreWindow* owner() const { return owner_; }

  // Every live WindowHost (a window that hasn't finished closing).
  static const std::vector<WindowHost*>& All();
  static WindowHost* ForNSWindow(NSWindow* window);
  static WindowHost* ForBrowser(const BrowserWindowInterface* browser);

  // The profile's Browser in this window, created on first use.
  Browser* BrowserFor(Profile* profile);
  Browser* ExistingBrowserFor(Profile* profile) const;
  std::vector<Browser*> browsers() const;
  void SetActiveProfile(Profile* profile);
  Profile* active_profile() const { return active_profile_; }
  bool IsActiveBrowser(const Browser* browser) const;
  // While set, Chrome's active-tab changes aren't reported (a command run in a background
  // tab activates it for a moment).
  void set_quiet_activation(bool quiet) { quiet_activation_ = quiet; }
  // The close can no longer be cancelled: every Browser is closing.
  bool closing() const { return close_state_ == CloseState::kClosing; }
  // Cancellable: beforeunload in every Browser, then the downloads the close would cancel;
  // a "stay" leaves every Browser as it was (windowDidCancelClose:).
  void Close();
  // The user asked the NSWindow itself to close (title bar, -performClose:).
  void CloseRequestedByUser();
  bool CanCloseWidget() const { return widget_close_allowed_; }
  void ShowInactive();

  // Downloads in flight that closing `browser` (a Browser of this window) would cancel; asks
  // the host. `callback` runs later, never synchronously.
  void ConfirmCloseWithDownloads(int count, base::OnceCallback<void(bool)> callback);
  void NotifyCloseCancelled();
  void QuitCancelled();

  // Disposition Chrome chose for the contents it is about to insert (OpenURLFromTab
  // rewrites popups and windows into tabs of our Browser; the host still learns what the
  // page asked for).
  struct PendingOpen {
    std::optional<WindowOpenDisposition> disposition;
    base::WeakPtr<content::WebContents> source;
  };
  // Set for the duration of one OpenURLFromTab (base::AutoReset: re-entrant safe).
  PendingOpen& pending_open() { return pending_open_; }

  // A Browser Chrome is building itself (inside its constructor), hosted here: its window.
  // Null if this window can't take it (closing, or it already has the profile's Browser).
  BrowserWindow* HostChromeBrowser(Browser* browser);

  // From Chrome, through our BrowserWindow / delegates.
  void AddBrowser(Browser* browser);
  void BrowserWindowDestroyed(NNBrowserWindow* window);
  void ActiveTabChanged(Browser* browser, content::WebContents* contents);
  void DevToolsDockChanged(content::WebContents* inspected,
                           content::WebContents* devtools);
  bool OfferPasswordSave(content::WebContents* contents);
  void FullscreenChanged(Browser* browser, bool fullscreen);

  base::WeakPtr<WindowHost> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  // TabStripModelObserver:
  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;

  // web_modal::WebContentsModalDialogHost:
  gfx::NativeView GetHostView() const override;
  gfx::Point GetDialogPosition(const gfx::Size& size) override;
  gfx::Size GetMaximumDialogSize() override;
  void AddObserver(web_modal::ModalDialogHostObserver* observer) override;
  void RemoveObserver(web_modal::ModalDialogHostObserver* observer) override;

 private:
  enum class CloseState { kOpen, kAsking, kClosing };
  void ContinueClose();
  void OnBeforeUnloadAnswered(bool proceed);
  void CancelClose();
  void CommitClose();
  void CloseWidget();
  int DownloadsCancelledByClose() const;

  __weak NNCoreWindow* owner_;
  // The owner lives until the window has closed (the host may drop it after -close).
  NNCoreWindow* __strong owner_ref_;
  std::unique_ptr<views::WidgetDelegate> widget_delegate_;
  std::unique_ptr<views::Widget> widget_;
  NSView* __strong host_view_;
  std::map<Profile*, raw_ptr<Browser>> browsers_;
  raw_ptr<Profile> active_profile_ = nullptr;
  CloseState close_state_ = CloseState::kOpen;
  bool widget_close_allowed_ = false;
  bool quiet_activation_ = false;
  PendingOpen pending_open_;
  base::ObserverList<web_modal::ModalDialogHostObserver> modal_observers_;
  base::WeakPtrFactory<WindowHost> weak_factory_{this};
};

// Passed to Browser::Create through BrowserWindowCreateParams::cef_params: marks the
// Browser as one of ours and names its window.
class NNCreateParams : public cef::BrowserDelegate::CreateParams {
 public:
  explicit NNCreateParams(base::WeakPtr<WindowHost> host)
      : host(std::move(host)) {}
  base::WeakPtr<WindowHost> host;

 private:
  ~NNCreateParams() override = default;
};

// Every Browser gets one (Chrome's hooks call cef::BrowserDelegate::Create for each).
// Browsers Chrome makes on its own (an undocked DevTools window, chrome.windows.create)
// have no host and keep Chrome's behaviour.
class NNBrowserDelegate : public cef::BrowserDelegate {
 public:
  NNBrowserDelegate(Browser* browser, base::WeakPtr<WindowHost> host);
  ~NNBrowserDelegate() override;

  WindowHost* host() const { return host_.get(); }
  bool is_ours() const { return is_ours_; }
  // A Browser Chrome made itself that the host took into one of its windows (before
  // Chrome sets up the Browser's WebContentsDelegate).
  void AdoptIntoHost(base::WeakPtr<WindowHost> host) {
    host_ = std::move(host);
    is_ours_ = true;
  }

  // cef::BrowserDelegate:
  std::unique_ptr<content::WebContents> AddWebContents(
      std::unique_ptr<content::WebContents> new_contents) override;
  void OnWebContentsCreated(content::WebContents* new_contents) override {}
  void OnPopupWebContentsCreated(
      content::WebContents* source_contents,
      const content::GlobalRenderFrameHostId& opener_id,
      const std::string& frame_name,
      const GURL& target_url,
      content::WebContents* new_contents) override {}
  void SetAsDelegate(content::WebContents* web_contents,
                     bool set_delegate) override {}
  void UpdateDraggableRegions(
      const std::vector<blink::mojom::DraggableRegionPtr>& regions,
      content::WebContents* contents) override {}
  bool KeepsWindowWithoutTabs() const override;
  bool AllowsDockedDevTools() const override;
  void DevToolsDockChanged(content::WebContents* inspected,
                           content::WebContents* devtools) override;

 private:
  raw_ptr<Browser> browser_;
  base::WeakPtr<WindowHost> host_;
  bool is_ours_;
};

NNBrowserDelegate* DelegateFor(const BrowserWindowInterface* browser);

// The host is being told of a tab-strip change (inside Chrome's change): tab-strip changes it
// asks for now must wait for the next turn.
bool IsNotifyingTabStrip();

// An extension's side panel opening or closing in one of the host's tabs (the API tells the
// engine delegate). True: the host took it.
bool HostExtensionSidePanel(content::WebContents* contents,
                            const std::string& extension_id,
                            bool open);

// Chrome's extension install prompt, to the host (NNCoreEngineDelegate); false: Chrome's own.
bool HostExtensionInstallPrompt(
    Profile* profile,
    content::WebContents* parent,
    const extensions::InstallPromptData& prompt,
    extensions::ExtensionInstallPromptClient::DoneCallback* done_callback);
void ResolveExtensionInstallPrompt(const std::string& request_id, bool accepted);

// Starts reporting Chrome's media capture indicator (camera, microphone, screen) per tab.
void StartMediaCaptureObserver();

// The quit's downloads prompt (Chrome's Mac close manager leaves it to AppController): asks the
// host through the last active window. `callback` runs later, never synchronously.
void ConfirmQuitWithDownloads(int count, base::OnceCallback<void(bool)> callback);
// A cancelled quit: every window's delegate gets windowDidCancelClose:.
void NotifyWindowsQuitCancelled();

// Keeps every tab Chrome opens from one of our tabs in our Browser: popups and new
// windows become tabs the host owns (it gets the original disposition), with their
// opener, their WebContents and their navigation (POST body included) intact.
class NNWebContentsDelegate : public BrowserWebContentsDelegate {
 public:
  NNWebContentsDelegate(BrowserWindowInterface* browser,
                        ExclusiveAccessManager& exclusive_access_manager,
                        chrome::BrowserCommandController& command_controller,
                        UnloadController& unload_controller,
                        web_app::AppBrowserController* app_browser_controller,
                        BrowserWindow& window,
                        DesktopBrowserWindowCapabilities& capabilities,
                        BrowserUiController& browser_ui_controller,
                        base::WeakPtr<WindowHost> host);
  ~NNWebContentsDelegate() override;

  content::WebContents* OpenURLFromTab(
      content::WebContents* source,
      const content::OpenURLParams& params,
      base::OnceCallback<void(content::NavigationHandle&)>
          navigation_handle_callback) override;
  void UpdateTargetURL(content::WebContents* source, const GURL& url) override;
  // Chrome asks to bring a tab forward (Picture in Picture's "back to tab", a page's
  // window.focus()): the host decides (tabRequestsActivation:).
  void ActivateContents(content::WebContents* contents) override;
  // The host shows its own "page unresponsive" UI (tabBecameUnresponsive:), not Chrome's
  // hung-renderer dialog.
  void RendererUnresponsive(content::WebContents* source,
                            content::RenderWidgetHost* render_widget_host,
                            base::RepeatingClosure hang_monitor_restarter) override;
  void RendererResponsive(content::WebContents* source,
                          content::RenderWidgetHost* render_widget_host) override;
  content::WebContents* AddNewContents(
      content::WebContents* source,
      std::unique_ptr<content::WebContents> new_contents,
      const GURL& target_url,
      WindowOpenDisposition disposition,
      const blink::mojom::WindowFeatures& window_features,
      bool user_gesture,
      bool* was_blocked) override;

 private:
  base::WeakPtr<WindowHost> host_;
};

// Per tab: owns the ObjC NNCoreTab and reports the page's state to it.
class TabBridge : public content::WebContentsObserver,
                  public zoom::ZoomObserver,
                  public blocked_content::UrlListManager::Observer,
                  public favicon::FaviconDriverObserver,
                  public find_in_page::FindResultObserver,
                  public content::WebContentsUserData<TabBridge> {
 public:
  ~TabBridge() override;

  static TabBridge* GetOrCreate(content::WebContents* contents);
  NNCoreTab* tab() const { return tab_; }
  // How the page that opened this tab asked for it (Chrome's tab-strip opener is the
  // active tab, which need not be the page that opened it).
  void set_open(WindowOpenDisposition d, content::WebContents* source) {
    open_disposition_ = d;
    open_source_ = source ? source->GetWeakPtr() : nullptr;
  }
  std::optional<WindowOpenDisposition> TakeOpenDisposition();
  content::WebContents* open_source() const { return open_source_.get(); }
  // Chrome attaches the favicon driver with the tab helpers, after we may have made this.
  void EnsureFaviconObserved();
  void EnsureFindObserved();
  void EnsureZoomObserved();
  void EnsurePopupsObserved();
  // Focus the host itself asked for (activateTab:, -focus) isn't the page's.
  void NoteHostFocus();

  // Unresponsive renderer (NNWebContentsDelegate): kept until it answers or the host decides.
  void SetUnresponsive(content::RenderWidgetHost* host, base::RepeatingClosure restarter);
  void SetResponsive(content::RenderWidgetHost* host);
  void ResolveUnresponsive(bool terminate);
  bool frozen() const { return frozen_; }
  void set_frozen(bool frozen) { frozen_ = frozen; }
  // Media capture (camera, microphone, screen) as JS MediaAccess.
  void MediaAccessChanged();

  // blocked_content::UrlListManager::Observer:
  void BlockedUrlAdded(int32_t popup_id, const GURL& url) override;
  float pinch_scale() const { return pinch_scale_; }

  // The host closed it (-[NNCoreTab close]): no tabWillClose.
  void set_closed_by_host() { closed_by_host_ = true; }
  // Reports tabWillClose once, for a close the host didn't ask for.
  void ReportWillClose();
  const GURL& favicon_url() const { return favicon_url_; }

  // content::WebContentsObserver:
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus status) override;
  void DidChangeVisibleSecurityState() override;
  void WasDiscarded() override;
  void DidStartNavigation(content::NavigationHandle* handle) override;
  void OnPageScaleFactorChanged(float page_scale_factor) override;
  void OnVisibilityChanged(content::Visibility visibility) override;

  // zoom::ZoomObserver:
  void OnZoomChanged(const zoom::ZoomController::ZoomChangedEventData& data) override;
  void OnZoomControllerDestroyed(zoom::ZoomController* zoom_controller) override;

  // Security state as JS SecurityInfo; tabDidChangeSecurity: when it changes.
  void CheckSecurity();
  void BeforeUnloadFired(bool proceed) override;
  void DidChangeThemeColor() override;
  void OnWebContentsFocused(content::RenderWidgetHost* render_widget_host) override;
  void OnAudioStateChanged(bool audible) override;
  void DidUpdateAudioMutingState(bool muted) override;
  void TitleWasSet(content::NavigationEntry* entry) override;
  void DidStartLoading() override;
  void DidStopLoading() override;
  void LoadProgressChanged(double progress) override;
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void NavigationEntryCommitted(
      const content::LoadCommittedDetails& load_details) override;
  void WebContentsDestroyed() override;

  // find_in_page::FindResultObserver:
  void OnFindResultAvailable(content::WebContents* web_contents) override;
  void OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) override;

  // favicon::FaviconDriverObserver:
  void OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                        NotificationIconType notification_icon_type,
                        const GURL& icon_url,
                        bool icon_url_changed,
                        const gfx::Image& image) override;

 private:
  friend class content::WebContentsUserData<TabBridge>;
  explicit TabBridge(content::WebContents* contents);

  NNCoreTab* __strong tab_;
  GURL favicon_url_;
  NSDictionary* __strong security_;
  raw_ptr<zoom::ZoomController> zoom_ = nullptr;
  raw_ptr<blocked_content::PopupBlockerTabHelper> popups_ = nullptr;
  base::TimeTicks host_focus_at_;
  bool discarded_ = false;
  bool frozen_ = false;
  NSDictionary* __strong media_access_;
  // The hung widget, by id (it may go while the host decides).
  std::optional<std::pair<int, int>> unresponsive_;
  base::RepeatingClosure hang_monitor_restarter_;
  // The host may close the tab from any callback: checked after each, where more follows.
  base::WeakPtrFactory<TabBridge> weak_factory_{this};
  float pinch_scale_ = 1;
  bool closed_by_host_ = false;
  bool will_close_reported_ = false;
  std::optional<WindowOpenDisposition> open_disposition_;
  base::WeakPtr<content::WebContents> open_source_;
  bool observing_favicon_ = false;
  raw_ptr<find_in_page::FindTabHelper> find_helper_ = nullptr;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_BROWSER_H_
