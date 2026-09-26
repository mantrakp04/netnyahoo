// The sidebar's address field opens Arc's dropdown; "netnyahoo" is typed a letter at a time; Escape closes it.
const DIR = "addr";
const q = "netnyahoo";
const typeStep = (text) => () => { nn.omnibox.get(W + ":sidebar").type(text); return sleep(250).then(() => snap(DIR, "type:" + text)); };
let chain = snap(DIR, "closed")
  .then(() => { nn.runCommand({ command: "focusCommandBar", windowId: W }); return sleep(300).then(() => snap(DIR, "open")); });
q.split("").map((_, i) => q.slice(0, i + 1)).forEach((text) => { chain = chain.then(typeStep(text)); });
return chain
  .then(() => sleep(400)).then(() => snap(DIR, "hold"))
  .then(() => { nn.omnibox.get(W + ":sidebar").key("Escape"); return sleep(350).then(() => snap(DIR, "closed-after")); })
  .then(() => JSON.stringify({ log }));
