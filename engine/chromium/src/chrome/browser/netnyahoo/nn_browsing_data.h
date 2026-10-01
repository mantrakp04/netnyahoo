// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Browsing data CEF's ClearBrowsingData doesn't reach, deleted as Chrome's
// Delete Browsing Data dialog deletes it (all time).
//
//   nn_browsing_data_clear  {types: ["formData" | "siteSettings"]} -> {ok}
//       formData: autofill and autocomplete entries; siteSettings: every
//       site's content settings. {ok: false} if any type failed.

#ifndef CHROME_BROWSER_NETNYAHOO_NN_BROWSING_DATA_H_
#define CHROME_BROWSER_NETNYAHOO_NN_BROWSING_DATA_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_browsing_data_clear);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_BROWSING_DATA_H_
