// Our hooks in Chrome's code: the g_arcadia_* function pointers our patches add (the
// password bubble, the extension install prompt, device choosers, the Cast dialog, extension
// side panels, hidden windows, windows without tabs, docked DevTools) and the flag the
// reading mode and toast hooks read (engine/patches, engine/arcadiacore/apply.sh). Chrome keeps its
// own behaviour while a hook is unset; ArcadiaCore sets them all once, as the browser process starts
// (ACMainDelegate::PreSandboxStartup). Among them, the WebContentsDelegate of ArcadiaCore's Browsers
// (apply.sh's InitPostWindowConstruction hook).

#include "arcadia/core/ac_seams.h"

#include <memory>

#include "base/functional/callback.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/permissions/chooser_controller.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_install_prompt_client.h"
#include "extensions/common/extension_id.h"
#include "arcadia/core/ac_browser.h"
#include "arcadia/core/ac_cast_dialog.h"
#include "arcadia/core/ac_browser_window.h"
#include "arcadia/core/ac_device_chooser.h"

class Profile;

namespace extensions {
class InstallPromptData;
}

namespace media_router {
class MediaRouterUI;
}

// chromium-password-bubble-hook.patch
extern bool (*g_arcadia_password_bubble)(content::WebContents* web_contents);
// chromium-extension-install-prompt-hook.patch
extern bool (*g_arcadia_extension_install_prompt)(
    Profile* profile,
    content::WebContents* parent,
    const extensions::InstallPromptData& prompt,
    extensions::ExtensionInstallPromptClient::DoneCallback* done_callback);
// chromium-device-chooser-hook.patch
extern bool (*g_arcadia_device_chooser)(
    content::RenderFrameHost* owner,
    std::unique_ptr<permissions::ChooserController>* controller,
    base::OnceClosure* close_closure);
// chromium-cast-dialog-hook.patch
extern bool (*g_arcadia_wants_cast_dialog)(content::WebContents* initiator);
extern bool (*g_arcadia_cast_dialog)(content::WebContents* initiator,
                                       media_router::MediaRouterUI* ui);
// chromium-side-panel-hook.patch
extern bool (*g_arcadia_extension_side_panel)(
    BrowserWindowInterface* browser_window,
    content::WebContents* web_contents,
    const extensions::ExtensionId& extension_id,
    bool open);
// chromium-extension-window-hidden.patch (and chromium-hidden-window-current-window.patch,
// apply.sh's browser_window_util hook)
extern bool (*g_arcadia_hidden_from_extensions)(
    const BrowserWindowInterface* browser);
// chromium-window-hosted.patch
extern bool (*g_arcadia_keeps_window_without_tabs)(
    const BrowserWindowInterface* browser);
// chromium-window-docked-devtools.patch
extern void (*g_arcadia_devtools_dock_changed)(BrowserWindowInterface* browser,
                                                 content::WebContents* inspected,
                                                 content::WebContents* devtools);
// apply.sh's toast and reading mode hooks
extern bool g_arcadia_viewless_browsers;
// apply.sh's BrowserWindowFeatures::InitPostWindowConstruction hook
extern std::unique_ptr<BrowserWebContentsDelegate> (
    *g_arcadia_create_web_contents_delegate)(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller);

namespace arcadiacore {

namespace {

bool HandlePasswordBubble(content::WebContents* web_contents) {
  // Chrome's bubble anchors to its toolbar's key icon; the host shows its own prompt.
  WindowHost* host = WindowHost::ForBrowser(
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(web_contents));
  return host && host->OfferPasswordSave(web_contents);
}

bool HandleExtensionSidePanel(BrowserWindowInterface* browser_window,
                              content::WebContents* web_contents,
                              const extensions::ExtensionId& extension_id,
                              bool open) {
  // An extension opening (chrome.sidePanel.open) or closing its side panel: the host's
  // tabs show it in their own panel.
  content::WebContents* contents = web_contents;
  if (!contents && browser_window && browser_window->GetActiveTabInterface()) {
    contents = browser_window->GetActiveTabInterface()->GetContents();
  }
  BrowserWindowInterface* browser =
      contents ? GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents)
               : browser_window;
  if (!contents || !WindowHost::ForBrowser(browser)) {
    return false;
  }
  return HostExtensionSidePanel(contents, extension_id, open);
}

bool IsHiddenFromExtensions(const BrowserWindowInterface* browser) {
  // The host's own hidden pages (the content blocker's extension page, standalone views):
  // never an extension's window, its current one, or where its tabs.create lands.
  WindowHost* host = WindowHost::ForBrowser(browser);
  return host && host->internal();
}

bool KeepsWindowWithoutTabs(const BrowserWindowInterface* browser) {
  // A profile's Browser stays while its window is open, tabs or not; the host decides.
  // (Chrome checks the Browser's own close first: UnloadController's
  // is_attempting_to_close_browser.)
  WindowHost* host = WindowHost::ForBrowser(browser);
  return host && !host->closing() && !browser_shutdown::IsTryingToQuit();
}

std::unique_ptr<BrowserWebContentsDelegate> CreateWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller) {
  // One of ArcadiaCore's Browsers: its window is ours, made for it (WindowHost::BrowserFor) or by
  // the window factory hook (HostChromeBrowser). It is recorded as ours from here on.
  ACBrowserWindow* ours = ACBrowserWindow::FromWindow(&window);
  if (!ours) {
    return nullptr;  // Chrome's own
  }
  ours->Register(browser);
  return std::make_unique<ACWebContentsDelegate>(
      browser, exclusive_access_manager, command_controller, unload_controller,
      app_browser_controller, window, capabilities, browser_ui_controller,
      ours->host_weak());
}

void DevToolsDockChanged(BrowserWindowInterface* browser,
                         content::WebContents* inspected,
                         content::WebContents* devtools) {
  if (WindowHost* host = WindowHost::ForBrowser(browser)) {
    host->DevToolsDockChanged(inspected, devtools);
  }
}

}  // namespace

void InstallChromeHooks() {
  g_arcadia_password_bubble = &HandlePasswordBubble;
  // Chrome's "Add <extension>?" (the Web Store, an extension asking for more permissions):
  // the host asks with its own UI when it wants to.
  g_arcadia_extension_install_prompt = &HostExtensionInstallPrompt;
  g_arcadia_device_chooser = &HandleDeviceChooser;
  g_arcadia_wants_cast_dialog = &WantsCastDialog;
  g_arcadia_cast_dialog = &HandleCastDialog;
  g_arcadia_extension_side_panel = &HandleExtensionSidePanel;
  g_arcadia_hidden_from_extensions = &IsHiddenFromExtensions;
  g_arcadia_keeps_window_without_tabs = &KeepsWindowWithoutTabs;
  g_arcadia_devtools_dock_changed = &DevToolsDockChanged;
  g_arcadia_create_web_contents_delegate = &CreateWebContentsDelegate;
  g_arcadia_viewless_browsers = true;
}

}  // namespace arcadiacore
