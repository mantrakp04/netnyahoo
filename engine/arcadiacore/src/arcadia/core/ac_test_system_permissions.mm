#include "arcadia/core/ac_test_system_permissions.h"

#include <map>
#include <memory>
#include <string>
#include <utility>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/global_features.h"
#include "chrome/browser/permissions/system/platform_handle.h"
#include "chrome/browser/permissions/system/system_permission_settings.h"
#include "components/content_settings/core/common/content_settings_types.h"

namespace arcadiacore {

namespace {

constexpr char kSwitch[] = "arcadia-test-system-media-permission";

bool IsMedia(ContentSettingsType type) {
  return type == ContentSettingsType::MEDIASTREAM_CAMERA ||
         type == ContentSettingsType::MEDIASTREAM_MIC ||
         type == ContentSettingsType::CAMERA_PAN_TILT_ZOOM;
}

class TestSystemPermissions : public system_permission_settings::PlatformHandle {
 public:
  TestSystemPermissions(bool denied, base::TimeDelta answer_after)
      : denied_(denied), answer_after_(answer_after) {}

  bool CanPrompt(ContentSettingsType type) override {
    if (!IsMedia(type)) {
      return Real()->CanPrompt(type);
    }
    return !denied_ && !granted_[type];
  }
  bool IsDenied(ContentSettingsType type) override {
    return IsMedia(type) ? denied_ : Real()->IsDenied(type);
  }
  bool IsAllowed(ContentSettingsType type) override {
    return IsMedia(type) ? !denied_ && granted_[type] : Real()->IsAllowed(type);
  }
  void IsDeniedFresh(ContentSettingsType type,
                     system_permission_settings::SystemPermissionDeniedCallback
                         callback) override {
    if (!IsMedia(type)) {
      Real()->IsDeniedFresh(type, std::move(callback));
      return;
    }
    std::move(callback).Run(denied_);
  }
  void OpenSystemSettings(content::WebContents* web_contents,
                          ContentSettingsType type) override {
    if (!IsMedia(type)) {
      Real()->OpenSystemSettings(web_contents, type);
    }
  }
  // macOS's answer comes later, as it would: "Allow" when asking is possible.
  void Request(ContentSettingsType type,
               system_permission_settings::SystemPermissionResponseCallback
                   callback) override {
    if (!IsMedia(type)) {
      Real()->Request(type, std::move(callback));
      return;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(
            [](TestSystemPermissions* self, ContentSettingsType type,
               system_permission_settings::SystemPermissionResponseCallback callback) {
              if (!self->denied_) {
                self->granted_[type] = true;
              }
              std::move(callback).Run();
            },
            base::Unretained(this), type, std::move(callback)),
        answer_after_);
  }
  std::unique_ptr<system_permission_settings::ScopedObservation> Observe(
      system_permission_settings::SystemPermissionChangedCallback observer)
      override {
    return Real()->Observe(observer);
  }

 private:
  static system_permission_settings::PlatformHandle* Real() {
    return g_browser_process->GetFeatures()->system_permissions_platform_handle();
  }

  const bool denied_;
  const base::TimeDelta answer_after_;
  std::map<ContentSettingsType, bool> granted_;
};

}  // namespace

void MaybeInstallTestSystemPermissions() {
  const base::CommandLine* command_line = base::CommandLine::ForCurrentProcess();
  if (!command_line->HasSwitch(kSwitch)) {
    return;
  }
  const std::string value = command_line->GetSwitchValueASCII(kSwitch);
  // The stand-in lives for the process (NoDestructor), so its delayed answers never outlive it.
  static base::NoDestructor<TestSystemPermissions> handle(
      value == "denied", value == "ask-slow" ? base::Seconds(4) : base::TimeDelta());
  system_permission_settings::SetInstanceForTesting(handle.get());
}

}  // namespace arcadiacore
