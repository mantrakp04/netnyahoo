#include "arcadia/core/ac_browser_window.h"

#import <AppKit/AppKit.h>

#include <map>
#include <set>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"

#include "chrome/browser/devtools/devtools_ui_controller.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/autofill/save_address_bubble_controller.h"
#include "chrome/browser/ui/autofill/update_address_bubble_controller.h"
#include "chrome/browser/ui/browser_window/public/browser_window_features.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/find_bar/find_bar_controller.h"
#include "ui/gfx/range/range.h"
#include "chrome/browser/ui/views/bubble_anchor_util_views.h"
#include "chrome/browser/ui/views/frame/contents_container_view.h"
#include "content/public/browser/eye_dropper.h"
#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#import "arcadia/core/arcadiacore_internal.h"
#include "content/public/browser/web_contents.h"
#include "arcadia/core/ac_autofill_prompt.h"
#include "arcadia/core/ac_browser.h"
#include "arcadia/core/ac_lifetime.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/color/color_provider_manager.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/mac/coordinate_conversion.h"
#include "ui/native_theme/native_theme.h"
#include "ui/views/widget/widget.h"

namespace arcadiacore {

// --- ACLocationBar ----------------------------------------------------------------------

ACLocationBar::ACLocationBar() : LocationBar(/*command_updater=*/nullptr) {}
ACLocationBar::~ACLocationBar() = default;
OmniboxView* ACLocationBar::GetOmniboxView() {
  return nullptr;
}
OmniboxPopupView* ACLocationBar::GetOmniboxPopupView() {
  return nullptr;
}
OmniboxController* ACLocationBar::GetOmniboxController() {
  return nullptr;
}
bool ACLocationBar::ShouldCloseOmniboxPopup(ui::MouseEvent* event) {
  return false;
}
content::WebContents* ACLocationBar::GetWebContents() {
  return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                  : nullptr;
}
LocationBarModel* ACLocationBar::GetLocationBarModel() {
  return nullptr;
}
std::optional<bubble_anchor_util::AnchorConfiguration>
ACLocationBar::GetChipAnchor() {
  return std::nullopt;
}
ChipController* ACLocationBar::GetChipController() {
  return nullptr;
}
ui::TrackedElement* ACLocationBar::GetAnchorOrNull() {
  return nullptr;
}
BrowserWindowInterface* ACLocationBar::GetBrowser() {
  return browser_;
}
Profile* ACLocationBar::GetProfile() {
  return browser_ ? browser_->GetProfile() : nullptr;
}
bool ACLocationBar::IsInitialized() const {
  return true;
}
bool ACLocationBar::IsVisible() const {
  return false;
}
bool ACLocationBar::IsDrawn() const {
  return false;
}
bool ACLocationBar::IsFullscreen() const {
  return false;
}
bool ACLocationBar::IsEditingOrEmpty() const {
  return false;
}
bool ACLocationBar::IsMouseHovered() const {
  return false;
}
bool ACLocationBar::IsFocusWithin() const {
  return false;
}
gfx::Rect ACLocationBar::Bounds() const {
  return gfx::Rect();
}
gfx::Rect ACLocationBar::BoundsInScreen() const {
  return gfx::Rect();
}
gfx::Size ACLocationBar::MinimumSize() const {
  return gfx::Size();
}
gfx::Size ACLocationBar::PreferredSize() const {
  return gfx::Size();
}
bool ACLocationBar::HasSecurityStateChanged() {
  return false;
}
LocationBarTesting* ACLocationBar::GetLocationBarForTesting() {
  return nullptr;
}

// --- ACAutofillBubbleHandler ------------------------------------------------------------

ACAutofillBubbleHandler::ACAutofillBubbleHandler() = default;
ACAutofillBubbleHandler::~ACAutofillBubbleHandler() = default;

#define AC_NO_BUBBLE(...) \
  {                       \
    return nullptr;       \
  }
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::ShowSaveCreditCardBubble(
    content::WebContents* web_contents,
    autofill::SaveCardBubbleController* controller,
    bool) {
  return ShowSaveCardPrompt(web_contents, controller);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::ShowIbanBubble(
    content::WebContents* web_contents,
    autofill::IbanBubbleController*,
    bool,
    autofill::IbanBubbleType) {
  return SkipIbanBubble(web_contents);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowOfferNotificationBubble(content::WebContents* web_contents,
                                autofill::OfferNotificationBubbleController*,
                                bool) {
  return SkipOfferNotification(web_contents);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveAutofillAiDataBubble(content::WebContents*,
                                 autofill::AutofillAiImportDataController*)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowAutofillAiLocalSaveNotification(
        content::WebContents*,
        autofill::AutofillAiImportDataController*) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveAddressProfileBubble(
        content::WebContents* web_contents,
        std::unique_ptr<autofill::SaveAddressBubbleController> controller,
        bool) {
  return ShowSaveAddressPrompt(web_contents, std::move(controller));
}
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::ShowAddressSignInPromo(
    content::WebContents* web_contents,
    const autofill::AutofillProfile&) {
  return SkipAddressSignInPromo(web_contents);
}
#endif
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowUpdateAddressProfileBubble(
        content::WebContents* web_contents,
        std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
        bool) {
  return ShowUpdateAddressPrompt(web_contents, std::move(controller));
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowFilledCardInformationBubble(
        content::WebContents*,
        autofill::FilledCardInformationBubbleController*,
        bool) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowVirtualCardEnrollBubble(content::WebContents*,
                                autofill::VirtualCardEnrollBubbleController*,
                                bool) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowVirtualCardEnrollConfirmationBubble(
        content::WebContents*,
        autofill::VirtualCardEnrollBubbleController*) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowMandatoryReauthBubble(content::WebContents*,
                              autofill::MandatoryReauthBubbleController*,
                              bool,
                              autofill::MandatoryReauthBubbleType)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveCardConfirmationBubble(
        content::WebContents* web_contents,
        autofill::SaveCardBubbleController* controller) {
  // Google Pay's "card saved" (an upload's): nothing to show, closed unanswered.
  return ShowSaveCardPrompt(web_contents, controller);
}
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowSaveIbanConfirmationBubble(content::WebContents*,
                                   autofill::IbanBubbleController*)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowOmniboxAutofillBubble(content::WebContents*,
                              autofill::OmniboxAutofillBubbleController*)
        AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowPaymentsChurnedUsersBubble(
        content::WebContents*,
        autofill::PaymentsChurnedUsersBubbleController*,
        bool) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowPaymentsChurnedUsersConfirmationBubble(
        content::WebContents*,
        autofill::PaymentsChurnedUsersBubbleController*) AC_NO_BUBBLE()
autofill::AutofillBubbleBase* ACAutofillBubbleHandler::
    ShowWalletReminderNoticeBubble(
        content::WebContents*,
        autofill::WalletReminderNoticeBubbleController*,
        bool) AC_NO_BUBBLE()
#undef AC_NO_BUBBLE

// --- ACBrowserWindow --------------------------------------------------------------------

namespace {

// Every live ACBrowserWindow.
std::set<const BrowserWindow*>& LiveWindows() {
  static base::NoDestructor<std::set<const BrowserWindow*>> windows;
  return *windows;
}
// ArcadiaCore's Browsers and their hosts (ac_browser_window.h, Register).
std::map<const BrowserWindowInterface*, base::WeakPtr<WindowHost>>& Records() {
  static base::NoDestructor<
      std::map<const BrowserWindowInterface*, base::WeakPtr<WindowHost>>>
      records;
  return *records;
}

}  // namespace

// static
ACBrowserWindow* ACBrowserWindow::FromWindow(const BrowserWindow* window) {
  if (!window || !LiveWindows().contains(window)) {
    return nullptr;
  }
  return static_cast<ACBrowserWindow*>(const_cast<BrowserWindow*>(window));
}

void ACBrowserWindow::Register(const BrowserWindowInterface* browser) {
  Records()[browser] = host_;
}

// static
bool ACBrowserWindow::IsOurs(const BrowserWindowInterface* browser) {
  return browser && Records().contains(browser);
}

// static
WindowHost* ACBrowserWindow::HostOf(const BrowserWindowInterface* browser) {
  auto it = browser ? Records().find(browser) : Records().end();
  return it == Records().end() ? nullptr : it->second.get();
}

// static
void ACBrowserWindow::Forget(const BrowserWindowInterface* browser) {
  Records().erase(browser);
}

ACBrowserWindow::ACBrowserWindow(base::WeakPtr<WindowHost> host)
    : host_(std::move(host)), location_bar_(std::make_unique<ACLocationBar>()) {
  LiveWindows().insert(this);
}

ACBrowserWindow::~ACBrowserWindow() {
  LiveWindows().erase(this);
  // BrowserWindow implementations tear these down before the window goes (as
  // BrowserView does): they hold references into it.
  devtools_ui_controller_.reset();
  autofill_bubble_handler_registration_.reset();
  if (browser_) {
    browser_->GetFeatures().TearDownPreBrowserWindowDestruction();
  }
  if (host_) {
    host_->BrowserWindowDestroyed(this);
  }
}

void ACBrowserWindow::AttachBrowser(Browser* browser) {
  browser_ = browser;
  Register(browser);
  autofill_bubble_handler_registration_.emplace(
      browser->GetUnownedUserDataHost(), autofill_bubble_handler_);
  location_bar_->set_browser(browser);
  devtools_ui_controller_ = std::make_unique<DevtoolsUIController>(
      browser,
      std::vector<raw_ptr<ContentsContainerView, DanglingUntriaged>>());
}

void ACBrowserWindow::DeleteBrowserWindow() {
  delete this;
}

bool ACBrowserWindow::IsActive() const {
  if (!host_ || !host_->widget()) {
    return false;
  }
  return host_->widget()->IsActive() && host_->IsActiveBrowser(browser_);
}

bool ACBrowserWindow::IsMaximized() const {
  return host_ && host_->widget() && host_->widget()->IsMaximized();
}

bool ACBrowserWindow::IsMinimized() const {
  return host_ && host_->widget() && host_->widget()->IsMinimized();
}

bool ACBrowserWindow::IsFullscreen() const {
  if (tab_fullscreen_ ||
      (host_ && (host_->acted_fullscreen() ||
                 (host_->widget() && host_->widget()->IsFullscreen())))) {
    return true;
  }
  // A page fullscreen in a window that already was (no EnterFullscreen came) stays "in
  // fullscreen" after the user leaves the window's: Chrome would ignore its exit otherwise.
  ExclusiveAccessManager* manager =
      browser_ ? browser_->GetFeatures().exclusive_access_manager() : nullptr;
  return manager && manager->fullscreen_controller()->IsTabFullscreen();
}

gfx::NativeWindow ACBrowserWindow::GetNativeWindow() const {
  return host_ && host_->widget() ? host_->widget()->GetNativeWindow()
                                  : gfx::NativeWindow();
}

gfx::Rect ACBrowserWindow::GetRestoredBounds() const {
  return host_ && host_->widget() ? host_->widget()->GetRestoredBounds()
                                  : gfx::Rect();
}

ui::mojom::WindowShowState ACBrowserWindow::GetRestoredState() const {
  return ui::mojom::WindowShowState::kNormal;
}

gfx::Rect ACBrowserWindow::GetBounds() const {
  return host_ && host_->widget() ? host_->widget()->GetWindowBoundsInScreen()
                                  : gfx::Rect();
}

void ACBrowserWindow::Show() {
  // Chrome shows a Browser's window when it wants it seen (a tab it opened, the install
  // bubble's window). The host decides what is shown: its windows are on screen when it
  // showed them, and its hidden ones (a Browser Chrome made, its own pages) never are.
}

bool ACBrowserWindow::IsVisible() const {
  return host_ && host_->widget() && host_->widget()->IsVisible() &&
         host_->IsActiveBrowser(browser_);
}

void ACBrowserWindow::ShowInactive() {
  // As Show(): only the host shows its windows (-[ArcadiaCoreWindow showInactive]).
}

void ACBrowserWindow::Close() {
  // As BrowserView::CanClose/Close: beforeunload first, then close every tab; Chrome calls
  // back here once the strip is empty and destroys the Browser after that.
  if (!browser_) {
    return;
  }
  UnloadController* unload = UnloadController::From(browser_);
  if (unload) {
    // Its window's close records its tabs in Chrome's closed-tab list: a New Tab page's tab
    // made ahead on about:blank goes first, unrecorded. Only for the host's close (decided:
    // after beforeunload and the downloads question) or the quit's. One Chrome starts on its
    // own (an extension's windows.remove) may still be refused here, and keeps it; one that
    // races a quit's pending beforeunload and is refused loses only the prewarm (the New Tab
    // page makes its tab at Enter instead).
    if ((host_ && host_->closing()) || browser_shutdown::IsTryingToQuit()) {
      CloseBlankTabsBeforeWindowCloses(browser_);
    }
    unload->OnWindowClosing();
  }
}

void ACBrowserWindow::Activate() {
  // Through the host's focus (chrome.windows.update focused, undocked DevTools closing): the
  // window comes forward and its activation tells Chrome, never the bookkeeping alone. Not from
  // inside Chrome's call: the host may switch tabs or profiles in response.
  if (host_ && browser_) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<WindowHost> host,
                          base::WeakPtr<BrowserWindowInterface> browser) {
                         if (host && browser) {
                           host->RequestActivation(static_cast<Browser*>(browser.get()));
                         }
                       },
                       host_, browser_->GetWeakPtr()));
  }
}

void ACBrowserWindow::SetBounds(const gfx::Rect& bounds) {
  if (host_ && host_->widget()) {
    host_->widget()->SetBounds(bounds);
  }
}

ui::ZOrderLevel ACBrowserWindow::GetZOrderLevel() const {
  return ui::ZOrderLevel::kNormal;
}

bool ACBrowserWindow::IsOnCurrentWorkspace() const {
  // The host's own hidden pages never are: Chrome looking for a window to show something in
  // (ProfileBrowserCollection::FindTabbedBrowser: the install bubble, an options page) skips
  // them.
  return host_ && !host_->internal();
}

bool ACBrowserWindow::IsVisibleOnScreen() const {
  return IsVisible();
}

bool ACBrowserWindow::DoBrowserControlsShrinkRendererSize(
    const content::WebContents* contents) const {
  return false;
}

ui::NativeTheme* ACBrowserWindow::GetNativeTheme() {
  return ui::NativeTheme::GetInstanceForNativeUi();
}

const ui::ThemeProvider* ACBrowserWindow::GetThemeProvider() const {
  return browser_ ? &ThemeService::GetThemeProviderForProfile(
                        browser_->GetProfile())
                  : nullptr;
}

const ui::ColorProvider* ACBrowserWindow::GetColorProvider() const {
  if (host_ && host_->widget()) {
    return host_->widget()->GetColorProvider();
  }
  return ui::ColorProviderManager::Get().GetColorProviderFor(
      ui::ColorProviderKey());
}

int ACBrowserWindow::GetTopControlsHeight() const {
  return 0;
}

std::vector<StatusBubble*> ACBrowserWindow::GetStatusBubbles() {
  return {};
}

void ACBrowserWindow::OnActiveTabChanged(content::WebContents* old_contents,
                                         content::WebContents* new_contents,
                                         int index,
                                         int reason) {
  if (host_ && browser_) {
    host_->ActiveTabChanged(browser_, new_contents);
  }
}

gfx::Size ACBrowserWindow::GetContentsSize() const {
  if (!host_ || !host_->host_view()) {
    return gfx::Size();
  }
  NSSize size = host_->host_view().bounds.size;
  return gfx::Size(size.width, size.height);
}

autofill::AutofillBubbleHandler* ACBrowserWindow::GetAutofillBubbleHandler() {
  return &autofill_bubble_handler_;
}

LocationBar* ACBrowserWindow::GetLocationBar() const {
  return location_bar_.get();
}

bool ACBrowserWindow::UpdateToolbarSecurityState() {
  return false;
}

bool ACBrowserWindow::IsTabStripEditable() const {
  return true;
}

bool ACBrowserWindow::IsToolbarVisible() const {
  return false;
}

bool ACBrowserWindow::IsToolbarShowing() const {
  return false;
}

bool ACBrowserWindow::IsLocationBarVisible() const {
  return false;
}

ShowTranslateBubbleResult ACBrowserWindow::ShowTranslateBubble(
    content::WebContents* contents,
    translate::TranslateStep step,
    const std::string& source_language,
    const std::string& target_language,
    translate::TranslateErrors error_type,
    bool is_user_gesture) {
  return ShowTranslateBubbleResult::kBrowserWindowNotValid;
}

DownloadBubbleUIController* ACBrowserWindow::GetDownloadBubbleUIController() {
  return nullptr;
}

void ACBrowserWindow::ConfirmBrowserCloseWithPendingDownloads(
    int download_count,
    UnloadController::DownloadCloseType dialog_type,
    base::OnceCallback<void(bool)> callback) {
  // Chrome asks here when closing this Browser would cancel an off-the-record profile's
  // downloads. A close or quit the host started has asked already; anything else (an
  // extension's chrome.windows.remove…) asks the host now. Never synchronously: Chrome sets
  // up its state after asking.
  if (host_ && !host_->closing() && !IsQuitting()) {
    host_->ConfirmCloseWithDownloads(download_count, std::move(callback));
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(callback), true));
}

namespace {

// A key down the host's main menu has an item for (its key equivalent and modifiers).
bool MenuHasKeyEquivalent(NSMenu* menu, NSEvent* event) {
  const NSEventModifierFlags mask =
      NSEventModifierFlagCommand | NSEventModifierFlagOption |
      NSEventModifierFlagControl | NSEventModifierFlagShift;
  const NSEventModifierFlags flags = event.modifierFlags & mask;
  NSString* chars = event.charactersIgnoringModifiers.lowercaseString;
  for (NSMenuItem* item in menu.itemArray) {
    if (item.hasSubmenu) {
      if (MenuHasKeyEquivalent(item.submenu, event)) {
        return true;
      }
      continue;
    }
    NSString* key = item.keyEquivalent;
    if (!key.length) {
      continue;
    }
    NSEventModifierFlags item_flags = item.keyEquivalentModifierMask & mask;
    // An upper-case key equivalent implies Shift.
    if (![key isEqualToString:key.lowercaseString]) {
      item_flags |= NSEventModifierFlagShift;
    }
    if (item_flags == flags && [key.lowercaseString isEqualToString:chars]) {
      return true;
    }
  }
  return false;
}

// As Chrome's BrowserNativeWidgetMac: what the renderer ignored is the browser's to handle,
// except IME-consumed keys and the synthesized Char that follows a key down.
NSEvent* UnhandledKeyDown(const input::NativeWebKeyboardEvent& event) {
  if (event.skip_if_unhandled ||
      event.GetType() == input::NativeWebKeyboardEvent::Type::kChar) {
    return nil;
  }
  NSEvent* ns_event = event.os_event.Get();
  return ns_event.type == NSEventTypeKeyDown ? ns_event : nil;
}

}  // namespace

// Keys with the page focused. AppKit hands a key equivalent to the window, whose
// RenderWidgetHostViewCocoa takes it when it is first responder (it never reaches the main
// menu from there): Chrome asks here first, synchronously, then the page gets it, and what
// the page leaves (no preventDefault) comes back to HandleKeyboardEvent.
content::KeyboardEventProcessingResult ACBrowserWindow::PreHandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  NSEvent* ns_event = event.os_event.Get();
  if (!ns_event || ns_event.type != NSEventTypeKeyDown || !host_) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }
  ArcadiaCoreWindow* owner = host_->owner();
  id<ArcadiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:preHandleKeyEvent:)] &&
      [delegate window:owner preHandleKeyEvent:ns_event]) {
    return content::KeyboardEventProcessingResult::HANDLED;
  }
  // A shortcut of the host's menu: the page still sees it first (Chrome's rule for
  // shortcuts it doesn't reserve), as a browser shortcut (no keypress/char follows).
  if ((ns_event.modifierFlags & NSEventModifierFlagCommand) &&
      MenuHasKeyEquivalent(NSApp.mainMenu, ns_event)) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED_IS_SHORTCUT;
  }
  return content::KeyboardEventProcessingResult::NOT_HANDLED;
}

bool ACBrowserWindow::HandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  NSEvent* ns_event = UnhandledKeyDown(event);
  if (!ns_event || !host_) {
    return false;
  }
  ArcadiaCoreWindow* owner = host_->owner();
  id<ArcadiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:handleKeyEvent:)] &&
      [delegate window:owner handleKeyEvent:ns_event]) {
    return true;
  }
  // Where AppKit would have taken it had the page not been first responder: Chrome's
  // CommandDispatcher redispatch does the same (window key equivalents without the first
  // responder, then the main menu); our window has no Chrome dispatcher delegate or parent.
  // Chrome's own accelerators (IDC_NEW_TAB…) don't run: the host's menu owns the keys.
  // Only what AppKit takes as a key equivalent (⌘, ⌃ or fn): asked directly, the View menu's
  // Enter Full Screen (fn-F) answers a plain "f" too, so a page's unhandled "f" toggled the
  // window's full screen.
  if (!(ns_event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl |
                                  NSEventModifierFlagFunction))) {
    return false;
  }
  return [NSApp.mainMenu performKeyEquivalent:ns_event];
}

std::unique_ptr<FindBar> ACBrowserWindow::CreateFindBar() {
  return std::make_unique<ACFindBar>();
}

// --- ACFindBar --------------------------------------------------------------------------

ACFindBar::ACFindBar() = default;
ACFindBar::~ACFindBar() = default;
FindBarController* ACFindBar::GetFindBarController() const {
  return controller_;
}
void ACFindBar::SetFindBarController(FindBarController* controller) {
  controller_ = controller;
}
void ACFindBar::Show(bool animate, bool focus) {
  visible_ = true;
}
void ACFindBar::Hide(bool animate) {
  visible_ = false;
}
void ACFindBar::SetFindTextAndSelectedRange(const std::u16string& find_text,
                                            const gfx::Range& selected_range) {
  find_text_ = find_text;
}
std::u16string_view ACFindBar::GetFindText() const {
  return find_text_;
}
gfx::Range ACFindBar::GetSelectedRange() const {
  return gfx::Range();
}
bool ACFindBar::IsFindBarVisible() const {
  return visible_;
}
bool ACFindBar::HasGlobalFindPasteboard() const {
  return true;  // macOS's find pasteboard, as Chrome's find bar on the Mac.
}
bool ACFindBar::CanPopulateFromSelectedText() {
  return true;
}
const FindBarTesting* ACFindBar::GetFindBarTesting() const {
  return nullptr;
}
bool ACFindBar::HasFocus() const {
  return false;
}
views::Widget* ACFindBar::GetHostWidget() {
  return nullptr;
}

web_modal::WebContentsModalDialogHost*
ACBrowserWindow::GetWebContentsModalDialogHost() {
  return host_.get();
}

web_modal::WebContentsModalDialogHost*
ACBrowserWindow::GetWebContentsModalDialogHostFor(
    content::WebContents* web_contents) {
  return host_.get();
}

ExclusiveAccessContext* ACBrowserWindow::GetExclusiveAccessContext() {
  // Chrome calls it on every mouse event (ExclusiveAccessManager::OnUserInput).
  return this;
}

Profile* ACBrowserWindow::GetProfile() {
  return browser_ ? browser_->GetProfile() : nullptr;
}

void ACBrowserWindow::EnterFullscreen(const url::Origin& origin,
                                      ExclusiveAccessBubbleType bubble_type,
                                      FullscreenTabParams fullscreen_tab_params) {
  tab_fullscreen_ = true;
  ReportFullscreenTab();
}

void ACBrowserWindow::ExitFullscreen() {
  tab_fullscreen_ = false;
  ReportFullscreenTab();
}

// Chrome updates the bubble on every change of who holds fullscreen, including the ones that
// don't go through Enter/ExitFullscreen (a page entering it in a window that already was).
void ACBrowserWindow::UpdateExclusiveAccessBubble(
    const ExclusiveAccessBubbleParams& params,
    ExclusiveAccessBubbleHideCallback first_hide_callback) {
  ReportFullscreenTab();
}

void ACBrowserWindow::ReportFullscreenTab() {
  ExclusiveAccessManager* manager =
      browser_ ? browser_->GetFeatures().exclusive_access_manager() : nullptr;
  FullscreenController* controller =
      manager ? manager->fullscreen_controller() : nullptr;
  content::WebContents* now = controller && controller->IsTabFullscreen()
                                  ? controller->exclusive_access_tab()
                                  : nullptr;
  content::WebContents* was = fullscreen_tab_.get();
  if (now == was) {
    return;
  }
  fullscreen_tab_ = now ? now->GetWeakPtr() : nullptr;
  if (!host_ || !browser_) {
    return;
  }
  base::WeakPtr<content::WebContents> entering = fullscreen_tab_;
  if (was) {
    host_->FullscreenChanged(was, false);
  }
  // Unless the host's answer changed it meanwhile (closed the tab, say).
  if (content::WebContents* contents = entering.get();
      contents && contents == fullscreen_tab_.get() && host_) {
    host_->FullscreenChanged(contents, true);
  }
}

bool ACBrowserWindow::IsExclusiveAccessBubbleDisplayed() const {
  return false;
}

content::WebContents* ACBrowserWindow::GetWebContentsForExclusiveAccess() {
  return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                  : nullptr;
}

bool ACBrowserWindow::CanUserEnterFullscreen() const {
  return true;
}

bool ACBrowserWindow::CanUserExitFullscreen() const {
  return true;
}

std::string ACBrowserWindow::GetWorkspace() const {
  return std::string();
}

bool ACBrowserWindow::IsVisibleOnAllWorkspaces() const {
  return false;
}

void ACBrowserWindow::ShowEmojiPanel() {
  [NSApp orderFrontCharacterPalette:nil];
}

std::unique_ptr<content::EyeDropper> ACBrowserWindow::OpenEyeDropper(
    content::RenderFrameHost* frame,
    content::EyeDropperListener* listener) {
  return nullptr;
}

bool ACBrowserWindow::IsUnframedModeEnabled() const {
  return false;
}

bool ACBrowserWindow::GetCanResize() {
  return true;
}

ui::mojom::WindowShowState ACBrowserWindow::GetWindowShowState() const {
  if (IsMinimized()) {
    return ui::mojom::WindowShowState::kMinimized;
  }
  if (IsFullscreen()) {
    return ui::mojom::WindowShowState::kFullscreen;
  }
  return ui::mojom::WindowShowState::kNormal;
}

BrowserView* ACBrowserWindow::AsBrowserView() {
  return nullptr;
}

}  // namespace arcadiacore
