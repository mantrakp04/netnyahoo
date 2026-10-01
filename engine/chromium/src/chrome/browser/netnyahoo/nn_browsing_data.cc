// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_browsing_data.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "chrome/browser/browsing_data/browsing_data_important_sites_util.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "components/browsing_data/core/browsing_data_utils.h"
#include "content/public/browser/browsing_data_filter_builder.h"
#include "content/public/browser/browsing_data_remover.h"

NN_ENGINE_CALL(nn_browsing_data_clear) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  uint64_t mask = 0;
  if (const base::ListValue* types = call.args().FindList("types")) {
    for (const base::Value& type : *types) {
      if (type == base::Value("formData")) {
        mask |= chrome_browsing_data_remover::DATA_TYPE_FORM_DATA;
      } else if (type == base::Value("siteSettings")) {
        mask |= chrome_browsing_data_remover::DATA_TYPE_CONTENT_SETTINGS;
      } else {
        return call.TakeReply().Error("unknown type");
      }
    }
  }
  if (!mask) {
    return call.TakeReply().Error("types required");
  }
  // As ClearBrowsingDataHandler::HandleClearBrowsingData: the same remover,
  // filter and time period.
  browsing_data_important_sites_util::Remove(
      mask, /*origin_mask=*/0, browsing_data::TimePeriod::ALL_TIME,
      content::BrowsingDataFilterBuilder::Create(
          content::BrowsingDataFilterBuilder::Mode::kPreserve),
      call.profile()->GetBrowsingDataRemover(),
      base::BindOnce(
          [](netnyahoo::Reply reply, uint64_t failed) {
            reply.Send(base::DictValue().Set("ok", failed == 0));
          },
          call.TakeReply()));
}
