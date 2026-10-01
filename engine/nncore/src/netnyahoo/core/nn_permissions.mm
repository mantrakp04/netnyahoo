#include "netnyahoo/core/nn_permissions.h"

#include <map>
#include <memory>
#include <optional>
#include <variant>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/permission_bubble/permission_prompt.h"
#include "components/permissions/permission_prompt.h"
#include "components/permissions/permission_request.h"
#include "components/permissions/permission_util.h"
#include "components/permissions/request_type.h"
#include "content/public/browser/web_contents.h"
#include "netnyahoo/core/nn_browser.h"

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

// One request group Chrome's PermissionRequestManager is asking about. The manager owns it:
// it goes when the host answers, the page navigates or closes, or a request outranks it.
class NNPermissionPrompt : public permissions::PermissionPrompt {
 public:
  NNPermissionPrompt(content::WebContents* contents, Delegate* delegate)
      : delegate_(delegate) {
    static int last_id = 0;
    id_ = "p" + std::to_string(++last_id);
    Prompts()[id_] = weak_factory_.GetWeakPtr();
    NSMutableOrderedSet<NSString*>* kinds = [NSMutableOrderedSet orderedSet];
    for (const auto& request : delegate->Requests()) {
      if (NSString* kind = KindName(request->request_type())) {
        [kinds addObject:kind];
      }
    }
    NSDictionary* request = @{
      @"id" : base::SysUTF8ToNSString(id_),
      @"origin" : base::SysUTF8ToNSString(delegate->GetRequestingOrigin().spec()),
      @"permissions" : kinds.array,
    };
    // Not from inside Chrome's ShowPrompt: the host may answer at once, and an answer
    // re-enters the PermissionRequestManager.
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

  ~NNPermissionPrompt() override {
    Prompts().erase(id_);
    if (!resolved_) {
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

  void Resolve(const std::string& result, bool remember) {
    resolved_ = true;
    // The manager deletes this from inside the call: nothing after it.
    Delegate* delegate = delegate_;
    const PromptOptions options(std::monostate{});
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

  // permissions::PermissionPrompt:
  bool UpdateAnchor() override { return true; }
  TabSwitchingBehavior GetTabSwitchingBehavior() override {
    return TabSwitchingBehavior::kKeepPromptAlive;
  }
  permissions::PermissionPromptDisposition GetPromptDisposition() const override {
    return permissions::PermissionPromptDisposition::CUSTOM_MODAL_DIALOG;
  }
  bool IsAskPrompt() const override { return true; }
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
  const raw_ptr<Delegate> delegate_;
  std::string id_;
  bool resolved_ = false;
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

}  // namespace

void InstallPermissionPrompts() {
  SetCreatePermissionPromptFunction(&CreatePrompt);
}

void ResolvePermission(const std::string& request_id,
                       const std::string& result,
                       bool remember) {
  auto it = Prompts().find(request_id);
  if (it == Prompts().end() || !it->second) {
    return;
  }
  it->second->Resolve(result, remember);
}

}  // namespace nncore
