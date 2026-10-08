// CEF's seams in Chrome's code (nn_cef_seams.h): in this tree CEF's own patches make //chrome
// call these, and libcef would define them for CEF. NNCore is Chrome's framework without
// libcef, so it defines them itself: our Browsers get our delegate, everything else keeps
// Chrome's behaviour. Deleted at the Chromium bump, with CEF's patches.

#include "netnyahoo/core/nn_cef_seams.h"

#include <memory>

#include "cef/libcef/browser/chrome/extensions/chrome_extension_util.h"
#include "cef/libcef/browser/chrome/extensions/chrome_mime_handler_view_guest_delegate_cef.h"
#include "cef/libcef/browser/download_manager_delegate.h"
#include "cef/libcef/browser/prefs/browser_prefs.h"
#include "cef/libcef/browser/prefs/pref_names.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "components/prefs/pref_registry_simple.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/guest_view/mime_handler_view/mime_handler_view_guest.h"
#include "netnyahoo/core/nn_browser.h"

namespace nncore {

NNBrowserDelegate::NNBrowserDelegate(Browser* browser,
                                     base::WeakPtr<WindowHost> host)
    : browser_(browser), host_(host), is_ours_(!!host) {}

NNBrowserDelegate::~NNBrowserDelegate() = default;

std::unique_ptr<content::WebContents> NNBrowserDelegate::AddWebContents(
    std::unique_ptr<content::WebContents> new_contents) {
  return new_contents;
}

NNBrowserDelegate* DelegateFor(const BrowserWindowInterface* browser) {
  // Every Browser's delegate is ours: NNCore defines cef::BrowserDelegate::Create.
  return browser ? static_cast<NNBrowserDelegate*>(browser->cef_delegate())
                 : nullptr;
}

void SetHostOfNewBrowser(BrowserWindowCreateParams& params,
                         base::WeakPtr<WindowHost> host) {
  params.cef_params = base::MakeRefCounted<NNCreateParams>(std::move(host));
}

}  // namespace nncore

namespace cef {

// static
std::unique_ptr<BrowserDelegate> BrowserDelegate::Create(
    Browser* browser,
    scoped_refptr<CreateParams> cef_params,
    const BrowserWindowInterface* opener) {
  base::WeakPtr<nncore::WindowHost> host;
  if (cef_params) {
    host = static_cast<nncore::NNCreateParams*>(cef_params.get())->host;
  }
  return std::make_unique<nncore::NNBrowserDelegate>(browser, host);
}

// static
std::unique_ptr<BrowserWebContentsDelegate>
BrowserDelegate::CreateWebContentsDelegate(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller) {
  nncore::NNBrowserDelegate* delegate = nncore::DelegateFor(browser);
  if (delegate && delegate->is_ours()) {
    return std::make_unique<nncore::NNWebContentsDelegate>(
        browser, exclusive_access_manager, command_controller,
        unload_controller, app_browser_controller, window, capabilities,
        browser_ui_controller,
        delegate->host() ? delegate->host()->GetWeakPtr()
                         : base::WeakPtr<nncore::WindowHost>());
  }
  return std::make_unique<BrowserWebContentsDelegate>(
      browser, exclusive_access_manager, command_controller, unload_controller,
      app_browser_controller, window, capabilities, browser_ui_controller);
}

// static
Browser* BrowserDelegate::CreateDevToolsBrowser(
    Profile* profile,
    BrowserWindowInterface* opener,
    content::WebContents* inspected_web_contents,
    std::unique_ptr<content::WebContents>& devtools_contents) {
  // Undocked DevTools keep Chrome's own window.
  return nullptr;
}

bool GetAlloyTabById(int tab_id,
                     Profile* profile,
                     bool include_incognito,
                     content::WebContents** contents) {
  return false;
}

bool IsAlloyContents(content::WebContents* contents, bool primary_only) {
  return false;
}

namespace {
// Chrome's own download behaviour (ChromeDownloadManagerDelegate asks this first).
class ChromeDownloads final : public DownloadManagerDelegate {};
}  // namespace

// static
std::unique_ptr<DownloadManagerDelegate> DownloadManagerDelegate::Create(
    content::DownloadManager* download_manager) {
  return std::make_unique<ChromeDownloads>();
}

}  // namespace cef

namespace browser_prefs {

void RegisterLocalStatePrefs(PrefRegistrySimple* registry) {}

void RegisterProfilePrefs(PrefRegistrySimple* registry) {
  // Read by ProfileImpl::GetStorageNotificationService in the CEF-patched tree.
  registry->RegisterBooleanPref(cef::prefs::kEnableStorageNotificationService,
                                true);
}

}  // namespace browser_prefs

namespace extensions {

ChromeMimeHandlerViewGuestDelegateCef::ChromeMimeHandlerViewGuestDelegateCef(
    MimeHandlerViewGuest* guest)
    : owner_web_contents_(guest->owner_web_contents()) {}

ChromeMimeHandlerViewGuestDelegateCef::
    ~ChromeMimeHandlerViewGuestDelegateCef() = default;

void ChromeMimeHandlerViewGuestDelegateCef::OverrideWebContentsCreateParams(
    content::WebContents::CreateParams* params) {}

bool ChromeMimeHandlerViewGuestDelegateCef::HandleContextMenu(
    content::RenderFrameHost& render_frame_host,
    const content::ContextMenuParams& params) {
  return ChromeMimeHandlerViewGuestDelegate::HandleContextMenu(
      render_frame_host, params);
}

}  // namespace extensions
