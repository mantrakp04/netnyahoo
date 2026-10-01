// The ObjC API (public/NNCore.h) over NNCore's Chromium-side model.

#import "netnyahoo/core/public/NNCore.h"

#include <map>
#include <sstream>
#include <memory>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/extensions/extension_util.h"
#include "chrome/browser/extensions/extension_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "components/keep_alive_registry/keep_alive_registry.h"
#include "chrome/browser/password_manager/factories/profile_password_store_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_commands.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/password_manager/core/browser/password_store/password_store_consumer.h"
#include "components/password_manager/core/browser/password_store/password_store_interface.h"
#include "components/sessions/content/session_tab_helper.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/unpacked_installer.h"
#include "extensions/common/extension.h"
#include "netnyahoo/core/nn_browser.h"
#include "netnyahoo/core/nn_main_delegate.h"
#import "netnyahoo/core/nncore_internal.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/mac/coordinate_conversion.h"

extern "C" int ChromeMain(int argc, const char** argv);

namespace {

id<NNCoreEngineDelegate> __strong g_delegate;
NNCoreEngine* __strong g_engine;

NSString* NS(const std::string& s) {
  return base::SysUTF8ToNSString(s);
}

NSString* NS(const std::u16string& s) {
  return base::SysUTF16ToNSString(s);
}

std::map<Profile*, NNCoreProfile*>& ProfileWrappers() {
  static base::NoDestructor<std::map<Profile*, NNCoreProfile*>> wrappers;
  return *wrappers;
}

// Collects a profile's logins once and deletes itself.
class LoginsFetcher : public password_manager::PasswordStoreConsumer {
 public:
  explicit LoginsFetcher(
      void (^completion)(NSArray<NSDictionary<NSString*, NSString*>*>*))
      : completion_(completion) {}

  void OnGetPasswordStoreResultsOrErrorFrom(
      password_manager::PasswordStoreInterface* store,
      password_manager::LoginsResultOrError results_or_error) override {
    NSMutableArray* logins = [NSMutableArray array];
    if (auto* results =
            std::get_if<password_manager::LoginsResult>(&results_or_error)) {
      for (const auto& login : *results) {
        [logins addObject:@{
          @"origin" : NS(login.signon_realm),
          @"username" : NS(login.username_value),
        }];
      }
    }
    completion_(logins);
    delete this;
  }

  base::WeakPtr<PasswordStoreConsumer> GetWeakPtr() {
    return weak_factory_.GetWeakPtr();
  }

 private:
  void (^completion_)(NSArray<NSDictionary<NSString*, NSString*>*>*);
  base::WeakPtrFactory<LoginsFetcher> weak_factory_{this};
};

class ActionPopup;
std::unique_ptr<ActionPopup>& CurrentPopup();

// An extension's action popup: Chrome's ExtensionViewHost (the popup page, its
// extension process and APIs) shown in a panel attached to our window, as Dia shows
// its own. Chrome's ExtensionPopup is a bubble anchored to its toolbar, which we lack.
class ActionPopup : public extensions::ExtensionView {
 public:
  ActionPopup(std::unique_ptr<extensions::ExtensionViewHost> host,
              NSWindow* parent,
              NSRect anchor)
      : host_(std::move(host)), parent_(parent), anchor_(anchor) {
    host_->set_view(this);
    NSView* view = host_->host_contents()->GetNativeView().GetNativeNSView();
    panel_ = [[NSPanel alloc]
        initWithContentRect:NSMakeRect(0, 0, 200, 100)
                  styleMask:NSWindowStyleMaskBorderless |
                            NSWindowStyleMaskNonactivatingPanel
                    backing:NSBackingStoreBuffered
                      defer:NO];
    panel_.releasedWhenClosed = NO;
    panel_.hasShadow = YES;
    panel_.contentView = view;
    // window.close() in the popup (and Chrome closing it) ends it, as Chrome's popup.
    host_->SetCloseHandler(base::BindOnce([](extensions::ExtensionHost*) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce([] { CurrentPopup().reset(); }));
    }));
    host_->CreateRendererSoon();
  }

  ~ActionPopup() override {
    [parent_ removeChildWindow:panel_];
    [panel_ orderOut:nil];
  }

  NSPanel* panel() const { return panel_; }
  extensions::ExtensionViewHost* host() const { return host_.get(); }

  // extensions::ExtensionView:
  gfx::NativeView GetNativeView() override {
    return host_->host_contents()->GetNativeView();
  }
  void ResizeDueToAutoResize(content::WebContents* web_contents,
                             const gfx::Size& new_size) override {
    size_ = NSMakeSize(new_size.width(), new_size.height());
    Place();
  }
  void RenderFrameCreated(content::RenderFrameHost* render_frame_host) override {
    // As Chrome's popup: the page sizes the panel, within these limits.
    if (auto* rwhv = host_->host_contents()->GetRenderWidgetHostView()) {
      rwhv->EnableAutoResize(gfx::Size(25, 25), gfx::Size(800, 600));
    }
  }
  bool HandleKeyboardEvent(content::WebContents* source,
                           const input::NativeWebKeyboardEvent& event) override {
    return false;
  }
  void OnLoaded() override {
    shown_ = true;
    Place();
    [parent_ addChildWindow:panel_ ordered:NSWindowAbove];
  }

 private:
  void Place() {
    // Under the anchor, right-aligned to it (window coordinates, bottom-left origin).
    NSRect anchor = [parent_ convertRectToScreen:anchor_];
    NSRect frame = NSMakeRect(NSMaxX(anchor) - size_.width,
                              NSMinY(anchor) - size_.height, size_.width,
                              size_.height);
    [panel_ setFrame:frame display:shown_];
  }

  std::unique_ptr<extensions::ExtensionViewHost> host_;
  NSWindow* __strong parent_;
  NSRect anchor_;
  NSSize size_ = NSMakeSize(200, 100);
  NSPanel* __strong panel_;
  bool shown_ = false;
};

std::unique_ptr<ActionPopup>& CurrentPopup() {
  static base::NoDestructor<std::unique_ptr<ActionPopup>> popup;
  return *popup;
}

}  // namespace

// The C entry point, for hosts that don't use the ObjC runtime to start.
extern "C" __attribute__((visibility("default"))) int NNCoreMain(
    int argc,
    const char** argv) {
  return ChromeMain(argc, argv);
}

// --- NNCoreEngine -----------------------------------------------------------------------

@implementation NNCoreEngine

+ (int)runWithArgc:(int)argc
              argv:(const char**)argv
          delegate:(id<NNCoreEngineDelegate>)delegate {
  bool is_browser = true;
  for (int i = 1; i < argc; ++i) {
    if (strncmp(argv[i], "--type=", 7) == 0) {
      is_browser = false;
    }
  }
  if (!is_browser) {
    return ChromeMain(argc, argv);
  }

  g_delegate = delegate;
  g_engine = [[NNCoreEngine alloc] init];
  nncore::SetEngineCallbacks({
      .started = base::BindOnce([] { [g_delegate engineDidStart]; }),
      .shutting_down = base::BindOnce([] {
        // Before Chrome tears profiles down: a popup's host keeps its extension's
        // renderer alive.
        CurrentPopup().reset();
        if ([g_delegate respondsToSelector:@selector(engineWillShutDown)]) {
          [g_delegate engineWillShutDown];
        }
      }),
  });

  // The host owns every window: Chrome opens none at startup and never restores its own.
  std::vector<const char*> args(argv, argv + argc);
  args.push_back("--no-startup-window");
  args.push_back("--no-first-run");
  args.push_back("--no-default-browser-check");
  int rv = ChromeMain(static_cast<int>(args.size()), args.data());
  g_delegate = nil;
  return rv;
}

+ (NNCoreEngine*)sharedEngine {
  return g_engine;
}

- (NNCoreProfile*)defaultProfile {
  Profile* profile = ProfileManager::GetLastUsedProfileIfLoaded();
  return profile ? [NNCoreProfile wrapperFor:profile] : nil;
}

- (void)loadProfile:(NSString*)directoryName
         completion:(void (^)(NNCoreProfile*))completion {
  ProfileManager* manager = g_browser_process->profile_manager();
  base::FilePath path =
      manager->user_data_dir().Append(base::SysNSStringToUTF8(directoryName));
  manager->CreateProfileAsync(
      path, base::BindOnce(
                [](void (^completion)(NNCoreProfile*), Profile* profile) {
                  completion(profile ? [NNCoreProfile wrapperFor:profile]
                                     : nil);
                },
                completion));
}

- (void)quit {
  nncore::QuitEngine();
}

- (NSString*)keepAliveState {
  std::ostringstream out;
  out << *KeepAliveRegistry::GetInstance()
      << " trying_to_quit=" << browser_shutdown::IsTryingToQuit();
  return NS(out.str());
}

- (NSString*)chromiumVersion {
  return NS(std::string(version_info::GetVersionNumber()));
}

@end

// --- NNCoreProfile ----------------------------------------------------------------------

@implementation NNCoreProfile {
  raw_ptr<Profile> _profile;
}

+ (NNCoreProfile*)wrapperFor:(Profile*)profile {
  NNCoreProfile* __strong& wrapper = ProfileWrappers()[profile];
  if (!wrapper) {
    wrapper = [[NNCoreProfile alloc] init];
    wrapper->_profile = profile;
  }
  return wrapper;
}

- (Profile*)chromeProfile {
  return _profile;
}

- (NSString*)name {
  return NS(_profile->GetBaseName().value());
}

- (NSString*)path {
  return NS(_profile->GetPath().value());
}

- (void)loadUnpackedExtension:(NSString*)path
                   completion:(void (^)(NSString*, NSString*))completion {
  // Chrome keeps unpacked extensions disabled unless the profile is in developer mode
  // (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION); loading one is that mode's flow.
  extensions::util::SetDeveloperModeForProfile(_profile, true);
  scoped_refptr<extensions::UnpackedInstaller> installer =
      extensions::UnpackedInstaller::Create(_profile);
  installer->set_be_noisy_on_failure(false);
  installer->set_completion_callback(base::BindOnce(
      [](void (^completion)(NSString*, NSString*),
         const extensions::Extension* extension, const base::FilePath&,
         const std::u16string& error) {
        completion(extension ? NS(extension->id()) : nil,
                   error.empty() ? nil : NS(error));
      },
      completion));
  installer->Load(base::FilePath(base::SysNSStringToUTF8(path)));
}

- (NSArray<NSDictionary<NSString*, id>*>*)extensions {
  NSMutableArray* list = [NSMutableArray array];
  auto* registry = extensions::ExtensionRegistry::Get(_profile);
  auto* actions = extensions::ExtensionActionManager::Get(_profile);
  for (const auto& extension : registry->enabled_extensions()) {
    extensions::ExtensionAction* action =
        actions->GetExtensionAction(*extension);
    [list addObject:@{
      @"id" : NS(extension->id()),
      @"name" : NS(extension->name()),
      @"version" : NS(extension->VersionString()),
      @"enabled" : @YES,
      @"actionPopupURL" :
          action ? NS(action->GetPopupUrl(extensions::ExtensionAction::kDefaultTabId)
                          .spec())
                 : @"",
    }];
  }
  return list;
}

- (void)fetchSavedLogins:
    (void (^)(NSArray<NSDictionary<NSString*, NSString*>*>*))completion {
  scoped_refptr<password_manager::PasswordStoreInterface> store =
      ProfilePasswordStoreFactory::GetForProfile(
          _profile, ServiceAccessType::EXPLICIT_ACCESS);
  if (!store) {
    completion(@[]);
    return;
  }
  auto* fetcher = new LoginsFetcher(completion);
  store->GetAllLogins(fetcher->GetWeakPtr());
}

@end

// --- NNCoreWindow -----------------------------------------------------------------------

@implementation NNCoreWindow {
  std::unique_ptr<nncore::WindowHost> _host;
}

@synthesize delegate = _delegate;

- (instancetype)initWithContentRect:(NSRect)rect {
  if ((self = [super init])) {
    _host = std::make_unique<nncore::WindowHost>(self,
                                                 gfx::ScreenRectFromNSRect(rect));
  }
  return self;
}

- (nncore::WindowHost*)host {
  return _host.get();
}

- (NSWindow*)window {
  return _host->ns_window();
}

- (NSView*)hostView {
  return _host->host_view();
}

- (NNCoreTab*)openTab:(NSString*)url
              profile:(NNCoreProfile*)profile
           foreground:(BOOL)foreground {
  Browser* browser = _host->BrowserFor(profile.chromeProfile);
  if (!browser) {
    return nil;
  }
  NavigateParams params(browser, GURL(base::SysNSStringToUTF8(url)),
                        ui::PAGE_TRANSITION_TYPED);
  params.disposition = foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                                  : WindowOpenDisposition::NEW_BACKGROUND_TAB;
  params.window_action = NavigateParams::WindowAction::kNoAction;
  Navigate(&params);
  content::WebContents* contents = params.navigated_or_inserted_contents;
  return contents ? nncore::TabBridge::GetOrCreate(contents)->tab() : nil;
}

- (NNCoreProfile*)activeProfile {
  Profile* profile = _host->active_profile();
  return profile ? [NNCoreProfile wrapperFor:profile] : nil;
}

- (void)setActiveProfile:(NNCoreProfile*)profile {
  if (profile) {
    _host->BrowserFor(profile.chromeProfile);
    _host->SetActiveProfile(profile.chromeProfile);
  }
}

- (void)activateTab:(NNCoreTab*)tab {
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser) {
    return;
  }
  _host->SetActiveProfile(browser->GetProfile());
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab && index != model->active_index()) {
    model->ActivateTabAt(index);
  }
}

- (NSArray<NNCoreTab*>*)tabsForProfile:(NNCoreProfile*)profile {
  NSMutableArray* tabs = [NSMutableArray array];
  Browser* browser = _host->ExistingBrowserFor(profile.chromeProfile);
  if (!browser) {
    return tabs;
  }
  TabStripModel* model = browser->GetTabStripModel();
  for (int i = 0; i < model->count(); ++i) {
    [tabs addObject:nncore::TabBridge::GetOrCreate(model->GetWebContentsAt(i))
                        ->tab()];
  }
  return tabs;
}

- (int)chromeWindowIdForProfile:(NNCoreProfile*)profile {
  Browser* browser = _host->ExistingBrowserFor(profile.chromeProfile);
  return browser ? browser->GetSessionID().id() : -1;
}

- (BOOL)executeChromeCommand:(int)commandId profile:(NNCoreProfile*)profile {
  Browser* browser = _host->ExistingBrowserFor(profile.chromeProfile);
  return browser && chrome::ExecuteCommand(browser, commandId);
}

- (void)showInactive {
  _host->ShowInactive();
}

- (void)close {
  _host->Close();
}

@end

// --- NNCoreTab --------------------------------------------------------------------------

@implementation NNCoreTab {
  raw_ptr<content::WebContents> _contents;
}

@synthesize delegate = _delegate;

- (instancetype)initWithContents:(content::WebContents*)contents {
  if ((self = [super init])) {
    _contents = contents;
  }
  return self;
}

- (content::WebContents*)contents {
  return _contents;
}

- (void)contentsDestroyed {
  _contents = nullptr;
}

- (void)notify:(SEL)selector {
  id<NNCoreTabDelegate> delegate = _delegate;
  if ([delegate respondsToSelector:selector]) {
    [delegate performSelector:selector withObject:self];
  }
}

- (BOOL)closed {
  return !_contents;
}

- (NSView*)view {
  return _contents ? _contents->GetNativeView().GetNativeNSView() : nil;
}

- (NNCoreProfile*)profile {
  return _contents ? [NNCoreProfile
                         wrapperFor:Profile::FromBrowserContext(
                                        _contents->GetBrowserContext())]
                   : nil;
}

- (int)tabId {
  return _contents ? sessions::SessionTabHelper::IdForTab(_contents).id() : -1;
}

- (NSString*)url {
  return _contents ? NS(_contents->GetVisibleURL().spec()) : @"";
}

- (NSString*)title {
  return _contents ? NS(_contents->GetTitle()) : @"";
}

- (BOOL)loading {
  return _contents && _contents->IsLoading();
}

- (double)progress {
  return _contents ? _contents->GetLoadProgress() : 0;
}

- (NSImage*)favicon {
  if (!_contents) {
    return nil;
  }
  auto* driver = favicon::ContentFaviconDriver::FromWebContents(_contents);
  if (!driver || !driver->FaviconIsValid()) {
    return nil;
  }
  gfx::Image image = driver->GetFavicon();
  return image.IsEmpty() ? nil : image.ToNSImage();
}

- (BOOL)canGoBack {
  return _contents && _contents->GetController().CanGoBack();
}

- (BOOL)canGoForward {
  return _contents && _contents->GetController().CanGoForward();
}

- (void)loadURL:(NSString*)url {
  if (_contents) {
    _contents->GetController().LoadURL(GURL(base::SysNSStringToUTF8(url)),
                                       content::Referrer(),
                                       ui::PAGE_TRANSITION_TYPED, std::string());
  }
}

- (void)focus {
  if (_contents) {
    _contents->Focus();
  }
}

- (void)find:(NSString*)text forward:(BOOL)forward {
  if (!_contents) {
    return;
  }
  nncore::TabBridge::GetOrCreate(_contents)->EnsureFindObserved();
  if (auto* helper = find_in_page::FindTabHelper::FromWebContents(_contents)) {
    helper->StartFinding(base::SysNSStringToUTF16(text), forward,
                         /*case_sensitive=*/false, /*find_match=*/true);
  }
}

- (void)stopFinding {
  if (!_contents) {
    return;
  }
  if (auto* helper = find_in_page::FindTabHelper::FromWebContents(_contents)) {
    helper->StopFinding(find_in_page::SelectionAction::kKeep);
  }
}

- (void)goBack {
  if (self.canGoBack) {
    _contents->GetController().GoBack();
  }
}

- (void)goForward {
  if (self.canGoForward) {
    _contents->GetController().GoForward();
  }
}

- (void)reload {
  if (_contents) {
    _contents->GetController().Reload(content::ReloadType::NORMAL, true);
  }
}

- (void)stop {
  if (_contents) {
    _contents->Stop();
  }
}

- (void)close {
  if (!_contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return;
  }
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(_contents);
  if (index != TabStripModel::kNoTab) {
    model->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE |
                                         TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  }
}

- (void)showDevTools {
  if (_contents) {
    DevToolsWindow::OpenDevToolsWindow(_contents, DevToolsToggleAction::Show(),
                                       DevToolsOpenedByAction::kUnknown);
  }
}

- (void)closeDevTools {
  if (!_contents) {
    return;
  }
  if (content::WebContents* devtools =
          DevToolsWindow::GetInTabWebContents(_contents, nullptr)) {
    devtools->ClosePage();
  }
}

- (NSView*)devToolsView {
  if (!_contents) {
    return nil;
  }
  content::WebContents* devtools =
      DevToolsWindow::GetInTabWebContents(_contents, nullptr);
  return devtools ? devtools->GetNativeView().GetNativeNSView() : nil;
}

- (void)devToolsLayoutForSize:(NSSize)size
                     devTools:(NSRect*)devToolsFrame
                         page:(NSRect*)pageFrame {
  DevToolsContentsResizingStrategy strategy;
  gfx::Rect devtools_bounds, page_bounds;
  gfx::Rect container(0, 0, size.width, size.height);
  if (_contents && DevToolsWindow::GetInTabWebContents(_contents, &strategy)) {
    ApplyDevToolsContentsResizingStrategy(strategy, container, &devtools_bounds,
                                          &page_bounds);
  } else {
    page_bounds = container;
  }
  if (devToolsFrame) {
    *devToolsFrame = devtools_bounds.ToCGRect();
  }
  if (pageFrame) {
    *pageFrame = page_bounds.ToCGRect();
  }
}

- (void)savePendingPassword {
  if (!_contents) {
    return;
  }
  base::WeakPtr<PasswordsModelDelegate> model =
      PasswordsModelDelegateFromWebContents(_contents);
  if (model &&
      model->GetState() == password_manager::ui::PENDING_PASSWORD_STATE) {
    const password_manager::PasswordForm& form = model->GetPendingPassword();
    model->SavePassword(form.username_value, form.password_value);
  }
}

- (void)dismissPendingPassword {
  if (!_contents) {
    return;
  }
  base::WeakPtr<PasswordsModelDelegate> model =
      PasswordsModelDelegateFromWebContents(_contents);
  if (model) {
    model->OnBubbleHidden();
  }
}

- (BOOL)openActionPopupForExtension:(NSString*)extensionId anchor:(NSRect)anchor {
  if (!_contents) {
    return NO;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  Profile* profile = Profile::FromBrowserContext(_contents->GetBrowserContext());
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(profile)->enabled_extensions().GetByID(
          base::SysNSStringToUTF8(extensionId));
  if (!browser || !extension) {
    return NO;
  }
  extensions::ExtensionAction* action =
      extensions::ExtensionActionManager::Get(profile)->GetExtensionAction(
          *extension);
  if (!action) {
    return NO;
  }
  GURL popup_url = action->GetPopupUrl(self.tabId);
  if (popup_url.is_empty()) {
    return NO;
  }
  std::unique_ptr<extensions::ExtensionViewHost> host =
      extensions::ExtensionViewHostFactory::CreatePopupHost(*extension,
                                                            popup_url, browser);
  if (!host) {
    return NO;
  }
  NSWindow* parent = _contents->GetTopLevelNativeWindow().GetNativeNSWindow();
  CurrentPopup() = std::make_unique<ActionPopup>(std::move(host), parent, anchor);
  return YES;
}

@end
