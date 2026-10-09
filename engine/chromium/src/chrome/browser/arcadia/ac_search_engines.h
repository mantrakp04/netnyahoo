// Copyright 2026 Arcadia. Apache-2.0.
//
// Chrome's search engines (TemplateURLService). The app keeps its own engines;
// it reads Chrome's for the ones extensions add (chrome_settings_overrides and
// the omnibox API).
//
//   ac_search_engines_list  {} -> {engines: [{name, keyword, url,
//       suggestionsUrl, default, isOmniboxExtension, extension?: {id, name}}]}
//       URLs as chrome://settings shows them, "%s" for the search terms.

#ifndef CHROME_BROWSER_ARCADIA_AC_SEARCH_ENGINES_H_
#define CHROME_BROWSER_ARCADIA_AC_SEARCH_ENGINES_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_search_engines_list);

#endif  // CHROME_BROWSER_ARCADIA_AC_SEARCH_ENGINES_H_
