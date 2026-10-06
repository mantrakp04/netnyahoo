// Copyright 2026 Netnyahoo. Apache-2.0.
//
// The command bar's preloading, as Chrome's omnibox does it
// (ChromeOmniboxClient::OnTextChanged, DoPreconnect, DoPrerender): Chrome's
// AutocompleteActionPredictor learns which typed text leads to which page, and
// for its default match recommends a preconnect (confidence >= 0.3) or a
// prerender (>= 0.5, never for a search). Chrome's preloading setting
// (Settings > Performance > Preload pages) gates both, as in Chrome; a
// prerender is also limited to https (and loopback http) pages, and never
// starts while DevTools is attached to the tab. A prerender waits at most 10 s
// for Enter, and ends when the bar closes without opening it.
//
//   nn_omnibox_typed {tab, text, matches: [{url, kind}], default?} ->
//     {action: "prerender" | "preconnect" | "none"}: the bar's text changed and
//     its suggestions are `matches` (kind: "typed", "history", "bookmark",
//     "tab", "search", "suggest", "other"); `default` (0) is the one Enter
//     opens. tab: Chrome's id of the tab the bar navigates (a prerender starts
//     in it and activates when it navigates there with a typed transition); 0
//     for none (preconnect only).
//   nn_omnibox_opened {tab, url} -> {ok}: the bar opened `url` (learns from what
//     was typed since the last call); "" when the bar closed without opening
//     anything (Chrome's OnRevert: every suggestion shown was a miss).

#ifndef CHROME_BROWSER_NETNYAHOO_NN_OMNIBOX_H_
#define CHROME_BROWSER_NETNYAHOO_NN_OMNIBOX_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_omnibox_typed);
NN_ENGINE_CALL(nn_omnibox_opened);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_OMNIBOX_H_
