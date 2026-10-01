// Copyright 2026 Netnyahoo. Apache-2.0.
//
// External apps' "always allow" choices: Chrome's own per-profile pref
// (protocol_handler.allowed_origin_protocol_pairs, {origin: {scheme: true}}),
// which Chrome's ExternalProtocolHandler and CEF's engine
// (packages/cef/ios/NNExternalApps.mm) both read and write.
//
//   nn_external_apps_allowances {} -> {allowances: [{origin, scheme,
//       app: <name> | null, icon: <PNG data: URI> | null}]}: sorted by origin
//       then scheme; app is the app that opens the scheme on this Mac now.
//   nn_external_apps_remove {origin, scheme} -> {ok}

#ifndef CHROME_BROWSER_NETNYAHOO_NN_EXTERNAL_APPS_H_
#define CHROME_BROWSER_NETNYAHOO_NN_EXTERNAL_APPS_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_external_apps_allowances);
NN_ENGINE_CALL(nn_external_apps_remove);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_EXTERNAL_APPS_H_
