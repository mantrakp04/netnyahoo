// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Tab strips: every Browser's TabStripModel, groups included, as the app's
// live-tab contract needs it (docs/store-api.md › "Live tabs").
//
//   nn_tabs_watch {} -> {ok}: every strip as it is now, then, event "tabs.strip"
//     {window, tabs: [{tab, index, active, pinned, group}],
//      groups: [{id, title, color, collapsed}], activePickedOnClose} after
//     every change to a strip (tabs added, removed, moved, activated, pinned,
//     grouped; a group's title, color or collapsed state), synchronously, so
//     the app can tell what caused it; and {window, closed: true} when its
//     Browser goes.
//     window: the Browser's session id; tab: Chrome's tab id (chrome.tabs);
//     group: the TabGroupId token, or null; color: Chrome's color name
//     (grey, blue, red, yellow, green, pink, purple, cyan, orange).
//     activePickedOnClose: the active tab is the one Chrome picked because
//     the active tab left the strip (closed, moved out), not one somebody
//     activated.
//   nn_tabs_group {window, tabs: [tab ids], group, title?, color?,
//     collapsed?} -> {group}: puts the tabs in `group` (a token Chrome gave,
//     "new" for a new group, "" to take them out of their groups) and sets the
//     group's visuals when given. Replies the group's token ("" for none).

#ifndef CHROME_BROWSER_NETNYAHOO_NN_TABS_H_
#define CHROME_BROWSER_NETNYAHOO_NN_TABS_H_

#include "chrome/browser/netnyahoo/nn_engine.h"

NN_ENGINE_CALL(nn_tabs_watch);
NN_ENGINE_CALL(nn_tabs_group);

#endif  // CHROME_BROWSER_NETNYAHOO_NN_TABS_H_
