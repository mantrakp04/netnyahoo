#include "netnyahoo/core/nn_browser.h"

#import <AppKit/AppKit.h>

#include "base/auto_reset.h"
#include "base/no_destructor.h"
#include "base/functional/bind.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/download/download_core_service_factory.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_active_state_manager/browser_active_state_manager.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/desktop_browser_window_capabilities.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/unload_controller.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/find_in_page/find_notification_details.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/password_manager/core/browser/password_form.h"
#import "components/remote_cocoa/app_shim/bridged_content_view.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "chrome/browser/tab_list/tab_removed_reason.h"
#include "net/base/net_errors.h"
#include "netnyahoo/core/nn_page_channel.h"
#include "netnyahoo/core/nn_browser_window.h"
#import "netnyahoo/core/nncore_internal.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/mac/coordinate_conversion.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/window/client_view.h"
#include "url/origin.h"

namespace nncore {

const char* DispositionName(WindowOpenDisposition disposition) {
  switch (disposition) {
    case WindowOpenDisposition::CURRENT_TAB:
      return "current_tab";
    case WindowOpenDisposition::SINGLETON_TAB:
      return "singleton_tab";
    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
      return "foreground_tab";
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
      return "background_tab";
    case WindowOpenDisposition::NEW_POPUP:
      return "popup";
    case WindowOpenDisposition::NEW_WINDOW:
      return "window";
    case WindowOpenDisposition::NEW_PICTURE_IN_PICTURE:
      return "picture_in_picture";
    case WindowOpenDisposition::OFF_THE_RECORD:
      return "off_the_record";
    case WindowOpenDisposition::NEW_SPLIT_VIEW:
      return "split_view";
    default:
      return "other";
  }
}

// --- WindowHost -------------------------------------------------------------------------

namespace {

std::vector<WindowHost*>& Hosts() {
  static base::NoDestructor<std::vector<WindowHost*>> hosts;
  return *hosts;
}

// The window's client view: AppKit's close (the title bar's button, -performClose:) and
// Views' own close requests come here first. The widget closes only once every Browser has;
// anything else becomes the host's cancellable close.
class HostClientView : public views::ClientView {
 public:
  HostClientView(views::Widget* widget,
                 views::View* contents,
                 base::WeakPtr<WindowHost> host)
      : views::ClientView(widget, contents), host_(std::move(host)) {}

  views::CloseRequestResult OnWindowCloseRequested() override {
    if (!host_ || host_->CanCloseWidget()) {
      return views::CloseRequestResult::kCanClose;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&WindowHost::CloseRequestedByUser, host_));
    return views::CloseRequestResult::kCannotClose;
  }

 private:
  base::WeakPtr<WindowHost> host_;
};

}  // namespace

// static
const std::vector<WindowHost*>& WindowHost::All() {
  return Hosts();
}

// static
WindowHost* WindowHost::ForNSWindow(NSWindow* window) {
  for (WindowHost* host : Hosts()) {
    if (window && host->ns_window() == window) {
      return host;
    }
  }
  return nullptr;
}

// static
WindowHost* WindowHost::ForBrowser(const BrowserWindowInterface* browser) {
  NNBrowserDelegate* delegate = DelegateFor(browser);
  return delegate ? delegate->host() : nullptr;
}

WindowHost::WindowHost(NNCoreWindow* owner, const gfx::Rect& bounds)
    : owner_(owner), owner_ref_(owner) {
  Hosts().push_back(this);
  widget_delegate_ = std::make_unique<views::WidgetDelegate>();
  widget_delegate_->SetCanResize(true);
  widget_delegate_->SetCanMaximize(true);
  widget_delegate_->SetCanMinimize(true);
  widget_delegate_->SetTitle(u"Netnyahoo");
  widget_delegate_->SetClientViewFactory(base::BindOnce(
      [](base::WeakPtr<WindowHost> host, views::Widget* widget,
         views::View* contents) -> std::unique_ptr<views::ClientView> {
        return std::make_unique<HostClientView>(widget, contents, host);
      },
      GetWeakPtr()));

  widget_ = std::make_unique<views::Widget>();
  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_WINDOW);
  params.delegate = widget_delegate_.get();
  params.bounds = bounds;
  params.name = "NNCoreWindow";
  widget_->Init(std::move(params));

  // The host's views go inside Chrome's content view (the page must stay under it:
  // RenderWidgetHostViewCocoa hit-tests from it), and are hit-tested first.
  NSWindow* window = ns_window();
  NSView* content = window.contentView;
  host_view_ = [[NSView alloc] initWithFrame:content.bounds];
  host_view_.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [content addSubview:host_view_];
  if ([content isKindOfClass:[BridgedContentView class]]) {
    static_cast<BridgedContentView*>(content).netnyahooEmbeddedView =
        host_view_;
  }
}

WindowHost::~WindowHost() {
  std::erase(Hosts(), this);
  for (auto& observer : modal_observers_) {
    observer.OnHostDestroying();
  }
  for (auto& [profile, browser] : browsers_) {
    browser->GetTabStripModel()->RemoveObserver(this);
  }
  browsers_.clear();
  widget_close_allowed_ = true;
  widget_.reset();
}

NSWindow* WindowHost::ns_window() const {
  return widget_ ? widget_->GetNativeWindow().GetNativeNSWindow() : nil;
}

Browser* WindowHost::ExistingBrowserFor(Profile* profile) const {
  auto it = browsers_.find(profile);
  return it == browsers_.end() ? nullptr : it->second.get();
}

std::vector<Browser*> WindowHost::browsers() const {
  std::vector<Browser*> list;
  for (const auto& [profile, browser] : browsers_) {
    list.push_back(browser.get());
  }
  return list;
}

Browser* WindowHost::BrowserFor(Profile* profile) {
  if (Browser* browser = ExistingBrowserFor(profile)) {
    return browser;
  }
  if (close_state_ != CloseState::kOpen || !widget_ || widget_close_allowed_ ||
      browser_shutdown::IsTryingToQuit() ||
      GetBrowserWindowCreationStatusForProfile(*profile) !=
          BrowserWindowInterface::CreationStatus::kOk) {
    return nullptr;
  }
  auto* window = new NNBrowserWindow(GetWeakPtr());
  BrowserWindowCreateParams params(BrowserWindowInterface::TYPE_NORMAL,
                                   *profile, /*from_user_gesture=*/true);
  params.window = window;
  params.omit_from_session_restore = true;
  params.should_trigger_session_restore = false;
  params.cef_params = base::MakeRefCounted<NNCreateParams>(GetWeakPtr());
  Browser* browser = static_cast<Browser*>(CreateBrowserWindow(std::move(params)));
  window->AttachBrowser(browser);
  AddBrowser(browser);
  return browser;
}

BrowserWindow* WindowHost::HostChromeBrowser(Browser* browser) {
  Profile* profile = browser->GetProfile();
  NNBrowserDelegate* delegate = DelegateFor(browser);
  if (!delegate || delegate->is_ours() || close_state_ != CloseState::kOpen ||
      widget_close_allowed_ || ExistingBrowserFor(profile)) {
    return nullptr;
  }
  delegate->AdoptIntoHost(GetWeakPtr());
  auto* window = new NNBrowserWindow(GetWeakPtr());
  window->AttachBrowser(browser);
  AddBrowser(browser);
  return window;
}

void WindowHost::AddBrowser(Browser* browser) {
  Profile* profile = browser->GetProfile();
  browsers_[profile] = browser;
  browser->GetTabStripModel()->AddObserver(this);
  if (!active_profile_) {
    SetActiveProfile(profile);
  }
}

void WindowHost::SetActiveProfile(Profile* profile) {
  if (active_profile_ == profile) {
    return;
  }
  Browser* old_browser =
      active_profile_ ? ExistingBrowserFor(active_profile_) : nullptr;
  active_profile_ = profile;
  if (old_browser) {
    BrowserActiveStateManager::From(old_browser)->DidBecomeInactive();
  }
  // The shown profile's Browser is Chrome's last active one: chrome.windows'
  // currentWindow, keyboard shortcuts and new tabs from Chrome go to it.
  if (Browser* browser = ExistingBrowserFor(profile)) {
    BrowserActiveStateManager::From(browser)->DidBecomeActive();
  }
}

bool WindowHost::IsActiveBrowser(const Browser* browser) const {
  return browser && active_profile_ &&
         ExistingBrowserFor(active_profile_) == browser;
}

void WindowHost::ShowInactive() {
  if (widget_ && !widget_close_allowed_ && !widget_->IsVisible()) {
    widget_->ShowInactive();
  }
}

void WindowHost::CloseRequestedByUser() {
  if (close_state_ != CloseState::kOpen) {
    return;
  }
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(windowShouldClose:)] &&
      ![delegate windowShouldClose:owner]) {
    return;
  }
  Close();
}

void WindowHost::Close() {
  if (close_state_ != CloseState::kOpen) {
    return;
  }
  close_state_ = CloseState::kAsking;
  ContinueClose();
}

// As BrowserCloseManager does for the quit: every Browser's beforeunload first, one Browser
// at a time, and nothing closes until all of them said yes.
void WindowHost::ContinueClose() {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  for (Browser* browser : browsers()) {
    if (UnloadController::From(browser)->TryToCloseWindow(
            /*skip_beforeunload=*/false,
            base::BindRepeating(&WindowHost::OnBeforeUnloadAnswered,
                                GetWeakPtr()))) {
      return;  // A page is asking; OnBeforeUnloadAnswered continues.
    }
  }
  const int downloads = DownloadsCancelledByClose();
  if (downloads > 0) {
    ConfirmCloseWithDownloads(
        downloads, base::BindOnce(
                       [](base::WeakPtr<WindowHost> host, bool close_anyway) {
                         if (!host || host->close_state_ != CloseState::kAsking) {
                           return;
                         }
                         if (close_anyway) {
                           host->CommitClose();
                         } else {
                           host->CancelClose();
                         }
                       },
                       GetWeakPtr()));
    return;
  }
  CommitClose();
}

void WindowHost::OnBeforeUnloadAnswered(bool proceed) {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  if (proceed) {
    ContinueClose();
  } else {
    CancelClose();
  }
}

void WindowHost::CancelClose() {
  close_state_ = CloseState::kOpen;
  // Browsers whose pages already agreed go back to normal (their unload handlers won't run).
  for (Browser* browser : browsers()) {
    UnloadController::From(browser)->ResetTryToCloseWindow();
  }
  NotifyCloseCancelled();
}

void WindowHost::NotifyCloseCancelled() {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<WindowHost> host) {
                       if (!host) {
                         return;
                       }
                       NNCoreWindow* owner = host->owner_;
                       id<NNCoreWindowDelegate> delegate = owner.delegate;
                       if ([delegate respondsToSelector:@selector
                                     (windowDidCancelClose:)]) {
                         [delegate windowDidCancelClose:owner];
                       }
                     },
                     GetWeakPtr()));
}

void WindowHost::CommitClose() {
  close_state_ = CloseState::kClosing;
  if (browsers_.empty()) {
    CloseWidget();
    return;
  }
  // Each Browser runs its pages' unload handlers, closes its tabs and is destroyed by
  // Chrome; BrowserWindowDestroyed closes the widget after the last one.
  for (Browser* browser : browsers()) {
    browser->GetWindow()->Close();
  }
}

void WindowHost::CloseWidget() {
  if (widget_close_allowed_) {
    return;
  }
  widget_close_allowed_ = true;
  if (widget_) {
    widget_->Close();
  }
  std::erase(Hosts(), this);
  // The host may have let go of its NNCoreWindow after -close; it goes after this turn.
  NNCoreWindow* owner = owner_ref_;
  owner_ref_ = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    (void)owner;
  });
}

int WindowHost::DownloadsCancelledByClose() const {
  // On the Mac a profile's downloads outlive its windows (the app stays up); an
  // off-the-record profile's go with its last window.
  int count = 0;
  for (const auto& [profile, browser] : browsers_) {
    if (!profile->IsOffTheRecord()) {
      continue;
    }
    bool other_window = false;
    GlobalBrowserCollection::GetInstance()->ForEach(
        [&](BrowserWindowInterface* other) {
          if (other->GetProfile() == profile && WindowHost::ForBrowser(other) != this &&
              !other->capabilities()->IsAttemptingToCloseBrowser()) {
            other_window = true;
          }
          return !other_window;
        });
    DownloadCoreService* downloads =
        DownloadCoreServiceFactory::GetForBrowserContext(profile);
    if (!other_window && downloads) {
      count += downloads->BlockingShutdownCount();
    }
  }
  return count;
}

void WindowHost::ConfirmCloseWithDownloads(int count,
                                           base::OnceCallback<void(bool)> callback) {
  auto answer = std::make_shared<base::OnceCallback<void(bool)>>(std::move(callback));
  // Never synchronously: Chrome's callers set up their state after asking.
  auto reply = ^(BOOL close_anyway) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](std::shared_ptr<base::OnceCallback<void(bool)>> answer,
                          bool close_anyway) {
                         if (*answer) {
                           std::move(*answer).Run(close_anyway);
                         }
                       },
                       answer, close_anyway));
  };
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if (![delegate respondsToSelector:@selector
                 (window:confirmCloseWithDownloads:completion:)]) {
    reply(YES);
    return;
  }
  [delegate window:owner confirmCloseWithDownloads:count completion:reply];
}

void WindowHost::BrowserWindowDestroyed(NNBrowserWindow* window) {
  for (auto it = browsers_.begin(); it != browsers_.end(); ++it) {
    if (it->second == window->browser()) {
      it->second->GetTabStripModel()->RemoveObserver(this);
      if (active_profile_ == it->first) {
        active_profile_ = nullptr;
      }
      browsers_.erase(it);
      break;
    }
  }
  if (browsers_.empty() &&
      (closing() || browser_shutdown::IsTryingToQuit())) {
    close_state_ = CloseState::kClosing;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&WindowHost::CloseWidget, GetWeakPtr()));
  }
}

void WindowHost::ActiveTabChanged(Browser* browser,
                                  content::WebContents* contents) {
  if (!contents) {
    return;
  }
  NNCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  NNCoreWindow* owner = owner_;
  if ([owner.delegate respondsToSelector:@selector(window:didActivateTab:)]) {
    [owner.delegate window:owner didActivateTab:tab];
  }
}

void WindowHost::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if (change.type() == TabStripModelChange::kInserted) {
    for (const auto& inserted : change.GetInsert()->contents) {
      TabBridge* bridge = TabBridge::GetOrCreate(inserted.contents);
      bridge->EnsureFaviconObserved();
      std::optional<WindowOpenDisposition> disposition =
          bridge->TakeOpenDisposition();
      content::WebContents* source = bridge->open_source();
      if (!disposition && pending_open_.disposition) {
        disposition = pending_open_.disposition;
        source = pending_open_.source.get();
        bridge->set_open(*disposition, source);
      }
      if (!source) {
        tabs::TabInterface* opener_tab =
            tab_strip_model->GetOpenerOfTabAt(inserted.index);
        source = opener_tab ? opener_tab->GetContents() : nullptr;
      }
      NNCoreTab* opener =
          source ? TabBridge::GetOrCreate(source)->tab() : nil;
      if (!disposition) {
        disposition = tab_strip_model->active_index() == inserted.index
                          ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                          : WindowOpenDisposition::NEW_BACKGROUND_TAB;
      }
      if ([delegate respondsToSelector:@selector
                    (window:didInsertTab:opener:disposition:)]) {
        [delegate window:owner
            didInsertTab:bridge->tab()
                  opener:opener
             disposition:@(DispositionName(*disposition))];
      }
    }
  } else if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      if (!removed.contents) {
        continue;
      }
      TabBridge* bridge = TabBridge::FromWebContents(removed.contents);
      // Closed by the page (window.close()) or by Chrome (an extension's tabs.remove),
      // not by the host, nor by its window or the quit closing everything.
      Browser* browser = nullptr;
      for (Browser* b : browsers()) {
        if (b->GetTabStripModel() == tab_strip_model) {
          browser = b;
        }
      }
      const bool browser_closing =
          !browser || UnloadController::From(browser)->is_attempting_to_close_browser();
      if (bridge && removed.remove_reason == TabRemovedReason::kDeleted &&
          !browser_closing && !closing() && !browser_shutdown::IsTryingToQuit()) {
        bridge->ReportWillClose();
      }
      if (bridge &&
          [delegate respondsToSelector:@selector(window:didRemoveTab:)]) {
        [delegate window:owner didRemoveTab:bridge->tab()];
      }
    }
  }
}

void WindowHost::DevToolsDockChanged(content::WebContents* inspected,
                                     content::WebContents* devtools) {
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if (![delegate respondsToSelector:@selector(window:
                                        devToolsDidChangeForTab:view:)]) {
    return;
  }
  NSView* view =
      devtools ? devtools->GetNativeView().GetNativeNSView() : nil;
  [delegate window:owner
      devToolsDidChangeForTab:TabBridge::GetOrCreate(inspected)->tab()
                         view:view];
}

bool WindowHost::OfferPasswordSave(content::WebContents* contents) {
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if (![delegate respondsToSelector:@selector
                 (window:passwordSavePromptForTab:username:origin:)]) {
    return false;
  }
  base::WeakPtr<PasswordsModelDelegate> model =
      PasswordsModelDelegateFromWebContents(contents);
  if (!model ||
      model->GetState() != password_manager::ui::PENDING_PASSWORD_STATE) {
    return false;
  }
  const password_manager::PasswordForm& form = model->GetPendingPassword();
  [delegate window:owner
      passwordSavePromptForTab:TabBridge::GetOrCreate(contents)->tab()
                      username:base::SysUTF16ToNSString(form.username_value)
                        origin:base::SysUTF8ToNSString(
                                   model->GetOrigin().Serialize())];
  return true;
}

void WindowHost::FullscreenChanged(Browser* browser, bool fullscreen) {
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  content::WebContents* contents =
      browser->GetTabStripModel()->GetActiveWebContents();
  if (contents && [delegate respondsToSelector:@selector
                            (window:tab:didChangeFullscreen:)]) {
    [delegate window:owner
                     tab:TabBridge::GetOrCreate(contents)->tab()
        didChangeFullscreen:fullscreen];
  }
}

gfx::NativeView WindowHost::GetHostView() const {
  return gfx::NativeView(host_view_);
}

gfx::Point WindowHost::GetDialogPosition(const gfx::Size& size) {
  // Top centre of the page that is showing (Chrome puts tab-modal dialogs there).
  NSRect page = host_view_.bounds;
  if (Browser* browser =
          active_profile_ ? ExistingBrowserFor(active_profile_) : nullptr) {
    if (content::WebContents* contents =
            browser->GetTabStripModel()->GetActiveWebContents()) {
      NSView* view = contents->GetNativeView().GetNativeNSView();
      if (view.window == host_view_.window && view.superview) {
        page = [view convertRect:view.bounds toView:host_view_];
      }
    }
  }
  const int top = host_view_.bounds.size.height - NSMaxY(page);
  return gfx::Point(NSMidX(page) - size.width() / 2, top);
}

gfx::Size WindowHost::GetMaximumDialogSize() {
  NSSize size = host_view_.bounds.size;
  return gfx::Size(size.width, size.height);
}

void WindowHost::AddObserver(web_modal::ModalDialogHostObserver* observer) {
  modal_observers_.AddObserver(observer);
}

void WindowHost::RemoveObserver(web_modal::ModalDialogHostObserver* observer) {
  modal_observers_.RemoveObserver(observer);
}

void ConfirmQuitWithDownloads(int count, base::OnceCallback<void(bool)> callback) {
  WindowHost* host =
      WindowHost::ForBrowser(GetLastActiveBrowserWindowInterfaceWithAnyProfile());
  if (!host && !WindowHost::All().empty()) {
    host = WindowHost::All().back();
  }
  if (host) {
    host->ConfirmCloseWithDownloads(count, std::move(callback));
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(callback), true));
}

void NotifyWindowsQuitCancelled() {
  for (WindowHost* host : WindowHost::All()) {
    host->NotifyCloseCancelled();
  }
}

// --- NNBrowserDelegate ------------------------------------------------------------------

NNBrowserDelegate::NNBrowserDelegate(Browser* browser,
                                     base::WeakPtr<WindowHost> host)
    : browser_(browser), host_(host), is_ours_(!!host) {}

NNBrowserDelegate::~NNBrowserDelegate() = default;

std::unique_ptr<content::WebContents> NNBrowserDelegate::AddWebContents(
    std::unique_ptr<content::WebContents> new_contents) {
  return new_contents;
}

bool NNBrowserDelegate::KeepsWindowWithoutTabs() const {
  // A profile's Browser stays while its window is open, tabs or not; the host decides.
  // (Chrome checks the Browser's own close first: UnloadController's
  // is_attempting_to_close_browser.)
  return host_ && !host_->closing() && !browser_shutdown::IsTryingToQuit();
}

bool NNBrowserDelegate::AllowsDockedDevTools() const {
  return is_ours_;
}

void NNBrowserDelegate::DevToolsDockChanged(content::WebContents* inspected,
                                            content::WebContents* devtools) {
  if (host_) {
    host_->DevToolsDockChanged(inspected, devtools);
  }
}

NNBrowserDelegate* DelegateFor(const BrowserWindowInterface* browser) {
  // Every Browser's delegate is ours: NNCore defines cef::BrowserDelegate::Create.
  return browser ? static_cast<NNBrowserDelegate*>(browser->cef_delegate())
                 : nullptr;
}

// --- NNWebContentsDelegate --------------------------------------------------------------

NNWebContentsDelegate::NNWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller,
    base::WeakPtr<WindowHost> host)
    : BrowserWebContentsDelegate(browser,
                                 exclusive_access_manager,
                                 command_controller,
                                 unload_controller,
                                 app_browser_controller,
                                 window,
                                 capabilities,
                                 browser_ui_controller),
      host_(std::move(host)) {}

NNWebContentsDelegate::~NNWebContentsDelegate() = default;

namespace {
bool IsWindowDisposition(WindowOpenDisposition d) {
  return d == WindowOpenDisposition::NEW_POPUP ||
         d == WindowOpenDisposition::NEW_WINDOW;
}
bool IsNewTabDisposition(WindowOpenDisposition d) {
  return IsWindowDisposition(d) ||
         d == WindowOpenDisposition::NEW_FOREGROUND_TAB ||
         d == WindowOpenDisposition::NEW_BACKGROUND_TAB;
}
}  // namespace

content::WebContents* NNWebContentsDelegate::OpenURLFromTab(
    content::WebContents* source,
    const content::OpenURLParams& params,
    base::OnceCallback<void(content::NavigationHandle&)>
        navigation_handle_callback) {
  // The app's own pages: never opened here. Chrome's pages ask the host (nn_page_channel.h).
  if (IsAppURL(params.url)) {
    if (source && IsWebUIURL(source->GetLastCommittedURL())) {
      ReportAppURLRequest(source, params.url, params.user_gesture);
    }
    return nullptr;
  }
  WindowHost* host = host_.get();
  if (!host || !IsNewTabDisposition(params.disposition)) {
    return BrowserWebContentsDelegate::OpenURLFromTab(
        source, params, std::move(navigation_handle_callback));
  }
  // ⌘-click, shift-click, middle-click, a form with target=_blank…: Chrome creates and
  // navigates the new contents itself (POST body, referrer and initiator included). It
  // goes into our Browser as a tab; the host learns what was asked for.
  content::OpenURLParams tab_params(params);
  WindowHost::PendingOpen open{params.disposition,
                              source ? source->GetWeakPtr() : nullptr};
  base::AutoReset<WindowHost::PendingOpen> pending(&host->pending_open(),
                                                   std::move(open));
  if (IsWindowDisposition(params.disposition)) {
    tab_params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  }
  return BrowserWebContentsDelegate::OpenURLFromTab(
      source, tab_params, std::move(navigation_handle_callback));
}

content::WebContents* NNWebContentsDelegate::AddNewContents(
    content::WebContents* source,
    std::unique_ptr<content::WebContents> new_contents,
    const GURL& target_url,
    WindowOpenDisposition disposition,
    const blink::mojom::WindowFeatures& window_features,
    bool user_gesture,
    bool* was_blocked) {
  if (IsAppURL(target_url)) {
    // window.open('netnyahoo:…'): dropped, as CEF did; Chrome's pages ask the host.
    if (source && IsWebUIURL(source->GetLastCommittedURL())) {
      ReportAppURLRequest(source, target_url, user_gesture);
    }
    return nullptr;
  }
  if (host_ && new_contents) {
    // window.open and target=_blank: the renderer already made the contents (opener
    // relationship and all). Keep them as a tab of ours.
    TabBridge::GetOrCreate(new_contents.get())->set_open(disposition, source);
    if (IsWindowDisposition(disposition)) {
      disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
    }
  }
  return BrowserWebContentsDelegate::AddNewContents(
      source, std::move(new_contents), target_url, disposition,
      window_features, user_gesture, was_blocked);
}

void NNWebContentsDelegate::UpdateTargetURL(content::WebContents* source,
                                            const GURL& url) {
  BrowserWebContentsDelegate::UpdateTargetURL(source, url);
  NNCoreTab* tab = TabBridge::GetOrCreate(source)->tab();
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didChangeStatusText:)]) {
    [delegate tab:tab didChangeStatusText:base::SysUTF8ToNSString(url.spec())];
  }
}

// --- TabBridge --------------------------------------------------------------------------

TabBridge::TabBridge(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<TabBridge>(*contents) {
  tab_ = [[NNCoreTab alloc] initWithContents:contents];
}

TabBridge::~TabBridge() = default;

// static
TabBridge* TabBridge::GetOrCreate(content::WebContents* contents) {
  CreateForWebContents(contents);
  return FromWebContents(contents);
}

void TabBridge::EnsureFaviconObserved() {
  if (observing_favicon_) {
    return;
  }
  if (auto* driver =
          favicon::ContentFaviconDriver::FromWebContents(web_contents())) {
    driver->AddObserver(this);
    observing_favicon_ = true;
  }
}

void TabBridge::EnsureFindObserved() {
  if (find_helper_) {
    return;
  }
  find_helper_ = find_in_page::FindTabHelper::FromWebContents(web_contents());
  if (find_helper_) {
    find_helper_->AddObserver(this);
  }
}

void TabBridge::OnFindResultAvailable(content::WebContents* web_contents) {
  const find_in_page::FindNotificationDetails& result =
      find_helper_->find_result();
  NNCoreTab* tab = tab_;
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didFindMatches:active:final:)]) {
    [delegate tab:tab
        didFindMatches:result.number_of_matches()
                active:result.active_match_ordinal()
                 final:result.final_update()];
  }
}

void TabBridge::OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) {
  helper->RemoveObserver(this);
  find_helper_ = nullptr;
}

std::optional<WindowOpenDisposition> TabBridge::TakeOpenDisposition() {
  std::optional<WindowOpenDisposition> d = open_disposition_;
  open_disposition_.reset();
  return d;
}

void TabBridge::ReportWillClose() {
  if (closed_by_host_ || will_close_reported_) {
    return;
  }
  will_close_reported_ = true;
  [tab_ notify:@selector(tabWillClose:)];
}

namespace {
const char* TerminationName(base::TerminationStatus status) {
  switch (status) {
    case base::TERMINATION_STATUS_NORMAL_TERMINATION:
      return "normal";
    case base::TERMINATION_STATUS_ABNORMAL_TERMINATION:
      return "abnormal";
    case base::TERMINATION_STATUS_PROCESS_WAS_KILLED:
      return "killed";
    case base::TERMINATION_STATUS_PROCESS_CRASHED:
      return "crashed";
    case base::TERMINATION_STATUS_OOM:
      return "oom";
    case base::TERMINATION_STATUS_LAUNCH_FAILED:
      return "launchFailed";
    case base::TERMINATION_STATUS_EVICTED_FOR_MEMORY:
      return "evicted";
    default:
      return "other";
  }
}
}  // namespace

void TabBridge::PrimaryMainFrameRenderProcessGone(
    base::TerminationStatus status) {
  // A renderer that exits cleanly (the quit, an unused process) leaves no sad tab.
  if (status == base::TERMINATION_STATUS_NORMAL_TERMINATION ||
      status == base::TERMINATION_STATUS_STILL_RUNNING) {
    return;
  }
  NNCoreTab* tab = tab_;
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:rendererGone:code:)]) {
    [delegate tab:tab
        rendererGone:@(TerminationName(status))
                code:web_contents()->GetCrashedErrorCode()];
  }
}

void TabBridge::DidChangeThemeColor() {
  [tab_ notify:@selector(tabDidChangeThemeColor:)];
}

void TabBridge::OnWebContentsFocused(
    content::RenderWidgetHost* render_widget_host) {
  [tab_ notify:@selector(tabDidGainFocus:)];
}

void TabBridge::OnAudioStateChanged(bool audible) {
  [tab_ notify:@selector(tabDidChangeAudio:)];
}

void TabBridge::DidUpdateAudioMutingState(bool muted) {
  [tab_ notify:@selector(tabDidChangeAudio:)];
}

void TabBridge::TitleWasSet(content::NavigationEntry* entry) {
  [tab_ notify:@selector(tabDidChangeTitle:)];
}

void TabBridge::DidStartLoading() {
  EnsureFaviconObserved();
  [tab_ notify:@selector(tabDidChangeLoading:)];
}

void TabBridge::DidStopLoading() {
  [tab_ notify:@selector(tabDidChangeLoading:)];
}

void TabBridge::LoadProgressChanged(double progress) {
  [tab_ notify:@selector(tabDidChangeProgress:)];
}

void TabBridge::DidFinishNavigation(content::NavigationHandle* handle) {
  EnsureFaviconObserved();
  [tab_ notify:@selector(tabDidChangeURL:)];
  const int error = handle->GetNetErrorCode();
  if (handle->IsInPrimaryMainFrame() && error != net::OK) {
    NNCoreTab* tab = tab_;
    id<NNCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:didFailLoad:code:description:)]) {
      [delegate tab:tab
          didFailLoad:base::SysUTF8ToNSString(handle->GetURL().spec())
                 code:error
          description:base::SysUTF8ToNSString(net::ErrorToShortString(error))];
    }
  }
}

void TabBridge::NavigationEntryCommitted(
    const content::LoadCommittedDetails& load_details) {
  [tab_ notify:@selector(tabDidChangeNavigationState:)];
}

void TabBridge::WebContentsDestroyed() {
  if (find_helper_) {
    find_helper_->RemoveObserver(this);
    find_helper_ = nullptr;
  }
  if (observing_favicon_) {
    if (auto* driver =
            favicon::ContentFaviconDriver::FromWebContents(web_contents())) {
      driver->RemoveObserver(this);
    }
    observing_favicon_ = false;
  }
  [tab_ contentsDestroyed];
}

void TabBridge::OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                                 NotificationIconType notification_icon_type,
                                 const GURL& icon_url,
                                 bool icon_url_changed,
                                 const gfx::Image& image) {
  favicon_url_ = icon_url;
  [tab_ notify:@selector(tabDidChangeFavicon:)];
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabBridge);

}  // namespace nncore
