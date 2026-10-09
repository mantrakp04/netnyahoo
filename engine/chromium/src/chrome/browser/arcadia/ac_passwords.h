// Copyright 2026 Arcadia. Apache-2.0.
//
// Saved passwords, through the same PasswordsPrivateDelegate that
// chrome://password-manager uses: Chrome's SavedPasswordsPresenter (both
// stores, affiliations, duplicates across stores) and its exporter, behind
// Chrome's OS reauth (ac_reauth.h) with the password page's prompts and
// validity. Logins are named by origin (a signon realm without its trailing
// slash) and username; a call that reauthenticates picks the credential
// before the prompt, by Chrome's id.
//
//   ac_passwords_list        {} -> {passwords: [{origin, username}]}
//   ac_passwords_unlock      {} -> {unlocked}: reauth (5-minute validity);
//                            unlocked at once with no login saved
//   ac_passwords_reveal      {origin, username} -> {password|null}: reauth
//   ac_passwords_add         {origin, username, password} -> {ok}
//   ac_passwords_update      {origin, username, newUsername?, newPassword?}
//                            -> {ok}: reauth, as Chrome's edit dialog
//   ac_passwords_remove      {origin, username} -> {ok} (from every store)
//   ac_passwords_exceptions  {} -> {origins: [...]} ("Never on this site")
//   ac_passwords_allow       {origin} -> {ok} (removes its exception)
//   ac_passwords_export      {path} -> {status: "succeeded" | "cancelled" |
//                            "writeFailed" | "reauthFailed" | "inProgress"}:
//                            a reauth every time (as Chrome's export), then
//                            Chrome's exporter writes the CSV to |path| (the
//                            app asked the user where)
//
// Event "passwords.export" {status, folder} reports export progress. Writes
// resolve once the list shows exactly the change, or fail after about a
// second.

#ifndef CHROME_BROWSER_ARCADIA_AC_PASSWORDS_H_
#define CHROME_BROWSER_ARCADIA_AC_PASSWORDS_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_passwords_list);
AC_ENGINE_CALL(ac_passwords_unlock);
AC_ENGINE_CALL(ac_passwords_reveal);
AC_ENGINE_CALL(ac_passwords_add);
AC_ENGINE_CALL(ac_passwords_update);
AC_ENGINE_CALL(ac_passwords_remove);
AC_ENGINE_CALL(ac_passwords_exceptions);
AC_ENGINE_CALL(ac_passwords_allow);
AC_ENGINE_CALL(ac_passwords_export);

#endif  // CHROME_BROWSER_ARCADIA_AC_PASSWORDS_H_
