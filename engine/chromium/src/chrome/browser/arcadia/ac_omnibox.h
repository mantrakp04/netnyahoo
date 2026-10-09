// Copyright 2026 Arcadia. Apache-2.0.
//
// What the app asks to know this engine has the New Tab page's prewarm fixes
// (ArcadiaCore: the prewarmed about:blank tab leaves no Back entry, and no entry in
// Chrome's closed-tab list when it closes, its window closes or the app quits).
//
//   ac_omnibox_opened {} -> {prewarm: 2}: answers, and changes nothing. An
//     engine without it answers "not an engine call", and one with only the
//     first two fixes {}: the app makes no page ahead with either.
//
// It once also told Chrome's omnibox predictor what the command bar opened, for
// preconnect and prerender (5c9d0422). Those were removed: this engine keeps
// Chrome's "Preload pages" off by default, and a prerender is cancelled when its
// page binds ACPageHost (docs/perf/ideas.md).

#ifndef CHROME_BROWSER_ARCADIA_AC_OMNIBOX_H_
#define CHROME_BROWSER_ARCADIA_AC_OMNIBOX_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_omnibox_opened);

#endif  // CHROME_BROWSER_ARCADIA_AC_OMNIBOX_H_
