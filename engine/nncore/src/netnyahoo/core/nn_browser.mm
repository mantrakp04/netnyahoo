#include "netnyahoo/core/nn_browser.h"

#import <AppKit/AppKit.h>

#include <algorithm>

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
#include "chrome/browser/profiles/profile_manager.h"
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
#include "extensions/browser/api/declarative_net_request/request_action.h"
#include "extensions/browser/api/web_request/web_request_info.h"
#include "extensions/browser/extensions_browser_client.h"
#include "extensions/common/constants.h"
#include "content/public/browser/web_contents.h"
#include "chrome/browser/tab_list/tab_removed_reason.h"
#include "net/base/net_errors.h"
#include "content/public/browser/render_frame_host.h"
#include "third_party/blink/public/common/loader/resource_type_util.h"
#include "third_party/blink/public/mojom/loader/resource_load_info.mojom.h"
#include "netnyahoo/core/nn_desktop_capture.h"
#include "netnyahoo/core/nn_fake_media.h"
#include "netnyahoo/core/nn_installed_bubble.h"
#include "netnyahoo/core/nn_page_channel.h"
#include "netnyahoo/core/nn_tab_info.h"
#include "netnyahoo/core/nn_autofill_trigger.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/common/result_codes.h"
#include "netnyahoo/core/nn_browser_window.h"
#include "netnyahoo/core/nn_password_prompt.h"
#import "netnyahoo/core/nncore_internal.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/mac/coordinate_conversion.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/window/client_view.h"
#include "url/origin.h"

namespace content {
// RenderWidgetHostViewBase's opacity hook (engine/nncore/apply.sh).
extern bool g_netnyahoo_opacity_from_default_color;
}  // namespace content

// The hook in declarativeNetRequest's ActionTracker (engine/nncore/apply.sh).
extern void (*g_netnyahoo_dnr_rule_matched)(
    content::BrowserContext* browser_context,
    int tab_id,
    const extensions::declarative_net_request::RequestAction& action,
    const extensions::WebRequestInfo& request);

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
  widget_->AddObserver(this);

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
  if (widget_) {
    widget_->RemoveObserver(this);
  }
  widget_.reset();
}

namespace {

// Chrome has one active Browser at a time (its last active, whose profile is the last used):
// the others go inactive first, and one already flagged active is flagged again so Chrome
// hears of it.
void ActivateExclusively(Browser* browser) {
  for (WindowHost* host : WindowHost::All()) {
    for (Browser* other : host->browsers()) {
      if (other != browser) {
        BrowserActiveStateManager::From(other)->DidBecomeInactive();
      }
    }
  }
  BrowserActiveStateManager* state = BrowserActiveStateManager::From(browser);
  if (GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser() != browser ||
      ProfileManager::GetLastUsedProfileIfLoaded() != browser->GetProfile()) {
    state->DidBecomeInactive();
  }
  state->DidBecomeActive();
}

}  // namespace

void WindowHost::NoteHostActivated(Browser* browser) {
  if (internal_ || !browser || ExistingBrowserFor(browser->GetProfile()) != browser) {
    return;
  }
  for (WindowHost* host : Hosts()) {
    if (host != this && host->widget() && host->widget()->IsActive()) {
      return;  // the user's window is another one
    }
  }
  if (GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser() == browser &&
      ProfileManager::GetLastUsedProfileIfLoaded() == browser->GetProfile()) {
    return;
  }
  ActivateExclusively(browser);
}

void WindowHost::OnWidgetActivationChanged(views::Widget* widget, bool active) {
  Browser* browser = !internal_ && active_profile_ ? ExistingBrowserFor(active_profile_) : nullptr;
  if (!browser) {
    return;
  }
  if (active) {
    ActivateExclusively(browser);
  } else {
    BrowserActiveStateManager::From(browser)->DidBecomeInactive();
  }
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
  // A profile that went (a destroyed one's wrapper hands out null) or is going: no Browser.
  if (!profile || IsProfileDying(profile)) {
    return nullptr;
  }
  if (Browser* browser = ExistingBrowserFor(profile)) {
    return browser;
  }
  // Nor a new one for a profile being deleted (Chrome is closing the ones it has).
  if (IsProfileDeleting(profile)) {
    return nullptr;
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
  // currentWindow, keyboard shortcuts and new tabs from Chrome go to it (never one of the
  // host's own hidden pages).
  if (Browser* browser = internal_ ? nullptr : ExistingBrowserFor(profile)) {
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
  ++close_attempt_;
  ContinueClose();
}

void WindowHost::ContinueCloseAttempt(int attempt) {
  if (attempt != close_attempt_ || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  ContinueClose();
}

// As BrowserCloseManager does for the quit: every Browser's beforeunload first, one Browser
// at a time, and nothing closes until all of them said yes.
void WindowHost::ContinueClose() {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  asking_ = nullptr;
  for (Browser* browser : browsers()) {
    if (UnloadController::From(browser)->TryToCloseWindow(
            /*skip_beforeunload=*/false,
            base::BindRepeating(&WindowHost::OnBeforeUnloadAnswered,
                                GetWeakPtr()))) {
      asking_ = browser;
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
  asking_ = nullptr;
  if (proceed) {
    ContinueClose();
  } else {
    CancelClose();
  }
}

void WindowHost::CancelClose() {
  close_state_ = CloseState::kOpen;
  asking_ = nullptr;
  ++close_attempt_;
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
  const bool was_asking = asking_ && window->browser() == asking_;
  if (was_asking) {
    asking_ = nullptr;
  }
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
  } else if (was_asking && close_state_ == CloseState::kAsking &&
             !browser_shutdown::IsTryingToQuit()) {
    // The Browser being asked closed itself (the host closed the tab it was asking: its
    // UnloadController then closes the Browser and never answers). The close goes on with
    // the others; without this the window stayed open, hidden, with its compositor (~40 MB
    // in the browser process and as much in the GPU process, each window the app closed
    // as its page loaded). A quit owns the asking once it started (its close manager's
    // callbacks replaced ours): this close then ends with the quit, as QuitCancelled says.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&WindowHost::ContinueCloseAttempt, GetWeakPtr(),
                                  close_attempt_));
  }
}

namespace {
// Chrome is inside a tab-strip change while it tells the host (its TabStripModel CHECKs
// against re-entrant changes): the API defers tab-strip changes made from the callbacks.
int g_tab_strip_notifying = 0;
}  // namespace

bool IsNotifyingTabStrip() {
  return g_tab_strip_notifying > 0;
}

void WindowHost::ActiveTabChanged(Browser* browser,
                                  content::WebContents* contents) {
  if (!contents) {
    return;
  }
  // A page of the profile came forward: an "added" bubble waiting for one can show (not from
  // inside Chrome's tab-strip change).
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&ShowWaitingInstalledBubbles));
  if (quiet_activation_) {
    return;
  }
  base::AutoReset<int> notifying(&g_tab_strip_notifying,
                                 g_tab_strip_notifying + 1);
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
  base::AutoReset<int> notifying(&g_tab_strip_notifying,
                                 g_tab_strip_notifying + 1);
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if (change.type() == TabStripModelChange::kInserted) {
    for (const auto& inserted : change.GetInsert()->contents) {
      TabBridge* bridge = TabBridge::GetOrCreate(inserted.contents);
      TrackAutofillFocus(inserted.contents);
      bridge->EnsureFaviconObserved();
      bridge->EnsurePopupsObserved();
      bridge->EnsureZoomObserved();
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
  if ([delegate respondsToSelector:@selector(window:passwordPrompt:forTab:)]) {
    NSDictionary* prompt = PasswordPrompt(contents);
    if (!prompt) {
      return false;
    }
    PasswordPromptShown(contents);
    [delegate window:owner
        passwordPrompt:prompt
                forTab:TabBridge::GetOrCreate(contents)->tab()];
    PasswordConfirmationShown(contents);
    return true;
  }
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

void WindowHost::FullscreenChanged(content::WebContents* contents,
                                   bool fullscreen) {
  NNCoreWindow* owner = owner_;
  id<NNCoreWindowDelegate> delegate = owner.delegate;
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
    host->QuitCancelled();
  }
}

void WindowHost::QuitCancelled() {
  // A close of ours the quit overtook (Chrome's close manager took its Browsers' beforeunload
  // over): it ends with the quit, the window as it was.
  if (close_state_ == CloseState::kAsking) {
    close_state_ = CloseState::kOpen;
    asking_ = nullptr;
    ++close_attempt_;
    for (Browser* browser : browsers()) {
      UnloadController::From(browser)->ResetTryToCloseWindow();
    }
  }
  NotifyCloseCancelled();
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
    TabBridge* bridge = TabBridge::GetOrCreate(new_contents.get());
    bridge->set_open(disposition, source);
    if (disposition == WindowOpenDisposition::NEW_POPUP) {
      // The host may give a popup a window of its own, sized and placed as asked.
      NSMutableDictionary* features = [NSMutableDictionary dictionary];
      const gfx::Rect& bounds = window_features.bounds;
      if (window_features.has_x) {
        features[@"x"] = @(bounds.x());
      }
      if (window_features.has_y) {
        features[@"y"] = @(bounds.y());
      }
      if (window_features.has_width) {
        features[@"width"] = @(bounds.width());
      }
      if (window_features.has_height) {
        features[@"height"] = @(bounds.height());
      }
      bridge->set_popup_features(features);
    }
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

void NNWebContentsDelegate::RequestMediaAccessPermission(
    content::WebContents* web_contents,
    const content::MediaStreamRequest& request,
    content::MediaResponseCallback callback) {
  content::MediaStreamRequest granted(request);
  ApplyDesktopCaptureGrant(web_contents, granted);
  KeepAudioCaptureFake(granted);
  BrowserWebContentsDelegate::RequestMediaAccessPermission(web_contents, granted,
                                                           std::move(callback));
}

void NNWebContentsDelegate::ActivateContents(content::WebContents* contents) {
  NNCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if (![delegate respondsToSelector:@selector(tab:requestsActivation:)]) {
    BrowserWebContentsDelegate::ActivateContents(contents);
    return;
  }
  const bool pip =
      PictureInPictureWindowManager::GetInstance()->GetWebContents() == contents;
  [delegate tab:tab requestsActivation:pip ? @"pictureInPicture" : @"page"];
}

void NNWebContentsDelegate::RendererUnresponsive(
    content::WebContents* source,
    content::RenderWidgetHost* render_widget_host,
    base::RepeatingClosure hang_monitor_restarter) {
  TabBridge::GetOrCreate(source)->SetUnresponsive(
      render_widget_host, std::move(hang_monitor_restarter));
}

void NNWebContentsDelegate::RendererResponsive(
    content::WebContents* source,
    content::RenderWidgetHost* render_widget_host) {
  TabBridge::GetOrCreate(source)->SetResponsive(render_widget_host);
}

namespace {

// Chrome's media capture indicator, for every tab: what the page is capturing now.
class MediaCaptureObserver : public MediaStreamCaptureIndicator::Observer {
 public:
  explicit MediaCaptureObserver(scoped_refptr<MediaStreamCaptureIndicator> indicator)
      : indicator_(std::move(indicator)) {
    indicator_->AddObserver(this);
  }
  void OnIsCapturingVideoChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingAudioChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingTabChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingWindowChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingDisplayChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }

  NSDictionary* AccessOf(content::WebContents* contents) const {
    return @{
      @"camera" : @(indicator_->IsCapturingVideo(contents)),
      @"microphone" : @(indicator_->IsCapturingAudio(contents)),
      @"screen" : @(indicator_->IsCapturingTab(contents) ||
                    indicator_->IsCapturingWindow(contents) ||
                    indicator_->IsCapturingDisplay(contents)),
    };
  }

 private:
  void Changed(content::WebContents* contents) {
    if (contents) {
      TabBridge::GetOrCreate(contents)->MediaAccessChanged();
    }
  }

  scoped_refptr<MediaStreamCaptureIndicator> indicator_;
};

MediaCaptureObserver*& CaptureObserver() {
  static MediaCaptureObserver* observer = nullptr;
  return observer;
}

}  // namespace

void StartMediaCaptureObserver() {
  if (!CaptureObserver()) {
    // Lives as long as the indicator (the process): never removed.
    CaptureObserver() = new MediaCaptureObserver(
        MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator());
  }
}

// --- TabBridge --------------------------------------------------------------------------

TabBridge::TabBridge(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<TabBridge>(*contents) {
  // The host's page background (pageBackgroundColor) is translucent: a new document's view
  // decides the page's opacity from the colours the host set, not from the last page's
  // background it took over (engine/nncore/apply.sh).
  content::g_netnyahoo_opacity_from_default_color = true;
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

void TabBridge::BeforeUnloadFired(bool proceed) {
  // The host's close was cancelled by the page: a later close is someone else's.
  if (!proceed) {
    closed_by_host_ = false;
  }
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

void TabBridge::CheckSecurity() {
  NSDictionary* info = SecurityInfoFor(web_contents());
  if ([info isEqualToDictionary:security_]) {
    return;
  }
  security_ = info;
  [tab_ notify:@selector(tabDidChangeSecurity:)];
}

void TabBridge::DidChangeVisibleSecurityState() {
  CheckSecurity();
}

void TabBridge::OnVisibilityChanged(content::Visibility visibility) {
  // Showing a page unfreezes it (Chrome's rule).
  if (visibility == content::Visibility::VISIBLE) {
    frozen_ = false;
  }
}

void TabBridge::OnPageScaleFactorChanged(float page_scale_factor) {
  pinch_scale_ = page_scale_factor;
  [tab_ notify:@selector(tabDidChangeZoom:)];
}

void TabBridge::EnsureZoomObserved() {
  if (zoom_) {
    return;
  }
  zoom_ = zoom::ZoomController::FromWebContents(web_contents());
  if (zoom_) {
    zoom_->AddObserver(this);
  }
}

void TabBridge::OnZoomChanged(
    const zoom::ZoomController::ZoomChangedEventData& data) {
  if (data.web_contents == web_contents()) {
    [tab_ notify:@selector(tabDidChangeZoom:)];
  }
}

void TabBridge::OnZoomControllerDestroyed(zoom::ZoomController* zoom_controller) {
  zoom_controller->RemoveObserver(this);
  zoom_ = nullptr;
}

void TabBridge::DidChangeThemeColor() {
  [tab_ notify:@selector(tabDidChangeThemeColor:)];
}

void TabBridge::MediaAccessChanged() {
  if (!CaptureObserver()) {
    return;
  }
  NSDictionary* access = CaptureObserver()->AccessOf(web_contents());
  if ([access isEqualToDictionary:media_access_]) {
    return;
  }
  media_access_ = access;
  NNCoreTab* tab = tab_;
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didChangeMediaAccess:)]) {
    [delegate tab:tab didChangeMediaAccess:access];
  }
}

void TabBridge::SetUnresponsive(content::RenderWidgetHost* host,
                                base::RepeatingClosure restarter) {
  if (host) {
    unresponsive_ = std::make_pair(host->GetProcess()->GetDeprecatedID(),
                                   host->GetRoutingID());
  }
  hang_monitor_restarter_ = std::move(restarter);
  [tab_ notify:@selector(tabBecameUnresponsive:)];
}

void TabBridge::SetResponsive(content::RenderWidgetHost* host) {
  // Only the widget that hung (another frame's recovery isn't this one's).
  if (!unresponsive_ ||
      (host && *unresponsive_ != std::make_pair(host->GetProcess()->GetDeprecatedID(),
                                                host->GetRoutingID()))) {
    return;
  }
  unresponsive_.reset();
  hang_monitor_restarter_.Reset();
  [tab_ notify:@selector(tabBecameResponsive:)];
}

void TabBridge::ResolveUnresponsive(bool terminate) {
  content::RenderWidgetHost* host =
      unresponsive_ ? content::RenderWidgetHost::FromID(unresponsive_->first,
                                                         unresponsive_->second)
                    : nullptr;
  base::RepeatingClosure restarter = std::move(hang_monitor_restarter_);
  hang_monitor_restarter_.Reset();
  if (terminate) {
    unresponsive_.reset();
    // As Chrome's "Exit pages" (the sad tab and rendererGone follow).
    if (host && host->GetProcess()->IsInitializedAndNotDead()) {
      host->GetProcess()->Shutdown(content::RESULT_CODE_HUNG);
    }
  } else if (restarter) {
    // "Wait": ask again if it stays hung. Still the hung widget until it answers, so its
    // recovery reports tabBecameResponsive: (as CEF's onResponsive after a wait).
    restarter.Run();
  }
}

void TabBridge::WasDiscarded() {
  discarded_ = true;
  [tab_ notify:@selector(tabDidChangeDiscarded:)];
}

void TabBridge::DidStartNavigation(content::NavigationHandle* handle) {
  // A new page: blocks of the old one's requests are no longer awaited.
  if (handle->IsInPrimaryMainFrame() && !handle->IsSameDocument()) {
    rule_blocked_urls_.clear();
  }
  // A discarded tab reloads when it's next shown or navigated.
  if (discarded_ && handle->IsInPrimaryMainFrame() &&
      !web_contents()->WasDiscarded()) {
    discarded_ = false;
    [tab_ notify:@selector(tabDidChangeDiscarded:)];
  }
}

void TabBridge::NoteHostFocus() {
  host_focus_at_ = base::TimeTicks::Now();
}

void TabBridge::OnWebContentsFocused(
    content::RenderWidgetHost* render_widget_host) {
  // The page's focus, not the one following the host's own activate or -focus.
  if (base::TimeTicks::Now() - host_focus_at_ < base::Milliseconds(250)) {
    return;
  }
  [tab_ notify:@selector(tabDidGainFocus:)];
}

void TabBridge::EnsurePopupsObserved() {
  if (popups_) {
    return;
  }
  popups_ = blocked_content::PopupBlockerTabHelper::FromWebContents(web_contents());
  if (popups_) {
    popups_->manager()->AddObserver(this);
  }
}

void TabBridge::BlockedUrlAdded(int32_t popup_id, const GURL& url) {
  // JS BlockedPopup: {id, url, origin} (the page's origin, which "always allow" applies to).
  // On the next turn: Chrome is still adding it (the host may open it at once).
  NSDictionary* popup = @{
    @"id" : [NSString stringWithFormat:@"%d", popup_id],
    @"url" : base::SysUTF8ToNSString(url.spec()),
    @"origin" : OriginOf(web_contents()->GetLastCommittedURL()) ?: @"",
  };
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<TabBridge> bridge, int32_t popup_id,
                        NSDictionary* popup) {
                       if (!bridge || !bridge->popups_ ||
                           !bridge->popups_->GetBlockedPopupRequests().contains(
                               popup_id)) {
                         return;
                       }
                       NNCoreTab* tab = bridge->tab_;
                       id<NNCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector(tab:didBlockPopup:)]) {
                         [delegate tab:tab didBlockPopup:popup];
                       }
                     },
                     weak_factory_.GetWeakPtr(), popup_id, popup));
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
  EnsurePopupsObserved();
  [tab_ notify:@selector(tabDidChangeLoading:)];
}

void TabBridge::DidStopLoading() {
  base::WeakPtr<TabBridge> alive = weak_factory_.GetWeakPtr();
  [tab_ notify:@selector(tabDidChangeLoading:)];
  if (alive) {
    CheckSecurity();
  }
}

void TabBridge::LoadProgressChanged(double progress) {
  [tab_ notify:@selector(tabDidChangeProgress:)];
}

namespace {

// A frame of the page the tab shows (not a prerendered or cached one).
bool InPrimaryPage(content::RenderFrameHost* rfh) {
  return rfh && rfh->GetOutermostMainFrame()->IsInPrimaryMainFrame();
}

}  // namespace

void TabBridge::ResourceLoadComplete(
    content::RenderFrameHost* render_frame_host,
    const content::GlobalRequestID& request_id,
    const GURL& original_url,
    const blink::mojom::ResourceLoadInfo& resource_load_info) {
  // Frame loads are navigations: DidFinishNavigation counts those.
  if (resource_load_info.net_error != net::ERR_BLOCKED_BY_CLIENT ||
      blink::IsRequestDestinationFrame(resource_load_info.request_destination) ||
      !InPrimaryPage(render_frame_host)) {
    return;
  }
  NoteBlockedByClient(resource_load_info.final_url, original_url);
}

void TabBridge::NoteRuleMatched(bool block, const GURL& url) {
  if (block) {
    // Bounded (cleared with each page): a blocked request whose failure never comes back is
    // forgotten.
    if (rule_blocked_urls_.size() >= 4096) {
      rule_blocked_urls_.erase(rule_blocked_urls_.begin());
    }
    rule_blocked_urls_.push_back(url);
  }
  NoteBlocked(url);
}

void TabBridge::NoteBlockedByClient(const GURL& blocked_url, const GURL& url) {
  // A rule saw the request as it was blocked (after any redirect).
  auto it = std::find(rule_blocked_urls_.begin(), rule_blocked_urls_.end(), blocked_url);
  if (it != rule_blocked_urls_.end()) {
    rule_blocked_urls_.erase(it);
    return;
  }
  NoteBlocked(url);
}

void InstallRuleMatchedHook() {
  g_netnyahoo_dnr_rule_matched =
      [](content::BrowserContext* context, int tab_id,
         const extensions::declarative_net_request::RequestAction& action,
         const extensions::WebRequestInfo& request) {
        using Type = extensions::declarative_net_request::RequestAction::Type;
        const bool block = action.type == Type::BLOCK || action.type == Type::COLLAPSE;
        if ((!block && action.type != Type::REDIRECT) ||
            tab_id == extension_misc::kUnknownTabId) {
          return;
        }
        // A frame's request counts for the page the tab shows, not a prerendered one; a
        // navigation's has no frame yet.
        content::RenderFrameHost* frame =
            content::RenderFrameHost::FromID(request.global_id);
        if (frame && !InPrimaryPage(frame)) {
          return;
        }
        content::WebContents* contents = nullptr;
        if (!extensions::ExtensionsBrowserClient::Get()->IsValidTabId(
                context, tab_id, /*include_incognito=*/true, &contents) ||
            !contents) {
          return;
        }
        if (TabBridge* bridge = TabBridge::FromWebContents(contents)) {
          bridge->NoteRuleMatched(block, request.url);
        }
      };
}

void TabBridge::NoteBlocked(const GURL& url) {
  blocked_last_url_ = url;
  if (blocked_pending_++ == 0) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&TabBridge::ReportBlocked, weak_factory_.GetWeakPtr()));
  }
}

void TabBridge::ReportBlocked() {
  const int count = blocked_pending_;
  NSString* url = base::SysUTF8ToNSString(blocked_last_url_.spec());
  blocked_pending_ = 0;
  blocked_last_url_ = GURL();
  NNCoreTab* tab = tab_;
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if (count > 0 &&
      [delegate respondsToSelector:@selector(tab:didBlockRequests:lastURL:)]) {
    [delegate tab:tab didBlockRequests:count lastURL:url];
  }
}

void TabBridge::DidFinishNavigation(content::NavigationHandle* handle) {
  EnsureFaviconObserved();
  EnsureZoomObserved();
  base::WeakPtr<TabBridge> alive = weak_factory_.GetWeakPtr();
  // A navigation the content blocker cancelled (main frame or subframe).
  if (handle->GetNetErrorCode() == net::ERR_BLOCKED_BY_CLIENT &&
      (handle->IsInMainFrame()
           ? handle->IsInPrimaryMainFrame()
           : InPrimaryPage(handle->GetParentFrameOrOuterDocument()))) {
    NoteBlockedByClient(handle->GetURL(), handle->GetURL());
  }
  if (handle->IsInPrimaryMainFrame() && handle->IsDownload()) {
    // The page stays; Chrome downloads the response instead (CEF's downloadNavigation).
    NNCoreTab* tab = tab_;
    id<NNCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:navigationBecameDownload:)]) {
      [delegate tab:tab
          navigationBecameDownload:base::SysUTF8ToNSString(handle->GetURL().spec())];
    }
    if (!alive) {
      return;
    }
  }
  if (handle->IsInPrimaryMainFrame() && handle->HasCommitted()) {
    CheckSecurity();
  }
  if (!alive) {
    return;
  }
  [tab_ notify:@selector(tabDidChangeURL:)];
  const int error = handle->GetNetErrorCode();
  // ERR_ABORTED is a navigation that stopped or became a download, not a failure (CEF's
  // adapter skipped it too).
  if (alive && handle->IsInPrimaryMainFrame() && error != net::OK &&
      error != net::ERR_ABORTED) {
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
  if (popups_) {
    popups_->manager()->RemoveObserver(this);
    popups_ = nullptr;
  }
  if (zoom_) {
    zoom_->RemoveObserver(this);
    zoom_ = nullptr;
  }
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
