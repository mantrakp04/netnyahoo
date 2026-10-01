// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Closed tabs: Chrome's TabRestoreService already records every tab the app
// closes (with its whole back/forward list, on disk in Sessions/Tabs_*). The
// app keeps its own list of what was closed, with its product rules (groups,
// pinned tiles, splits), and takes a tab's navigations back from Chrome when it
// reopens it.
//
//   nn_tab_restore_tag({tab, key}): names the open tab |tab| (its chrome.tabs
//     id) by |key| (the app's tab id) on each of its navigations, as session
//     data Chrome saves with them: call it as the app closes the tab, so the
//     entry Chrome records carries it, on disk too.
//   nn_tab_restore_take({key}) -> {state: "<base64>" | null}
//     The navigations of the closed tab named |key|, in the format
//     CefBrowserHost::RestoreTabInBrowser reads (its GetNavigationState:
//     version 1, selected index, count, then each SerializedNavigationEntry as
//     session restore pickles it). Of several (a tab closed with its window
//     too), the newest. A tab entry of its own leaves Chrome's list; one inside
//     a closed window or group stays (removing it would remove the whole
//     window). Without one, null: the app loads the page.
//
// The last session's entries load on the first take (and on
// nn_tab_restore_load).

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/no_destructor.h"
#include "base/pickle.h"
#include "base/scoped_observation.h"
#include "base/time/time.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/netnyahoo/nn_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/sessions/tab_restore_service_factory.h"
#include "components/sessions/content/content_serialized_navigation_driver.h"
#include "components/sessions/content/extended_info_handler.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/tab_restore_service.h"
#include "components/sessions/core/tab_restore_service_observer.h"
#include "components/sessions/core/tab_restore_types.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "url/gurl.h"

namespace netnyahoo {

namespace {

constexpr int kNavigationStateVersion = 1;
constexpr int kMaxNavigationEntryBytes = 256 * 1024;
// The session data key: once registered, always this.
constexpr char kTabKey[] = "nn_tab";

using sessions::tab_restore::Entry;
using sessions::tab_restore::Group;
using sessions::tab_restore::Tab;
using sessions::tab_restore::Type;
using sessions::tab_restore::Window;

// The app's tab id, kept on a tab's NavigationEntries and saved with them.
struct TabKeyData : public base::SupportsUserData::Data {
  explicit TabKeyData(std::string key) : key(std::move(key)) {}
  std::string key;
};
const char kTabKeyData[] = "nn_tab";

class TabKeyHandler : public sessions::ExtendedInfoHandler {
 public:
  std::string GetExtendedInfo(content::NavigationEntry* entry) const override {
    auto* data = static_cast<TabKeyData*>(entry->GetUserData(kTabKeyData));
    return data ? data->key : std::string();
  }
  void RestoreExtendedInfo(const std::string& info,
                           content::NavigationEntry* entry) override {
    entry->SetUserData(kTabKeyData, std::make_unique<TabKeyData>(info));
  }
};

void RegisterTabKey() {
  static bool registered = false;
  if (registered) {
    return;
  }
  registered = true;
  sessions::ContentSerializedNavigationDriver::GetInstance()
      ->RegisterExtendedInfoHandler(kTabKey,
                                    std::make_unique<TabKeyHandler>());
}

bool HasKey(const Tab& tab, const std::string& key) {
  for (const auto& navigation : tab.navigations) {
    auto it = navigation.extended_info_map().find(kTabKey);
    if (it != navigation.extended_info_map().end() && it->second == key) {
      return true;
    }
  }
  return false;
}

struct Candidate {
  const Tab* tab = nullptr;
  bool top_level = false;
};

void Collect(const Entry& entry, std::vector<Candidate>* out) {
  switch (entry.type) {
    case Type::TAB:
      out->push_back({static_cast<const Tab*>(&entry), true});
      break;
    case Type::WINDOW:
      for (const auto& tab : static_cast<const Window&>(entry).tabs) {
        out->push_back({tab.get(), false});
      }
      break;
    case Type::GROUP:
      for (const auto& tab : static_cast<const Group&>(entry).tabs) {
        out->push_back({tab.get(), false});
      }
      break;
    default:
      break;
  }
}

std::string NavigationState(const Tab& tab) {
  base::Pickle pickle;
  pickle.WriteInt(kNavigationStateVersion);
  pickle.WriteInt(tab.normalized_navigation_index());
  pickle.WriteInt(static_cast<int>(tab.navigations.size()));
  for (const auto& navigation : tab.navigations) {
    navigation.WriteToPickle(kMaxNavigationEntryBytes, &pickle);
  }
  return base::Base64Encode(pickle.AsBytes());
}

void Take(sessions::TabRestoreService* service,
          const std::string& key,
          Reply reply) {
  std::vector<Candidate> candidates;
  for (const auto& entry : service->entries()) {
    Collect(*entry, &candidates);
  }
  const Candidate* best = nullptr;
  for (const auto& candidate : candidates) {
    const Tab& tab = *candidate.tab;
    if (!tab.navigations.empty() && HasKey(tab, key) &&
        (!best || tab.timestamp > best->tab->timestamp)) {
      best = &candidate;
    }
  }
  if (!best) {
    return reply.Send(base::DictValue().Set("state", base::Value()));
  }
  std::string state = NavigationState(*best->tab);
  if (best->top_level) {
    service->RemoveEntryById(best->tab->id);
  }
  reply.Send(base::DictValue().Set("state", std::move(state)));
}

// Runs |then| once the service has the last session's entries.
class WhenLoaded : public sessions::TabRestoreServiceObserver {
 public:
  static void Run(sessions::TabRestoreService* service,
                  base::OnceClosure then) {
    if (service->IsLoaded()) {
      return std::move(then).Run();
    }
    new WhenLoaded(service, std::move(then));
    service->LoadTabsFromLastSession();
  }

  void TabRestoreServiceLoaded(sessions::TabRestoreService*) override {
    Finish();
  }
  void TabRestoreServiceDestroyed(sessions::TabRestoreService*) override {
    observation_.Reset();
    delete this;
  }

 private:
  WhenLoaded(sessions::TabRestoreService* service, base::OnceClosure then)
      : then_(std::move(then)) {
    observation_.Observe(service);
  }

  void Finish() {
    observation_.Reset();
    base::OnceClosure then = std::move(then_);
    delete this;
    std::move(then).Run();
  }

  base::OnceClosure then_;
  base::ScopedObservation<sessions::TabRestoreService,
                          sessions::TabRestoreServiceObserver>
      observation_{this};
};

sessions::TabRestoreService* ServiceFor(Profile* profile) {
  return profile && !profile->IsOffTheRecord()
             ? TabRestoreServiceFactory::GetForProfile(profile)
             : nullptr;
}

}  // namespace

}  // namespace netnyahoo

using netnyahoo::Call;
using netnyahoo::Reply;

NN_ENGINE_CALL(nn_tab_restore_take) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  sessions::TabRestoreService* service =
      netnyahoo::ServiceFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no tab restore service");
  }
  const std::string key = call.String("key");
  if (key.empty()) {
    return call.TakeReply().Error("no key");
  }
  base::WeakPtr<Profile> profile = call.profile()->GetWeakPtr();
  netnyahoo::WhenLoaded::Run(
      service, base::BindOnce(
                   [](base::WeakPtr<Profile> profile, std::string key,
                      Reply reply) {
                     auto* service =
                         profile ? netnyahoo::ServiceFor(profile.get()) : nullptr;
                     if (!service) {
                       return reply.Error("profile went away");
                     }
                     netnyahoo::Take(service, key, std::move(reply));
                   },
                   profile, key, call.TakeReply()));
}

NN_ENGINE_CALL(nn_tab_restore_load) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  sessions::TabRestoreService* service =
      netnyahoo::ServiceFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no tab restore service");
  }
  netnyahoo::WhenLoaded::Run(
      service, base::BindOnce([](Reply reply) { reply.Ok(); }, call.TakeReply()));
}

NN_ENGINE_CALL(nn_tab_restore_tag) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  const std::string key = call.String("key");
  content::WebContents* contents = nullptr;
  if (key.empty() ||
      !extensions::ExtensionTabUtil::GetTabById(
          static_cast<int>(call.Double("tab", -1)), call.profile(),
          /*include_incognito=*/false, &contents) ||
      !contents) {
    return call.TakeReply().Error("no such tab");
  }
  netnyahoo::RegisterTabKey();
  content::NavigationController& controller = contents->GetController();
  for (int i = 0; i < controller.GetEntryCount(); ++i) {
    controller.GetEntryAtIndex(i)->SetUserData(
        netnyahoo::kTabKeyData, std::make_unique<netnyahoo::TabKeyData>(key));
  }
  if (content::NavigationEntry* pending = controller.GetPendingEntry()) {
    pending->SetUserData(netnyahoo::kTabKeyData,
                         std::make_unique<netnyahoo::TabKeyData>(key));
  }
  call.TakeReply().Ok();
}
