// Copyright 2026 Arcadia. Apache-2.0.
//
// Installed extensions, managed the way chrome://extensions manages them:
// Chrome's ExtensionInfoGenerator for the list, the management API's enable,
// disable and uninstall steps (policy checks, requirements, the re-enable
// prompt after a permissions increase), UnpackedInstaller, and
// developerPrivate's configuration changes.
//
//   ac_extensions_list         {} -> {extensions: [{id, name, version,
//       description, enabled, state, icon, permissions: [message],
//       siteAccess: "ON_CLICK" | "ON_SPECIFIC_SITES" | "ON_ALL_SITES" | null,
//       sites: [granted host], optionsUrl, location, path, homepageUrl,
//       incognito, fileAccess, pinned, mayModify, errors: [message]}]}
//       Extensions only (no apps or themes), disabled and terminated
//       included. state and location are developerPrivate's names
//       ("ENABLED", "FROM_STORE"…).
//   ac_extensions_install      {path} -> {id}: loads an unpacked extension
//       (turns developer mode on, as Chrome keeps unpacked ones off without)
//   ac_extensions_install_crx  {path} -> {id}: installs a CRX3 file as one
//       dropped on chrome://extensions: Chrome's install prompt (the app's),
//       then Chrome's post-install UI ("<name> has been added")
//   ac_extensions_set_enabled  {id, enabled} -> {ok}; enabling one whose
//       permissions grew shows Chrome's re-enable prompt (the app's install
//       prompt, through the install-prompt hook) on the profile's last active
//       tab
//   ac_extensions_uninstall    {id} -> {ok}, without Chrome's dialog: the app
//       has asked the user. A disabled extension stays disabled until gone.
//   ac_extensions_reload       {id} -> {ok}
//   ac_extensions_configure    {id, pinned?, incognito?, fileAccess?,
//       siteAccess?: "onClick" | "specificSites" | "allSites"} -> {ok}

#ifndef CHROME_BROWSER_ARCADIA_AC_EXTENSIONS_H_
#define CHROME_BROWSER_ARCADIA_AC_EXTENSIONS_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_extensions_list);
AC_ENGINE_CALL(ac_extensions_install);
AC_ENGINE_CALL(ac_extensions_install_crx);
AC_ENGINE_CALL(ac_extensions_set_enabled);
AC_ENGINE_CALL(ac_extensions_uninstall);
AC_ENGINE_CALL(ac_extensions_reload);
AC_ENGINE_CALL(ac_extensions_configure);

#endif  // CHROME_BROWSER_ARCADIA_AC_EXTENSIONS_H_
