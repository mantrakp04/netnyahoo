// NNCore's Chromium-side model: the window host that several per-profile Browsers share,
// the Browser delegate Chrome's hooks call, the WebContentsDelegate that keeps every new
// tab in our window, and the per-tab bridge that reports a tab's state to the host.

#ifndef NETNYAHOO_CORE_NN_BROWSER_H_
#define NETNYAHOO_CORE_NN_BROWSER_H_

#include <map>
#include <memory>
#include <optional>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/observer_list.h"
#include "cef/libcef/browser/chrome/browser_delegate.h"
#include "chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/favicon/core/favicon_driver_observer.h"
#include "components/find_in_page/find_result_observer.h"
#include "components/web_modal/web_contents_modal_dialog_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/rect.h"

@class NNCoreTab;
@class NNCoreWindow;
@class NSView;
@class NSWindow;

class Browser;
class Profile;

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

  // The profile's Browser in this window, created on first use.
  Browser* BrowserFor(Profile* profile);
  Browser* ExistingBrowserFor(Profile* profile) const;
  void SetActiveProfile(Profile* profile);
  Profile* active_profile() const { return active_profile_; }
  bool IsActiveBrowser(const Browser* browser) const;
  bool closing() const { return closing_; }
  void Close();
  void ShowInactive();

  // Disposition Chrome chose for the contents it is about to insert (OpenURLFromTab
  // rewrites popups and windows into tabs of our Browser; the host still learns what the
  // page asked for).
  struct PendingOpen {
    std::optional<WindowOpenDisposition> disposition;
    base::WeakPtr<content::WebContents> source;
  };
  // Set for the duration of one OpenURLFromTab (base::AutoReset: re-entrant safe).
  PendingOpen& pending_open() { return pending_open_; }

  // From Chrome, through our BrowserWindow / delegates.
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
  __weak NNCoreWindow* owner_;
  std::unique_ptr<views::WidgetDelegate> widget_delegate_;
  std::unique_ptr<views::Widget> widget_;
  NSView* __strong host_view_;
  std::map<Profile*, raw_ptr<Browser>> browsers_;
  raw_ptr<Profile> active_profile_ = nullptr;
  bool closing_ = false;
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
  // Our BrowserWindow::Close ran: the Browser goes once its tabs have closed.
  void set_closing() { closing_ = true; }

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
  const bool is_ours_;
  bool closing_ = false;
};

NNBrowserDelegate* DelegateFor(const BrowserWindowInterface* browser);

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

  // content::WebContentsObserver:
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
  std::optional<WindowOpenDisposition> open_disposition_;
  base::WeakPtr<content::WebContents> open_source_;
  bool observing_favicon_ = false;
  raw_ptr<find_in_page::FindTabHelper> find_helper_ = nullptr;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_BROWSER_H_
