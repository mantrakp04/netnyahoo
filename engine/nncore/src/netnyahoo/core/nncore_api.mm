// The ObjC API (public/NNCore.h) over NNCore's Chromium-side model.

#import "netnyahoo/core/public/NNCore.h"

#include <map>
#include <sstream>
#include <memory>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/task/thread_pool.h"
#include "content/public/browser/browser_thread.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "base/metrics/user_metrics.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/devtools/devtools_toggle_action.h"
#include "chrome/browser/ui/tab_contents/core_tab_helper.h"
#include "chrome/common/content_restriction.h"
#include "chrome/common/pref_names.h"
#include "content/public/common/url_utils.h"
#include "components/policy/core/common/policy_pref_names.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "pdf/buildflags.h"
#include "printing/buildflags/buildflags.h"
#if BUILDFLAG(ENABLE_PDF)
#include "chrome/browser/pdf/pdf_extension_util.h"
#include "pdf/pdf_features.h"
#endif
#if BUILDFLAG(ENABLE_PRINTING)
#include "chrome/browser/printing/print_view_manager_common.h"
#endif
#if BUILDFLAG(ENABLE_PRINT_PREVIEW)
#include "chrome/browser/printing/print_preview_dialog_controller.h"
#endif
#include "chrome/browser/extensions/extension_util.h"
#include "chrome/browser/extensions/extension_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "components/keep_alive_registry/keep_alive_registry.h"
#include "chrome/browser/password_manager/factories/profile_password_store_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "content/public/browser/browsing_data_remover.h"
#include "components/prefs/pref_service.h"
#include "base/scoped_observation.h"
#include "base/supports_user_data.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_commands.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_features.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
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
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/unpacked_installer.h"
#include "extensions/common/extension.h"
#include "netnyahoo/core/nn_autofill_prompt.h"
#include "netnyahoo/core/nn_browser.h"
#include "netnyahoo/core/nn_extension_view.h"
#include "netnyahoo/core/nn_installed_bubble.h"
#include "netnyahoo/core/nn_lifetime.h"
#include "netnyahoo/core/nn_main_delegate.h"
#include "netnyahoo/core/nn_navigation_hold.h"
#include "netnyahoo/core/nn_page_channel.h"
#include "netnyahoo/core/nn_password_prompt.h"
#include "netnyahoo/core/nn_tab_info.h"
#include "netnyahoo/core/nn_permissions.h"
#include "chrome/browser/ui/tab_sharing/tab_sharing_infobar_delegate.h"
#include "components/infobars/content/content_infobar_manager.h"
#include "components/infobars/core/infobar.h"
#include "chrome/browser/ui/browser_window/public/desktop_browser_window_capabilities.h"
#include "base/pickle.h"
#include "chrome/browser/ui/browser_tabrestore.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/serialized_user_agent_override.h"
#include "netnyahoo/core/nn_device_chooser.h"
#include "netnyahoo/core/nn_cast_dialog.h"
#include "netnyahoo/core/nn_context_menu.h"
#include "netnyahoo/core/nn_desktop_capture.h"
#include "netnyahoo/core/nn_devtools_call.h"
#include "netnyahoo/core/nn_host_visibility.h"
#include "netnyahoo/core/nn_picture_in_picture.h"
#include "netnyahoo/core/nn_autofill_trigger.h"
#include "base/trace_event/trace_config.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/tracing_controller.h"
#include "content/public/browser/web_contents_media_capture_id.h"
#include "extensions/browser/install_prompt_data.h"
#include "chrome/browser/profiles/delete_profile_helper.h"
#include "chrome/browser/profiles/nuke_profile_directory_utils.h"
#include "chrome/browser/profiles/profile_destroyer.h"
#include "chrome/browser/profiles/profile_metrics.h"
#include "chrome/browser/extensions/component_loader.h"
#include "extensions/common/manifest.h"
#include "extensions/common/mojom/manifest.mojom-shared.h"
#include "netnyahoo/core/nn_external_apps.h"
#include "base/base64.h"
#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "chrome/browser/resource_coordinator/lifecycle_unit_state.mojom.h"
#include "chrome/browser/resource_coordinator/tab_lifecycle_unit_external.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#include "base/auto_reset.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "chrome/browser/apps/platform_apps/shortcut_manager.h"
#include "base/strings/string_number_conversions.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/zoom/page_zoom.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/common/page_zoom.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_model.h"
#include "third_party/skia/include/core/SkColor.h"
#include <algorithm>
#include <optional>
#import "netnyahoo/core/nncore_internal.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/mac/coordinate_conversion.h"

extern "C" int ChromeMain(int argc, const char** argv);

@interface NNCoreProfile (Lifetime)
- (void)profileWillBeDestroyed;
@end

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
      void (^completion)(NSArray<NSDictionary<NSString*, id>*>*))
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
          @"passwordLength" : @(login.password_value.size()),
          @"blocked" : @(login.blocked_by_user),
          @"federation" : login.federation_origin.IsValid()
              ? NS(login.federation_origin.Serialize())
              : @"",
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
  void (^completion_)(NSArray<NSDictionary<NSString*, id>*>*);
  base::WeakPtrFactory<LoginsFetcher> weak_factory_{this};
};

// Tells a profile's wrapper when its Profile goes.
class ProfileGoneObserver : public ProfileObserver {
 public:
  ProfileGoneObserver(Profile* profile, NNCoreProfile* wrapper)
      : wrapper_(wrapper) {
    observation_.Observe(profile);
  }
  void OnProfileWillBeDestroyed(Profile* profile) override {
    observation_.Reset();
    nncore::NoteProfileDying(profile);
    // May destroy this.
    [wrapper_ profileWillBeDestroyed];
  }

 private:
  __weak NNCoreProfile* wrapper_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

// "#rrggbb", or null for a transparent colour (NNChromeUI.mm HexColor).
id HexColor(SkColor color) {
  if (!SkColorGetA(color)) {
    return NSNull.null;
  }
  return [NSString stringWithFormat:@"#%02x%02x%02x", SkColorGetR(color),
                                    SkColorGetG(color), SkColorGetB(color)];
}

// A data: URL of the image's 2x PNG (the toolbar draws on Retina screens), as CEF's.
NSString* PngDataURL(const gfx::Image& image) {
  if (image.IsEmpty()) {
    return @"";
  }
  const gfx::ImageSkiaRep& rep = image.ToImageSkia()->GetRepresentation(2.0f);
  std::optional<std::vector<uint8_t>> png = gfx::PNGCodec::EncodeBGRASkBitmap(
      rep.GetBitmap(), /*discard_transparency=*/false);
  if (!png) {
    return @"";
  }
  return NS("data:image/png;base64," + base::Base64Encode(*png));
}

// Chrome's automatic Picture in Picture (AutoPictureInPictureTabHelper: a page that handles
// Media Session's "enterpictureinpicture" and uses the camera or microphone, a Meet call, pops
// out its own document PiP window on a tab switch, as in Chrome and Dia) follows the app's
// autoPictureInPicture setting: allowed without Chrome's prompt when on, blocked when off.
bool g_auto_picture_in_picture = true;

void ApplyAutoPictureInPicture(Profile* profile) {
  HostContentSettingsMapFactory::GetForProfile(profile)->SetDefaultContentSetting(
      ContentSettingsType::AUTO_PICTURE_IN_PICTURE,
      g_auto_picture_in_picture ? CONTENT_SETTING_ALLOW : CONTENT_SETTING_BLOCK);
}

// Prefs CEF set on every profile it loaded (packages/cef/ios/NNEngine.mm WhenProfileReady):
// a new session starts on a new tab, and the download bubble doesn't open by itself.
void PrepareProfilePrefs(Profile* profile) {
  if (!profile || profile->IsOffTheRecord()) {
    return;
  }
  PrefService* prefs = profile->GetPrefs();
  if (prefs->FindPreference("session.restore_on_startup")) {
    prefs->SetInteger("session.restore_on_startup", 5);
  }
  if (prefs->FindPreference("download_bubble.partial_view_enabled")) {
    prefs->SetBoolean("download_bubble.partial_view_enabled", false);
  }
  ApplyAutoPictureInPicture(profile);
}

class ProfilePrefsApplier : public ProfileManagerObserver {
 public:
  explicit ProfilePrefsApplier(ProfileManager* manager) {
    observation_.Observe(manager);
  }
  void OnProfileAdded(Profile* profile) override { PrepareProfilePrefs(profile); }
  // (g_browser_process->profile_manager() is already null here: it is being destroyed.)
  void OnProfileManagerDestroying() override { observation_.Reset(); }

 private:
  base::ScopedObservation<ProfileManager, ProfileManagerObserver> observation_{this};
};

void StartApplyingProfilePrefs() {
  ProfileManager* manager = g_browser_process->profile_manager();
  for (Profile* profile : manager->GetLoadedProfiles()) {
    PrepareProfilePrefs(profile);
  }
  static base::NoDestructor<ProfilePrefsApplier> applier(manager);
}

// The prefs the host may read and write (NNCoreProfile boolPreference:).
bool IsHostPreference(const std::string& name) {
  static const char* const kAllowed[] = {
      "credentials_enable_service", "autofill.profile_enabled",
      "autofill.credit_card_enabled", "download_bubble.partial_view_enabled"};
  for (const char* allowed : kAllowed) {
    if (name == allowed) {
      return true;
    }
  }
  return false;
}

// One BrowsingDataRemover task; deletes itself when it reports.
class BrowsingDataDone : public content::BrowsingDataRemover::Observer {
 public:
  BrowsingDataDone(content::BrowsingDataRemover* remover, void (^completion)(void))
      : completion_(completion) {
    observation_.Observe(remover);
  }
  void OnBrowsingDataRemoverDone(uint64_t failed_data_types) override {
    if (completion_) {
      completion_();
    }
    delete this;
  }

 private:
  void (^completion_)(void);
  base::ScopedObservation<content::BrowsingDataRemover,
                          content::BrowsingDataRemover::Observer>
      observation_{this};
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

// The window-creation hook in Chrome's Browser constructor (engine/nncore/apply.sh).
extern BrowserWindow* (*g_netnyahoo_browser_window_factory)(Browser*);
// HistoryTabHelper's eligibility hook (engine/nncore/apply.sh).
extern bool (*g_netnyahoo_history_eligible)(content::WebContents*);

namespace {

const char* BrowserTypeName(BrowserWindowInterface::Type type) {
  switch (type) {
    case BrowserWindowInterface::TYPE_NORMAL:
      return "normal";
    case BrowserWindowInterface::TYPE_POPUP:
      return "popup";
    case BrowserWindowInterface::TYPE_DEVTOOLS:
      return "devtools";
    case BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE:
      return "picture_in_picture";
    default:
      return "app";
  }
}

// A Browser Chrome makes itself (chrome.windows.create, an incognito window from a Chrome
// command, undocked DevTools, document PiP): the host may hold it in one of its windows.
BrowserWindow* WindowForChromeBrowser(Browser* browser) {
  nncore::NNBrowserDelegate* delegate = nncore::DelegateFor(browser);
  // A document picture-in-picture window is always Chrome's own: Chrome reaches into its
  // PictureInPictureBrowserFrameView (content_settings::UpdateLocationBarUiForWebContents
  // on every commit), which a window of ours doesn't have.
  if (!delegate || delegate->is_ours() ||
      browser->GetType() == BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE ||
      ![g_delegate respondsToSelector:@selector
                   (engineWindowForNewBrowserOfProfile:type:)]) {
    return nullptr;
  }
  NNCoreWindow* window = [g_delegate
      engineWindowForNewBrowserOfProfile:[NNCoreProfile
                                             wrapperFor:browser->GetProfile()]
                                    type:@(BrowserTypeName(browser->GetType()))];
  nncore::WindowHost* host = window.host;
  return host ? host->HostChromeBrowser(browser) : nullptr;
}

}  // namespace

namespace nncore {

namespace {
std::vector<base::WeakPtr<Profile>>& DyingProfiles() {
  static base::NoDestructor<std::vector<base::WeakPtr<Profile>>> dying;
  return *dying;
}
}  // namespace

void NoteProfileDying(Profile* profile) {
  if (profile && !IsProfileDying(profile)) {
    DyingProfiles().push_back(profile->GetWeakPtr());
  }
}

bool IsProfileDying(const Profile* profile) {
  std::erase_if(DyingProfiles(), [](const base::WeakPtr<Profile>& p) { return !p; });
  return profile && std::ranges::any_of(DyingProfiles(), [&](const base::WeakPtr<Profile>& p) {
           return p.get() == profile;
         });
}

namespace {
// Rides on a dying profile as its user data, so it goes with the Profile itself: then whoever
// waited for it to be gone goes on (a turn later, out of Chrome's teardown).
class GoneNotifier : public base::SupportsUserData::Data {
 public:
  static const void* Key() {
    static const int key = 0;
    return &key;
  }
  ~GoneNotifier() override {
    for (base::OnceClosure& waiter : waiters_) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, std::move(waiter));
    }
  }
  void Add(base::OnceClosure waiter) { waiters_.push_back(std::move(waiter)); }

 private:
  std::vector<base::OnceClosure> waiters_;
};

void WhenProfileGone(Profile* profile, base::OnceClosure done) {
  auto* notifier = static_cast<GoneNotifier*>(profile->GetUserData(GoneNotifier::Key()));
  if (!notifier) {
    auto owned = std::make_unique<GoneNotifier>();
    notifier = owned.get();
    profile->SetUserData(GoneNotifier::Key(), std::move(owned));
  }
  notifier->Add(std::move(done));
}
}  // namespace

namespace {
std::vector<base::WeakPtr<Profile>>& DeletingProfiles() {
  static base::NoDestructor<std::vector<base::WeakPtr<Profile>>> deleting;
  return *deleting;
}
}  // namespace

void NoteProfileDeleting(Profile* profile) {
  if (profile && !IsProfileDeleting(profile)) {
    DeletingProfiles().push_back(profile->GetWeakPtr());
  }
}

bool IsProfileDeleting(const Profile* profile) {
  std::erase_if(DeletingProfiles(), [](const base::WeakPtr<Profile>& p) { return !p; });
  return profile && std::ranges::any_of(DeletingProfiles(), [&](const base::WeakPtr<Profile>& p) {
           return p.get() == profile;
         });
}

void HostPermissionRequest(content::WebContents* contents, NSDictionary* request) {
  if ([g_delegate respondsToSelector:@selector(engine:permissionRequest:tab:)]) {
    [g_delegate engine:g_engine
        permissionRequest:request
                      tab:TabBridge::GetOrCreate(contents)->tab()];
  }
}

namespace {

std::string InstallPromptTypeName(extensions::InstallPromptData::PromptType type) {
  switch (type) {
    case extensions::InstallPromptData::INSTALL_PROMPT:
      return "install";
    case extensions::InstallPromptData::RE_ENABLE_PROMPT:
      return "re-enable";
    case extensions::InstallPromptData::PERMISSIONS_PROMPT:
      return "permissions";
    case extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT:
      return "external";
    case extensions::InstallPromptData::REMOTE_INSTALL_PROMPT:
      return "remote";
    case extensions::InstallPromptData::REPAIR_PROMPT:
      return "repair";
    default:
      return "other";
  }
}

using InstallDone = extensions::ExtensionInstallPromptClient::DoneCallback;

struct PendingInstall {
  InstallDone done;
  base::WeakPtr<Profile> profile;
};

std::map<std::string, PendingInstall>& InstallPrompts() {
  static base::NoDestructor<std::map<std::string, PendingInstall>> prompts;
  return *prompts;
}

}  // namespace

bool HostExtensionInstallPrompt(Profile* profile,
                                content::WebContents* parent,
                                const extensions::InstallPromptData& prompt,
                                InstallDone* done_callback) {
  const extensions::Extension* extension = prompt.extension();
  if (!extension || !done_callback || done_callback->is_null() ||
      ![g_delegate respondsToSelector:@selector(engine:extensionInstallPrompt:tab:)]) {
    return false;
  }
  static int last_id = 0;
  const std::string request_id = "install" + std::to_string(++last_id);
  NSMutableArray* permissions = [NSMutableArray array];
  for (size_t i = 0; i < prompt.GetPermissionCount(); ++i) {
    [permissions addObject:NS(prompt.GetPermission(i))];
  }
  NSString* icon = @"";
  if (!prompt.icon().IsEmpty()) {
    if (auto png = prompt.icon().As1xPNGBytes(); png && png->size()) {
      icon = NS("data:image/png;base64," +
                base::Base64Encode(base::span<const uint8_t>(*png)));
    }
  }
  // JS ExtensionInstallPrompt without browserId (the host knows the tab).
  NSDictionary* payload = @{
    @"requestId" : NS(request_id),
    @"profile" : NS(profile->GetOriginalProfile()->GetBaseName().value()),
    @"id" : NS(extension->id()),
    @"name" : NS(extension->name()),
    @"version" : NS(extension->VersionString()),
    @"type" : NS(InstallPromptTypeName(prompt.type())),
    @"icon" : icon,
    @"permissions" : permissions,
  };
  InstallPrompts()[request_id] = {std::move(*done_callback), profile->GetWeakPtr()};
  NNCoreTab* tab = parent ? TabBridge::GetOrCreate(parent)->tab() : nil;
  // Not from inside Chrome's prompt: the host may answer at once.
  dispatch_async(dispatch_get_main_queue(), ^{
    [g_delegate engine:g_engine extensionInstallPrompt:payload tab:tab];
  });
  return true;
}

void ResolveExtensionInstallPrompt(const std::string& request_id, bool accepted) {
  auto it = InstallPrompts().find(request_id);
  if (it == InstallPrompts().end()) {
    return;
  }
  PendingInstall pending = std::move(it->second);
  InstallPrompts().erase(it);
  // The profile went (shutdown, deletion): Chrome's dialog would have been cancelled.
  if (!pending.profile) {
    return;
  }
  InstallDone done = std::move(pending.done);
  using Payload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
  using Result = extensions::ExtensionInstallPromptClient::Result;
  std::move(done).Run(Payload(accepted ? Result::ACCEPTED : Result::USER_CANCELED));
}

void HostCastRoutes(Profile* profile, NSArray* routes) {
  if ([g_delegate respondsToSelector:@selector(engine:castRoutes:profile:)]) {
    [g_delegate engine:g_engine castRoutes:routes profile:[NNCoreProfile wrapperFor:profile]];
  }
}

bool HostWantsCastDialogs() {
  return [g_delegate respondsToSelector:@selector(engine:castDialog:tab:)];
}

void HostCastDialog(content::WebContents* contents, NSDictionary* state) {
  if (HostWantsCastDialogs()) {
    [g_delegate engine:g_engine castDialog:state tab:TabBridge::GetOrCreate(contents)->tab()];
  }
}

bool HostWantsDeviceChoosers() {
  return [g_delegate respondsToSelector:@selector(engine:deviceChooser:tab:)];
}

void HostDeviceChooser(content::WebContents* contents, NSDictionary* state) {
  if (HostWantsDeviceChoosers()) {
    [g_delegate engine:g_engine
         deviceChooser:state
                   tab:TabBridge::GetOrCreate(contents)->tab()];
  }
}

bool HostExtensionSidePanel(content::WebContents* contents,
                            const std::string& extension_id,
                            bool open) {
  if (![g_delegate respondsToSelector:@selector(engine:extensionSidePanel:tab:)]) {
    return false;
  }
  [g_delegate engine:g_engine
      extensionSidePanel:@{@"extensionId" : NS(extension_id), @"open" : @(open)}
                     tab:TabBridge::GetOrCreate(contents)->tab()];
  return true;
}

bool HostExtensionActionPopup(content::WebContents* contents,
                              const std::string& extension_id) {
  if (![g_delegate respondsToSelector:@selector(engine:extensionActionPopup:tab:)]) {
    return false;
  }
  return [g_delegate engine:g_engine
       extensionActionPopup:@{@"extensionId" : NS(extension_id)}
                        tab:TabBridge::GetOrCreate(contents)->tab()];
}

void HostPermissionRequestDismissed(NSString* request_id) {
  if ([g_delegate respondsToSelector:@selector(engine:permissionRequestDismissed:)]) {
    [g_delegate engine:g_engine permissionRequestDismissed:request_id];
  }
}

}  // namespace nncore

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
  g_netnyahoo_browser_window_factory = &WindowForChromeBrowser;
  nncore::InstallRuleMatchedHook();
  nncore::InstallExtensionInstalledHook();
  nncore::InstallActionPopupHook();
  g_netnyahoo_history_eligible = [](content::WebContents* contents) {
    BrowserWindowInterface* browser =
        GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
    nncore::WindowHost* host = browser ? nncore::WindowHost::ForBrowser(browser) : nullptr;
    return !host || !host->internal();
  };
  // No Chrome Apps or web-app shims here: Chrome's platform-app shortcut manager would
  // otherwise, when a profile is deleted, look for that profile's shims in
  // ~/Applications/"Chromium Apps.localized", and its first lookup per run rewrites that
  // folder's icon and localized name (in the user's home, outside the data dir).
  AppShortcutManager::SuppressShortcutsForTesting();
  nncore::SetLifetimeCallbacks({
      .quit_cancelled = base::BindRepeating([] {
        if ([g_delegate respondsToSelector:@selector(engineQuitCancelled)]) {
          [g_delegate engineQuitCancelled];
        }
      }),
  });
  nncore::SetEngineCallbacks({
      .started = base::BindOnce([] {
        StartApplyingProfilePrefs();
        nncore::InstallPermissionPrompts();
        nncore::StartMediaCaptureObserver();
        nncore::InstallExternalAppPrompts();
        nncore::InstallContextMenuShowHandler();
        nncore::StartPictureInPictureObserver();
        nncore::StartHostVisibility();
        [g_delegate engineDidStart];
      }),
      .shutting_down = base::BindOnce([] {
        // Before Chrome tears profiles down: a popup's host keeps its extension's
        // renderer alive.
        CurrentPopup().reset();
        nncore::CloseAllExtensionViews();
        if ([g_delegate respondsToSelector:@selector(engineWillShutDown)]) {
          [g_delegate engineWillShutDown];
        }
      }),
  });

  // The host owns every window: Chrome opens none at startup and never restores its own.
  std::vector<const char*> args(argv, argv + argc);
  // Chrome's discard keeps the tab's WebContents (and so its NNCoreTab) instead of replacing
  // it: WebContentsDiscard, merged into the host's own --enable-features.
  static std::string features = "--enable-features=WebContentsDiscard";
  bool merged = false;
  for (const char*& arg : args) {
    if (strncmp(arg, "--enable-features=", 18) == 0 && !merged) {
      features = std::string(arg) + ",WebContentsDiscard";
      arg = features.c_str();
      merged = true;
    }
  }
  if (!merged) {
    args.push_back(features.c_str());
  }
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
  // Never one being deleted: loading it again would keep it, or make its folder anew.
  Profile* loaded = manager->GetProfileByPath(path);
  if (IsProfileDirectoryMarkedForDeletion(path) ||
      (loaded && nncore::IsProfileDeleting(loaded))) {
    completion(nil);
    return;
  }
  manager->CreateProfileAsync(
      path, base::BindOnce(
                [](void (^completion)(NNCoreProfile*), Profile* profile) {
                  completion(profile && !nncore::IsProfileDeleting(profile)
                                 ? [NNCoreProfile wrapperFor:profile]
                                 : nil);
                },
                completion));
}

- (void)quit {
  nncore::QuitEngine();
}

- (NSString*)pageScript {
  const std::string& script = nncore::GetPageScript();
  return script.empty() ? nil : NS(script);
}

- (void)setPageScript:(NSString*)pageScript {
  nncore::SetPageScript(pageScript ? base::SysNSStringToUTF8(pageScript)
                                   : std::string());
}

- (void)resolvePermission:(NSString*)requestId
                   result:(NSString*)result
                 remember:(BOOL)remember {
  nncore::ResolvePermission(base::SysNSStringToUTF8(requestId),
                            base::SysNSStringToUTF8(result), remember);
}

static bool g_tracing = false;

namespace {

// One beginTracing: answered once. Chrome calls back only when tracing started; when the
// tracing service fails first (TracingControllerImpl::OnTracingFailed), it drops the
// session and keeps the callback, so the start is watched until one or the other.
// `session` is g_tracing_session at its start: endTracing or a later start supersedes it,
// and a superseded start never touches the newer session.
struct TracingStart {
  void (^completion)(BOOL);
  bool answered = false;
  int session = 0;
};

int g_tracing_session = 0;
std::weak_ptr<TracingStart>& PendingTracingStart() {
  static base::NoDestructor<std::weak_ptr<TracingStart>> pending;
  return *pending;
}

constexpr int kTracingStartChecks = 100;  // every 100 ms: 10 s

bool IsCurrent(const TracingStart& start) {
  return start.session == g_tracing_session;
}

void AnswerTracingStart(const std::shared_ptr<TracingStart>& start, bool started) {
  if (start->answered) {
    return;
  }
  start->answered = true;
  if (!started && IsCurrent(*start)) {
    g_tracing = false;
  }
  start->completion(started);
}

void WatchTracingStart(std::shared_ptr<TracingStart> start, int checks_left) {
  if (start->answered) {
    return;
  }
  if (!IsCurrent(*start)) {
    AnswerTracingStart(start, false);
    return;
  }
  content::TracingController* tracing = content::TracingController::GetInstance();
  if (!tracing->IsTracing()) {
    AnswerTracingStart(start, false);
    return;
  }
  if (checks_left == 0) {
    // Never started: given up, and stopped so a later start can't leave it running.
    AnswerTracingStart(start, false);
    tracing->StopTracing(nullptr);
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, base::BindOnce(&WatchTracingStart, std::move(start), checks_left - 1),
      base::Milliseconds(100));
}

}  // namespace

+ (void)beginTracing:(void (^)(BOOL started))completion {
  if (g_tracing) {
    completion(NO);
    return;
  }
  auto start = std::make_shared<TracingStart>();
  start->completion = completion;
  start->session = ++g_tracing_session;
  PendingTracingStart() = start;
  // Chrome's default categories, as CEF's CefBeginTracing("").
  g_tracing = content::TracingController::GetInstance()->StartTracing(
      base::trace_event::TraceConfig(),
      base::BindOnce(
          [](std::shared_ptr<TracingStart> start) {
            if (start->answered) {
              // Started after it was given up on (answered NO): not ours any more.
              if (IsCurrent(*start) && !g_tracing) {
                content::TracingController::GetInstance()->StopTracing(nullptr);
              }
              return;
            }
            AnswerTracingStart(start, true);
          },
          start));
  if (!g_tracing) {
    AnswerTracingStart(start, false);
    return;
  }
  WatchTracingStart(start, kTracingStartChecks);
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString* _Nullable path))completion {
  if (!g_tracing) {
    completion(nil);
    return;
  }
  g_tracing = false;
  // A start not answered yet never started: NO, and its watcher stands down.
  ++g_tracing_session;
  if (std::shared_ptr<TracingStart> pending = PendingTracingStart().lock()) {
    AnswerTracingStart(pending, false);
  }
  // keep: "Netnyahoo Trace <date>.json" in Downloads (as CEF's NNDiagnostics); else a
  // temporary file, deleted once written.
  NSDateFormatter* format = [[NSDateFormatter alloc] init];
  format.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  format.dateFormat = @"yyyy-MM-dd 'at' HH.mm.ss.SSS";
  NSString* folder =
      keep ? [NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory
                                                  inDomains:NSUserDomainMask]
                 .firstObject.path
           : NSTemporaryDirectory();
  [NSFileManager.defaultManager createDirectoryAtPath:folder
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  NSString* path = [folder
      stringByAppendingPathComponent:[NSString stringWithFormat:@"Netnyahoo Trace %@.json",
                                                                [format stringFromDate:NSDate.date]]];
  const bool stopped = content::TracingController::GetInstance()->StopTracing(
      content::TracingController::CreateFileEndpoint(
          base::FilePath(base::SysNSStringToUTF8(path)),
          base::BindOnce(
              [](NSString* path, BOOL keep, void (^completion)(NSString*)) {
                if (keep) {
                  completion(path);
                } else {
                  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
                  completion(nil);
                }
              },
              path, keep, completion)));
  if (!stopped) {
    completion(nil);
  }
}

+ (BOOL)isTracing {
  return g_tracing;
}

+ (void)startCasting:(int)dialogId sink:(NSString*)sinkId mode:(int)castMode {
  nncore::StartCasting(dialogId, base::SysNSStringToUTF8(sinkId), castMode);
}

+ (void)stopCasting:(int)dialogId route:(NSString*)routeId {
  nncore::StopCasting(dialogId, base::SysNSStringToUTF8(routeId));
}

+ (void)setAutoPictureInPicture:(BOOL)enabled {
  g_auto_picture_in_picture = enabled;
  for (Profile* profile : g_browser_process->profile_manager()->GetLoadedProfiles()) {
    if (!profile->IsOffTheRecord()) {
      ApplyAutoPictureInPicture(profile);
    }
  }
}

+ (void)terminateCastRoute:(NSString*)routeId {
  nncore::TerminateCastRoute(base::SysNSStringToUTF8(routeId));
}

+ (void)closeCastDialog:(int)dialogId {
  nncore::CloseCastDialog(dialogId);
}

+ (void)selectDevice:(int)chooserId index:(int)index {
  nncore::SelectDevice(chooserId, index);
}

+ (void)cancelDeviceChooser:(int)chooserId {
  nncore::CancelDeviceChooser(chooserId);
}

+ (void)refreshDeviceChooser:(int)chooserId {
  nncore::RefreshDeviceChooser(chooserId);
}

+ (void)openDeviceChooserSettings:(int)chooserId {
  nncore::OpenDeviceChooserSettings(chooserId);
}

+ (void)resolveExtensionInstallPrompt:(NSString*)requestId accepted:(BOOL)accepted {
  nncore::ResolveExtensionInstallPrompt(base::SysNSStringToUTF8(requestId), accepted);
}

- (void)deleteProfile:(NNCoreProfile*)profile completion:(void (^)(BOOL deleted))completion {
  Profile* chrome_profile = profile.chromeProfile;
  ProfileManager* manager = g_browser_process->profile_manager();
  // Not the user-data-dir's initial profile ("Default"), nor an incognito, guest or system
  // one: those aren't deleted this way. The last-used profile may be: Chrome's deletion
  // makes another one last-used first (a window's, else any other, else a new one), as its
  // profile picker does.
  if (!chrome_profile || !chrome_profile->IsRegularProfile() ||
      chrome_profile->GetPath() ==
          manager->user_data_dir().Append(ProfileManager::GetInitialProfileDir())) {
    if (completion) {
      completion(NO);
    }
    return;
  }
  // Chrome's own deletion: its Browsers close, then its directory goes (now, or at the
  // next start if something still holds it). No Browser for it from now on: one made after
  // Chrome closed the others (the content blocker's hidden page in a profile that just
  // loaded) kept the profile, and its folder, for as long as it lived.
  nncore::NoteProfileDeleting(chrome_profile);
  base::WeakPtr<Profile> weak = chrome_profile->GetWeakPtr();
  const base::FilePath path = chrome_profile->GetPath();
  manager->GetDeleteProfileHelper().MaybeScheduleProfileForDeletion(
      chrome_profile->GetPath(), base::DoNothing(),
      ProfileMetrics::DELETE_PROFILE_SETTINGS);
  // A profile Chrome loaded is kept until its first browser window opens; the host's
  // profiles may never have had one (loaded for its passwords, or deleted right after it
  // loaded), and then it never unloaded, so its folder stayed until the next launch.
  if (weak) {
    manager->ClearFirstBrowserWindowKeepAlive(weak.get());
  }
  // Chrome removes the folder once the profile is gone, but services still opening their
  // databases as it went (a profile deleted right after it loaded) make some of their
  // folders again afterwards (crbug.com/40594327): swept again a little later, while the
  // folder is still marked for deletion and nothing has the profile loaded.
  for (const base::TimeDelta delay : {base::Seconds(2), base::Seconds(10)}) {
    content::GetUIThreadTaskRunner({})->PostDelayedTask(
        FROM_HERE, base::BindOnce([](const base::FilePath& dir) {
          if (!IsProfileDirectoryMarkedForDeletion(dir) ||
              g_browser_process->profile_manager()->GetProfileByPath(dir)) {
            return;
          }
          base::ThreadPool::PostTask(
              FROM_HERE,
              {base::MayBlock(), base::TaskPriority::BEST_EFFORT,
               base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
              base::BindOnce(base::IgnoreResult(&base::DeletePathRecursively), dir));
        }, path),
        delay);
  }
  if (completion) {
    completion(YES);
  }
}

- (void)releaseProfile:(NNCoreProfile*)profile {
  // A private profile goes for good once nothing shows it (as CEF's private contexts): its
  // cookies, cache and downloads with it. A regular profile stays loaded.
  Profile* chrome_profile = profile.chromeProfile;
  if (!chrome_profile || !chrome_profile->IsOffTheRecord()) {
    return;
  }
  // Every incognito window shares it: only once none is left.
  bool in_use = false;
  GlobalBrowserCollection::GetInstance()->ForEach([&](BrowserWindowInterface* browser) {
    in_use |= browser->GetProfile() == chrome_profile &&
              !browser->capabilities()->IsAttemptingToCloseBrowser();
    return !in_use;
  });
  if (!in_use) {
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(chrome_profile);
  }
}

+ (void)allowDesktopCapture:(NSString*)sourceId
                        tab:(NNCoreTab*)tab
                      frame:(NSString*)frameId
                     origin:(NSString*)origin {
  nncore::AllowDesktopCapture(tab.contents, base::SysNSStringToUTF8(sourceId ?: @""),
                              base::SysNSStringToUTF8(frameId ?: @""),
                              base::SysNSStringToUTF8(origin ?: @""));
}

+ (NSArray<NSDictionary*>*)testExternalLaunches {
  return nncore::TestExternalLaunches();
}

+ (NSArray<NSDictionary*>*)testChooserEvents {
  return nncore::TestChooserEvents();
}

+ (void)resolveExternalApp:(NSString*)requestId open:(BOOL)open remember:(BOOL)remember {
  nncore::ResolveExternalApp(base::SysNSStringToUTF8(requestId), open, remember);
}

- (void)offTheRecordProfileFor:(NNCoreProfile*)profile
                    completion:(void (^)(NNCoreProfile*, NSString*))completion {
  Profile* original = profile.chromeProfile;
  // Never the original profile in place of a private one.
  if (!original || original->IsOffTheRecord()) {
    completion(nil, original ? @"not a regular profile" : @"the profile went");
    return;
  }
  // The last private window just closed and Chrome is destroying its profile (it waits for its
  // renderers, up to a second): a new one once it has gone.
  Profile* current = original->GetPrimaryOTRProfile(/*create_if_needed=*/false);
  if (current && nncore::IsProfileDying(current)) {
    nncore::WhenProfileGone(current, base::BindOnce(^{
                              [self offTheRecordProfileFor:profile completion:completion];
                            }));
    return;
  }
  NNCoreProfile* otr =
      [NNCoreProfile wrapperFor:original->GetPrimaryOTRProfile(/*create_if_needed=*/true)];
  completion(otr, otr ? nil : @"Chrome is destroying it");
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
  // Weak: a wrapper made after Chrome sent its destroyed notification (no observer fires
  // again) still never hands out a freed Profile.
  base::WeakPtr<Profile> _profile;
  std::unique_ptr<ProfileGoneObserver> _observer;
  NSString* __strong _name;
  NSString* __strong _path;
  BOOL _offTheRecord;
}

+ (NNCoreProfile*)wrapperFor:(Profile*)profile {
  // Never one for a profile on its way out (its destroyed notification was sent already).
  if (!profile || nncore::IsProfileDying(profile)) {
    return nil;
  }
  NNCoreProfile* __strong& wrapper = ProfileWrappers()[profile];
  if (!wrapper) {
    wrapper = [[NNCoreProfile alloc] init];
    wrapper->_profile = profile->GetWeakPtr();
    wrapper->_offTheRecord = profile->IsOffTheRecord();
    // An off-the-record profile is named after its original's directory.
    wrapper->_name = NS(profile->GetBaseName().value());
    wrapper->_path = NS(profile->GetPath().value());
    wrapper->_observer = std::make_unique<ProfileGoneObserver>(profile, wrapper);
  }
  return wrapper;
}

- (void)profileWillBeDestroyed {
  // The wrapper outlives its Profile (the host may hold it); every call is a no-op from now.
  ProfileWrappers().erase(_profile.get());
  _profile.reset();
  _observer.reset();
}

- (Profile*)chromeProfile {
  return _profile.get();
}

- (BOOL)destroyed {
  return !_profile;
}

- (BOOL)offTheRecord {
  return _offTheRecord;
}

- (NSString*)name {
  return _name;
}

- (NSString*)path {
  return _path;
}

- (void)loadUnpackedExtension:(NSString*)path
                   completion:(void (^)(NSString*, NSString*))completion {
  if (!_profile) {
    completion(nil, @"profile destroyed");
    return;
  }
  // Chrome keeps unpacked extensions disabled unless the profile is in developer mode
  // (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION); loading one is that mode's flow.
  extensions::util::SetDeveloperModeForProfile(_profile.get(), true);
  scoped_refptr<extensions::UnpackedInstaller> installer =
      extensions::UnpackedInstaller::Create(_profile.get());
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

- (NSNumber*)boolPreference:(NSString*)name {
  const std::string key = base::SysNSStringToUTF8(name);
  if (!_profile || !IsHostPreference(key)) {
    return nil;
  }
  const PrefService::Preference* pref = _profile->GetPrefs()->FindPreference(key);
  return pref && pref->GetValue()->is_bool() ? @(pref->GetValue()->GetBool()) : nil;
}

- (void)setBoolPreference:(NSString*)name value:(BOOL)value {
  const std::string key = base::SysNSStringToUTF8(name);
  if (_profile && IsHostPreference(key) &&
      _profile->GetPrefs()->FindPreference(key)) {
    _profile->GetPrefs()->SetBoolean(key, value);
  }
}

- (void)clearBrowsingData:(NSArray<NSString*>*)types
                    since:(NSDate*)since
               completion:(void (^)(void))completion {
  // The categories of Chrome's "Delete browsing data" dialog (as CEF's ClearBrowsingData).
  uint64_t mask = 0;
  for (NSString* type in types) {
    if ([type isEqualToString:@"history"]) {
      mask |= chrome_browsing_data_remover::DATA_TYPE_HISTORY;
    } else if ([type isEqualToString:@"siteData"]) {
      mask |= chrome_browsing_data_remover::DATA_TYPE_SITE_DATA;
    } else if ([type isEqualToString:@"cache"]) {
      mask |= content::BrowsingDataRemover::DATA_TYPE_CACHE;
    } else if ([type isEqualToString:@"downloads"]) {
      mask |= content::BrowsingDataRemover::DATA_TYPE_DOWNLOADS;
    }
  }
  if (!_profile || !mask) {
    if (completion) {
      completion();
    }
    return;
  }
  content::BrowsingDataRemover* remover = _profile->GetBrowsingDataRemover();
  const base::Time begin =
      since ? base::Time::FromSecondsSinceUnixEpoch(since.timeIntervalSince1970)
            : base::Time();
  remover->RemoveAndReply(begin, base::Time::Max(), mask,
                          content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB,
                          new BrowsingDataDone(remover, completion));
}

- (NSString*)loadComponentExtension:(NSString*)path {
  if (!_profile || !path.length) {
    return nil;
  }
  const base::FilePath root(base::SysNSStringToUTF8(path));
  // Already running from there: nothing to do (a reload would restart its worker).
  for (const auto& extension :
       extensions::ExtensionRegistry::Get(_profile.get())->enabled_extensions()) {
    if (extension->location() == extensions::mojom::ManifestLocation::kComponent &&
        extension->path() == root) {
      return NS(extension->id());
    }
  }
  // Chrome's component extensions (its own built-ins): the manifest's key fixes the id;
  // hidden from chrome://extensions and the user's list, as CEF's LoadComponentExtension.
  extensions::ComponentLoader* loader = extensions::ComponentLoader::Get(_profile.get());
  if (!loader) {
    return nil;
  }
  const std::string extension_id = loader->AddOrReplace(root);
  return extension_id.empty() ? nil : NS(extension_id);
}

- (void)holdNavigationsUntilRulesetsOf:(NSString*)extensionId {
  if (_profile) {
    nncore::HoldNavigationsForRulesets(_profile.get(), base::SysNSStringToUTF8(extensionId));
  }
}

- (void)releaseNavigationHold:(NSString*)reason {
  if (_profile) {
    nncore::ReleaseNavigationHold(_profile.get(), base::SysNSStringToUTF8(reason));
  }
}

- (void)unloadComponentExtension:(NSString*)extensionId {
  if (!_profile) {
    return;
  }
  if (extensions::ComponentLoader* loader = extensions::ComponentLoader::Get(_profile.get())) {
    loader->Remove(extensions::ExtensionId(base::SysNSStringToUTF8(extensionId)));
  }
}

- (void)watchCastRoutes {
  nncore::WatchCastRoutes(_profile.get());
}

- (NSArray<NSDictionary<NSString*, id>*>*)extensions {
  NSMutableArray* list = [NSMutableArray array];
  if (!_profile) {
    return list;
  }
  auto* registry = extensions::ExtensionRegistry::Get(_profile.get());
  auto* actions = extensions::ExtensionActionManager::Get(_profile.get());
  for (const auto& extension : registry->enabled_extensions()) {
    // The user's extensions: not Chrome's built-ins or the host's component ones.
    if (extensions::Manifest::IsComponentLocation(extension->location())) {
      continue;
    }
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
    (void (^)(NSArray<NSDictionary<NSString*, id>*>*))completion {
  if (!_profile) {
    completion(@[]);
    return;
  }
  scoped_refptr<password_manager::PasswordStoreInterface> store =
      ProfilePasswordStoreFactory::GetForProfile(
          _profile.get(), ServiceAccessType::EXPLICIT_ACCESS);
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
  // Reported as the host asked: Chrome makes the first tab of a Browser a foreground one,
  // and each profile has its own Browser here, so a background tab would read as shown.
  base::AutoReset<nncore::WindowHost::PendingOpen> pending(
      &_host->pending_open(), nncore::WindowHost::PendingOpen{params.disposition, nullptr});
  Navigate(&params);
  content::WebContents* contents = params.navigated_or_inserted_contents;
  return contents ? nncore::TabBridge::GetOrCreate(contents)->tab() : nil;
}

- (NNCoreTab*)openExtensionView:(NSString*)url
                        profile:(NNCoreProfile*)profile
                           kind:(NSString*)kind {
  content::WebContents* contents = nncore::OpenExtensionView(
      _host->BrowserFor(profile.chromeProfile), GURL(base::SysNSStringToUTF8(url)),
      [kind isEqualToString:@"sidePanel"] ? nncore::ExtensionViewKind::kSidePanel
                                          : nncore::ExtensionViewKind::kPopup);
  return contents ? nncore::TabBridge::GetOrCreate(contents)->tab() : nil;
}

- (NNCoreProfile*)activeProfile {
  Profile* profile = _host->active_profile();
  return profile ? [NNCoreProfile wrapperFor:profile] : nil;
}

- (void)setActiveProfile:(NNCoreProfile*)profile {
  if (profile.chromeProfile) {
    _host->BrowserFor(profile.chromeProfile);
    _host->SetActiveProfile(profile.chromeProfile);
  }
}

- (void)activateTab:(NNCoreTab*)tab {
  if (nncore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self activateTab:tab];
    });
    return;
  }
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser) {
    return;
  }
  // The strip's selection only: the profile the window shows is the host's own call
  // (setActiveProfile:), so a hidden profile's strip settling never shows that profile.
  auto focusing = nncore::TabBridge::GetOrCreate(contents)->HostFocuses();
  _host->NoteHostActivated(static_cast<Browser*>(browser));
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

- (BOOL)internal {
  return _host->internal();
}

- (void)setInternal:(BOOL)internal {
  _host->set_internal(internal);
}

- (void)showInactive {
  _host->ShowInactive();
}

- (BOOL)actedFullScreen {
  return _host->acted_fullscreen();
}

- (void)setActedFullScreen:(BOOL)acted {
  _host->set_acted_fullscreen(acted);
}

- (void)adoptTab:(NNCoreTab*)tab {
  if (nncore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self adoptTab:tab];
    });
    return;
  }
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* from =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  Browser* to = _host->BrowserFor(
      Profile::FromBrowserContext(contents->GetBrowserContext()));
  if (!from || !to || from == to) {
    return;
  }
  TabStripModel* source = from->GetTabStripModel();
  const int index = source->GetIndexOfWebContents(contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  // Chrome's tab move between windows: the tab (its WebContents, history, opener) leaves
  // one strip and enters the other; the hosts see didRemoveTab: then didInsertTab:.
  std::unique_ptr<tabs::TabModel> moved = source->DetachTabAtForInsertion(index);
  if (!moved) {
    return;
  }
  TabStripModel* target = to->GetTabStripModel();
  target->InsertDetachedTabAt(target->count(), std::move(moved),
                              AddTabTypes::ADD_NONE);
}

- (void)placeTab:(NNCoreTab*)tab index:(int)index pinned:(BOOL)pinned {
  if (nncore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self placeTab:tab index:index pinned:pinned];
    });
    return;
  }
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser || nncore::WindowHost::ForBrowser(browser) != _host.get()) {
    return;
  }
  TabStripModel* model = browser->GetTabStripModel();
  int at = model->GetIndexOfWebContents(contents);
  if (at == TabStripModel::kNoTab) {
    return;
  }
  if (model->IsTabPinned(at) != static_cast<bool>(pinned)) {
    at = model->SetTabPinned(at, pinned);
  }
  // Chrome keeps pinned tabs first; the index is clamped to the tab's side.
  const int pinned_count = model->IndexOfFirstNonPinnedTab();
  int to = std::clamp(index, 0, model->count() - 1);
  to = pinned ? std::min(to, pinned_count - 1) : std::max(to, pinned_count);
  if (to != at) {
    model->MoveWebContentsAt(at, to, /*select_after_move=*/false);
  }
}

- (NNCoreTab*)restoreTab:(NSString*)state
                 profile:(NNCoreProfile*)profile
              foreground:(BOOL)foreground {
  if (nncore::IsNotifyingTabStrip()) {
    return nil;  // Not from inside a tab-strip callback (Chrome CHECKs re-entrant inserts).
  }
  // The format of nn_tab_restore_take and CEF's GetNavigationState: base64 of a pickle of
  // version 1, the selected index, the count, then each SerializedNavigationEntry.
  std::optional<std::vector<uint8_t>> bytes =
      state ? base::Base64Decode(base::SysNSStringToUTF8(state)) : std::nullopt;
  Browser* browser = profile.chromeProfile ? _host->BrowserFor(profile.chromeProfile) : nullptr;
  if (!bytes || bytes->empty() || !browser) {
    return nil;
  }
  base::Pickle pickle = base::Pickle::WithUnownedBuffer(*bytes);
  base::PickleIterator it(pickle);
  int version = 0, selected = 0, count = 0;
  if (!it.ReadInt(&version) || version != 1 || !it.ReadInt(&selected) ||
      !it.ReadInt(&count) || count <= 0 || count > 1000) {
    return nil;
  }
  std::vector<sessions::SerializedNavigationEntry> navigations;
  for (int i = 0; i < count; ++i) {
    sessions::SerializedNavigationEntry entry;
    if (!entry.ReadFromPickle(&it)) {
      return nil;
    }
    navigations.push_back(std::move(entry));
  }
  selected = std::clamp(selected, 0, count - 1);
  // Chrome's own path for reopening a closed tab; the host's tab, reported as one it opened.
  base::AutoReset<nncore::WindowHost::PendingOpen> pending(
      &_host->pending_open(),
      nncore::WindowHost::PendingOpen{
          foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                     : WindowOpenDisposition::NEW_BACKGROUND_TAB,
          nullptr});
  content::WebContents* contents = chrome::AddRestoredTab(
      browser, navigations, browser->GetTabStripModel()->count(), selected,
      /*extension_app_id=*/std::string(), /*group=*/std::nullopt, foreground,
      /*pin=*/false, base::TimeTicks::Now(), base::Time::Now(),
      /*storage_namespace=*/nullptr, sessions::SerializedUserAgentOverride(),
      /*extra_data=*/{}, /*from_session_restore=*/false,
      /*is_active_browser=*/std::nullopt);
  return contents ? nncore::TabBridge::GetOrCreate(contents)->tab() : nil;
}

- (NNCoreTab*)duplicateTab:(NNCoreTab*)source
                   profile:(NNCoreProfile*)profile
                foreground:(BOOL)foreground {
  if (nncore::IsNotifyingTabStrip()) {
    return nil;  // Not from inside a tab-strip callback (Chrome CHECKs re-entrant inserts).
  }
  content::WebContents* contents = source.contents;
  Profile* chrome_profile = profile.chromeProfile;
  if (!contents || !chrome_profile ||
      Profile::FromBrowserContext(contents->GetBrowserContext()) != chrome_profile) {
    return nil;
  }
  Browser* browser = _host->BrowserFor(chrome_profile);
  if (!browser) {
    return nil;
  }
  // chrome::DuplicateTabAt's copy (history, scroll, form state), inserted where the host
  // places it.
  std::unique_ptr<content::WebContents> copy = contents->Clone();
  content::WebContents* raw = copy.get();
  base::AutoReset<nncore::WindowHost::PendingOpen> pending(
      &_host->pending_open(),
      nncore::WindowHost::PendingOpen{
          foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                     : WindowOpenDisposition::NEW_BACKGROUND_TAB,
          contents->GetWeakPtr()});
  TabStripModel* model = browser->GetTabStripModel();
  model->InsertWebContentsAt(model->count(), std::move(copy),
                             foreground ? AddTabTypes::ADD_ACTIVE : AddTabTypes::ADD_NONE);
  return nncore::TabBridge::GetOrCreate(raw)->tab();
}

+ (NNCoreWindow*)windowForNSWindow:(NSWindow*)window {
  nncore::WindowHost* host = nncore::WindowHost::ForNSWindow(window);
  return host ? host->owner() : nil;
}

- (void)prepareProfile:(NNCoreProfile*)profile {
  if (profile.chromeProfile) {
    _host->BrowserFor(profile.chromeProfile);
  }
}

- (void)close {
  _host->Close();
}

@end

// --- NNCoreTab --------------------------------------------------------------------------

namespace {

// Chrome's page commands (print, save, DevTools) aimed at `contents` itself, as Chrome's own
// commands are at the strip's active tab, with the checks those commands make (CanPrint,
// CanSavePage). For a tab that isn't the active one: selecting it for the command told
// extensions (tabs.onActivated), automatic Picture in Picture and permission prompts of two
// tab switches. nullopt: not one of these.
std::optional<bool> RunPageCommand(content::WebContents* contents, int command) {
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  PrefService* prefs = profile->GetPrefs();
  CoreTabHelper* core = CoreTabHelper::FromWebContents(contents);
  const int restrictions = core ? core->content_restrictions() : 0;
  switch (command) {
#if BUILDFLAG(ENABLE_PRINTING)
    case IDC_PRINT:
    case IDC_BASIC_PRINT: {
      auto* dialogs = web_modal::WebContentsModalDialogManager::FromWebContents(contents);
      const bool can_print = prefs->GetBoolean(prefs::kPrintingEnabled) && !contents->IsCrashed() &&
                             !(dialogs && dialogs->IsDialogActive()) &&
                             !(restrictions & CONTENT_RESTRICTION_PRINT);
      // The system dialog also from the page's print preview (CanBasicPrint).
      bool preview = false;
#if BUILDFLAG(ENABLE_PRINT_PREVIEW)
      auto* previews = printing::PrintPreviewDialogController::GetInstance();
      preview = previews && (previews->GetPrintPreviewForContents(contents) ||
                             previews->is_creating_print_preview_dialog());
#endif
      if (!can_print && !(command == IDC_BASIC_PRINT && preview &&
                          prefs->GetBoolean(prefs::kPrintingEnabled))) {
        return false;
      }
      if (command == IDC_PRINT) {
        printing::StartPrint(contents, prefs->GetBoolean(prefs::kPrintPreviewDisabled),
                             /*has_selection=*/false);
      } else {
        printing::StartBasicPrint(contents);
      }
      return true;
    }
#endif
    case IDC_SAVE_PAGE: {
      PrefService* local_state = g_browser_process->local_state();
      content::NavigationEntry* entry = contents->GetController().GetLastCommittedEntry();
      if ((local_state && !local_state->GetBoolean(prefs::kAllowFileSelectionDialogs)) ||
          static_cast<policy::DownloadRestriction>(
              prefs->GetInteger(policy::policy_prefs::kDownloadRestrictions)) ==
              policy::DownloadRestriction::ALL_FILES ||
          (restrictions & CONTENT_RESTRICTION_SAVE) ||
          (entry && !content::IsSavableURL(entry->GetURL()))) {
        return false;
      }
      base::RecordAction(base::UserMetricsAction("SavePage"));
#if BUILDFLAG(ENABLE_PDF)
      // As chrome::SavePage: the PDF viewer saves itself (its edits included).
      if (contents->GetContentsMimeType() == "application/pdf" &&
          chrome_pdf::features::IsOopifPdfEnabled() &&
          pdf_extension_util::MaybeDispatchSaveEvent(contents->GetPrimaryMainFrame())) {
        return true;
      }
#endif
      contents->OnSavePage();
      return true;
    }
    case IDC_DEV_TOOLS_CONSOLE:
    case IDC_DEV_TOOLS_INSPECT:
      DevToolsWindow::OpenDevToolsWindow(
          contents,
          command == IDC_DEV_TOOLS_CONSOLE ? DevToolsToggleAction::ShowConsolePanel()
                                           : DevToolsToggleAction::Inspect(),
          DevToolsOpenedByAction::kMainMenuOrMainShortcut);
      return true;
    case IDC_DEV_TOOLS_TOGGLE: {
      // As Chrome's toggle: docked tools close (their own beforeunload first, as
      // DevToolsWindow::Close; still loading, they stay), undocked ones come forward, none open.
      DevToolsWindow* tools = DevToolsWindow::GetInstanceForInspectedWebContents(contents);
      if (tools && tools->IsDocked()) {
        if (content::WebContents* docked = DevToolsWindow::GetInTabWebContents(contents, nullptr)) {
          docked->DispatchBeforeUnload(/*auto_cancel=*/false);
        }
      } else {
        DevToolsWindow::OpenDevToolsWindow(contents, DevToolsToggleAction::Show(),
                                           DevToolsOpenedByAction::kMainMenuOrMainShortcut);
      }
      return true;
    }
    default:
      return std::nullopt;
  }
}

}  // namespace

@implementation NNCoreTab {
  raw_ptr<content::WebContents> _contents;
  int _browserId;
  NSColor* __strong _pageBackgroundColor;
}

@synthesize delegate = _delegate;

- (instancetype)initWithContents:(content::WebContents*)contents {
  if ((self = [super init])) {
    static int lastBrowserId = 0;
    _contents = contents;
    _browserId = ++lastBrowserId;
  }
  return self;
}

- (int)browserId {
  return _browserId;
}

- (NSString*)faviconURL {
  if (!_contents) {
    return nil;
  }
  const GURL& url = nncore::TabBridge::GetOrCreate(_contents)->favicon_url();
  return url.is_valid() ? NS(url.spec()) : nil;
}

- (NSString*)themeColor {
  std::optional<SkColor> color = _contents ? _contents->GetThemeColor() : std::nullopt;
  if (!color) {
    return nil;
  }
  return [NSString stringWithFormat:@"#%02x%02x%02x", SkColorGetR(*color),
                                    SkColorGetG(*color), SkColorGetB(*color)];
}

- (BOOL)audible {
  return _contents && _contents->IsCurrentlyAudible();
}

- (BOOL)muted {
  return _contents && _contents->IsAudioMuted();
}

- (void)setMuted:(BOOL)muted {
  if (_contents) {
    _contents->SetAudioMuted(muted);
  }
}

- (void)loadURL:(NSString*)url userInitiated:(BOOL)userInitiated {
  if (!_contents) {
    return;
  }
  content::NavigationController::LoadURLParams params(
      GURL(base::SysNSStringToUTF8(url)));
  params.transition_type = userInitiated
                               ? ui::PageTransitionFromInt(
                                     ui::PAGE_TRANSITION_TYPED |
                                     ui::PAGE_TRANSITION_FROM_ADDRESS_BAR)
                               : ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
  params.has_user_gesture = userInitiated;
  // A New Tab page's tab, made ahead on about:blank (the app's prewarm): its first page
  // takes that entry's place, so Back never lands on the blank page.
  content::NavigationController& controller = _contents->GetController();
  content::NavigationEntry* committed = controller.GetLastCommittedEntry();
  if (controller.GetEntryCount() == 1 && committed && !committed->IsInitialEntry() &&
      committed->GetURL().IsAboutBlank()) {
    params.should_replace_current_entry = true;
  }
  controller.LoadURLWithParams(params);
}

- (void)goToOffset:(int)offset {
  if (_contents && _contents->GetController().CanGoToOffset(offset)) {
    _contents->GetController().GoToOffset(offset);
  }
}

- (void)reloadIgnoringCache {
  if (_contents) {
    _contents->GetController().Reload(content::ReloadType::BYPASSING_CACHE, true);
  }
}

- (NSArray<NSDictionary<NSString*, id>*>*)navigationEntries {
  NSMutableArray* entries = [NSMutableArray array];
  if (!_contents) {
    return entries;
  }
  content::NavigationController& controller = _contents->GetController();
  const int current = controller.GetCurrentEntryIndex();
  for (int i = 0; i < controller.GetEntryCount(); ++i) {
    content::NavigationEntry* entry = controller.GetEntryAtIndex(i);
    [entries addObject:@{
      @"url" : NS(entry->GetURL().spec()),
      @"title" : NS(entry->GetTitle()),
      @"current" : @(i == current),
    }];
  }
  return entries;
}

- (void)executeJavaScript:(NSString*)code {
  [self executeJavaScript:code userGesture:NO];
}

- (void)executeJavaScript:(NSString*)code userGesture:(BOOL)userGesture {
  if (_contents) {
    nncore::PageChannel::GetOrCreate(_contents)->Execute(
        base::SysNSStringToUTF8(code), userGesture);
  }
}

- (NSDictionary*)securityInfo {
  return nncore::SecurityInfoFor(_contents);
}

- (double)zoomFactor {
  return _contents ? blink::ZoomLevelToZoomFactor(
                         zoom::ZoomController::GetZoomLevelForWebContents(_contents))
                   : 1;
}

- (void)setZoomFactor:(double)zoomFactor {
  if (!_contents || zoomFactor <= 0) {
    return;
  }
  if (auto* zoom = zoom::ZoomController::FromWebContents(_contents)) {
    // Chrome's per-site zoom (HostZoomMap), as its menu sets it.
    zoom->SetZoomLevel(blink::ZoomFactorToZoomLevel(zoomFactor));
  }
}

- (void)zoomStep:(int)direction {
  if (_contents) {
    zoom::PageZoom::Zoom(_contents, direction > 0   ? content::PAGE_ZOOM_IN
                                    : direction < 0 ? content::PAGE_ZOOM_OUT
                                                    : content::PAGE_ZOOM_RESET);
  }
}

- (double)pinchScale {
  return _contents ? nncore::TabBridge::GetOrCreate(_contents)->pinch_scale() : 1;
}

- (BOOL)discard {
  if (!_contents) {
    return NO;
  }
  auto* unit =
      resource_coordinator::TabLifecycleUnitExternal::FromWebContents(_contents);
  // Chrome's discard: the page goes, the tab (and this object) stays; it reloads on use.
  return unit && unit->DiscardTab(
                     ::mojom::LifecycleUnitDiscardReason::EXTERNAL);
}

- (BOOL)discarded {
  return _contents && _contents->WasDiscarded();
}

- (BOOL)frozen {
  return _contents && nncore::TabBridge::GetOrCreate(_contents)->frozen();
}

- (void)setFrozen:(BOOL)frozen {
  // Chrome freezes hidden pages only (a shown page unfreezes).
  if (frozen && _contents &&
      _contents->GetVisibility() == content::Visibility::VISIBLE) {
    return;
  }
  if (_contents) {
    nncore::TabBridge::GetOrCreate(_contents)->set_frozen(frozen);
    _contents->SetPageFrozen(frozen);
  }
}

- (void)resolveUnresponsive:(BOOL)terminate {
  if (_contents) {
    nncore::TabBridge::GetOrCreate(_contents)->ResolveUnresponsive(terminate);
  }
}

- (NSColor*)pageBackgroundColor {
  return _pageBackgroundColor;
}

- (void)setPageBackgroundColor:(NSColor*)color {
  _pageBackgroundColor = color;
  if (!_contents) {
    return;
  }
  if (!color) {
    _contents->SetPageBaseBackgroundColor(std::nullopt);
    return;
  }
  NSColor* rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  _contents->SetPageBaseBackgroundColor(SkColorSetARGB(
      rgb.alphaComponent * 255, rgb.redComponent * 255, rgb.greenComponent * 255,
      rgb.blueComponent * 255));
}

- (NSString*)executeExtensionAction:(NSString*)extensionId {
  if (!_contents) {
    return @"none";
  }
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(_contents->GetBrowserContext())
          ->enabled_extensions()
          .GetByID(base::SysNSStringToUTF8(extensionId));
  auto* runner = extensions::ExtensionActionRunner::GetForWebContents(_contents);
  if (!extension || !runner) {
    return @"none";
  }
  // As a click on its toolbar button (grants activeTab); the host shows what it asks for.
  switch (runner->RunAction(extension, /*grant_tab_permissions=*/true)) {
    case extensions::ExtensionAction::ShowAction::kShowPopup:
      return @"popup";
    case extensions::ExtensionAction::ShowAction::kToggleSidePanel:
      return @"sidePanel";
    case extensions::ExtensionAction::ShowAction::kNone:
      return @"none";
  }
  return @"none";
}

- (NSDictionary<NSString*, NSDictionary*>*)actionStatesForExtensions:
    (NSArray<NSString*>*)extensionIds {
  NSMutableDictionary* states = [NSMutableDictionary dictionary];
  if (!_contents) {
    return states;
  }
  content::BrowserContext* context = _contents->GetBrowserContext();
  const int tab_id = self.tabId;
  for (NSString* extensionId in extensionIds) {
    const extensions::Extension* extension =
        extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(
            base::SysNSStringToUTF8(extensionId));
    extensions::ExtensionAction* action =
        extension ? extensions::ExtensionActionManager::Get(context)
                        ->GetExtensionAction(*extension)
                  : nullptr;
    if (!action) {
      continue;
    }
    gfx::Image icon = action->GetExplicitlySetIcon(tab_id);
    if (icon.IsEmpty()) {
      icon = action->GetDeclarativeIcon(tab_id);
    }
    NSString* badge = NS(action->GetDisplayBadgeText(tab_id));
    // JS ActionState (packages/cef/src/extensions.ts), as NNChromeUI.mm shapes it.
    states[extensionId] = @{
      @"title" : NS(action->GetTitle(tab_id)),
      @"badgeText" : [badge hasPrefix:@"<<"] ? @"" : badge,
      @"badgeColor" : HexColor(action->GetBadgeBackgroundColor(tab_id)),
      @"badgeTextColor" : HexColor(action->GetBadgeTextColor(tab_id)),
      @"popup" : NS(action->GetPopupUrl(tab_id).spec()),
      @"enabled" : @(action->GetIsVisible(tab_id)),
      @"icon" : PngDataURL(icon),
    };
  }
  return states;
}

- (NSString*)sidePanelURLForExtension:(NSString*)extensionId {
  if (!_contents) {
    return nil;
  }
  content::BrowserContext* context = _contents->GetBrowserContext();
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(
          base::SysNSStringToUTF8(extensionId));
  auto* service = extension ? extensions::SidePanelService::Get(context) : nullptr;
  if (!service) {
    return nil;
  }
  auto options = service->GetOptions(*extension, self.tabId);
  if (!options.path || !options.enabled.value_or(false)) {
    return nil;
  }
  return NS(extension->GetResourceURL(*options.path).spec());
}

- (void)openBlockedPopup:(NSString*)popupId always:(BOOL)always {
  if (nncore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self openBlockedPopup:popupId always:always];
    });
    return;
  }
  if (!_contents) {
    return;
  }
  auto* popups = blocked_content::PopupBlockerTabHelper::FromWebContents(_contents);
  int id_number = 0;
  // Only a popup this page still has (Chrome drops them when the page navigates).
  if (!popups || !base::StringToInt(base::SysNSStringToUTF8(popupId), &id_number) ||
      !popups->GetBlockedPopupRequests().contains(id_number)) {
    return;
  }
  if (always) {
    // Chrome's "Always allow pop-ups from this site".
    HostContentSettingsMapFactory::GetForProfile(_contents->GetBrowserContext())
        ->SetContentSettingDefaultScope(_contents->GetLastCommittedURL(), GURL(),
                                        ContentSettingsType::POPUPS,
                                        CONTENT_SETTING_ALLOW);
  }
  // Chrome navigates the request it kept (POST body, opener, referrer); it lands as a tab
  // of ours, reported with this page as its opener.
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  nncore::WindowHost* host = nncore::WindowHost::ForBrowser(browser);
  std::optional<base::AutoReset<nncore::WindowHost::PendingOpen>> pending;
  if (host) {
    pending.emplace(&host->pending_open(),
                    nncore::WindowHost::PendingOpen{
                        WindowOpenDisposition::NEW_FOREGROUND_TAB,
                        _contents->GetWeakPtr()});
  }
  popups->ShowBlockedPopup(id_number, WindowOpenDisposition::NEW_FOREGROUND_TAB);
}

- (BOOL)executeChromeCommand:(int)command {
  if (nncore::IsNotifyingTabStrip()) {
    // Inside a tab-strip callback: on the next turn (YES: queued).
    dispatch_async(dispatch_get_main_queue(), ^{
      [self executeChromeCommand:command];
    });
    return YES;
  }
  if (!_contents) {
    return NO;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return NO;
  }
  TabStripModel* model = browser->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(_contents);
  const int active = model->active_index();
  if (index == TabStripModel::kNoTab) {
    return NO;
  }
  if (index == active) {
    return chrome::ExecuteCommand(browser, command);
  }
  // Not the active tab: the command aimed at it, never a moment's switch to it.
  if (std::optional<bool> ran = RunPageCommand(_contents, command)) {
    return *ran;
  }
  // A command of the whole Browser (caret browsing) needs no tab of its own.
  if (command == IDC_CARET_BROWSING_TOGGLE) {
    return chrome::ExecuteCommand(browser, command);
  }
  return NO;
}

- (void)devToolsCall:(NSString*)method
              params:(NSDictionary*)params
          completion:(void (^)(NSDictionary* result, NSString* error))completion {
  [self devToolsCall:method params:params timeout:0 completion:completion];
}

- (void)devToolsCall:(NSString*)method
              params:(NSDictionary*)params
             timeout:(NSTimeInterval)timeout
          completion:(void (^)(NSDictionary* result, NSString* error))completion {
  base::DictValue dict;
  if (params.count) {
    NSData* data = [NSJSONSerialization dataWithJSONObject:params options:0 error:nil];
    std::optional<base::DictValue> parsed =
        data ? base::JSONReader::ReadDict(
                   std::string_view(static_cast<const char*>(data.bytes), data.length),
                   base::JSON_PARSE_RFC)
             : std::nullopt;
    if (!parsed) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(nil, @"params aren't JSON");
      });
      return;
    }
    dict = std::move(*parsed);
  }
  nncore::CallDevTools(
      _contents, base::SysNSStringToUTF8(method), std::move(dict),
      timeout > 0 ? std::optional<base::TimeDelta>(base::Seconds(timeout)) : std::nullopt,
      base::BindOnce(
          [](void (^completion)(NSDictionary*, NSString*),
             std::optional<base::DictValue> result, std::optional<std::string> error) {
            if (!result) {
              completion(nil, base::SysUTF8ToNSString(error.value_or("error")));
              return;
            }
            std::optional<std::string> json = base::WriteJson(*result);
            NSData* data = json ? [NSData dataWithBytes:json->data() length:json->size()] : nil;
            id object = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                             : nil;
            if (![object isKindOfClass:NSDictionary.class]) {
              completion(nil, @"the reply isn't JSON");
              return;
            }
            completion(object, nil);
          },
          completion));
}

- (NSString*)mediaCaptureSourceId {
  content::RenderFrameHost* frame =
      _contents ? _contents->GetPrimaryMainFrame() : nullptr;
  if (!frame || !frame->IsRenderFrameLive()) {
    return nil;
  }
  // As CEF's CefGetMediaCaptureSourceId: the id getDisplayMedia/tab capture uses for this tab.
  return NS(content::WebContentsMediaCaptureId(frame->GetProcess()->GetDeprecatedID(),
                                               frame->GetRoutingID())
                .ToString());
}

- (BOOL)stopCapture {
  if (!_contents) {
    return NO;
  }
  scoped_refptr<MediaStreamCaptureIndicator> indicator =
      MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator();
  const bool capturing = indicator->IsCapturingTab(_contents) ||
                         indicator->IsCapturingWindow(_contents) ||
                         indicator->IsCapturingDisplay(_contents);
  // Chrome's "Stop sharing" for what this page shares (tab, window or screen).
  indicator->StopMediaCapturing(_contents,
                                MediaStreamCaptureIndicator::MediaType::kDisplayMedia);
  return capturing;
}

- (void)noteShownByHost:(BOOL)shown {
  if (_contents) {
    nncore::NoteTabShownByHost(_contents, shown);
  }
}

- (void)exitFullscreen {
  if (_contents && _contents->IsFullscreen()) {
    _contents->ExitFullscreen(/*will_cause_resize=*/true);
  }
}

- (void)exitExclusiveAccess {
  if (!_contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  ExclusiveAccessManager* manager =
      browser ? browser->GetFeatures().exclusive_access_manager() : nullptr;
  if (manager) {
    manager->OnTabDeactivated(_contents);
  }
}

- (void)tracePictureInPicture:(NSString*)line withInputs:(BOOL)withInputs {
  if (!nncore::PictureInPictureTracing()) {
    return;
  }
  if (withInputs && _contents) {
    nncore::TraceAutoPictureInPictureInputs(_contents, line.UTF8String);
  } else {
    nncore::TracePictureInPicture(base::SysNSStringToUTF8(line));
  }
}

- (BOOL)autoPictureInPictureIsChromes {
  if (!_contents) {
    return NO;
  }
  auto* helper = AutoPictureInPictureTabHelper::FromWebContents(_contents);
  if (!helper) {
    return NO;
  }
  // Chrome took this tab switch (or is in its auto PiP already).
  if (helper->IsInAutoPictureInPicture() || helper->AreAutoPictureInPicturePreconditionsMet()) {
    return YES;
  }
  // Or will: its conditions for a call (IsEligibleForAutoPictureInPicture), which don't wait
  // on anything asynchronous.
  const GURL& url = _contents->GetLastCommittedURL();
  Profile* profile = Profile::FromBrowserContext(_contents->GetBrowserContext());
  return helper->HasAutoPictureInPictureBeenRegistered() &&
         (url.SchemeIs(url::kHttpsScheme) || url.SchemeIsFile()) &&
         MediaCaptureDevicesDispatcher::GetInstance()
             ->GetMediaStreamCaptureIndicator()
             ->IsCapturingUserMedia(_contents) &&
         HostContentSettingsMapFactory::GetForProfile(profile)->GetContentSetting(
             url, url, ContentSettingsType::AUTO_PICTURE_IN_PICTURE) == CONTENT_SETTING_ALLOW;
}

- (BOOL)showCastDialog {
  return nncore::ShowCastDialog(_contents);
}

- (BOOL)devShowBluetoothChooser:(BOOL)unauthorized {
  return nncore::ShowTestBluetoothChooser(_contents, unauthorized);
}

- (BOOL)focusedEditable {
  return _contents && _contents->IsFocusedElementEditable();
}

- (NSSize)preferredSize {
  const gfx::Size size =
      _contents ? nncore::ExtensionPopupPreferredSize(_contents) : gfx::Size();
  return NSMakeSize(size.width(), size.height());
}

- (NSDictionary<NSString*, NSNumber*>*)popupFeatures {
  nncore::TabBridge* bridge =
      _contents ? nncore::TabBridge::FromWebContents(_contents) : nullptr;
  return bridge ? bridge->popup_features() : nil;
}

namespace {
// Chrome's tab-sharing infobar on this tab for the share `capturer` makes. Each share
// puts one on every tab, so a tab shows one per share: matched by its capturing frame
// (the capturer's main frame, so two shares from one tab can't be told apart: none).
TabSharingInfoBarDelegate* TabSharingDelegateFor(content::WebContents* contents,
                                                 content::WebContents* capturer) {
  auto* manager =
      contents ? infobars::ContentInfoBarManager::FromWebContents(contents) : nullptr;
  if (!manager || !capturer) {
    return nullptr;
  }
  TabSharingInfoBarDelegate* found = nullptr;
  for (infobars::InfoBar* infobar : manager->infobars()) {
    if (infobar->delegate()->GetIdentifier() !=
        infobars::InfoBarDelegate::TAB_SHARING_INFOBAR_DELEGATE) {
      continue;
    }
    auto* sharing = static_cast<TabSharingInfoBarDelegate*>(infobar->delegate());
    content::RenderFrameHost* frame =
        content::RenderFrameHost::FromID(sharing->capturer_id());
    if (frame && content::WebContents::FromRenderFrameHost(frame) == capturer) {
      if (found) {
        return nullptr;
      }
      found = sharing;
    }
  }
  return found;
}
}  // namespace

- (BOOL)canShareThisTabInsteadFor:(NNCoreTab*)capturer {
  TabSharingInfoBarDelegate* sharing =
      TabSharingDelegateFor(_contents, capturer.contents);
  return sharing &&
         (sharing->GetButtons() & TabSharingInfoBarDelegate::kShareThisTabInstead) &&
         sharing->IsButtonEnabled(TabSharingInfoBarDelegate::kShareThisTabInstead);
}

- (BOOL)shareThisTabInsteadFor:(NNCoreTab*)capturer {
  if (![self canShareThisTabInsteadFor:capturer]) {
    return NO;
  }
  // Chrome's "Share this tab instead" on that share's bar: its capture moves here.
  TabSharingDelegateFor(_contents, capturer.contents)->ShareThisTabInstead();
  return YES;
}

- (BOOL)showAutofillSuggestions:(BOOL)passwords {
  return nncore::ShowAutofillSuggestions(_contents, passwords);
}

- (void)executeJavaScript:(NSString*)code frame:(NSString*)frameId {
  if (_contents) {
    nncore::PageChannel::GetOrCreate(_contents)->ExecuteInFrame(
        base::SysNSStringToUTF8(frameId), base::SysNSStringToUTF8(code));
  }
}

- (void)evaluate:(NSString*)code completion:(void (^)(NSString*))completion {
  [self evaluate:code userGesture:NO completion:completion];
}

- (void)evaluate:(NSString*)code
     userGesture:(BOOL)userGesture
      completion:(void (^)(NSString*))completion {
  if (!_contents) {
    completion(nil);
    return;
  }
  nncore::PageChannel::GetOrCreate(_contents)->Evaluate(
      base::SysNSStringToUTF8(code), userGesture,
      base::BindOnce(
          [](void (^completion)(NSString*), const std::optional<std::string>& json) {
            completion(json ? NS(*json) : nil);
          },
          completion));
}

- (void)callPage:(NSString*)kind json:(NSString*)json {
  if (_contents) {
    nncore::PageChannel::GetOrCreate(_contents)->CallPage(
        base::SysNSStringToUTF8(kind), base::SysNSStringToUTF8(json));
  }
}

- (void)callFrame:(NSString*)frameId kind:(NSString*)kind json:(NSString*)json {
  if (_contents) {
    nncore::PageChannel::GetOrCreate(_contents)->CallFrame(
        base::SysNSStringToUTF8(frameId), base::SysNSStringToUTF8(kind),
        base::SysNSStringToUTF8(json));
  }
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
    auto focusing = nncore::TabBridge::GetOrCreate(_contents)->HostFocuses();
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

- (void)closeNow {
  if (nncore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self closeNow];
    });
    return;
  }
  if (!_contents || nncore::CloseExtensionView(_contents)) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return;
  }
  // As CEF's CloseBrowser(true): no beforeunload, gone now (didRemoveTab:, no tabWillClose:).
  nncore::TabBridge::GetOrCreate(_contents)->set_closed_by_host();
  TabStripModel* model = browser->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(_contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  // Chrome's closed-tab entry (⇧⌘T, chrome.sessions), as a user's close records it, now: a
  // tag the host set just before is in it. Not for incognito, a page that never committed, or
  // a New Tab page's tab that only ever showed about:blank (made ahead of its navigation).
  content::NavigationController& controller = _contents->GetController();
  content::NavigationEntry* committed = controller.GetLastCommittedEntry();
  const bool only_blank = controller.GetEntryCount() == 1 && committed &&
                          committed->GetURL().IsAboutBlank();
  if (!Profile::FromBrowserContext(_contents->GetBrowserContext())->IsOffTheRecord() &&
      committed && !committed->IsInitialEntry() && !only_blank) {
    model->delegate()->CreateHistoricalTab(_contents);
  }
  model->DetachAndDeleteWebContentsAt(index);
}

- (void)close {
  if (nncore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self close];
    });
    return;
  }
  if (!_contents || nncore::CloseExtensionView(_contents)) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return;
  }
  nncore::TabBridge::GetOrCreate(_contents)->set_closed_by_host();
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

- (NSDictionary<NSString*, id>*)passwordPrompt {
  return nncore::PasswordPrompt(_contents);
}

- (void)resolvePasswordPrompt:(NSString*)action
                     username:(NSString*)username
                     password:(NSString*)password {
  nncore::ResolvePasswordPrompt(_contents, action, username, password);
}

- (NSDictionary<NSString*, id>*)autofillPrompt {
  return nncore::AutofillPrompt(_contents);
}

- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString*)action {
  nncore::ResolveAutofillPrompt(_contents, promptId, action);
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
