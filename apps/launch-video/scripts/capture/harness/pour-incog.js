// "Pour": an incognito window (⌘⇧N) on the same silk, the tab renamed "Silk" as in the main window, snapshotted
// once the image has loaded.
const DIR = "pour-incog";
const before = new Set(nn.store.getState().windowOrder);
nn.runCommand({ command: "newIncognitoWindow" });
let w;
return sleep(2500).then(() => {
  const s = nn.store.getState();
  w = s.windowOrder.find((id) => !before.has(id));
  const t = s.windows[w].tabIds[0];
  s.navigate(t, "https://images.unsplash.com/photo-1705674337411-3b89e5afcc11?w=2400");
  return sleep(4000).then(() => { nn.store.getState().updateTab(t, { customTitle: "Silk" }); return sleep(800); });
}).then(() => {
  const f = `${L}/steps2/${DIR}/incognito.png`;
  return nn.shell.devSnapshotWindow(w, f).then(() => { log.push({ f, w, label: "incognito" }); return JSON.stringify({ log, win: nn.store.getState().windows[w] }); });
});
