// Copyright 2026 Arcadia. Apache-2.0.
//
// Clear Browsing Data, as Chrome's Delete Browsing Data dialog deletes it
// (Chrome's BrowsingDataRemover, web origins only).
//
//   ac_browsing_data_clear  {types: [type…], since?: <ms since the epoch>}
//       -> {ok}; {ok: false} if any type failed. Without since, all time.
//       history:      Chrome's history and what depends on it
//       siteData:     cookies and other site data
//       cache:        cached files
//       downloads:    the download list (the files stay)
//       formData:     autofill and autocomplete entries
//       siteSettings: every site's content settings
//   CEF's ClearBrowsingData took the first four.

#ifndef CHROME_BROWSER_ARCADIA_AC_BROWSING_DATA_H_
#define CHROME_BROWSER_ARCADIA_AC_BROWSING_DATA_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_browsing_data_clear);

#endif  // CHROME_BROWSER_ARCADIA_AC_BROWSING_DATA_H_
