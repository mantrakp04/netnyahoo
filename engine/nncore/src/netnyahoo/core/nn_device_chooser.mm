// A page's device chooser (WebUSB, WebHID, Web Serial, Web Bluetooth requestDevice) in the
// host's tabs goes to the host (JS DeviceChooser), as CEF's HandleDeviceChooser seam did:
// Chrome's bubble anchors to a toolbar our Browsers don't have. Chrome's ChooserController
// keeps finding devices; the host shows them and answers.

#include "netnyahoo/core/nn_device_chooser.h"

#import <Foundation/Foundation.h>

#include <map>
#include <memory>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/permissions/chooser_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "netnyahoo/core/nn_browser.h"

namespace nncore {

namespace {

class DeviceChooser;

std::map<int, std::unique_ptr<DeviceChooser>>& Live() {
  static base::NoDestructor<std::map<int, std::unique_ptr<DeviceChooser>>> live;
  return *live;
}

class DeviceChooser : public permissions::ChooserController::View {
 public:
  DeviceChooser(std::unique_ptr<permissions::ChooserController> controller,
                content::WebContents* contents)
      : controller_(std::move(controller)), contents_(contents->GetWeakPtr()) {
    static int last_id = 0;
    id_ = ++last_id;
    controller_->set_view(this);
  }
  ~DeviceChooser() override {
    if (controller_) {
      controller_->set_view(nullptr);
    }
  }

  int id() const { return id_; }
  base::WeakPtr<DeviceChooser> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  // JS DeviceChooser without browserId (the host knows the tab).
  NSDictionary* State() const {
    NSMutableArray* options = [NSMutableArray array];
    NSMutableDictionary* state =
        [@{@"id" : @(id_), @"open" : @(open_), @"options" : options} mutableCopy];
    if (!open_ || !controller_) {
      return state;
    }
    permissions::ChooserController* c = controller_.get();
    state[@"title"] = base::SysUTF16ToNSString(c->GetTitle());
    state[@"okLabel"] = base::SysUTF16ToNSString(c->GetOkButtonLabel());
    state[@"cancelLabel"] = base::SysUTF16ToNSString(c->GetCancelButtonLabel());
    state[@"noOptionsText"] = base::SysUTF16ToNSString(c->GetNoOptionsText());
    state[@"scanningText"] =
        base::SysUTF16ToNSString(c->GetThrobberLabelAndTooltip().first);
    state[@"refreshing"] = @(refreshing_);
    state[@"canRefresh"] = @(c->ShouldShowReScanButton());
    state[@"adapterOff"] = @(c->ShouldShowAdapterOffView() && !adapter_on_);
    state[@"unauthorized"] =
        @(c->ShouldShowAdapterUnauthorizedView() && !authorized_);
    state[@"bothButtonsEnabled"] = @(c->BothButtonsAlwaysEnabled());
    state[@"showSignal"] = @(c->ShouldShowIconBeforeText());
    for (size_t i = 0; i < c->NumOptions(); ++i) {
      [options addObject:@{
        @"name" : base::SysUTF16ToNSString(c->GetOption(i)),
        @"connected" : @(c->IsConnected(i)),
        @"paired" : @(c->IsPaired(i)),
        @"signal" : @(c->ShouldShowIconBeforeText() ? c->GetSignalStrengthLevel(i) : -1),
      }];
    }
    return state;
  }

  void Select(int index) {
    if (!open_ || !controller_) {
      return;
    }
    // A scanning prompt has no options to pick: OK allows it.
    std::vector<size_t> indices;
    if (index >= 0 && static_cast<size_t>(index) < controller_->NumOptions()) {
      indices.push_back(static_cast<size_t>(index));
    } else if (!controller_->BothButtonsAlwaysEnabled()) {
      return;
    }
    std::unique_ptr<permissions::ChooserController> controller = Finish();
    controller->Select(indices);
    Release(std::move(controller));
  }

  void Cancel() {
    if (!open_ || !controller_) {
      return;
    }
    std::unique_ptr<permissions::ChooserController> controller = Finish();
    controller->Cancel();
    Release(std::move(controller));
  }

  void Refresh() {
    if (open_ && controller_) {
      controller_->RefreshOptions();
    }
  }

  void OpenSettings() {
    if (open_ && controller_) {
      controller_->OpenPermissionPreferences();
    }
  }

  // The page's request went (navigation, the tab closing): Chrome closes it.
  void CloseFromChrome() {
    if (open_) {
      Release(Finish());
    }
  }

  void Announce() {
    announced_ = true;
    Changed();
  }

  // permissions::ChooserController::View:
  void OnOptionsInitialized() override { Changed(); }
  void OnOptionAdded(size_t index) override { Changed(); }
  void OnOptionRemoved(size_t index) override { Changed(); }
  void OnOptionUpdated(size_t index) override { Changed(); }
  void OnAdapterEnabledChanged(bool enabled) override {
    adapter_on_ = enabled;
    Changed();
  }
  void OnAdapterAuthorizationChanged(bool authorized) override {
    authorized_ = authorized;
    Changed();
  }
  void OnRefreshStateChanged(bool refreshing) override {
    refreshing_ = refreshing;
    Changed();
  }

 private:
  void Changed() {
    if (!announced_ || !contents_) {
      return;
    }
    HostDeviceChooser(contents_.get(), State());
  }

  // Closed: the host hears it, and the object goes. Returns the controller to finish with.
  std::unique_ptr<permissions::ChooserController> Finish() {
    open_ = false;
    Changed();
    controller_->set_view(nullptr);
    std::unique_ptr<permissions::ChooserController> controller = std::move(controller_);
    // This object goes on the next turn (the caller may be inside it).
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce([](int id) { Live().erase(id); }, id_));
    return controller;
  }

  // The controller may still be calling out: let it go after this task.
  static void Release(std::unique_ptr<permissions::ChooserController> controller) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce([](std::unique_ptr<permissions::ChooserController>) {},
                       std::move(controller)));
  }

  std::unique_ptr<permissions::ChooserController> controller_;
  base::WeakPtr<content::WebContents> contents_;
  int id_;
  bool open_ = true;
  bool announced_ = false;
  bool refreshing_ = false;
  bool adapter_on_ = true;
  bool authorized_ = true;
  base::WeakPtrFactory<DeviceChooser> weak_factory_{this};
};

DeviceChooser* Find(int id) {
  auto it = Live().find(id);
  return it == Live().end() ? nullptr : it->second.get();
}

}  // namespace

bool HandleDeviceChooser(content::RenderFrameHost* owner,
                         std::unique_ptr<permissions::ChooserController>* controller,
                         base::OnceClosure* close_closure) {
  content::WebContents* contents =
      owner ? content::WebContents::FromRenderFrameHost(owner) : nullptr;
  BrowserWindowInterface* browser =
      contents ? GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents)
               : nullptr;
  if (!browser || !WindowHost::ForBrowser(browser) || !controller || !*controller ||
      !HostWantsDeviceChoosers()) {
    return false;
  }
  auto chooser = std::make_unique<DeviceChooser>(std::move(*controller), contents);
  DeviceChooser* raw = chooser.get();
  Live()[raw->id()] = std::move(chooser);
  *close_closure = base::BindOnce(
      [](base::WeakPtr<DeviceChooser> chooser) {
        if (chooser) {
          chooser->CloseFromChrome();
        }
      },
      raw->GetWeakPtr());
  // Not from inside Chrome's request: the host may answer at once.
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<DeviceChooser> chooser) {
                       if (chooser) {
                         chooser->Announce();
                       }
                     },
                     raw->GetWeakPtr()));
  return true;
}

void SelectDevice(int chooser_id, int index) {
  if (DeviceChooser* chooser = Find(chooser_id)) {
    chooser->Select(index);
  }
}

void CancelDeviceChooser(int chooser_id) {
  if (DeviceChooser* chooser = Find(chooser_id)) {
    chooser->Cancel();
  }
}

void RefreshDeviceChooser(int chooser_id) {
  if (DeviceChooser* chooser = Find(chooser_id)) {
    chooser->Refresh();
  }
}

void OpenDeviceChooserSettings(int chooser_id) {
  if (DeviceChooser* chooser = Find(chooser_id)) {
    chooser->OpenSettings();
  }
}

}  // namespace nncore
