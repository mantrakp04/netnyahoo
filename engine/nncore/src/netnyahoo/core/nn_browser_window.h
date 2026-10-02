// NNBrowserWindow: Chrome's BrowserWindow for a Browser that lives in an NNCore window.
//
// It is a plain object, not a view: Chrome's BrowserView, frame, tab strip and toolbar
// never exist for our Browsers. Several of these (one per profile) share one NSWindow,
// owned by the WindowHost (nn_browser.h). Most of BrowserWindow is UI we don't show
// (Chrome's toolbar, its bubbles anchored to it); those methods are inert here, and the
// host shows its own UI through the NNCore API instead.

#ifndef NETNYAHOO_CORE_NN_BROWSER_WINDOW_H_
#define NETNYAHOO_CORE_NN_BROWSER_WINDOW_H_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/ui/autofill/autofill_bubble_handler.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_context.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/location_bar/location_bar.h"
#include "chrome/browser/ui/views/bubble_anchor_util_views.h"

class DevtoolsUIController;

namespace nncore {

class WindowHost;

// Chrome asks the window for its location bar in many places (content settings icons,
// security state, omnibox focus). We have none of Chrome's: answer like an empty one.
class NNLocationBar : public LocationBar {
 public:
  NNLocationBar();
  ~NNLocationBar() override;
  void set_browser(BrowserWindowInterface* browser) { browser_ = browser; }

  void FocusLocation(bool is_user_initiated, bool clear_focus_if_failed) override {}
  void FocusSearch() override {}
  void UpdateFocusBehavior(bool toolbar_visible) override {}
  void UpdateContentSettingsIcons() override {}
  void SaveStateToContents(content::WebContents* contents) override {}
  void Revert() override {}
  OmniboxView* GetOmniboxView() override;
  OmniboxPopupView* GetOmniboxPopupView() override;
  OmniboxController* GetOmniboxController() override;
  bool ShouldCloseOmniboxPopup(ui::MouseEvent* event) override;
  content::WebContents* GetWebContents() override;
  LocationBarModel* GetLocationBarModel() override;
  std::optional<bubble_anchor_util::AnchorConfiguration> GetChipAnchor()
      override;
  ChipController* GetChipController() override;
  void AnnounceAlert(const std::u16string& announcement) override {}
  void OnChanged() override {}
  void UpdateWithoutTabRestore() override {}
  ui::TrackedElement* GetAnchorOrNull() override;
  BrowserWindowInterface* GetBrowser() override;
  Profile* GetProfile() override;
  bool IsInitialized() const override;
  bool IsVisible() const override;
  bool IsDrawn() const override;
  bool IsFullscreen() const override;
  bool IsEditingOrEmpty() const override;
  bool IsMouseHovered() const override;
  bool IsFocusWithin() const override;
  void InvalidateLayout() override {}
  gfx::Rect Bounds() const override;
  gfx::Rect BoundsInScreen() const override;
  gfx::Size MinimumSize() const override;
  gfx::Size PreferredSize() const override;
  void Update(content::WebContents* contents) override {}
  void ResetTabState(content::WebContents* contents) override {}
  bool HasSecurityStateChanged() override;
  LocationBarTesting* GetLocationBarForTesting() override;

 private:
  raw_ptr<BrowserWindowInterface> browser_ = nullptr;
};

// Chrome's autofill bubbles anchor to its toolbar, which we don't have. Offers to save or
// update an address or a card go to the host as its own prompts (nn_autofill_prompt.h); the
// rest (Google Pay, virtual cards, IBANs, offers) don't show. Registered on the window's Browser
// too, where the payments controllers look it up (AutofillBubbleHandler::Get).
class NNAutofillBubbleHandler : public autofill::AutofillBubbleHandler {
 public:
  NNAutofillBubbleHandler();
  ~NNAutofillBubbleHandler() override;

  autofill::AutofillBubbleBase* ShowSaveCreditCardBubble(
      content::WebContents* web_contents,
      autofill::SaveCardBubbleController* controller,
      bool is_user_gesture) override;
  autofill::AutofillBubbleBase* ShowIbanBubble(
      content::WebContents* web_contents,
      autofill::IbanBubbleController* controller,
      bool is_user_gesture,
      autofill::IbanBubbleType bubble_type) override;
  autofill::AutofillBubbleBase* ShowOfferNotificationBubble(
      content::WebContents* web_contents,
      autofill::OfferNotificationBubbleController* controller,
      bool is_user_gesture) override;
  autofill::AutofillBubbleBase* ShowSaveAutofillAiDataBubble(
      content::WebContents* web_contents,
      autofill::AutofillAiImportDataController* controller) override;
  autofill::AutofillBubbleBase* ShowAutofillAiLocalSaveNotification(
      content::WebContents* web_contents,
      autofill::AutofillAiImportDataController* controller) override;
  autofill::AutofillBubbleBase* ShowSaveAddressProfileBubble(
      content::WebContents* web_contents,
      std::unique_ptr<autofill::SaveAddressBubbleController> controller,
      bool is_user_gesture) override;
#if BUILDFLAG(ENABLE_DICE_SUPPORT)
  autofill::AutofillBubbleBase* ShowAddressSignInPromo(
      content::WebContents* web_contents,
      const autofill::AutofillProfile& autofill_profile) override;
#endif
  autofill::AutofillBubbleBase* ShowUpdateAddressProfileBubble(
      content::WebContents* web_contents,
      std::unique_ptr<autofill::UpdateAddressBubbleController> controller,
      bool is_user_gesture) override;
  autofill::AutofillBubbleBase* ShowFilledCardInformationBubble(
      content::WebContents* web_contents,
      autofill::FilledCardInformationBubbleController* controller,
      bool is_user_gesture) override;
  autofill::AutofillBubbleBase* ShowVirtualCardEnrollBubble(
      content::WebContents* web_contents,
      autofill::VirtualCardEnrollBubbleController* controller,
      bool is_user_gesture) override;
  autofill::AutofillBubbleBase* ShowVirtualCardEnrollConfirmationBubble(
      content::WebContents* web_contents,
      autofill::VirtualCardEnrollBubbleController* controller) override;
  autofill::AutofillBubbleBase* ShowMandatoryReauthBubble(
      content::WebContents* web_contents,
      autofill::MandatoryReauthBubbleController* controller,
      bool is_user_gesture,
      autofill::MandatoryReauthBubbleType bubble_type) override;
  autofill::AutofillBubbleBase* ShowSaveCardConfirmationBubble(
      content::WebContents* web_contents,
      autofill::SaveCardBubbleController* controller) override;
  autofill::AutofillBubbleBase* ShowSaveIbanConfirmationBubble(
      content::WebContents* web_contents,
      autofill::IbanBubbleController* controller) override;
  autofill::AutofillBubbleBase* ShowOmniboxAutofillBubble(
      content::WebContents* web_contents,
      autofill::OmniboxAutofillBubbleController* controller) override;
  autofill::AutofillBubbleBase* ShowPaymentsChurnedUsersBubble(
      content::WebContents* web_contents,
      autofill::PaymentsChurnedUsersBubbleController* controller,
      bool is_user_gesture) override;
  autofill::AutofillBubbleBase* ShowPaymentsChurnedUsersConfirmationBubble(
      content::WebContents* web_contents,
      autofill::PaymentsChurnedUsersBubbleController* controller) override;
  autofill::AutofillBubbleBase* ShowWalletReminderNoticeBubble(
      content::WebContents* web_contents,
      autofill::WalletReminderNoticeBubbleController* controller,
      bool is_user_gesture) override;
};

// Chrome's find (⌘F, chrome.find, "Find in page") runs through a FindBar. Ours has no UI
// of its own: Chrome's FindBarController and FindTabHelper do the searching, and the
// host's find bar drives them through the API.
class NNFindBar : public FindBar {
 public:
  NNFindBar();
  ~NNFindBar() override;

  FindBarController* GetFindBarController() const override;
  void SetFindBarController(FindBarController* controller) override;
  void Show(bool animate, bool focus) override;
  void Hide(bool animate) override;
  void SetFocusAndSelection() override {}
  void ClearResults(const find_in_page::FindNotificationDetails& results) override {}
  void StopAnimation() override {}
  void MoveWindowIfNecessary() override {}
  void SetFindTextAndSelectedRange(const std::u16string& find_text,
                                   const gfx::Range& selected_range) override;
  std::u16string_view GetFindText() const override;
  gfx::Range GetSelectedRange() const override;
  void UpdateUIForFindResult(const find_in_page::FindNotificationDetails& result,
                             const std::u16string& find_text) override {}
  void AudibleAlert() override {}
  bool IsFindBarVisible() const override;
  void RestoreSavedFocus() override {}
  bool HasGlobalFindPasteboard() const override;
  void UpdateFindBarForChangedWebContents() override {}
  bool CanPopulateFromSelectedText() override;
  const FindBarTesting* GetFindBarTesting() const override;
  bool HasFocus() const override;
  void CloseOverlappingBubbles() override {}
  views::Widget* GetHostWidget() override;

 private:
  raw_ptr<FindBarController> controller_ = nullptr;
  std::u16string find_text_;
  bool visible_ = false;
};

class NNBrowserWindow : public BrowserWindow, public ExclusiveAccessContext {
 public:
  explicit NNBrowserWindow(base::WeakPtr<WindowHost> host);
  NNBrowserWindow(const NNBrowserWindow&) = delete;
  NNBrowserWindow& operator=(const NNBrowserWindow&) = delete;

  // Called once Browser::Create has returned with this window.
  void AttachBrowser(Browser* browser);
  Browser* browser() const { return browser_; }

  // ui::BaseWindow:
  bool IsActive() const override;
  bool IsMaximized() const override;
  bool IsMinimized() const override;
  bool IsFullscreen() const override;
  gfx::NativeWindow GetNativeWindow() const override;
  gfx::Rect GetRestoredBounds() const override;
  ui::mojom::WindowShowState GetRestoredState() const override;
  gfx::Rect GetBounds() const override;
  void Show() override;
  void Hide() override {}
  bool IsVisible() const override;
  void ShowInactive() override;
  void Close() override;
  void Activate() override;
  // As Chrome's own on macOS (NativeWidgetMac::Deactivate does nothing).
  void Deactivate() override {}
  void Maximize() override {}
  void Minimize() override {}
  void Restore() override {}
  void SetBounds(const gfx::Rect& bounds) override;
  void FlashFrame(bool flash) override {}
  ui::ZOrderLevel GetZOrderLevel() const override;
  void SetZOrderLevel(ui::ZOrderLevel order) override {}

  // BrowserWindow:
  bool IsOnCurrentWorkspace() const override;
  bool IsVisibleOnScreen() const override;
  void SetTopControlsShownRatio(content::WebContents* web_contents,
                                float ratio) override {}
  bool DoBrowserControlsShrinkRendererSize(
      const content::WebContents* contents) const override;
  ui::NativeTheme* GetNativeTheme() override;
  const ui::ThemeProvider* GetThemeProvider() const override;
  const ui::ColorProvider* GetColorProvider() const override;
  int GetTopControlsHeight() const override;
  void SetTopControlsGestureScrollInProgress(bool in_progress) override {}
  std::vector<StatusBubble*> GetStatusBubbles() override;
  void UpdateTitleBar() override {}
  void UpdateLoadingAnimations(bool is_visible) override {}
  void OnActiveTabChanged(content::WebContents* old_contents,
                          content::WebContents* new_contents,
                          int index,
                          int reason) override;
  void OnTabDetached(content::WebContents* contents, bool was_active) override {}
  gfx::Size GetContentsSize() const override;
  void SetContentsSize(const gfx::Size& size) override {}
  autofill::AutofillBubbleHandler* GetAutofillBubbleHandler() override;
  LocationBar* GetLocationBar() const override;
  void SetFocusToLocationBar(bool is_user_initiated) override {}
  void UpdateReloadStopState(bool is_loading, bool force) override {}
  void UpdateToolbar(content::WebContents* contents) override {}
  bool UpdateToolbarSecurityState() override;
  void UpdateCustomTabBarVisibility(bool visible, bool animate) override {}
  void ResetToolbarTabState(content::WebContents* contents) override {}
  void FocusToolbar() override {}
  void ToolbarSizeChanged(bool is_animating) override {}
  void TabDraggingStatusChanged(bool is_dragging) override {}
  void LinkOpeningFromGesture(WindowOpenDisposition disposition) override {}
  void FocusAppMenu() override {}
  bool IsTabStripEditable() const override;
  void DisableTabStripEditingForTesting() override {}
  bool IsToolbarVisible() const override;
  bool IsToolbarShowing() const override;
  bool IsLocationBarVisible() const override;
  void ShowUpdateChromeDialog() override {}
  void ShowIntentPickerBubble(
      std::vector<apps::IntentPickerAppInfo> app_info,
      bool show_stay_in_chrome,
      bool show_remember_selection,
      apps::IntentPickerBubbleType bubble_type,
      const std::optional<url::Origin>& initiating_origin,
      IntentPickerResponse callback) override {}
  void ShowBookmarkBubble(const GURL& url, bool already_bookmarked) override {}
  ShowTranslateBubbleResult ShowTranslateBubble(
      content::WebContents* contents,
      translate::TranslateStep step,
      const std::string& source_language,
      const std::string& target_language,
      translate::TranslateErrors error_type,
      bool is_user_gesture) override;
  DownloadBubbleUIController* GetDownloadBubbleUIController() override;
  void ConfirmBrowserCloseWithPendingDownloads(
      int download_count,
      UnloadController::DownloadCloseType dialog_type,
      base::OnceCallback<void(bool)> callback) override;
  void ShowAppMenu() override {}
  void PreHandleDragUpdate(const content::DropData& drop_data,
                           const gfx::PointF& point) override {}
  void PreHandleDragExit() override {}
  void HandleDragEnded() override {}
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      const input::NativeWebKeyboardEvent& event) override;
  bool HandleKeyboardEvent(const input::NativeWebKeyboardEvent& event) override;
  std::unique_ptr<FindBar> CreateFindBar() override;
  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHost()
      override;
  web_modal::WebContentsModalDialogHost* GetWebContentsModalDialogHostFor(
      content::WebContents* web_contents) override;
  void ShowAvatarBubbleFromAvatarButton(bool is_source_accelerator) override {}
  void MaybeShowProfileSwitchIPH() override {}
  void MaybeShowSupervisedUserProfileSignInIPH() override {}
  void ShowHatsDialog(
      const std::string& site_id,
      const std::optional<std::string>& hats_histogram_name,
      const std::optional<uint64_t> hats_survey_ukm_id,
      base::OnceClosure success_callback,
      base::OnceClosure failure_callback,
      const SurveyBitsData& product_specific_bits_data,
      const SurveyStringData& product_specific_string_data) override {}
  ExclusiveAccessContext* GetExclusiveAccessContext() override;
  std::string GetWorkspace() const override;
  bool IsVisibleOnAllWorkspaces() const override;
  void ShowEmojiPanel() override;
  std::unique_ptr<content::EyeDropper> OpenEyeDropper(
      content::RenderFrameHost* frame,
      content::EyeDropperListener* listener) override;
  void ShowCaretBrowsingDialog() override {}
  void CreateTabSearchBubble() override {}
  void CloseTabSearchBubble() override {}
  void ShowIncognitoClearBrowsingDataDialog() override {}
  void ShowIncognitoHistoryDisclaimerDialog() override {}
  bool IsUnframedModeEnabled() const override;
  bool GetCanResize() override;
  ui::mojom::WindowShowState GetWindowShowState() const override;
  void ShowChromeLabs() override {}
  BrowserView* AsBrowserView() override;

  // ExclusiveAccessContext (tab fullscreen, pointer lock and keyboard lock). The host
  // shows a fullscreen tab itself; Chrome only tracks the state, as with CEF's hosted tabs.
  Profile* GetProfile() override;
  void EnterFullscreen(const url::Origin& origin,
                       ExclusiveAccessBubbleType bubble_type,
                       FullscreenTabParams fullscreen_tab_params) override;
  void ExitFullscreen() override;
  void UpdateExclusiveAccessBubble(
      const ExclusiveAccessBubbleParams& params,
      ExclusiveAccessBubbleHideCallback first_hide_callback) override;
  bool IsExclusiveAccessBubbleDisplayed() const override;
  void OnExclusiveAccessUserInput() override {}
  content::WebContents* GetWebContentsForExclusiveAccess() override;
  bool CanUserEnterFullscreen() const override;
  bool CanUserExitFullscreen() const override;

 protected:
  void DeleteBrowserWindow() override;

 private:
  ~NNBrowserWindow() override;

  base::WeakPtr<WindowHost> host_;
  raw_ptr<Browser> browser_ = nullptr;
  std::unique_ptr<NNLocationBar> location_bar_;
  NNAutofillBubbleHandler autofill_bubble_handler_;
  // The handler as the Browser's unowned user data (from AttachBrowser).
  std::optional<ui::ScopedUnownedUserData<autofill::AutofillBubbleHandler>>
      autofill_bubble_handler_registration_;
  bool tab_fullscreen_ = false;
  // Tells the host which page is in tab fullscreen, from Chrome's own record of it (never
  // the active tab: a tab switch selects the next tab before the old one's fullscreen ends).
  void ReportFullscreenTab();
  // The page last reported as fullscreen.
  base::WeakPtr<content::WebContents> fullscreen_tab_;
  // Chrome makes this only for a BrowserView; docked DevTools need it (devtools_window.cc
  // asks it whether the Browser can dock, and it reports dock changes to our delegate).
  std::unique_ptr<DevtoolsUIController> devtools_ui_controller_;
};

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_BROWSER_WINDOW_H_
