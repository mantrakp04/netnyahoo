// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Saved addresses and cards: Chrome's PersonalDataManager, written the way
// chrome://settings/autofill writes them (autofillPrivate's save, remove and
// local-card calls).
//
//   nn_autofill_addresses     {} -> {addresses: [{id, name, organization,
//       street, city, state, postalCode, country, phone, email}]} (empty
//       fields left out)
//   nn_autofill_save_address  {address: {id?, <fields above>}} -> {id}
//   nn_autofill_cards         {} -> {cards: [{id, name?, network, last4,
//       expMonth?, expYear?}]}; network: visa, mastercard, amex, discover,
//       diners, jcb, unionpay or card
//   nn_autofill_save_card     {card: {id?, name?, expMonth?, expYear?},
//       number?} -> {id}; a new card needs a 12–19 digit number
//   nn_autofill_remove        {id} -> {ok} (an address or a card)
//   nn_autofill_card_number   {id} -> {number|null, authenticated} after
//       Chrome's OS reauth (nn_reauth.h), every time
//
// Writes resolve once the data shows exactly the change, or fail after about
// a second (Chrome refused it: a duplicate, say).

#ifndef CHROME_BROWSER_NETNYAHOO_NN_AUTOFILL_H_
#define CHROME_BROWSER_NETNYAHOO_NN_AUTOFILL_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_autofill_addresses);
NN_ENGINE_CALL(nn_autofill_save_address);
NN_ENGINE_CALL(nn_autofill_cards);
NN_ENGINE_CALL(nn_autofill_save_card);
NN_ENGINE_CALL(nn_autofill_remove);
NN_ENGINE_CALL(nn_autofill_card_number);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_AUTOFILL_H_
