// Copyright 2026 Arcadia. Apache-2.0.

#include "chrome/browser/arcadia/ac_browsing_data.h"

#include <cmath>
#include <string_view>
#include <utility>

#include "base/functional/bind.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "content/public/browser/browsing_data_remover.h"

namespace arcadia {
namespace {

uint64_t MaskFor(std::string_view type) {
  if (type == "history") {
    return chrome_browsing_data_remover::DATA_TYPE_HISTORY;
  }
  if (type == "siteData") {
    return chrome_browsing_data_remover::DATA_TYPE_SITE_DATA;
  }
  if (type == "cache") {
    return content::BrowsingDataRemover::DATA_TYPE_CACHE;
  }
  if (type == "downloads") {
    return content::BrowsingDataRemover::DATA_TYPE_DOWNLOADS;
  }
  if (type == "formData") {
    return chrome_browsing_data_remover::DATA_TYPE_FORM_DATA;
  }
  if (type == "siteSettings") {
    return chrome_browsing_data_remover::DATA_TYPE_CONTENT_SETTINGS;
  }
  return 0;
}

// Replies when the remover finishes the one task it was handed (the remover
// reports only to registered observers). Deletes itself; if the profile goes
// first it never replies (public/ac_engine.h allows that at shutdown).
class Done : public content::BrowsingDataRemover::Observer {
 public:
  Done(content::BrowsingDataRemover* remover, Reply reply)
      : reply_(std::move(reply)) {
    observation_.Observe(remover);
  }

  // Replies after the remover's notification unwinds (the app's reply may
  // do anything, even close the profile).
  void OnBrowsingDataRemoverDone(uint64_t failed_data_types) override {
    observation_.Reset();
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](Reply reply, bool ok) {
                         reply.Send(base::DictValue().Set("ok", ok));
                       },
                       std::move(reply_), failed_data_types == 0));
    delete this;
  }

 private:
  Reply reply_;
  base::ScopedObservation<content::BrowsingDataRemover,
                          content::BrowsingDataRemover::Observer>
      observation_{this};
};

}  // namespace
}  // namespace arcadia

AC_ENGINE_CALL(ac_browsing_data_clear) {
  arcadia::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  uint64_t mask = 0;
  if (const base::ListValue* types = call.args().FindList("types")) {
    for (const base::Value& type : *types) {
      const uint64_t bits =
          type.is_string() ? arcadia::MaskFor(type.GetString()) : 0;
      if (!bits) {
        return call.TakeReply().Error("unknown type");
      }
      mask |= bits;
    }
  }
  if (!mask) {
    return call.TakeReply().Error("types required");
  }
  base::Time begin;  // the beginning of time
  const double since = call.Double("since");
  if (std::isfinite(since) && since > 0) {
    begin = base::Time::FromMillisecondsSinceUnixEpoch(since);
  }
  // As ClearBrowsingDataHandler (and CEF's ClearBrowsingData): web origins,
  // from |begin| to now.
  content::BrowsingDataRemover* remover =
      call.profile()->GetBrowsingDataRemover();
  remover->RemoveAndReply(
      begin, base::Time::Max(), mask,
      content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB,
      new arcadia::Done(remover, call.TakeReply()));
}
