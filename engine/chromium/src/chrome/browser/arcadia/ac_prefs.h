// Copyright 2026 Arcadia. Apache-2.0.
//
// A few of the profile's Chrome preferences the app owns, by Chrome's names
// (an allow-list; anything else replies {error: "not allowed"}).
//
//   ac_prefs_get {name} -> {value, managed}: managed when a policy fixes it.
//   ac_prefs_set {name, value} -> {ok}; value of the pref's type.
//
//   credentials_enable_service           bool  offer to save passwords
//   autofill.profile_enabled             bool  save and fill addresses
//   autofill.credit_card_enabled         bool  save and fill payment methods
//   session.restore_on_startup           int   Chrome's startup pages (CEF's
//       engine sets 5, "open the new tab page": the app restores its own)
//   download_bubble.partial_view_enabled bool  Chrome's download bubble
//       opening by itself (CEF's engine sets false)
//   download.prompt_for_download         bool  ask where to save each file
//       (the downloads service turns the ungoogled default, on, off)

#ifndef CHROME_BROWSER_ARCADIA_AC_PREFS_H_
#define CHROME_BROWSER_ARCADIA_AC_PREFS_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_prefs_get);
AC_ENGINE_CALL(ac_prefs_set);

#endif  // CHROME_BROWSER_ARCADIA_AC_PREFS_H_
