#include "netnyahoo/core/nn_extension_view.h"

#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/extensions/extension_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_host_registry.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/browser/extension_util.h"
#include "extensions/common/constants.h"
#include "extensions/common/extension.h"
#include "netnyahoo/core/nn_browser.h"
#include "url/gurl.h"

namespace nncore {

namespace {

class HostedView;

// Every view the host shows, by its page.
std::map<content::WebContents*, std::unique_ptr<HostedView>>& Views() {
  static base::NoDestructor<std::map<content::WebContents*, std::unique_ptr<HostedView>>>
      views;
  return *views;
}

void Destroy(content::WebContents* contents);

// The ExtensionView Chrome's ExtensionViewHost talks to. Chrome's popup is a bubble anchored to
// its toolbar; here the host places and sizes the page in its own views.
class HostedView : public extensions::ExtensionView,
                   public BrowserCollectionObserver,
                   public extensions::ExtensionRegistryObserver,
                   public extensions::ExtensionHostRegistry::Observer,
                   public ProfileObserver {
 public:
  HostedView(std::unique_ptr<extensions::ExtensionViewHost> host, Browser* browser)
      : host_(std::move(host)), browser_(browser) {
    host_->set_view(this);
    // window.close() in the page, Esc in a popup.
    host_->SetCloseHandler(
        base::BindOnce(&HostedView::ClosedByChrome, weak_factory_.GetWeakPtr()));
    browser_observation_.Observe(GlobalBrowserCollection::GetInstance());
    // The host's own context: a spanning extension's page in a private window runs in the
    // original profile.
    content::BrowserContext* context = host_->browser_context();
    registry_observation_.Observe(extensions::ExtensionRegistry::Get(context));
    hosts_observation_.Observe(extensions::ExtensionHostRegistry::Get(context));
    profile_observation_.Observe(Profile::FromBrowserContext(context));
  }
  HostedView(const HostedView&) = delete;
  HostedView& operator=(const HostedView&) = delete;
  ~HostedView() override = default;

  content::WebContents* contents() const { return host_->host_contents(); }
  void Start() { host_->CreateRendererSoon(); }

  // The page closes soon (posted: callers may be inside one of its callbacks).
  void ScheduleDestroy() {
    if (destroy_scheduled_) {
      return;
    }
    destroy_scheduled_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<HostedView> view) {
                         if (view) {
                           Destroy(view->contents());
                         }
                       },
                       weak_factory_.GetWeakPtr()));
  }

  // The host's view lets the page go and tells the app (onWindowClose), as for a tab the page
  // closed: before the page goes, so the view never holds a destroyed one. Never for a close
  // the host asked for (closed_by_host), and once.
  void ReportClosed() {
    if (TabBridge* bridge = TabBridge::FromWebContents(contents())) {
      bridge->ReportWillClose();
    }
  }

  // extensions::ExtensionView:
  gfx::NativeView GetNativeView() override { return contents()->GetNativeView(); }
  // The host sizes the view from the page itself; Chrome's auto-resize stays off.
  void ResizeDueToAutoResize(content::WebContents* web_contents,
                             const gfx::Size& new_size) override {}
  void RenderFrameCreated(content::RenderFrameHost* render_frame_host) override {}
  bool HandleKeyboardEvent(content::WebContents* source,
                           const input::NativeWebKeyboardEvent& event) override {
    // Keys the page left go where a tab's do: its window's (the app's menus).
    return browser_ &&
           BrowserWebContentsDelegate::From(browser_)->HandleKeyboardEvent(source, event);
  }
  void OnLoaded() override {}

  // BrowserCollectionObserver: the Browser it is bound to is closing (its window, or the
  // profile leaving the window; Chrome destroys it in a later task). Chrome's host delegate
  // keeps a pointer to it: the page goes now.
  void OnBrowserClosed(BrowserWindowInterface* browser) override {
    if (browser != browser_) {
      return;
    }
    browser_ = nullptr;
    CloseNow();
  }

  // extensions::ExtensionRegistryObserver: as Chrome's popup, gone at once (a queued renderer
  // start would read the unloaded extension).
  void OnExtensionUnloaded(content::BrowserContext* browser_context,
                           const extensions::Extension* extension,
                           extensions::UnloadedExtensionReason reason) override {
    if (extension->id() == host_->extension_id()) {
      CloseNow();
    }
  }

  // extensions::ExtensionHostRegistry::Observer: its renderer died. The host still runs after
  // telling: closed in a later task.
  void OnExtensionHostRenderProcessGone(content::BrowserContext* browser_context,
                                        extensions::ExtensionHost* extension_host) override {
    if (extension_host == host_.get()) {
      ReportClosed();
      ScheduleDestroy();
    }
  }

  // ProfileObserver: its services are still there; the host needs them to go.
  void OnProfileWillBeDestroyed(Profile* profile) override { CloseNow(); }

 private:
  void ClosedByChrome(extensions::ExtensionHost* host) {
    ReportClosed();
    ScheduleDestroy();
  }

  void CloseNow() {
    ReportClosed();
    Destroy(contents());  // deletes this
  }

  std::unique_ptr<extensions::ExtensionViewHost> host_;
  raw_ptr<Browser> browser_;
  bool destroy_scheduled_ = false;
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver>
      browser_observation_{this};
  base::ScopedObservation<extensions::ExtensionRegistry, extensions::ExtensionRegistryObserver>
      registry_observation_{this};
  base::ScopedObservation<extensions::ExtensionHostRegistry,
                          extensions::ExtensionHostRegistry::Observer>
      hosts_observation_{this};
  base::ScopedObservation<Profile, ProfileObserver> profile_observation_{this};
  base::WeakPtrFactory<HostedView> weak_factory_{this};
};

// Out of the map first, then gone: its destruction (the page's WebContents, observers told)
// never runs while the map is being changed.
void Destroy(content::WebContents* contents) {
  auto it = Views().find(contents);
  if (it == Views().end()) {
    return;
  }
  std::unique_ptr<HostedView> view = std::move(it->second);
  Views().erase(it);
}

}  // namespace

content::WebContents* OpenExtensionView(Browser* browser,
                                        const GURL& url,
                                        ExtensionViewKind kind) {
  if (!browser || !url.SchemeIs(extensions::kExtensionScheme)) {
    return nullptr;
  }
  Profile* profile = browser->GetProfile();
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(profile)->enabled_extensions().GetByID(
          std::string(url.host()));
  // A private window shows only extensions allowed there (Chrome's factory would stop on a
  // split-mode one that isn't).
  if (!extension || (profile->IsOffTheRecord() &&
                     !extensions::util::IsIncognitoEnabled(extension->id(), profile))) {
    return nullptr;
  }
  std::unique_ptr<extensions::ExtensionViewHost> host =
      kind == ExtensionViewKind::kPopup
          ? extensions::ExtensionViewHostFactory::CreatePopupHost(*extension, url, browser)
          : extensions::ExtensionViewHostFactory::CreateSidePanelHost(
                *extension, url, browser, /*tab_interface=*/nullptr);
  if (!host) {
    return nullptr;
  }
  auto view = std::make_unique<HostedView>(std::move(host), browser);
  HostedView* hosted = view.get();
  content::WebContents* contents = hosted->contents();
  Views()[contents] = std::move(view);
  // The NNCoreTab the host attaches, reporting the page's state as a tab's.
  TabBridge::GetOrCreate(contents);
  hosted->Start();
  return contents;
}

bool CloseExtensionView(content::WebContents* contents) {
  auto it = Views().find(contents);
  if (it == Views().end()) {
    return false;
  }
  if (TabBridge* bridge = TabBridge::FromWebContents(contents)) {
    bridge->set_closed_by_host();
  }
  it->second->ScheduleDestroy();
  return true;
}

void CloseAllExtensionViews() {
  std::vector<std::unique_ptr<HostedView>> views;
  for (auto& [contents, view] : Views()) {
    views.push_back(std::move(view));
  }
  Views().clear();
  for (const auto& view : views) {
    view->ReportClosed();
  }
}

}  // namespace nncore
