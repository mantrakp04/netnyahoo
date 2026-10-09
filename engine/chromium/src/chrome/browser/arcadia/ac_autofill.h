// Copyright 2026 Arcadia. Apache-2.0.
//
// Saved addresses and cards: Chrome's PersonalDataManager, written the way
// chrome://settings/autofill writes them (autofillPrivate's save, remove and
// local-card calls).
//
//   ac_autofill_addresses     {} -> {addresses: [{id, name, organization,
//       street, city, state, postalCode, country, phone, email}]} (empty
//       fields left out)
//   ac_autofill_save_address  {address: {id?, <fields above>}} -> {id}
//   ac_autofill_cards         {} -> {cards: [{id, name?, network, last4,
//       expMonth?, expYear?}]}; network: visa, mastercard, amex, discover,
//       diners, jcb, unionpay or card
//   ac_autofill_save_card     {card: {id?, name?, expMonth?, expYear?},
//       number?} -> {id}; a new card needs a 12–19 digit number
//   ac_autofill_remove        {id} -> {ok} (an address or a card)
//   ac_autofill_card_number   {id} -> {number|null, authenticated} after
//       Chrome's OS reauth (ac_reauth.h), every time
//   ac_autofill_import        {addresses: [{name?, organization?, street?,
//       city?, state?, postalCode?, country?, phone?, email?}], cards:
//       [{name?, number, expMonth?, expYear?, nickname?}]} -> {addresses:
//       added, cards: added, existing: n, rejected: n}. Another browser's
//       data: an address already present (a subset of one, or equal) and a
//       card whose number is already saved count as existing; a card number
//       must be 12–19 digits (spaces and dashes allowed) and pass Luhn, an
//       expiry must be a real month and year (an expired card is kept), an
//       address needs one field. Replies once the rest is queued, without
//       waiting for the database. Off the record: {error: "private
//       profile"}. Up to 1000 of each and 4 MB a call. Card numbers are
//       parsed before the call returns and every copy made is zeroed
//       (ac_sensitive_args.h); never logged.
//
// Writes resolve once the data shows exactly the change, or fail after about
// a second (Chrome refused it: a duplicate, say).

#ifndef CHROME_BROWSER_ARCADIA_AC_AUTOFILL_H_
#define CHROME_BROWSER_ARCADIA_AC_AUTOFILL_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_autofill_addresses);
AC_ENGINE_CALL(ac_autofill_save_address);
AC_ENGINE_CALL(ac_autofill_cards);
AC_ENGINE_CALL(ac_autofill_save_card);
AC_ENGINE_CALL(ac_autofill_remove);
AC_ENGINE_CALL(ac_autofill_card_number);
AC_ENGINE_CALL(ac_autofill_import);

#endif  // CHROME_BROWSER_ARCADIA_AC_AUTOFILL_H_
