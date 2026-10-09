#include "netnyahoo/core/nn_permissions.h"

#include <map>
#include <memory>
#include <optional>
#include <variant>
#include <vector>

#include "base/memory/ptr_util.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/file_system_access/file_system_access_permission_request_manager.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/permissions/system/system_permission_settings.h"
#include "components/permissions/embedded_permission_prompt_flow_model.h"
#include "components/permissions/permission_prompt.h"
#include "components/permissions/permission_request.h"
#include "components/permissions/permission_uma_constants.h"
#include "components/permissions/permission_util.h"
#include "components/permissions/request_type.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "netnyahoo/core/nn_browser.h"
#include "netnyahoo/core/nn_fake_media.h"
#include "netnyahoo/core/nn_test_system_permissions.h"
#include "url/origin.h"

// Set here, defined in Chrome's restore bubble (engine/nncore/apply.sh).
extern bool (*g_netnyahoo_file_system_restore_prompt)(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)>& callback,
    content::WebContents* web_contents);

// Chrome's permission prompt factory (engine/nncore/apply.sh, permission_prompt_factory.cc):
// a prompt, or null with `default_handling` false for none at all; null with it true is
// Chrome's own.
extern std::unique_ptr<permissions::PermissionPrompt> (
    *g_netnyahoo_create_permission_prompt)(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling);

namespace nncore {

namespace {

// JS PermissionKind (packages/cef/src/module.ts), as packages/cef/ios/NNCef.mm names them.
NSString* KindName(permissions::RequestType type) {
  using permissions::RequestType;
  switch (type) {
    case RequestType::kCameraStream:
      return @"camera";
    case RequestType::kMicStream:
      return @"microphone";
    case RequestType::kCameraPanTiltZoom:
      return @"cameraPanTiltZoom";
    case RequestType::kGeolocation:
      return @"location";
    case RequestType::kNotifications:
      return @"notifications";
    case RequestType::kClipboard:
      return @"clipboard";
    case RequestType::kMidiSysex:
      return @"midi";
    case RequestType::kMultipleDownloads:
      return @"multipleDownloads";
    case RequestType::kLocalFonts:
      return @"localFonts";
    case RequestType::kIdleDetection:
      return @"idleDetection";
    case RequestType::kStorageAccess:
    case RequestType::kTopLevelStorageAccess:
      return @"storageAccess";
    case RequestType::kWindowManagement:
      return @"windowManagement";
    case RequestType::kFileSystemAccess:
      return @"fileSystem";
    case RequestType::kKeyboardLock:
      return @"keyboardLock";
    case RequestType::kPointerLock:
      return @"pointerLock";
    case RequestType::kRegisterProtocolHandler:
      return @"protocolHandler";
    case RequestType::kSensors:
      return @"sensors";
    case RequestType::kLocalNetwork:
    case RequestType::kLoopbackNetwork:
      return @"localNetwork";
    case RequestType::kVrSession:
      return @"vr";
    case RequestType::kArSession:
      return @"ar";
    case RequestType::kHandTracking:
      return @"handTracking";
    case RequestType::kIdentityProvider:
      return @"identityProvider";
    case RequestType::kWebAppInstallation:
      return @"webAppInstallation";
    case RequestType::kCapturedSurfaceControl:
      return @"capturedSurfaceControl";
    case RequestType::kDiskQuota:
      return @"diskQuota";
    default:
      return nil;
  }
}

class NNPermissionPrompt;

std::map<std::string, base::WeakPtr<NNPermissionPrompt>>& Prompts() {
  static base::NoDestructor<std::map<std::string, base::WeakPtr<NNPermissionPrompt>>>
      prompts;
  return *prompts;
}

using Variant = permissions::EmbeddedPermissionPromptFlowModel::Variant;

// What a prompt asks for. A page's permission element (<usermedia>, <geolocation>) runs
// Chrome's embedded flow: after the site is allowed, the manager keeps the same requests and
// shows the next step (ask macOS, open System Settings, an administrator's policy), the
// views Chrome's EmbeddedPermissionPrompt picks by variant. Only the flow's first view can
// be a question: a later one holds requests already decided, and deciding one twice runs its
// spent callback (CEF 0.2.21 aborted there: its client answered the "ask macOS" step with
// Accept). A later view is never a question even if its variant says so (the site's setting
// reset while macOS was being asked): it closes, as Chrome's acknowledgement does.
enum class Step { kAsk, kAlreadyAllowed, kSystemPrompt, kAcknowledge };

Step StepOf(permissions::PermissionPrompt::Delegate* delegate) {
  permissions::EmbeddedPermissionPromptFlowModel* flow =
      delegate->GetEmbeddedPromptFlowModel();
  if (!flow) {
    return Step::kAsk;
  }
  // The manager marks its requests displayed once their first view is up; a view made for
  // the same requests after that is a later step (this prompt keeps itself through tab
  // switches and anchor updates, so nothing else recreates it).
  const bool later_step = delegate->WasCurrentRequestAlreadyDisplayed();
  switch (flow->prompt_variant()) {
    case Variant::kOsPrompt:
      return Step::kSystemPrompt;
    case Variant::kAsk:
    case Variant::kPreviouslyDenied:
      return later_step ? Step::kAcknowledge : Step::kAsk;
    case Variant::kPreviouslyGranted:
      return later_step ? Step::kAcknowledge : Step::kAlreadyAllowed;
    case Variant::kOsSystemSettings:
    case Variant::kAdministratorGranted:
    case Variant::kAdministratorDenied:
    case Variant::kUninitialized:
      return Step::kAcknowledge;
  }
  return Step::kAcknowledge;
}

// One request group Chrome's PermissionRequestManager is asking about. The manager owns it:
// it goes when the host answers, the page navigates or closes, or a request outranks it.
// The host answers it once, through its id; an answer to a prompt that has gone (or a
// second one) is dropped, and a camera and microphone group is one prompt, one answer.
class NNPermissionPrompt : public permissions::PermissionPrompt {
 public:
  NNPermissionPrompt(content::WebContents* contents, Delegate* delegate)
      : delegate_(delegate), step_(StepOf(delegate)) {
    static int last_id = 0;
    id_ = "p" + std::to_string(++last_id);
    Prompts()[id_] = weak_factory_.GetWeakPtr();
    // Never from inside Chrome's ShowPrompt: an answer re-enters the manager.
    switch (step_) {
      case Step::kAsk:
      case Step::kAlreadyAllowed:
        AskHost(contents);
        break;
      case Step::kSystemPrompt:
        PostToSelf(&NNPermissionPrompt::AskSystem);
        break;
      case Step::kAcknowledge:
        // Chrome's view only informs (System Settings, a policy); closing it dismisses.
        PostToSelf(&NNPermissionPrompt::Acknowledge);
        break;
    }
  }

  ~NNPermissionPrompt() override {
    Prompts().erase(id_);
    if (asked_host_ && !answered_) {
      // Not from inside the manager's cleanup: the host may close the tab in response.
      NSString* request_id = base::SysUTF8ToNSString(id_);
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(
                         [](NSString* request_id) {
                           HostPermissionRequestDismissed(request_id);
                         },
                         request_id));
    }
  }

  // The host's answer: taken once, applied from a task of its own (never inside a call
  // that came from the manager, or a nested run loop's).
  void Resolve(const std::string& result, bool remember) {
    if (!asked_host_ || answered_) {
      return;
    }
    answered_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&NNPermissionPrompt::Apply,
                                  weak_factory_.GetWeakPtr(), result, remember));
  }

  // permissions::PermissionPrompt:
  bool UpdateAnchor() override { return true; }
  TabSwitchingBehavior GetTabSwitchingBehavior() override {
    return TabSwitchingBehavior::kKeepPromptAlive;
  }
  permissions::PermissionPromptDisposition GetPromptDisposition() const override {
    return permissions::PermissionPromptDisposition::CUSTOM_MODAL_DIALOG;
  }
  bool IsAskPrompt() const override { return step_ == Step::kAsk; }
  std::optional<gfx::Rect> GetViewBoundsInScreen() const override {
    return std::nullopt;
  }
  std::vector<permissions::ElementAnchoredBubbleVariant> GetPromptVariants()
      const override {
    return {};
  }
  std::optional<permissions::feature_params::PermissionElementPromptPosition>
  GetPromptPosition() const override {
    return std::nullopt;
  }

 private:
  void AskHost(content::WebContents* contents) {
    asked_host_ = true;
    NSMutableOrderedSet<NSString*>* kinds = [NSMutableOrderedSet orderedSet];
    for (const auto& request : delegate_->Requests()) {
      if (NSString* kind = KindName(request->request_type())) {
        [kinds addObject:kind];
      }
    }
    NSDictionary* request = @{
      @"id" : base::SysUTF8ToNSString(id_),
      @"origin" : base::SysUTF8ToNSString(delegate_->GetRequestingOrigin().spec()),
      @"permissions" : kinds.array,
    };
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<NNPermissionPrompt> prompt,
               base::WeakPtr<content::WebContents> contents, NSDictionary* request) {
              if (prompt && contents) {
                HostPermissionRequest(contents.get(), request);
              }
            },
            weak_factory_.GetWeakPtr(), contents->GetWeakPtr(), request));
  }

  void PostToSelf(void (NNPermissionPrompt::*step)()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(step, weak_factory_.GetWeakPtr()));
  }

  // Still the manager's prompt: a stale task (the prompt replaced in the meantime) is a no-op.
  bool Current() const { return delegate_->GetCurrentPrompt() == this; }

  void Apply(const std::string& result, bool remember) {
    if (!Current()) {
      return;
    }
    // The manager deletes this from inside the call: nothing after it.
    Delegate* delegate = delegate_;
    const PromptOptions options(std::monostate{});
    if (step_ == Step::kAlreadyAllowed) {
      // The element clicked on a site already allowed: Chrome's "Continue allowing" closes
      // (the grant stays as it is), "Stop allowing" blocks.
      if (result == "deny" && remember) {
        delegate->Deny(options);
      } else {
        delegate->Dismiss(options);
      }
      return;
    }
    if (result == "accept") {
      bool one_time = !remember;
      for (const auto& request : delegate->Requests()) {
        one_time &= permissions::PermissionUtil::DoesSupportTemporaryGrants(
            request->GetContentSettingsType());
      }
      if (one_time) {
        delegate->AcceptThisTime(options);
      } else {
        delegate->Accept(options);
      }
    } else if (result == "deny" && remember) {
      delegate->Deny(options);
    } else {
      // "dismiss", or a "deny" not to keep: the page is refused, the site stays "ask".
      delegate->Dismiss(options);
    }
  }

  // The site is allowed and macOS hasn't been asked: ask it, as Chrome's view does, and
  // move the flow on once every type has an answer (macOS's prompt can stay unanswered).
  void AskSystem() {
    if (!Current()) {
      return;
    }
    std::vector<ContentSettingsType> types;
    for (const auto& request : delegate_->Requests()) {
      types.push_back(request->GetContentSettingsType());
    }
    pending_system_answers_ = types.size();
    for (ContentSettingsType type : types) {
      system_permission_settings::Request(
          type, base::BindOnce(&NNPermissionPrompt::OnSystemAnswer,
                               weak_factory_.GetWeakPtr(), types));
    }
  }

  void OnSystemAnswer(std::vector<ContentSettingsType> types) {
    if (pending_system_answers_ == 0 || --pending_system_answers_ > 0 || !Current()) {
      return;
    }
    for (ContentSettingsType type : types) {
      if (system_permission_settings::CanPrompt(type)) {
        return;
      }
    }
    // The manager replaces or deletes this from inside the call: nothing after it.
    delegate_->AdvanceOrFinalizeEmbeddedPromptFlow();
  }

  void Acknowledge() {
    if (Current()) {
      delegate_->Dismiss(PromptOptions(std::monostate{}));
    }
  }

  const raw_ptr<Delegate> delegate_;
  const Step step_;
  std::string id_;
  bool asked_host_ = false;
  bool answered_ = false;
  size_t pending_system_answers_ = 0;
  base::WeakPtrFactory<NNPermissionPrompt> weak_factory_{this};
};

std::unique_ptr<permissions::PermissionPrompt> CreatePrompt(
    content::WebContents* contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling) {
  // The host's tabs only; Chrome's own windows keep Chrome's bubble.
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser || !WindowHost::ForBrowser(browser)) {
    *default_handling = true;
    return nullptr;
  }
  *default_handling = false;
  return std::make_unique<NNPermissionPrompt>(contents, delegate);
}

using RestoreCallback = base::OnceCallback<void(permissions::PermissionAction)>;

// A site asking again for files it kept handles to (in IndexedDB, from an earlier visit): Chrome's
// restore prompt, a bubble anchored to the toolbar's page info icon, is asked of the host as a
// "fileSystem" request. It answers once: the host, or the page going to another origin or the tab
// closing, which dismiss it as Chrome's bubble does (a dismissal forgets the saved grants).
class NNFileRestorePrompt : public content::WebContentsObserver {
 public:
  static std::map<std::string, std::unique_ptr<NNFileRestorePrompt>>& All() {
    static base::NoDestructor<std::map<std::string, std::unique_ptr<NNFileRestorePrompt>>>
        prompts;
    return *prompts;
  }

  static void Start(content::WebContents* contents,
                    const url::Origin& origin,
                    RestoreCallback callback) {
    static int last_id = 0;
    const std::string id = "r" + std::to_string(++last_id);
    All()[id] = base::WrapUnique(new NNFileRestorePrompt(contents, id, std::move(callback)));
    NSDictionary* request = @{
      @"id" : base::SysUTF8ToNSString(id),
      @"origin" : base::SysUTF8ToNSString(origin.GetURL().spec()),
      @"permissions" : @[ @"fileSystem" ],
    };
    // Never from inside Chrome's request manager: the host's answer re-enters it.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](std::string id, NSDictionary* request) {
                         auto it = All().find(id);
                         if (it != All().end() && it->second->web_contents()) {
                           HostPermissionRequest(it->second->web_contents(), request);
                         }
                       },
                       id, request));
  }

  // The host's answer. Its one "Allow" is Chrome's "Allow this time": the files stay the
  // site's for this visit and it asks again on the next (Chrome's "Allow on every visit" is a
  // choice the host's prompt doesn't offer). A remembered "deny" is "Don't allow"; anything
  // else dismisses.
  static bool Resolve(const std::string& id, const std::string& result, bool remember) {
    if (!All().contains(id)) {
      return false;
    }
    permissions::PermissionAction action = permissions::PermissionAction::DISMISSED;
    if (result == "accept") {
      action = permissions::PermissionAction::GRANTED_ONCE;
    } else if (result == "deny" && remember) {
      action = permissions::PermissionAction::DENIED;
    }
    // From a task of its own, never inside the host's call.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&NNFileRestorePrompt::Finish, id, action,
                                  /*tell_host=*/false));
    return true;
  }

  // content::WebContentsObserver: as LocationBarBubbleDelegateView closes Chrome's bubble.
  void DidFinishNavigation(content::NavigationHandle* navigation) override {
    if (navigation->IsInPrimaryMainFrame() && navigation->HasCommitted() &&
        !url::IsSameOriginWith(navigation->GetPreviousPrimaryMainFrameURL(),
                               navigation->GetURL())) {
      Dismiss();
    }
  }
  void WebContentsDestroyed() override { Dismiss(); }

 private:
  NNFileRestorePrompt(content::WebContents* contents,
                      std::string id,
                      RestoreCallback callback)
      : content::WebContentsObserver(contents),
        id_(std::move(id)),
        callback_(std::move(callback)) {}

  void Dismiss() {
    // Not from inside the observer call: the host may close the tab in response.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&NNFileRestorePrompt::Finish, id_,
                                  permissions::PermissionAction::DISMISSED,
                                  /*tell_host=*/true));
    Observe(nullptr);
  }

  // Once: a second answer (the page went after the host answered) finds nothing.
  static void Finish(std::string id, permissions::PermissionAction action, bool tell_host) {
    auto it = All().find(id);
    if (it == All().end()) {
      return;
    }
    RestoreCallback callback = std::move(it->second->callback_);
    All().erase(it);
    if (tell_host) {
      HostPermissionRequestDismissed(base::SysUTF8ToNSString(id));
    }
    // Chrome's request manager (bound weakly: a closed tab's runs nothing).
    std::move(callback).Run(action);
  }

  const std::string id_;
  RestoreCallback callback_;
};

bool AskHostToRestoreFiles(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    RestoreCallback& callback,
    content::WebContents* contents) {
  // The host's tabs only; Chrome's own windows keep Chrome's bubble.
  BrowserWindowInterface* browser =
      contents ? GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents)
               : nullptr;
  if (!browser || !WindowHost::ForBrowser(browser)) {
    return false;
  }
  NNFileRestorePrompt::Start(contents, request.origin, std::move(callback));
  return true;
}

}  // namespace

void InstallPermissionPrompts() {
  MaybeInstallTestSystemPermissions();
  InstallFakeMediaDevices();
  g_netnyahoo_create_permission_prompt = &CreatePrompt;
  g_netnyahoo_file_system_restore_prompt = &AskHostToRestoreFiles;
}

void ResolvePermission(const std::string& request_id,
                       const std::string& result,
                       bool remember) {
  if (NNFileRestorePrompt::Resolve(request_id, result, remember)) {
    return;
  }
  auto it = Prompts().find(request_id);
  if (it == Prompts().end() || !it->second) {
    return;
  }
  it->second->Resolve(result, remember);
}

}  // namespace nncore
