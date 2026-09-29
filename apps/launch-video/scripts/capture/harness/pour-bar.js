const DIR = "pour-bar";
const bar = () => nn.omnibox.get(W + ":panel");
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const fibers = (from, pred) => { const out = []; const st = [from]; while (st.length) { const f = st.pop(); if (!f) continue; if (pred(f)) out.push(f); if (f.child) st.push(f.child); if (f.sibling) st.push(f.sibling); } return out; };
const field = () => [...hook.getFiberRoots(1)].flatMap((r) => fibers(r.current, (f) => f.memoizedProps && f.memoizedProps.placeholder === "Search or enter address" && f.stateNode && f.stateNode.setNativeProps))[0].stateNode;
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
