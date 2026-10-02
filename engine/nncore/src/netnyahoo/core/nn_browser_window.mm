#include "netnyahoo/core/nn_browser_window.h"

#import <AppKit/AppKit.h>

#include "base/functional/bind.h"
#include "base/task/single_thread_task_runner.h"

#include "chrome/browser/devtools/devtools_ui_controller.h"
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
#import "netnyahoo/core/nncore_internal.h"
#include "content/public/browser/web_contents.h"
#include "netnyahoo/core/nn_browser.h"
#include "netnyahoo/core/nn_lifetime.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/color/color_provider_manager.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/mac/coordinate_conversion.h"
#include "ui/native_theme/native_theme.h"
#include "ui/views/widget/widget.h"

namespace nncore {

// --- NNLocationBar ----------------------------------------------------------------------

NNLocationBar::NNLocationBar() : LocationBar(/*command_updater=*/nullptr) {}
NNLocationBar::~NNLocationBar() = default;
OmniboxView* NNLocationBar::GetOmniboxView() {
  return nullptr;
}
OmniboxPopupView* NNLocationBar::GetOmniboxPopupView() {
  return nullptr;
}
OmniboxController* NNLocationBar::GetOmniboxController() {
  return nullptr;
}
bool NNLocationBar::ShouldCloseOmniboxPopup(ui::MouseEvent* event) {
  return false;
}
content::WebContents* NNLocationBar::GetWebContents() {
  return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                  : nullptr;
}
LocationBarModel* NNLocationBar::GetLocationBarModel() {
  return nullptr;
}
std::optional<bubble_anchor_util::AnchorConfiguration>
NNLocationBar::GetChipAnchor() {
  return std::nullopt;
}
ChipController* NNLocationBar::GetChipController() {
  return nullptr;
}
ui::TrackedElement* NNLocationBar::GetAnchorOrNull() {
  return nullptr;
}
BrowserWindowInterface* NNLocationBar::GetBrowser() {
  return browser_;
}
Profile* NNLocationBar::GetProfile() {
  return browser_ ? browser_->GetProfile() : nullptr;
}
bool NNLocationBar::IsInitialized() const {
  return true;
}
bool NNLocationBar::IsVisible() const {
  return false;
}
bool NNLocationBar::IsDrawn() const {
  return false;
}
bool NNLocationBar::IsFullscreen() const {
  return false;
}
bool NNLocationBar::IsEditingOrEmpty() const {
  return false;
}
bool NNLocationBar::IsMouseHovered() const {
  return false;
}
bool NNLocationBar::IsFocusWithin() const {
  return false;
}
gfx::Rect NNLocationBar::Bounds() const {
  return gfx::Rect();
}
gfx::Rect NNLocationBar::BoundsInScreen() const {
  return gfx::Rect();
}
gfx::Size NNLocationBar::MinimumSize() const {
  return gfx::Size();
}
gfx::Size NNLocationBar::PreferredSize() const {
  return gfx::Size();
}
bool NNLocationBar::HasSecurityStateChanged() {
  return false;
}
LocationBarTesting* NNLocationBar::GetLocationBarForTesting() {
  return nullptr;
}

// --- NNAutofillBubbleHandler ------------------------------------------------------------

NNAutofillBubbleHandler::NNAutofillBubbleHandler() = default;
NNAutofillBubbleHandler::~NNAutofillBubbleHandler() = default;

#define NN_NO_BUBBLE(...) \
  {                       \
    return nullptr;       \
  }
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::ShowSaveCreditCardBubble(
    content::WebContents*,
    autofill::SaveCardBubbleController*,
    bool) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::ShowIbanBubble(
    content::WebContents*,
    autofill::IbanBubbleController*,
    bool,
    autofill::IbanBubbleType) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowOfferNotificationBubble(content::WebContents*,
                                autofill::OfferNotificationBubbleController*,
                                bool) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowSaveAutofillAiDataBubble(content::WebContents*,
                                 autofill::AutofillAiImportDataController*)
        NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowAutofillAiLocalSaveNotification(
        content::WebContents*,
        autofill::AutofillAiImportDataController*) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowSaveAddressProfileBubble(
        content::WebContents*,
        std::unique_ptr<autofill::SaveAddressBubbleController>,
        bool) NN_NO_BUBBLE()
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::ShowAddressSignInPromo(
    content::WebContents*,
    const autofill::AutofillProfile&) NN_NO_BUBBLE()
#endif
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowUpdateAddressProfileBubble(
        content::WebContents*,
        std::unique_ptr<autofill::UpdateAddressBubbleController>,
        bool) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowFilledCardInformationBubble(
        content::WebContents*,
        autofill::FilledCardInformationBubbleController*,
        bool) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowVirtualCardEnrollBubble(content::WebContents*,
                                autofill::VirtualCardEnrollBubbleController*,
                                bool) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowVirtualCardEnrollConfirmationBubble(
        content::WebContents*,
        autofill::VirtualCardEnrollBubbleController*) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowMandatoryReauthBubble(content::WebContents*,
                              autofill::MandatoryReauthBubbleController*,
                              bool,
                              autofill::MandatoryReauthBubbleType)
        NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowSaveCardConfirmationBubble(content::WebContents*,
                                   autofill::SaveCardBubbleController*)
        NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowSaveIbanConfirmationBubble(content::WebContents*,
                                   autofill::IbanBubbleController*)
        NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowOmniboxAutofillBubble(content::WebContents*,
                              autofill::OmniboxAutofillBubbleController*)
        NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowPaymentsChurnedUsersBubble(
        content::WebContents*,
        autofill::PaymentsChurnedUsersBubbleController*,
        bool) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowPaymentsChurnedUsersConfirmationBubble(
        content::WebContents*,
        autofill::PaymentsChurnedUsersBubbleController*) NN_NO_BUBBLE()
autofill::AutofillBubbleBase* NNAutofillBubbleHandler::
    ShowWalletReminderNoticeBubble(
        content::WebContents*,
        autofill::WalletReminderNoticeBubbleController*,
        bool) NN_NO_BUBBLE()
#undef NN_NO_BUBBLE

// --- NNBrowserWindow --------------------------------------------------------------------

NNBrowserWindow::NNBrowserWindow(base::WeakPtr<WindowHost> host)
    : host_(std::move(host)), location_bar_(std::make_unique<NNLocationBar>()) {}

NNBrowserWindow::~NNBrowserWindow() {
  // BrowserWindow implementations tear these down before the window goes (as
  // BrowserView does): they hold references into it.
  devtools_ui_controller_.reset();
  if (browser_) {
    browser_->GetFeatures().TearDownPreBrowserWindowDestruction();
  }
  if (host_) {
    host_->BrowserWindowDestroyed(this);
  }
}

void NNBrowserWindow::AttachBrowser(Browser* browser) {
  browser_ = browser;
  location_bar_->set_browser(browser);
  devtools_ui_controller_ = std::make_unique<DevtoolsUIController>(
      browser,
      std::vector<raw_ptr<ContentsContainerView, DanglingUntriaged>>());
}

void NNBrowserWindow::DeleteBrowserWindow() {
  delete this;
}

bool NNBrowserWindow::IsActive() const {
  if (!host_ || !host_->widget()) {
    return false;
  }
  return host_->widget()->IsActive() && host_->IsActiveBrowser(browser_);
}

bool NNBrowserWindow::IsMaximized() const {
  return host_ && host_->widget() && host_->widget()->IsMaximized();
}

bool NNBrowserWindow::IsMinimized() const {
  return host_ && host_->widget() && host_->widget()->IsMinimized();
}

bool NNBrowserWindow::IsFullscreen() const {
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

gfx::NativeWindow NNBrowserWindow::GetNativeWindow() const {
  return host_ && host_->widget() ? host_->widget()->GetNativeWindow()
                                  : gfx::NativeWindow();
}

gfx::Rect NNBrowserWindow::GetRestoredBounds() const {
  return host_ && host_->widget() ? host_->widget()->GetRestoredBounds()
                                  : gfx::Rect();
}

ui::mojom::WindowShowState NNBrowserWindow::GetRestoredState() const {
  return ui::mojom::WindowShowState::kNormal;
}

gfx::Rect NNBrowserWindow::GetBounds() const {
  return host_ && host_->widget() ? host_->widget()->GetWindowBoundsInScreen()
                                  : gfx::Rect();
}

void NNBrowserWindow::Show() {
  // Chrome shows a Browser's window when it wants it seen (a tab it opened, the install
  // bubble's window). The host decides what is shown: its windows are on screen when it
  // showed them, and its hidden ones (a Browser Chrome made, its own pages) never are.
}

bool NNBrowserWindow::IsVisible() const {
  return host_ && host_->widget() && host_->widget()->IsVisible() &&
         host_->IsActiveBrowser(browser_);
}

void NNBrowserWindow::ShowInactive() {
  // As Show(): only the host shows its windows (-[NNCoreWindow showInactive]).
}

void NNBrowserWindow::Close() {
  // As BrowserView::CanClose/Close: beforeunload first, then close every tab; Chrome calls
  // back here once the strip is empty and destroys the Browser after that.
  if (!browser_) {
    return;
  }
  UnloadController* unload = UnloadController::From(browser_);
  if (unload) {
    unload->OnWindowClosing();
  }
}

void NNBrowserWindow::Activate() {
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

void NNBrowserWindow::SetBounds(const gfx::Rect& bounds) {
  if (host_ && host_->widget()) {
    host_->widget()->SetBounds(bounds);
  }
}

ui::ZOrderLevel NNBrowserWindow::GetZOrderLevel() const {
  return ui::ZOrderLevel::kNormal;
}

bool NNBrowserWindow::IsOnCurrentWorkspace() const {
  // The host's own hidden pages never are: Chrome looking for a window to show something in
  // (ProfileBrowserCollection::FindTabbedBrowser: the install bubble, an options page) skips
  // them.
  return host_ && !host_->internal();
}

bool NNBrowserWindow::IsVisibleOnScreen() const {
  return IsVisible();
}

bool NNBrowserWindow::DoBrowserControlsShrinkRendererSize(
    const content::WebContents* contents) const {
  return false;
}

ui::NativeTheme* NNBrowserWindow::GetNativeTheme() {
  return ui::NativeTheme::GetInstanceForNativeUi();
}

const ui::ThemeProvider* NNBrowserWindow::GetThemeProvider() const {
  return browser_ ? &ThemeService::GetThemeProviderForProfile(
                        browser_->GetProfile())
                  : nullptr;
}

const ui::ColorProvider* NNBrowserWindow::GetColorProvider() const {
  if (host_ && host_->widget()) {
    return host_->widget()->GetColorProvider();
  }
  return ui::ColorProviderManager::Get().GetColorProviderFor(
      ui::ColorProviderKey());
}

int NNBrowserWindow::GetTopControlsHeight() const {
  return 0;
}

std::vector<StatusBubble*> NNBrowserWindow::GetStatusBubbles() {
  return {};
}

void NNBrowserWindow::OnActiveTabChanged(content::WebContents* old_contents,
                                         content::WebContents* new_contents,
                                         int index,
                                         int reason) {
  if (host_ && browser_) {
    host_->ActiveTabChanged(browser_, new_contents);
  }
}

gfx::Size NNBrowserWindow::GetContentsSize() const {
  if (!host_ || !host_->host_view()) {
    return gfx::Size();
  }
  NSSize size = host_->host_view().bounds.size;
  return gfx::Size(size.width, size.height);
}

autofill::AutofillBubbleHandler* NNBrowserWindow::GetAutofillBubbleHandler() {
  return &autofill_bubble_handler_;
}

LocationBar* NNBrowserWindow::GetLocationBar() const {
  return location_bar_.get();
}

bool NNBrowserWindow::UpdateToolbarSecurityState() {
  return false;
}

bool NNBrowserWindow::IsTabStripEditable() const {
  return true;
}

bool NNBrowserWindow::IsToolbarVisible() const {
  return false;
}

bool NNBrowserWindow::IsToolbarShowing() const {
  return false;
}

bool NNBrowserWindow::IsLocationBarVisible() const {
  return false;
}

ShowTranslateBubbleResult NNBrowserWindow::ShowTranslateBubble(
    content::WebContents* contents,
    translate::TranslateStep step,
    const std::string& source_language,
    const std::string& target_language,
    translate::TranslateErrors error_type,
    bool is_user_gesture) {
  return ShowTranslateBubbleResult::kBrowserWindowNotValid;
}

DownloadBubbleUIController* NNBrowserWindow::GetDownloadBubbleUIController() {
  return nullptr;
}

void NNBrowserWindow::ConfirmBrowserCloseWithPendingDownloads(
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
content::KeyboardEventProcessingResult NNBrowserWindow::PreHandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  NSEvent* ns_event = event.os_event.Get();
  if (!ns_event || ns_event.type != NSEventTypeKeyDown || !host_) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }
  NNCoreWindow* owner = host_->owner();
  id<NNCoreWindowDelegate> delegate = owner.delegate;
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

bool NNBrowserWindow::HandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  NSEvent* ns_event = UnhandledKeyDown(event);
  if (!ns_event || !host_) {
    return false;
  }
  NNCoreWindow* owner = host_->owner();
  id<NNCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:handleKeyEvent:)] &&
      [delegate window:owner handleKeyEvent:ns_event]) {
    return true;
  }
  // Where AppKit would have taken it had the page not been first responder: Chrome's
  // CommandDispatcher redispatch does the same (window key equivalents without the first
  // responder, then the main menu); our window has no Chrome dispatcher delegate or parent.
  // Chrome's own accelerators (IDC_NEW_TAB…) don't run: the host's menu owns the keys.
  return [NSApp.mainMenu performKeyEquivalent:ns_event];
}

std::unique_ptr<FindBar> NNBrowserWindow::CreateFindBar() {
  return std::make_unique<NNFindBar>();
}

// --- NNFindBar --------------------------------------------------------------------------

NNFindBar::NNFindBar() = default;
NNFindBar::~NNFindBar() = default;
FindBarController* NNFindBar::GetFindBarController() const {
  return controller_;
}
void NNFindBar::SetFindBarController(FindBarController* controller) {
  controller_ = controller;
}
void NNFindBar::Show(bool animate, bool focus) {
  visible_ = true;
}
void NNFindBar::Hide(bool animate) {
  visible_ = false;
}
void NNFindBar::SetFindTextAndSelectedRange(const std::u16string& find_text,
                                            const gfx::Range& selected_range) {
  find_text_ = find_text;
}
std::u16string_view NNFindBar::GetFindText() const {
  return find_text_;
}
gfx::Range NNFindBar::GetSelectedRange() const {
  return gfx::Range();
}
bool NNFindBar::IsFindBarVisible() const {
  return visible_;
}
bool NNFindBar::HasGlobalFindPasteboard() const {
  return true;  // macOS's find pasteboard, as Chrome's find bar on the Mac.
}
bool NNFindBar::CanPopulateFromSelectedText() {
  return true;
}
const FindBarTesting* NNFindBar::GetFindBarTesting() const {
  return nullptr;
}
bool NNFindBar::HasFocus() const {
  return false;
}
views::Widget* NNFindBar::GetHostWidget() {
  return nullptr;
}

web_modal::WebContentsModalDialogHost*
NNBrowserWindow::GetWebContentsModalDialogHost() {
  return host_.get();
}

web_modal::WebContentsModalDialogHost*
NNBrowserWindow::GetWebContentsModalDialogHostFor(
    content::WebContents* web_contents) {
  return host_.get();
}

ExclusiveAccessContext* NNBrowserWindow::GetExclusiveAccessContext() {
  // Chrome calls it on every mouse event (ExclusiveAccessManager::OnUserInput).
  return this;
}

Profile* NNBrowserWindow::GetProfile() {
  return browser_ ? browser_->GetProfile() : nullptr;
}

void NNBrowserWindow::EnterFullscreen(const url::Origin& origin,
                                      ExclusiveAccessBubbleType bubble_type,
                                      FullscreenTabParams fullscreen_tab_params) {
  tab_fullscreen_ = true;
  ReportFullscreenTab();
}

void NNBrowserWindow::ExitFullscreen() {
  tab_fullscreen_ = false;
  ReportFullscreenTab();
}

// Chrome updates the bubble on every change of who holds fullscreen, including the ones that
// don't go through Enter/ExitFullscreen (a page entering it in a window that already was).
void NNBrowserWindow::UpdateExclusiveAccessBubble(
    const ExclusiveAccessBubbleParams& params,
    ExclusiveAccessBubbleHideCallback first_hide_callback) {
  ReportFullscreenTab();
}

void NNBrowserWindow::ReportFullscreenTab() {
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

bool NNBrowserWindow::IsExclusiveAccessBubbleDisplayed() const {
  return false;
}

content::WebContents* NNBrowserWindow::GetWebContentsForExclusiveAccess() {
  return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                  : nullptr;
}

bool NNBrowserWindow::CanUserEnterFullscreen() const {
  return true;
}

bool NNBrowserWindow::CanUserExitFullscreen() const {
  return true;
}

std::string NNBrowserWindow::GetWorkspace() const {
  return std::string();
}

bool NNBrowserWindow::IsVisibleOnAllWorkspaces() const {
  return false;
}

void NNBrowserWindow::ShowEmojiPanel() {
  [NSApp orderFrontCharacterPalette:nil];
}

std::unique_ptr<content::EyeDropper> NNBrowserWindow::OpenEyeDropper(
    content::RenderFrameHost* frame,
    content::EyeDropperListener* listener) {
  return nullptr;
}

bool NNBrowserWindow::IsUnframedModeEnabled() const {
  return false;
}

bool NNBrowserWindow::GetCanResize() {
  return true;
}

ui::mojom::WindowShowState NNBrowserWindow::GetWindowShowState() const {
  if (IsMinimized()) {
    return ui::mojom::WindowShowState::kMinimized;
  }
  if (IsFullscreen()) {
    return ui::mojom::WindowShowState::kFullscreen;
  }
  return ui::mojom::WindowShowState::kNormal;
}

BrowserView* NNBrowserWindow::AsBrowserView() {
  return nullptr;
}

}  // namespace nncore
