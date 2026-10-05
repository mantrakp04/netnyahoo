#include "netnyahoo/core/nn_extension_view.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/extensions/extension_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/extensions/extension_popup_types.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "extensions/browser/extension_host_registry.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/browser/extension_util.h"
#include "extensions/common/constants.h"
#include "extensions/common/extension.h"
#include "netnyahoo/core/nn_browser.h"
#include "netnyahoo/core/public/NNCore.h"
#include "ui/gfx/geometry/size.h"
#include "url/gurl.h"

// The hook in Chrome's extension_action_api.cc (engine/nncore/apply.sh).
extern std::optional<bool> (*g_netnyahoo_open_action_popup)(
    BrowserWindowInterface& browser,
    const extensions::Extension& extension,
    ShowPopupCallback& callback,
    std::string* error);

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
                   public content::WebContentsObserver,
                   public BrowserCollectionObserver,
                   public extensions::ExtensionRegistryObserver,
                   public extensions::ExtensionHostRegistry::Observer,
                   public ProfileObserver {
 public:
  HostedView(std::unique_ptr<extensions::ExtensionViewHost> host,
             Browser* browser,
             ExtensionViewKind kind)
      : host_(std::move(host)), browser_(browser), kind_(kind) {
    host_->set_view(this);
    Observe(host_->host_contents());
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
  ~HostedView() override {
    Observe(nullptr);
    FailShown();
  }

  content::WebContents* contents() const { return host_->host_contents(); }
  Browser* browser() const { return browser_; }
  ExtensionViewKind kind() const { return kind_; }
  const std::string& extension_id() const { return host_->extension_id(); }
  const gfx::Size& preferred_size() const { return preferred_size_; }

  // chrome.action.openPopup's answer: this popup once its page has loaded, or null if it
  // closes first.
  void set_shown_callback(ShowPopupCallback callback) {
    FailShown();
    shown_callback_ = std::move(callback);
    if (host_->has_loaded_once()) {
      OnLoaded();
    }
  }
  void Start() { host_->CreateRendererSoon(); }

  // The page closes soon (posted: callers may be inside one of its callbacks).
  void ScheduleDestroy() {
    if (destroy_scheduled_) {
      return;
    }
    destroy_scheduled_ = true;
    FailShown();
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
  // A popup sizes itself as Chrome's does (ExtensionViewViews: the page's auto-resize, within
  // Chrome's popup limits), and the host sizes its view to it; a side panel is the host's size.
  void ResizeDueToAutoResize(content::WebContents* web_contents,
                             const gfx::Size& new_size) override {
    if (kind_ != ExtensionViewKind::kPopup || new_size == preferred_size_) {
      return;
    }
    preferred_size_ = new_size;
    TabBridge* bridge = TabBridge::FromWebContents(contents());
    NNCoreTab* tab = bridge ? bridge->tab() : nil;
    id<NNCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:preferredSizeDidChange:)]) {
      [delegate tab:tab
          preferredSizeDidChange:NSMakeSize(new_size.width(), new_size.height())];
    }
  }
  // The first main frame (as views::WebView: not a speculative one)…
  void RenderFrameCreated(content::RenderFrameHost* render_frame_host) override {
    if (render_frame_host == contents()->GetPrimaryMainFrame()) {
      EnableAutoResize(render_frame_host);
    }
  }
  bool HandleKeyboardEvent(content::WebContents* source,
                           const input::NativeWebKeyboardEvent& event) override {
    // Keys the page left go where a tab's do: its window's (the app's menus).
    return browser_ &&
           BrowserWebContentsDelegate::From(browser_)->HandleKeyboardEvent(source, event);
  }
  // The first load stopped: shown, if a document committed (a popup URL that downloads stops
  // without one, and Chrome's answer requires one).
  void OnLoaded() override {
    if (shown_callback_) {
      std::move(shown_callback_)
          .Run(host_->document_element_available() ? host_.get() : nullptr);
    }
  }

  // content::WebContentsObserver: …and each one that replaces it (the popup's page going to
  // another of its pages).
  void RenderFrameHostChanged(content::RenderFrameHost* old_host,
                              content::RenderFrameHost* new_host) override {
    if (old_host && new_host == contents()->GetPrimaryMainFrame() &&
        new_host->IsRenderFrameLive()) {
      EnableAutoResize(new_host);
    }
  }

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
  void EnableAutoResize(content::RenderFrameHost* frame) {
    if (kind_ != ExtensionViewKind::kPopup || !frame->GetView()) {
      return;
    }
    // Chrome's ExtensionPopup limits (extension_popup.cc kMinSize, kMaxSize).
    frame->GetView()->EnableAutoResize(gfx::Size(25, 25), gfx::Size(800, 600));
  }

  // An openPopup still waiting: it failed.
  void FailShown() {
    if (shown_callback_) {
      std::move(shown_callback_).Run(nullptr);
    }
  }

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
  const ExtensionViewKind kind_;
  gfx::Size preferred_size_;
  ShowPopupCallback shown_callback_;
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

// A chrome.action.openPopup() the host is yet to show: one at a time, as Chrome's toolbar
// shows one popup. Answered by the extension's popup opening in that Browser
// (OpenExtensionView); failed after 10 s, when its Browser closes, or when another call takes
// its place.
class PendingPopup : public BrowserCollectionObserver {
 public:
  PendingPopup(BrowserWindowInterface* browser,
               std::string extension_id,
               ShowPopupCallback callback);
  PendingPopup(const PendingPopup&) = delete;
  PendingPopup& operator=(const PendingPopup&) = delete;
  ~PendingPopup() override = default;

  bool Matches(const BrowserWindowInterface* browser, const std::string& extension_id) const {
    return browser == browser_ && extension_id == extension_id_;
  }
  ShowPopupCallback TakeCallback() { return std::move(callback_); }

  // BrowserCollectionObserver: failed in a later task (never inside Chrome's notification).
  void OnBrowserClosed(BrowserWindowInterface* browser) override;

 private:
  // Compared, never used: the Browser may be gone.
  const void* browser_;
  const std::string extension_id_;
  ShowPopupCallback callback_;
  base::OneShotTimer timeout_;
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver> observation_{
      this};
  base::WeakPtrFactory<PendingPopup> weak_factory_{this};
};

std::unique_ptr<PendingPopup>& Pending() {
  static base::NoDestructor<std::unique_ptr<PendingPopup>> pending;
  return *pending;
}

// Out of the slot first, then answered: the answer (the extension's API call failing) may
// start another.
void FailPending() {
  std::unique_ptr<PendingPopup> pending = std::move(Pending());
  if (!pending) {
    return;
  }
  ShowPopupCallback callback = pending->TakeCallback();
  pending.reset();
  if (callback) {
    std::move(callback).Run(nullptr);
  }
}

PendingPopup::PendingPopup(BrowserWindowInterface* browser,
                           std::string extension_id,
                           ShowPopupCallback callback)
    : browser_(browser),
      extension_id_(std::move(extension_id)),
      callback_(std::move(callback)) {
  observation_.Observe(GlobalBrowserCollection::GetInstance());
  timeout_.Start(FROM_HERE, base::Seconds(10), base::BindOnce(&FailPending));
}

void PendingPopup::OnBrowserClosed(BrowserWindowInterface* browser) {
  if (browser != browser_) {
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<PendingPopup> pending) {
                       if (pending && Pending().get() == pending.get()) {
                         FailPending();
                       }
                     },
                     weak_factory_.GetWeakPtr()));
}

// g_netnyahoo_open_action_popup: the host's Browsers (not its own hidden ones) show the popup
// over their active tab; any other Browser is Chrome's.
std::optional<bool> OpenActionPopup(BrowserWindowInterface& browser,
                                    const extensions::Extension& extension,
                                    ShowPopupCallback& callback,
                                    std::string* error) {
  WindowHost* host = WindowHost::ForBrowser(&browser);
  if (!host) {
    return std::nullopt;
  }
  tabs::TabInterface* tab = browser.GetActiveTabInterface();
  if (host->internal() || !tab || !tab->GetContents()) {
    *error = "Failed to open popup.";
    return false;
  }
  FailPending();
  Pending() = std::make_unique<PendingPopup>(&browser, extension.id(), std::move(callback));
  if (!HostExtensionActionPopup(tab->GetContents(), extension.id())) {
    // Given back: Chrome answers the failure itself.
    if (Pending()) {
      callback = Pending()->TakeCallback();
      Pending().reset();
    }
    *error = "Failed to open popup.";
    return false;
  }
  return true;
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
  auto view = std::make_unique<HostedView>(std::move(host), browser, kind);
  HostedView* hosted = view.get();
  content::WebContents* contents = hosted->contents();
  Views()[contents] = std::move(view);
  // The NNCoreTab the host attaches, reporting the page's state as a tab's.
  TabBridge::GetOrCreate(contents);
  // The popup an openPopup() asked for: it answers once its page has loaded.
  if (kind == ExtensionViewKind::kPopup && Pending() &&
      Pending()->Matches(browser, extension->id())) {
    ShowPopupCallback callback = Pending()->TakeCallback();
    Pending().reset();
    hosted->set_shown_callback(std::move(callback));
  }
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

gfx::Size ExtensionPopupPreferredSize(content::WebContents* contents) {
  auto it = Views().find(contents);
  return it != Views().end() && it->second->kind() == ExtensionViewKind::kPopup
             ? it->second->preferred_size()
             : gfx::Size();
}

void InstallActionPopupHook() {
  g_netnyahoo_open_action_popup = &OpenActionPopup;
}

void CloseAllExtensionViews() {
  FailPending();
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
