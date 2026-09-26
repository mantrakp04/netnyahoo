const DIR = "addr";
const q = "netnyahoo";
nn.store.getState().updateSettings({ searchSuggestions: false });
const earth = tab("earth.nullschool");
nn.store.getState().activate(earth.id);
const typeStep = (text) => () => { nn.omnibox.get(W + ":sidebar").type(text); return sleep(280).then(() => snap(DIR, "type:" + text)); };
let chain = sleep(2500).then(() => snapFor(DIR, "closed", 400))
  .then(() => { nn.runCommand({ command: "focusCommandBar", windowId: W }); return snapFor(DIR, "opening", 900); });
q.split("").map((_, i) => q.slice(0, i + 1)).forEach((text) => { chain = chain.then(typeStep(text)); });
return chain.then(() => snapFor(DIR, "hold", 700)).then(() => { const st = nn.omnibox.get(W + ":sidebar").state(); nn.store.getState().closePanel(W); return JSON.stringify({ log, st }); });
