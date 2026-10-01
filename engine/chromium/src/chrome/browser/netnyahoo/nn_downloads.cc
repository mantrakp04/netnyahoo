// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_downloads.h"

#include <stdlib.h>

#include <algorithm>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/download/download_crx_util.h"
#include "chrome/browser/download/download_prefs.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/download/content/public/all_download_item_notifier.h"
#include "components/download/public/common/download_interrupt_reasons.h"
#include "components/download/public/common/download_item.h"
#include "content/public/browser/download_item_utils.h"
#include "content/public/browser/download_manager.h"
#include "extensions/browser/webstore_installer.h"

namespace netnyahoo {
namespace {

using download::DownloadItem;

constexpr base::TimeDelta kProgressInterval = base::Milliseconds(100);

const char* StateName(const DownloadItem& item) {
  switch (item.GetState()) {
    case DownloadItem::COMPLETE:
      return "finished";
    case DownloadItem::CANCELLED:
      return "cancelled";
    case DownloadItem::INTERRUPTED:
      return "failed";
    default:
      return "downloading";
  }
}

// Chrome's own downloads of an extension to install (the Web Store's .crx, which
// WebstoreInstaller fetches and CrxInstaller installs and deletes), and transient ones: never
// the user's downloads.
bool Listed(DownloadItem* item) {
  // The installer's own download says so from the start (its approval comes a moment later).
  if (item->IsTransient() ||
      item->GetDownloadSource() == download::DownloadSource::EXTENSION_INSTALLER ||
      extensions::WebstoreInstaller::GetAssociatedApproval(*item)) {
    return false;
  }
  content::BrowserContext* context =
      content::DownloadItemUtils::GetBrowserContext(item);
  return !context || !download_crx_util::IsTrustedExtensionDownload(
                         Profile::FromBrowserContext(context), *item);
}

bool IsOffTheRecord(DownloadItem* item) {
  content::BrowserContext* context =
      content::DownloadItemUtils::GetBrowserContext(item);
  return context && context->IsOffTheRecord();
}

base::DictValue Describe(DownloadItem* item) {
  base::FilePath path = item->GetTargetFilePath();
  if (path.empty()) {
    path = item->GetFullPath();
  }
  base::FilePath name = item->GetFileNameToReportUser();
  if (name.empty()) {
    name = path.BaseName();
  }
  const int64_t total = item->GetTotalBytes();
  return base::DictValue()
      .Set("id", item->GetGuid())
      .Set("url", item->GetOriginalUrl().spec())
      .Set("filename", name.value())
      .Set("path", path.value())
      .Set("state", StateName(*item))
      .Set("paused", item->IsPaused())
      .Set("received", static_cast<double>(item->GetReceivedBytes()))
      .Set("total", total > 0 ? static_cast<double>(total) : -1.0)
      .Set("speed", static_cast<double>(item->CurrentSpeed()))
      .Set("mimeType", item->GetMimeType())
      .Set("dangerous", item->IsDangerous() || item->IsInsecure())
      .Set("error", item->GetLastReason() ==
                            download::DOWNLOAD_INTERRUPT_REASON_NONE
                        ? base::Value()
                        : base::Value(download::DownloadInterruptReasonToString(
                              item->GetLastReason())))
      .Set("offTheRecord", IsOffTheRecord(item))
      .Set("startTime", item->GetStartTime().InMillisecondsFSinceUnixEpoch());
}

class DownloadsState;

// One download manager: the original profile's or a private profile's.
class Watch : public download::AllDownloadItemNotifier::Observer,
              public ProfileObserver {
 public:
  Watch(DownloadsState* owner, Profile* profile);
  ~Watch() override = default;

  Profile* profile() const { return profile_; }
  content::DownloadManager* manager() const { return notifier_.GetManager(); }

 private:
  // download::AllDownloadItemNotifier::Observer
  void OnDownloadCreated(content::DownloadManager*, DownloadItem* item) override;
  void OnDownloadUpdated(content::DownloadManager*, DownloadItem* item) override;
  void OnDownloadRemoved(content::DownloadManager*, DownloadItem* item) override;

  // ProfileObserver
  void OnProfileWillBeDestroyed(Profile* profile) override;

  raw_ptr<DownloadsState> owner_;
  raw_ptr<Profile> profile_;
  download::AllDownloadItemNotifier notifier_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

// The profile's downloads and its private profiles', with what this session
// has seen of each.
class DownloadsState : public ProfileState {
 public:
  explicit DownloadsState(Profile* profile) : ProfileState(profile) {
    // As CEF's engine: straight to the folder, never a save panel. The
    // ungoogled patches default "Ask where to save each file" to on; only
    // that default changes (nn_prefs_set can turn it back on).
    PrefService* prefs = profile->GetPrefs();
    if (const PrefService::Preference* prompt =
            prefs->FindPreference(prefs::kPromptForDownload);
        prompt && prompt->IsDefaultValue() && prompt->IsUserModifiable()) {
      prefs->SetBoolean(prefs::kPromptForDownload, false);
    }
    if (const char* dir = getenv("NETNYAHOO_DOWNLOADS_DIR"); dir && *dir) {
      DownloadPrefs::FromBrowserContext(profile)->SetDownloadPath(
          base::FilePath(dir));
    }
    watches_.push_back(std::make_unique<Watch>(this, profile));
    for (Profile* off_the_record : profile->GetAllOffTheRecordProfiles()) {
      OnOffTheRecordProfileCreated(off_the_record);
    }
  }

  std::vector<DownloadItem*> All() const {
    std::vector<DownloadItem*> items;
    for (const auto& watch : watches_) {
      if (content::DownloadManager* manager = watch->manager()) {
        content::DownloadManager::DownloadVector some;
        manager->GetAllDownloads(&some);
        for (DownloadItem* item : some) {
          if (Listed(item)) {
            items.push_back(item);
          }
        }
      }
    }
    std::sort(items.begin(), items.end(), [](DownloadItem* a, DownloadItem* b) {
      return a->GetStartTime() > b->GetStartTime();
    });
    return items;
  }

  DownloadItem* Find(const std::string& id) const {
    if (id.empty()) {
      return nullptr;
    }
    for (const auto& watch : watches_) {
      if (content::DownloadManager* manager = watch->manager()) {
        if (DownloadItem* item = manager->GetDownloadByGuid(id)) {
          return item;
        }
      }
    }
    return nullptr;
  }

  void Changed(DownloadItem* item) {
    if (!Listed(item)) {
      // Known only once its response came (the .crx's type) or the installer tagged it.
      if (auto it = entries_.find(item->GetGuid()); it != entries_.end()) {
        const bool emitted = it->second.emitted;
        entries_.erase(it);
        if (emitted) {
          Post("downloads.removed", base::DictValue().Set("id", item->GetGuid()));
        }
      }
      return;
    }
    Entry& entry = entries_[item->GetGuid()];
    const DownloadItem::DownloadState state = item->GetState();
    if (state == DownloadItem::IN_PROGRESS) {
      entry.live = true;
    }
    // History loaded from an earlier session: listed, never announced.
    if (!entry.live) {
      return;
    }
    if (state == DownloadItem::COMPLETE && !entry.quarantined) {
      if (!entry.quarantining) {
        entry.quarantining = true;
        // A private download's record keeps no URLs.
        const bool off_the_record = IsOffTheRecord(item);
        const GURL& tab = item->GetTabUrl();
        base::ThreadPool::PostTaskAndReply(
            FROM_HERE,
            {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
             base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN},
            base::BindOnce(&QuarantineDownload, item->GetTargetFilePath(),
                           off_the_record ? GURL() : item->GetURL(),
                           off_the_record
                               ? GURL()
                               : (item->GetReferrerUrl().is_valid()
                                      ? item->GetReferrerUrl()
                                      : tab)),
            base::BindOnce(&DownloadsState::Quarantined,
                           weak_factory_.GetWeakPtr(), item->GetGuid()));
      }
      return;  // "finished" once the file is quarantined
    }
    const base::TimeTicks now = base::TimeTicks::Now();
    const bool dangerous = item->IsDangerous() || item->IsInsecure();
    if (state == DownloadItem::IN_PROGRESS && entry.emitted &&
        entry.paused == item->IsPaused() && entry.dangerous == dangerous &&
        now - entry.last_emit < kProgressInterval) {
      return;
    }
    entry.emitted = true;
    entry.paused = item->IsPaused();
    entry.dangerous = dangerous;
    entry.last_emit = now;
    Post("downloads.changed",
         base::DictValue().Set("download", Describe(item)));
  }

  void Removed(DownloadItem* item) {
    if (!Listed(item)) {
      return;
    }
    entries_.erase(item->GetGuid());
    Post("downloads.removed", base::DictValue().Set("id", item->GetGuid()));
  }

  // A private profile is going: its downloads go with it.
  void Drop(Profile* profile) {
    auto it = std::find_if(
        watches_.begin(), watches_.end(),
        [profile](const auto& watch) { return watch->profile() == profile; });
    if (it == watches_.end()) {
      return;
    }
    std::unique_ptr<Watch> watch = std::move(*it);
    watches_.erase(it);
    if (content::DownloadManager* manager = watch->manager()) {
      content::DownloadManager::DownloadVector items;
      manager->GetAllDownloads(&items);
      for (DownloadItem* item : items) {
        Removed(item);
      }
    }
  }

 private:
  struct Entry {
    bool live = false;  // seen in progress this session
    bool emitted = false;
    bool paused = false;
    bool dangerous = false;
    bool quarantining = false;
    bool quarantined = false;
    base::TimeTicks last_emit;
  };

  // ProfileObserver (ProfileState observes the original profile).
  void OnOffTheRecordProfileCreated(Profile* off_the_record) override {
    for (const auto& watch : watches_) {
      if (watch->profile() == off_the_record) {
        return;
      }
    }
    watches_.push_back(std::make_unique<Watch>(this, off_the_record));
  }

  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    watches_.clear();
    entries_.clear();
  }

  // Events leave after the download's own notification has unwound: an app
  // that pauses, cancels or removes from its event handler never re-enters
  // DownloadItem::UpdateObservers.
  void Post(const char* topic, base::DictValue payload) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<DownloadsState> state, const char* topic,
               base::DictValue payload) {
              if (state) {
                Emit(topic, state->profile(), std::move(payload));
              }
            },
            weak_factory_.GetWeakPtr(), topic, std::move(payload)));
  }

  void Quarantined(const std::string& id) {
    auto it = entries_.find(id);
    if (it == entries_.end()) {
      return;
    }
    it->second.quarantined = true;
    if (DownloadItem* item = Find(id)) {
      Changed(item);
    }
  }

  std::vector<std::unique_ptr<Watch>> watches_;
  std::map<std::string, Entry> entries_;
  base::WeakPtrFactory<DownloadsState> weak_factory_{this};
};

Watch::Watch(DownloadsState* owner, Profile* profile)
    : owner_(owner),
      profile_(profile),
      notifier_(profile->GetDownloadManager(), this) {
  if (profile->IsOffTheRecord()) {
    observation_.Observe(profile);
    // Chrome's desktop download UI turns "Ask where to save" on for every
    // private profile when its download manager starts (DownloadUIController's
    // bubble delegate; notifier_ has started it by now). A private window
    // follows the profile's own choice instead, as in CEF's engine.
    profile->GetPrefs()->SetBoolean(
        prefs::kPromptForDownload,
        profile->GetOriginalProfile()->GetPrefs()->GetBoolean(
            prefs::kPromptForDownload));
  }
}

void Watch::OnDownloadCreated(content::DownloadManager*, DownloadItem* item) {
  owner_->Changed(item);
}

void Watch::OnDownloadUpdated(content::DownloadManager*, DownloadItem* item) {
  owner_->Changed(item);
}

void Watch::OnDownloadRemoved(content::DownloadManager*, DownloadItem* item) {
  owner_->Removed(item);
}

void Watch::OnProfileWillBeDestroyed(Profile* profile) {
  observation_.Reset();
  owner_->Drop(profile);  // deletes this
}

// The call's download, or replies with an error.
DownloadItem* DownloadFor(Call& call) {
  DownloadItem* item =
      StateFor<DownloadsState>(call.profile()).Find(call.String("id"));
  if (!item) {
    call.TakeReply().Error("no such download");
  }
  return item;
}

}  // namespace
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_downloads_list) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  base::ListValue downloads;
  for (download::DownloadItem* item :
       netnyahoo::StateFor<netnyahoo::DownloadsState>(call.profile()).All()) {
    downloads.Append(netnyahoo::Describe(item));
  }
  call.TakeReply().Send(
      base::DictValue().Set("downloads", std::move(downloads)));
}

NN_ENGINE_CALL(nn_downloads_cancel) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  if (download::DownloadItem* item = netnyahoo::DownloadFor(call)) {
    item->Cancel(/*user_cancel=*/true);
    call.TakeReply().Ok();
  }
}

NN_ENGINE_CALL(nn_downloads_pause) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  if (download::DownloadItem* item = netnyahoo::DownloadFor(call)) {
    item->Pause();
    call.TakeReply().Ok();
  }
}

NN_ENGINE_CALL(nn_downloads_resume) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  if (download::DownloadItem* item = netnyahoo::DownloadFor(call)) {
    if (!item->CanResume()) {
      return call.TakeReply().Error("can't resume");
    }
    item->Resume(/*user_resume=*/true);
    call.TakeReply().Ok();
  }
}

NN_ENGINE_CALL(nn_downloads_keep) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  if (download::DownloadItem* item = netnyahoo::DownloadFor(call)) {
    if (item->IsInsecure()) {
      item->ValidateInsecureDownload();
    } else if (item->IsDangerous()) {
      item->ValidateDangerousDownload();
    }
    call.TakeReply().Ok();
  }
}

NN_ENGINE_CALL(nn_downloads_remove) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  if (download::DownloadItem* item = netnyahoo::DownloadFor(call)) {
    if (!item->IsDone()) {
      return call.TakeReply().Error("download in progress");
    }
    item->Remove();
    call.TakeReply().Ok();
  }
}
