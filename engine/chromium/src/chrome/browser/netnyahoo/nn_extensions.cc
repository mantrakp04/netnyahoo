// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_extensions.h"

#include <map>
#include <set>
#include <memory>
#include <string>
#include <utility>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/extensions/api/developer_private/extension_info_generator.h"
#include "chrome/browser/extensions/extension_management.h"
#include "chrome/browser/extensions/extension_util.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/toolbar/toolbar_actions_model.h"
#include "chrome/common/extensions/api/developer_private.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/api/management/management_api.h"
#include "extensions/browser/api/management/management_api_delegate.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/management_policy.h"
#include "extensions/browser/permissions_manager.h"
#include "extensions/browser/permissions/scripting_permissions_modifier.h"
#include "extensions/browser/requirements_checker.h"
#include "extensions/browser/uninstall_reason.h"
#include "extensions/browser/unpacked_installer.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/common/extension.h"

namespace netnyahoo {
namespace {

namespace developer = extensions::api::developer_private;
using extensions::Extension;
using extensions::ExtensionRegistry;

const Extension* Find(Profile* profile, const std::string& id) {
  return ExtensionRegistry::Get(profile)->GetExtensionById(
      id, ExtensionRegistry::EVERYTHING);
}

const extensions::ManagementAPIDelegate* ManagementDelegate(Profile* profile) {
  return extensions::ManagementAPI::GetFactoryInstance()
      ->Get(profile)
      ->GetDelegate();
}

base::DictValue Entry(const developer::ExtensionInfo& info) {
  base::ListValue permissions;
  for (const auto& permission : info.permissions.simple_permissions) {
    permissions.Append(permission.message);
  }
  base::ListValue sites;
  base::Value site_access;
  if (const auto& hosts = info.permissions.runtime_host_permissions) {
    site_access = base::Value(developer::ToString(hosts->host_access));
    for (const auto& host : hosts->hosts) {
      if (host.granted) {
        sites.Append(host.host);
      }
    }
  }
  base::ListValue errors;
  for (const auto& error : info.manifest_errors) {
    errors.Append(error.message);
  }
  for (const auto& error : info.runtime_errors) {
    errors.Append(error.message);
  }
  auto optional = [](const std::optional<std::string>& value) {
    return value ? base::Value(*value) : base::Value();
  };
  return base::DictValue()
      .Set("id", info.id)
      .Set("name", info.name)
      .Set("version", info.version)
      .Set("description", info.description)
      .Set("enabled", info.state == developer::ExtensionState::kEnabled)
      .Set("state", developer::ToString(info.state))
      .Set("icon", info.icon_url)
      .Set("permissions", std::move(permissions))
      .Set("siteAccess", std::move(site_access))
      .Set("sites", std::move(sites))
      .Set("optionsUrl", info.options_page ? base::Value(info.options_page->url)
                                           : base::Value())
      .Set("location", developer::ToString(info.location))
      .Set("path", optional(info.path))
      .Set("homepageUrl", info.home_page.url.empty()
                              ? base::Value()
                              : base::Value(info.home_page.url))
      .Set("incognito", info.incognito_access.is_active)
      .Set("fileAccess", info.file_access.is_active)
      .Set("pinned", info.pinned_to_toolbar.value_or(false))
      .Set("mayModify", info.user_may_modify)
      .Set("errors", std::move(errors));
}

// The tab Chrome's prompts for this profile hang from: the active tab of its
// most recently active window.
content::WebContents* PromptTab(Profile* profile) {
  content::WebContents* tab = nullptr;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [&](BrowserWindowInterface* window) {
        if (window->GetProfile() != profile || !window->GetTabStripModel()) {
          return true;
        }
        tab = window->GetTabStripModel()->GetActiveWebContents();
        return !tab;
      });
  return tab;
}

// Keeps the profile's in-flight work (info generators, requirement checks,
// re-enable prompts) until it reports back.
class ExtensionsState : public ProfileState {
 public:
  explicit ExtensionsState(Profile* profile) : ProfileState(profile) {}

  void List(Reply reply) {
    auto generator =
        std::make_unique<extensions::ExtensionInfoGenerator>(profile());
    extensions::ExtensionInfoGenerator* raw = generator.get();
    const int key = Keep(std::move(generator));
    raw->CreateExtensionsInfo(
        /*include_disabled=*/true, /*include_terminated=*/true,
        base::BindOnce(&ExtensionsState::Listed, weak_factory_.GetWeakPtr(),
                       key, std::move(reply)));
  }

  // The management API's enable steps after its policy checks.
  void Enable(const Extension* extension, Reply reply) {
    const std::string id = extension->id();
    if (extensions::ExtensionPrefs::Get(profile())->HasDisableReason(
            id, extensions::disable_reason::DISABLE_UNSUPPORTED_REQUIREMENT)) {
      auto checker = std::make_unique<extensions::RequirementsChecker>(
          base::WrapRefCounted(extension));
      extensions::RequirementsChecker* raw = checker.get();
      const int key = Keep(std::move(checker));
      raw->Start(base::BindOnce(&ExtensionsState::RequirementsChecked,
                                weak_factory_.GetWeakPtr(), key, id,
                                std::move(reply)));
      return;
    }
    CheckPermissionsIncrease(id, std::move(reply));
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    kept_.clear();
  }

  int Keep(std::unique_ptr<void, void (*)(void*)> owned) {
    kept_.emplace(++next_key_, std::move(owned));
    return next_key_;
  }
  template <typename T>
  int Keep(std::unique_ptr<T> owned) {
    return Keep(std::unique_ptr<void, void (*)(void*)>(
        owned.release(), [](void* p) { delete static_cast<T*>(p); }));
  }
  // Not inside the callback of what it deletes.
  void Drop(int key) {
    auto it = kept_.find(key);
    if (it == kept_.end()) {
      return;
    }
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce([](std::unique_ptr<void, void (*)(void*)>) {},
                       std::move(it->second)));
    kept_.erase(it);
  }

  void Listed(int key,
              Reply reply,
              extensions::ExtensionInfoGenerator::ExtensionInfoList infos) {
    Drop(key);
    base::ListValue list;
    for (const auto& info : infos) {
      if (info.type == developer::ExtensionType::kExtension) {
        list.Append(Entry(info));
      }
    }
    reply.Send(base::DictValue().Set("extensions", std::move(list)));
  }

  void RequirementsChecked(int key,
                           std::string id,
                           Reply reply,
                           const extensions::PreloadCheck::Errors& errors) {
    if (!errors.empty()) {
      Drop(key);
      return reply.Error("The extension's requirements aren't met");
    }
    Drop(key);
    CheckPermissionsIncrease(id, std::move(reply));
  }

  void CheckPermissionsIncrease(const std::string& id, Reply reply) {
    const Extension* extension = Find(profile(), id);
    if (!extension) {
      return reply.Error("No such extension");
    }
    if (!extensions::ExtensionPrefs::Get(profile())
             ->DidExtensionEscalatePermissions(id)) {
      return Finish(id, std::move(reply), /*allowed=*/true);
    }
    content::WebContents* tab = PromptTab(profile());
    if (!tab) {
      return reply.Error("Open a window to re-enable this extension");
    }
    // A key now: the prompt may answer before SetEnabledFunctionDelegate
    // returns.
    const int key = ++next_key_;
    std::unique_ptr<extensions::InstallPromptDelegate> prompt =
        ManagementDelegate(profile())->SetEnabledFunctionDelegate(
            tab, profile(), extension,
            base::BindOnce(&ExtensionsState::Prompted,
                           weak_factory_.GetWeakPtr(), key, id,
                           std::move(reply)));
    if (!answered_.erase(key)) {
      kept_.emplace(key, std::unique_ptr<void, void (*)(void*)>(
                             prompt.release(), [](void* p) {
                               delete static_cast<
                                   extensions::InstallPromptDelegate*>(p);
                             }));
    }
  }

  void Prompted(int key, std::string id, Reply reply, bool allowed) {
    if (kept_.count(key)) {
      Drop(key);
    } else {
      answered_.insert(key);
    }
    Finish(id, std::move(reply), allowed);
  }

  void Finish(const std::string& id, Reply reply, bool allowed) {
    if (!allowed) {
      return reply.Error("The user didn't re-enable the extension");
    }
    if (!Find(profile(), id)) {
      return reply.Error("No such extension");
    }
    ManagementDelegate(profile())->EnableExtension(profile(), id);
    reply.Ok();
  }

  std::map<int, std::unique_ptr<void, void (*)(void*)>> kept_;
  std::set<int> answered_;
  int next_key_ = 0;
  base::WeakPtrFactory<ExtensionsState> weak_factory_{this};
};

// Whether the user may change the extension's settings or remove it (no
// policy holds it), as chrome://extensions' calls check.
bool UserMayModify(Profile* profile, const Extension* extension) {
  return extensions::ExtensionSystem::Get(profile)
      ->management_policy()
      ->UserMayModifySettings(extension, nullptr);
}

}  // namespace
}  // namespace netnyahoo

using netnyahoo::Call;
using netnyahoo::Reply;

#define NN_EXTENSIONS_CALL()                         \
  Call call(profile_dir, args_json, reply, context); \
  if (!call) {                                       \
    return;                                          \
  }

NN_ENGINE_CALL(nn_extensions_list) {
  NN_EXTENSIONS_CALL();
  netnyahoo::StateFor<netnyahoo::ExtensionsState>(call.profile())
      .List(call.TakeReply());
}

NN_ENGINE_CALL(nn_extensions_install) {
  NN_EXTENSIONS_CALL();
  const std::string path = call.String("path");
  if (path.empty() || path[0] != '/') {
    return call.TakeReply().Error("an absolute path required");
  }
  Profile* profile = call.profile();
  if (extensions::ExtensionManagementFactory::GetForBrowserContext(profile)
          ->BlocklistedByDefault()) {
    return call.TakeReply().Error(
        "Extension installation is blocked by policy.");
  }
  // Chrome keeps unpacked extensions off outside developer mode.
  extensions::util::SetDeveloperModeForProfile(profile, true);
  scoped_refptr<extensions::UnpackedInstaller> installer =
      extensions::UnpackedInstaller::Create(profile);
  installer->set_be_noisy_on_failure(false);
  installer->set_completion_callback(base::BindOnce(
      [](Reply reply, const extensions::Extension* extension,
         const base::FilePath&, const std::u16string& error) {
        if (!extension) {
          return reply.Error(error.empty()
                                 ? std::string("Could not load the extension")
                                 : base::UTF16ToUTF8(error));
        }
        reply.Send(base::DictValue().Set("id", extension->id()));
      },
      call.TakeReply()));
  installer->Load(base::FilePath(path));
}

NN_ENGINE_CALL(nn_extensions_set_enabled) {
  NN_EXTENSIONS_CALL();
  Profile* profile = call.profile();
  const std::string id = call.String("id");
  const bool enable = call.Bool("enabled");
  const extensions::Extension* extension = netnyahoo::Find(profile, id);
  if (!extension) {
    return call.TakeReply().Error("No such extension");
  }
  if (!netnyahoo::UserMayModify(profile, extension)) {
    return call.TakeReply().Error("The extension can't be changed");
  }
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile);
  const bool enabled = registry->enabled_extensions().Contains(id) ||
                       registry->terminated_extensions().Contains(id);
  if (enable == enabled) {
    return call.TakeReply().Ok();
  }
  if (!enable) {
    netnyahoo::ManagementDelegate(profile)->DisableExtension(
        profile, nullptr, id,
        extensions::disable_reason::DISABLE_USER_ACTION);
    return call.TakeReply().Ok();
  }
  if (extensions::ExtensionSystem::Get(profile)
          ->management_policy()
          ->MustRemainDisabled(extension, nullptr)) {
    return call.TakeReply().Error("The extension can't be changed");
  }
  netnyahoo::StateFor<netnyahoo::ExtensionsState>(profile).Enable(
      extension, call.TakeReply());
}

NN_ENGINE_CALL(nn_extensions_uninstall) {
  NN_EXTENSIONS_CALL();
  Profile* profile = call.profile();
  const std::string id = call.String("id");
  const extensions::Extension* extension = netnyahoo::Find(profile, id);
  if (!extension) {
    return call.TakeReply().Error("No such extension");
  }
  if (!netnyahoo::UserMayModify(profile, extension) ||
      extensions::ExtensionSystem::Get(profile)
          ->management_policy()
          ->MustRemainInstalled(extension, nullptr)) {
    return call.TakeReply().Error("The extension can't be removed");
  }
  // The app asked the user already (chrome.management.uninstall with
  // showConfirmDialog: false, as chrome://extensions called it).
  std::u16string error;
  if (!netnyahoo::ManagementDelegate(profile)->UninstallExtension(
          profile, id, extensions::UNINSTALL_REASON_MANAGEMENT_API, &error)) {
    return call.TakeReply().Error(error.empty() ? std::string("Not removed")
                                                : base::UTF16ToUTF8(error));
  }
  call.TakeReply().Ok();
}

NN_ENGINE_CALL(nn_extensions_reload) {
  NN_EXTENSIONS_CALL();
  const std::string id = call.String("id");
  if (!netnyahoo::Find(call.profile(), id)) {
    return call.TakeReply().Error("No such extension");
  }
  extensions::ExtensionRegistrar::Get(call.profile())
      ->ReloadExtensionWithQuietFailure(id);
  call.TakeReply().Ok();
}

NN_ENGINE_CALL(nn_extensions_configure) {
  NN_EXTENSIONS_CALL();
  Profile* profile = call.profile();
  const std::string id = call.String("id");
  if (!netnyahoo::Find(profile, id)) {
    return call.TakeReply().Error("No such extension");
  }
  // Pinning first: it needs the extension loaded, and file access and
  // incognito below may reload it (pinning is kept by id across a reload).
  // The rest in developerPrivate.updateExtensionConfiguration's order.
  if (std::optional<bool> pinned = call.args().FindBool("pinned")) {
    ToolbarActionsModel* model = ToolbarActionsModel::Get(profile);
    if (!model->HasAction(id)) {
      return call.TakeReply().Error(
          "Cannot pin an extension without an action");
    }
    if (model->IsActionPinned(id) != *pinned) {
      model->SetActionVisibility(id, *pinned);
    }
  }
  if (std::optional<bool> allow = call.args().FindBool("fileAccess")) {
    extensions::util::SetAllowFileAccess(id, profile, *allow);
  }
  if (std::optional<bool> allow = call.args().FindBool("incognito")) {
    extensions::util::SetIsIncognitoEnabled(id, profile, *allow);
  }
  if (const std::string* access = call.args().FindString("siteAccess")) {
    const extensions::Extension* extension = netnyahoo::Find(profile, id);
    extensions::PermissionsManager* manager =
        extensions::PermissionsManager::Get(profile);
    if (!extension || !manager->CanAffectExtension(*extension)) {
      return call.TakeReply().Error("Can't change this extension's site access");
    }
    extensions::ScriptingPermissionsModifier modifier(profile, extension);
    if (*access == "onClick") {
      modifier.SetWithholdHostPermissions(true);
      modifier.RemoveAllGrantedHostPermissions();
    } else if (*access == "specificSites") {
      if (manager->HasBroadGrantedHostPermissions(*extension)) {
        modifier.RemoveBroadGrantedHostPermissions();
      }
      modifier.SetWithholdHostPermissions(true);
    } else if (*access == "allSites") {
      modifier.SetWithholdHostPermissions(false);
    } else {
      return call.TakeReply().Error("unknown site access");
    }
  }
  call.TakeReply().Ok();
}
