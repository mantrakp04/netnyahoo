#include "netnyahoo/core/nn_browser.h"

#import <AppKit/AppKit.h>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_active_state_manager/browser_active_state_manager.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/find_in_page/find_notification_details.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/password_manager/core/browser/password_form.h"
#import "components/remote_cocoa/app_shim/bridged_content_view.h"
#include "content/public/browser/web_contents.h"
#include "netnyahoo/core/nn_browser_window.h"
#import "netnyahoo/core/nncore_internal.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/mac/coordinate_conversion.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
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

WindowHost::WindowHost(NNCoreWindow* owner, const gfx::Rect& bounds)
    : owner_(owner) {
  widget_delegate_ = std::make_unique<views::WidgetDelegate>();
  widget_delegate_->SetCanResize(true);
  widget_delegate_->SetCanMaximize(true);
  widget_delegate_->SetCanMinimize(true);
  widget_delegate_->SetTitle(u"Netnyahoo");

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
  for (auto& observer : modal_observers_) {
    observer.OnHostDestroying();
  }
  for (auto& [profile, browser] : browsers_) {
    browser->GetTabStripModel()->RemoveObserver(this);
  }
  browsers_.clear();
  widget_.reset();
}

NSWindow* WindowHost::ns_window() const {
  return widget_ ? widget_->GetNativeWindow().GetNativeNSWindow() : nil;
}

Browser* WindowHost::ExistingBrowserFor(Profile* profile) const {
  auto it = browsers_.find(profile);
  return it == browsers_.end() ? nullptr : it->second.get();
}

Browser* WindowHost::BrowserFor(Profile* profile) {
  if (Browser* browser = ExistingBrowserFor(profile)) {
    return browser;
  }
  if (closing_ || GetBrowserWindowCreationStatusForProfile(*profile) !=
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
  browsers_[profile] = browser;
  browser->GetTabStripModel()->AddObserver(this);
  if (!active_profile_) {
    SetActiveProfile(profile);
  }
  return browser;
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
  if (widget_ && !widget_->IsVisible()) {
    widget_->ShowInactive();
  }
}

void WindowHost::Close() {
  if (closing_) {
    return;
  }
  closing_ = true;
  if (browsers_.empty()) {
    widget_->Close();
    return;
  }
  // Each Browser closes its tabs (beforeunload first) and is destroyed by Chrome;
  // BrowserWindowDestroyed closes the widget after the last one.
  std::vector<Browser*> browsers;
  for (auto& [profile, browser] : browsers_) {
    browsers.push_back(browser.get());
  }
  for (Browser* browser : browsers) {
    browser->GetWindow()->Close();
  }
}

void WindowHost::BrowserWindowDestroyed(NNBrowserWindow* window) {
  for (auto it = browsers_.begin(); it != browsers_.end(); ++it) {
    if (it->second == window->browser()) {
      if (active_profile_ == it->first) {
        active_profile_ = nullptr;
      }
      browsers_.erase(it);
      break;
    }
  }
  if (browsers_.empty() && (closing_ || browser_shutdown::IsTryingToQuit())) {
    closing_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<WindowHost> host) {
                         if (host && host->widget_) {
                           host->widget_->Close();
                         }
                       },
                       GetWeakPtr()));
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
  return host_ && !host_->closing() && !closing_ &&
         !browser_shutdown::IsTryingToQuit();
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
  [tab_ notify:@selector(tabDidChangeFavicon:)];
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabBridge);

}  // namespace nncore
