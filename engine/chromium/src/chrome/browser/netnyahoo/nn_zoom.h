// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Per-site zoom: Chrome's HostZoomMap of the profile's default storage
// partition (what chrome://settings/content/zoomLevels shows).
//
//   nn_zoom_list  {tab?} -> {levels: {<host>: <zoom level>}}, non-default only
//   nn_zoom_set   {host, level, tab?} -> {ok}; level 0 (or the default)
//                 removes it
//
// With "tab" (a chrome.tabs id) the call means that tab's profile: how a
// private window reaches its off-the-record profile, whose zoom map Chrome
// keeps for the private session only (it starts as a copy of its parent's).
//
// Event "zoom.changed" {host, level} for every host zoom change in the
// profile (a tab's ⌘+, the app, an extension), once something has called
// nn_zoom_*.

#ifndef CHROME_BROWSER_NETNYAHOO_NN_ZOOM_H_
#define CHROME_BROWSER_NETNYAHOO_NN_ZOOM_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_zoom_list);
NN_ENGINE_CALL(nn_zoom_set);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_ZOOM_H_
