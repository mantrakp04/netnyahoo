// "Pour": the command bar (⌘T) opens over the silk; "net" is typed a letter at a time and the bar completes it
// inline from history to netnyahoo.com, the completion selected. It is never submitted; Escape closes it.
// A hidden instance gets no keystrokes, so each letter is put into the native field first (as a key would)
// and then reported through the bar's DEV driver; the bar's own inline-completion request then finds the field
// showing what it typed, as it does with real typing. Search suggestions are off (Settings), so the rows are
// this profile's own history and tabs.
const DIR = "pour-bar";
const bar = () => nn.omnibox.get(W + ":panel");
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const fibers = (from, pred) => { const out = []; const st = [from]; while (st.length) { const f = st.pop(); if (!f) continue; if (pred(f)) out.push(f); if (f.child) st.push(f.child); if (f.sibling) st.push(f.sibling); } return out; };
const field = () => [...hook.getFiberRoots(1)].flatMap((r) => fibers(r.current, (f) => f.memoizedProps && f.memoizedProps.placeholder === "Search or enter address" && f.stateNode && f.stateNode.setNativeProps))[0].stateNode;
// The request can still lose the race with the field; a letter is typed again (the same text) until it shows.
const attempt = (text, n) => { field().setNativeProps({ text }); return sleep(80).then(() => { bar().type(text); return sleep(700); })
  .then(() => (bar().state().completion || n >= 4 ? n : attempt(text, n + 1))); };
const typeStep = (text) => () => attempt(text, 0).then((n) => { log.push({ text, tries: n + 1 }); return snap(DIR, "type:" + text); });
nn.store.getState().updateSettings({ searchSuggestions: false });
let chain = snap(DIR, "closed")
  .then(() => { nn.store.getState().openPanel(W); return sleep(700).then(() => snap(DIR, "open")); });
["n", "ne", "net"].forEach((t) => { chain = chain.then(typeStep(t)); });
return chain
  .then(() => sleep(400)).then(() => snap(DIR, "hold"))
  .then(() => JSON.stringify({ log, state: bar().state() }))
  .finally(() => { bar() && bar().key("Escape"); nn.store.getState().closePanel(W); });
