// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Saved passwords, through the same PasswordsPrivateDelegate that
// chrome://password-manager uses: Chrome's SavedPasswordsPresenter (both
// stores, affiliations, duplicates across stores) and its exporter, behind
// Chrome's OS reauth (nn_reauth.h) with the password page's prompts and
// validity. Logins are named by origin (a signon realm without its trailing
// slash) and username; a call that reauthenticates picks the credential
// before the prompt, by Chrome's id.
//
//   nn_passwords_list        {} -> {passwords: [{origin, username}]}
//   nn_passwords_unlock      {} -> {unlocked}: reauth (5-minute validity);
//                            unlocked at once with no login saved
//   nn_passwords_reveal      {origin, username} -> {password|null}: reauth
//   nn_passwords_add         {origin, username, password} -> {ok}
//   nn_passwords_update      {origin, username, newUsername?, newPassword?}
//                            -> {ok}: reauth, as Chrome's edit dialog
//   nn_passwords_remove      {origin, username} -> {ok} (from every store)
//   nn_passwords_exceptions  {} -> {origins: [...]} ("Never on this site")
//   nn_passwords_allow       {origin} -> {ok} (removes its exception)
//   nn_passwords_export      {path} -> {status: "succeeded" | "cancelled" |
//                            "writeFailed" | "reauthFailed" | "inProgress"}:
//                            a reauth every time (as Chrome's export), then
//                            Chrome's exporter writes the CSV to |path| (the
//                            app asked the user where)
//
// Event "passwords.export" {status, folder} reports export progress. Writes
// resolve once the list shows exactly the change, or fail after about a
// second.

#ifndef CHROME_BROWSER_NETNYAHOO_NN_PASSWORDS_H_
#define CHROME_BROWSER_NETNYAHOO_NN_PASSWORDS_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_passwords_list);
NN_ENGINE_CALL(nn_passwords_unlock);
NN_ENGINE_CALL(nn_passwords_reveal);
NN_ENGINE_CALL(nn_passwords_add);
NN_ENGINE_CALL(nn_passwords_update);
NN_ENGINE_CALL(nn_passwords_remove);
NN_ENGINE_CALL(nn_passwords_exceptions);
NN_ENGINE_CALL(nn_passwords_allow);
NN_ENGINE_CALL(nn_passwords_export);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_PASSWORDS_H_
