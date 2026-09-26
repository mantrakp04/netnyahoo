// Split view: the Chrome extensions docs tab (already loaded, in the same profile) opens beside the repo; snapshots as fast
// as the hook allows while the panes settle.
const store = tab("developer.chrome.com");
return snap("split", "before")
  .then(() => { log.push({ opened: Date.now(), r: JSON.stringify(nn.store.getState().openSplitPane(W, { tabId: store.id })) }); return snapFor("split", "opening", 1600); })
  .then(() => JSON.stringify({ log, splits: nn.store.getState().splits }));
