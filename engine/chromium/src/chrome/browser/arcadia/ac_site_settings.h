// Copyright 2026 Arcadia. Apache-2.0.
//
// Per-site settings: Chrome's HostContentSettingsMap (what Page Info and
// chrome://settings/content show), with the type names and values of the JS
// (packages/cef/src/siteSettings.ts) and CEF's semantics
// (packages/cef/ios/ACSiteSettings.mm): a site is its http(s) origin, and a
// setting is stored with Chrome's default scope for the type, so CEF-era
// profiles read the same.
//
//   ac_site_settings_get     {origin} -> {settings: {<type>: {value,
//       isDefault}}}: value "allow"|"block"|"ask"|"default" (the effective
//       one), isDefault when the site has no exception of its own.
//   ac_site_settings_set     {origin, type, value} -> {ok}; "default" removes
//       the site's exception.
//   ac_site_settings_reset   {origin} -> {ok}: removes every type's exception.
//   ac_site_settings_origins {} -> {origins: [origin…]}: the sites with an
//       exception of their own, sorted.
//   ac_site_data_clear       {origin} -> {cookies: <count> | false,
//       storage: bool}: deletes the host's cookies, then the origin's storage
//       (local and session storage, IndexedDB, caches, service workers…).
//
// Types: popups camera microphone location notifications sound autoplay
// javascript images clipboard automaticDownloads cookies midi sensors
// windowManagement localFonts idleDetection storageAccess fileSystem
// keyboardLock pointerLock cameraPanTiltZoom. A value a type doesn't take
// ("ask" for sound) replies {error}.
//
// Event "siteSettings.changed" {origin: <origin> | null, type: <type> | null}
// for every change to one of these types in the profile (null: a pattern
// wider than one origin, or every type), once something has called
// ac_site_settings_*.

#ifndef CHROME_BROWSER_ARCADIA_AC_SITE_SETTINGS_H_
#define CHROME_BROWSER_ARCADIA_AC_SITE_SETTINGS_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_site_settings_get);
AC_ENGINE_CALL(ac_site_settings_set);
AC_ENGINE_CALL(ac_site_settings_reset);
AC_ENGINE_CALL(ac_site_settings_origins);
AC_ENGINE_CALL(ac_site_data_clear);

#endif  // CHROME_BROWSER_ARCADIA_AC_SITE_SETTINGS_H_
