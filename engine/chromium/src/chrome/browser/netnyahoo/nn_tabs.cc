// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_tabs.h"

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/sessions/content/session_tab_helper.h"
#include "components/tab_groups/tab_group_color.h"
#include "components/tab_groups/tab_group_id.h"
#include "components/tab_groups/tab_group_visual_data.h"
#include "components/tabs/public/tab_group.h"

namespace netnyahoo {
namespace {

constexpr const char* kColors[] = {"grey",   "blue",   "red",  "yellow", "green",
                                   "pink",   "purple", "cyan", "orange"};

std::string ColorName(tab_groups::TabGroupColorId color) {
  const int i = static_cast<int>(color);
  return i >= 0 && i < static_cast<int>(std::size(kColors)) ? kColors[i] : "grey";
}

std::optional<tab_groups::TabGroupColorId> ColorNamed(const std::string& name) {
  for (size_t i = 0; i < std::size(kColors); ++i) {
    if (name == kColors[i]) {
      return static_cast<tab_groups::TabGroupColorId>(i);
    }
  }
  return std::nullopt;
}

std::optional<tab_groups::TabGroupId> GroupNamed(TabStripModel* model,
                                                 const std::string& token) {
  if (!model->SupportsTabGroups()) {
    return std::nullopt;
  }
  for (const auto& id : model->group_model()->ListTabGroups()) {
    if (id.ToString() == token) {
      return id;
    }
  }
  return std::nullopt;
}

base::DictValue StripOf(BrowserWindowInterface* browser) {
  TabStripModel* model = browser->GetTabStripModel();
  base::ListValue tabs;
  for (int i = 0; i < model->count(); ++i) {
    const std::optional<tab_groups::TabGroupId> group =
        model->GetTabGroupForTab(i);
    tabs.Append(
        base::DictValue()
            .Set("tab",
                 sessions::SessionTabHelper::IdForTab(model->GetWebContentsAt(i))
                     .id())
            .Set("index", i)
            .Set("active", i == model->active_index())
            .Set("pinned", model->IsTabPinned(i))
            .Set("group", group ? base::Value(group->ToString()) : base::Value()));
  }
  base::ListValue groups;
  if (model->SupportsTabGroups()) {
    for (const auto& id : model->group_model()->ListTabGroups()) {
      const tab_groups::TabGroupVisualData* visuals =
          model->group_model()->GetTabGroup(id)->visual_data();
      groups.Append(base::DictValue()
                        .Set("id", id.ToString())
                        .Set("title", base::UTF16ToUTF8(visuals->title()))
                        .Set("color", ColorName(visuals->color()))
                        .Set("collapsed", visuals->is_collapsed()));
    }
  }
  return base::DictValue()
      .Set("window", browser->GetSessionID().id())
      .Set("tabs", std::move(tabs))
      .Set("groups", std::move(groups));
}

// Reports every Browser's strip after each change to it. Global: a Browser's
// strip is the same whichever profile asked.
class StripWatcher : public BrowserCollectionObserver,
                     public TabStripModelObserver {
 public:
  static StripWatcher& Get() {
    static base::NoDestructor<StripWatcher> watcher;
    return *watcher;
  }

  void Start() {
    if (started_) {
      return;
    }
    started_ = true;
    GlobalBrowserCollection* browsers = GlobalBrowserCollection::GetInstance();
    observation_.Observe(browsers);
    // Every strip as it is now, then every change.
    browsers->ForEach([this](BrowserWindowInterface* browser) {
      Watch(browser);
      Emit("tabs.strip", browser->GetProfile(), StripOf(browser));
      return true;
    });
  }

  // BrowserCollectionObserver:
  void OnBrowserCreated(BrowserWindowInterface* browser) override {
    Watch(browser);
  }
  void OnBrowserClosed(BrowserWindowInterface* browser) override {
    TabStripModel* model = browser->GetTabStripModel();
    if (model) {
      model->RemoveObserver(this);
    }
    Emit("tabs.strip", browser->GetProfile(),
         base::DictValue()
             .Set("window", browser->GetSessionID().id())
             .Set("closed", true));
  }

  // TabStripModelObserver:
  void OnTabStripModelChanged(TabStripModel* model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override {
    Report(model);
  }
  void OnTabPinnedStateChanged(tabs::TabInterface* tab, int index) override {
    // The model isn't given: report every strip the tab could be in.
    GlobalBrowserCollection::GetInstance()->ForEach(
        [this, tab](BrowserWindowInterface* browser) {
          TabStripModel* model = browser->GetTabStripModel();
          if (model && model->GetIndexOfTab(tab) != TabStripModel::kNoTab) {
            Report(model);
          }
          return true;
        });
  }
  void TabGroupedStateChanged(TabStripModel* model,
                              std::optional<tab_groups::TabGroupId> old_group,
                              std::optional<tab_groups::TabGroupId> new_group,
                              tabs::TabInterface* tab,
                              int index) override {
    Report(model);
  }
  void OnTabGroupChanged(const TabGroupChange& change) override {
    Report(change.model);
  }

 private:
  friend class base::NoDestructor<StripWatcher>;
  StripWatcher() = default;

  void Watch(BrowserWindowInterface* browser) {
    if (TabStripModel* model = browser->GetTabStripModel()) {
      model->AddObserver(this);
    }
  }

  void Report(TabStripModel* model) {
    if (!model) {
      return;
    }
    BrowserWindowInterface* found = nullptr;
    GlobalBrowserCollection::GetInstance()->ForEach(
        [&](BrowserWindowInterface* browser) {
          if (browser->GetTabStripModel() != model) {
            return true;
          }
          found = browser;
          return false;
        });
    if (found) {
      Emit("tabs.strip", found->GetProfile(), StripOf(found));
    }
  }

  bool started_ = false;
  base::ScopedObservation<BrowserCollection, BrowserCollectionObserver>
      observation_{this};
};

}  // namespace
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_tabs_watch) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StripWatcher::Get().Start();
  call.TakeReply().Ok();
}

NN_ENGINE_CALL(nn_tabs_group) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::Reply out = call.TakeReply();
  const std::optional<int> window = call.args().FindInt("window");
  BrowserWindowInterface* browser =
      window ? GlobalBrowserCollection::GetInstance()->FindBrowserWithID(
                   SessionID::FromSerializedValue(*window))
             : nullptr;
  TabStripModel* model = browser ? browser->GetTabStripModel() : nullptr;
  if (!model || !model->SupportsTabGroups()) {
    return out.Error("no such window");
  }
  std::vector<int> indices;
  if (const base::ListValue* tabs = call.args().FindList("tabs")) {
    for (const base::Value& tab : *tabs) {
      for (int i = 0; tab.is_int() && i < model->count(); ++i) {
        if (sessions::SessionTabHelper::IdForTab(model->GetWebContentsAt(i))
                .id() == tab.GetInt() &&
            !model->IsTabPinned(i)) {
          indices.push_back(i);
        }
      }
    }
  }
  std::sort(indices.begin(), indices.end());
  const std::string wanted = call.String("group");
  std::optional<tab_groups::TabGroupId> group;
  if (wanted.empty()) {
    if (!indices.empty()) {
      model->RemoveFromGroup(indices);
    }
    return out.Send(base::DictValue().Set("group", ""));
  }
  if (wanted == "new") {
    if (indices.empty()) {
      return out.Error("no tabs");
    }
    group = model->AddToNewGroup(indices);
  } else {
    group = netnyahoo::GroupNamed(model, wanted);
    if (!group) {
      return out.Error("no such group");
    }
    if (!indices.empty()) {
      model->AddToExistingGroup(indices, *group);
    }
  }
  const std::string* title = call.args().FindString("title");
  const std::string* color = call.args().FindString("color");
  const std::optional<bool> collapsed = call.args().FindBool("collapsed");
  if (title || color || collapsed) {
    const tab_groups::TabGroupVisualData* now =
        model->group_model()->GetTabGroup(*group)->visual_data();
    tab_groups::TabGroupVisualData visuals(
        title ? base::UTF8ToUTF16(*title) : now->title(),
        color ? netnyahoo::ColorNamed(*color).value_or(now->color())
              : now->color(),
        collapsed.value_or(now->is_collapsed()));
    model->ChangeTabGroupVisuals(*group, visuals);
  }
  out.Send(base::DictValue().Set("group", group->ToString()));
}
