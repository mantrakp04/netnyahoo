// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_process.h"

#include <cmath>
#include <optional>
#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/system/sys_info.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/task_manager/providers/task.h"
#include "chrome/browser/task_manager/task_manager_interface.h"
#include "chrome/browser/task_manager/task_manager_observer.h"
#include "components/component_updater/component_updater_service.h"
#include "components/sessions/core/session_id.h"
#include "components/update_client/crx_update_item.h"
#include "components/update_client/update_client.h"
#include "content/public/browser/browser_thread.h"

namespace netnyahoo {
namespace {

// The arguments of a call that needs no profile, or nullopt (and the reply
// has the error).
std::optional<base::DictValue> ArgsOf(const char* args_json, Reply& reply) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!args_json || !*args_json) {
    return base::DictValue();
  }
  std::optional<base::Value> parsed =
      base::JSONReader::Read(args_json, base::JSON_PARSE_CHROMIUM_EXTENSIONS);
  if (!parsed || !parsed->is_dict()) {
    reply.Error("arguments are not a JSON object");
    return std::nullopt;
  }
  return std::move(*parsed).TakeDict();
}

const char* TypeName(task_manager::Task::Type type) {
  using task_manager::Task;
  switch (type) {
    case Task::BROWSER:
      return "browser";
    case Task::GPU:
      return "gpu";
    case Task::ZYGOTE:
      return "zygote";
    case Task::UTILITY:
      return "utility";
    case Task::RENDERER:
      return "renderer";
    case Task::EXTENSION:
      return "extension";
    case Task::GUEST:
      return "guest";
    case Task::SANDBOX_HELPER:
      return "sandboxHelper";
    case Task::DEDICATED_WORKER:
      return "dedicatedWorker";
    case Task::SHARED_WORKER:
      return "sharedWorker";
    case Task::SERVICE_WORKER:
      return "serviceWorker";
    default:
      return "unknown";
  }
}

const char* StateName(update_client::ComponentState state) {
  using update_client::ComponentState;
  switch (state) {
    case ComponentState::kNew:
      return "new";
    case ComponentState::kChecking:
      return "checking";
    case ComponentState::kCanUpdate:
      return "canUpdate";
    case ComponentState::kDownloading:
      return "downloading";
    case ComponentState::kDecompressing:
      return "decompressing";
    case ComponentState::kPatching:
      return "patching";
    case ComponentState::kUpdating:
      return "updating";
    case ComponentState::kUpdated:
      return "updated";
    case ComponentState::kUpToDate:
      return "upToDate";
    case ComponentState::kUpdateError:
      return "updateError";
    case ComponentState::kRun:
      return "run";
  }
  return "unknown";
}

// Keeps Chrome's task manager sampling while the app asks (as CEF's
// CefTaskManager: every 2 s, CPU, memory footprint and GPU memory), and lets
// it stop 15 s after the last call.
class Sampler : public task_manager::TaskManagerObserver {
 public:
  Sampler()
      : TaskManagerObserver(base::Seconds(2),
                            task_manager::REFRESH_TYPE_CPU |
                                task_manager::REFRESH_TYPE_GPU_MEMORY |
                                task_manager::REFRESH_TYPE_MEMORY_FOOTPRINT) {}

  // The task manager, sampling until 15 s from now.
  task_manager::TaskManagerInterface* Use() {
    task_manager::TaskManagerInterface* manager =
        task_manager::TaskManagerInterface::GetTaskManager();
    if (!observed_task_manager()) {
      manager->AddObserver(this);
    }
    idle_.Start(FROM_HERE, base::Seconds(15),
                base::BindOnce(&Sampler::Stop, base::Unretained(this)));
    return manager;
  }

 private:
  void Stop() {
    if (observed_task_manager()) {
      observed_task_manager()->RemoveObserver(this);
    }
  }

  base::OneShotTimer idle_;
};

Sampler& TheSampler() {
  static base::NoDestructor<Sampler> sampler;
  return *sampler;
}

}  // namespace
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_tasks_list) {
  netnyahoo::Reply out(reply, context);
  if (!netnyahoo::ArgsOf(args_json, out)) {
    return;
  }
  task_manager::TaskManagerInterface* manager = netnyahoo::TheSampler().Use();
  const int processors = base::SysInfo::NumberOfProcessors();
  base::ListValue tasks;
  for (task_manager::TaskId id : manager->GetTaskIdsList()) {
    double cpu = manager->GetPlatformIndependentCPUUsage(id);
    if (!std::isfinite(cpu)) {
      cpu = 0;
    }
    const auto memory = manager->GetMemoryFootprintUsage(id);
    bool duplicates = false;
    const auto gpu_memory = manager->GetGpuMemoryUsage(id, &duplicates);
    base::ListValue tab_ids;
    if (const SessionID tab = manager->GetTabId(id); tab.is_valid()) {
      tab_ids.Append(tab.id());
    }
    tasks.Append(
        base::DictValue()
            .Set("id", static_cast<double>(id))
            .Set("type", netnyahoo::TypeName(manager->GetType(id)))
            .Set("title", base::UTF16ToUTF8(manager->GetTitle(id)))
            .Set("killable", manager->IsTaskKillable(id))
            .Set("cpu", cpu)
            .Set("processors", processors)
            .Set("memory",
                 memory ? static_cast<double>(memory->InBytes()) : 0.0)
            .Set("gpuMemory",
                 gpu_memory ? static_cast<double>(gpu_memory->InBytes()) : 0.0)
            .Set("tabIds", std::move(tab_ids))
            .Set("browserIds", base::ListValue()));
  }
  out.Send(base::DictValue().Set("tasks", std::move(tasks)));
}

NN_ENGINE_CALL(nn_tasks_kill) {
  netnyahoo::Reply out(reply, context);
  std::optional<base::DictValue> args = netnyahoo::ArgsOf(args_json, out);
  if (!args) {
    return;
  }
  const std::optional<double> id = args->FindDouble("id");
  if (!id || !std::isfinite(*id)) {
    return out.Error("id required");
  }
  const auto task = static_cast<task_manager::TaskId>(*id);
  task_manager::TaskManagerInterface* manager = netnyahoo::TheSampler().Use();
  const bool killable = manager->IsTaskValid(task) &&
                        manager->IsTaskKillable(task);
  out.Send(base::DictValue().Set("ok", killable && manager->KillTask(task)));
}

NN_ENGINE_CALL(nn_components_list) {
  netnyahoo::Reply out(reply, context);
  if (!netnyahoo::ArgsOf(args_json, out)) {
    return;
  }
  base::ListValue components;
  component_updater::ComponentUpdateService* updater =
      g_browser_process ? g_browser_process->component_updater() : nullptr;
  if (updater) {
    for (const component_updater::ComponentInfo& info :
         updater->GetComponents()) {
      update_client::CrxUpdateItem item;
      const char* state = updater->GetComponentDetails(info.id, &item)
                              ? netnyahoo::StateName(item.state)
                              : "unknown";
      components.Append(
          base::DictValue()
              .Set("id", info.id)
              .Set("name", base::UTF16ToUTF8(info.name))
              .Set("version",
                   info.version.IsValid() ? info.version.GetString() : "")
              .Set("state", state));
    }
  }
  out.Send(base::DictValue().Set("components", std::move(components)));
}
