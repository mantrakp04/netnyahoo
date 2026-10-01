// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Closed tabs: Chrome's TabRestoreService already records every tab the app
// closes (with its whole back/forward list, on disk in Sessions/Tabs_*). The
// app keeps its own list of what was closed, with its product rules (groups,
// pinned tiles, splits), and takes a tab's navigations back from Chrome when it
// reopens it.
//
//   nn_tab_restore_take({url, closedAt}) -> {state: "<base64>" | null}
//     The navigations of the closed tab showing |url| (the engine's form, the
//     fragment ignored) closed within a minute of |closedAt| (ms since the
//     epoch), the closest, in the
//     format CefBrowserHost::RestoreTabInBrowser reads (its
//     GetNavigationState: version 1, selected index, count, then each
//     SerializedNavigationEntry as session restore pickles it). A tab entry
//     of its own leaves Chrome's list; one inside a closed window or group
//     stays there (removing it would remove the whole window) but isn't
//     handed out again.
//
// The last session's entries load on the first call (and on
// nn_tab_restore_load, which the app calls at launch).

#include <cmath>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/no_destructor.h"
#include "base/pickle.h"
#include "base/scoped_observation.h"
#include "base/time/time.h"
#include "chrome/browser/netnyahoo/nn_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/sessions/tab_restore_service_factory.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/tab_restore_service.h"
#include "components/sessions/core/tab_restore_service_observer.h"
#include "components/sessions/core/tab_restore_types.h"
#include "url/gurl.h"

namespace netnyahoo {

namespace {

constexpr int kNavigationStateVersion = 1;
constexpr int kMaxNavigationEntryBytes = 256 * 1024;
// The app notes a close a moment before Chrome does (the tab's view goes
// first): the same page closed within this of the app's time is the tab.
// Anything else loads the page fresh rather than risk another tab's history.
constexpr base::TimeDelta kSameUrlWindow = base::Seconds(60);

using sessions::tab_restore::Entry;
using sessions::tab_restore::Group;
using sessions::tab_restore::Tab;
using sessions::tab_restore::Type;
using sessions::tab_restore::Window;

GURL WithoutRef(const GURL& url) {
  if (!url.has_ref()) {
    return url;
  }
  GURL::Replacements clear;
  clear.ClearRef();
  return url.ReplaceComponents(clear);
}

// Tabs already handed out from a window or group entry, by entry id.
std::set<SessionID::id_type>& Taken() {
  static base::NoDestructor<std::set<SessionID::id_type>> taken;
  return *taken;
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
          const GURL& url,
          base::Time closed_at,
          Reply reply) {
  std::vector<Candidate> candidates;
  for (const auto& entry : service->entries()) {
    Collect(*entry, &candidates);
  }
  const GURL page = WithoutRef(url);
  const Candidate* best = nullptr;
  base::TimeDelta best_delta = base::TimeDelta::Max();
  for (const auto& candidate : candidates) {
    const Tab& tab = *candidate.tab;
    if (tab.navigations.empty() || Taken().contains(tab.id.id())) {
      continue;
    }
    const base::TimeDelta delta = (tab.timestamp - closed_at).magnitude();
    const GURL shown =
        tab.navigations[tab.normalized_navigation_index()].virtual_url();
    if (WithoutRef(shown) == page && delta <= kSameUrlWindow &&
        delta < best_delta) {
      best = &candidate;
      best_delta = delta;
    }
  }
  if (!best) {
    return reply.Send(base::DictValue().Set("state", base::Value()));
  }
  std::string state = NavigationState(*best->tab);
  if (best->top_level) {
    service->RemoveEntryById(best->tab->id);
  } else {
    Taken().insert(best->tab->id.id());
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
  GURL url(call.String("url"));
  base::Time closed_at =
      base::Time::FromMillisecondsSinceUnixEpoch(call.Double("closedAt"));
  base::WeakPtr<Profile> profile = call.profile()->GetWeakPtr();
  netnyahoo::WhenLoaded::Run(
      service, base::BindOnce(
                   [](base::WeakPtr<Profile> profile, GURL url,
                      base::Time closed_at, Reply reply) {
                     auto* service =
                         profile ? netnyahoo::ServiceFor(profile.get()) : nullptr;
                     if (!service) {
                       return reply.Error("profile went away");
                     }
                     netnyahoo::Take(service, url, closed_at, std::move(reply));
                   },
                   profile, std::move(url), closed_at, call.TakeReply()));
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
