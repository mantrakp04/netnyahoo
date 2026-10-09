// ⌘L, then netnyahoo.com typed into the toolbar's address field a key at a time (each key through the window's own key
// path), completed inline from history; Return; the site loads; then a scroll down its page.
let tabId;
const C = globalThis.expo.modules.ArcadiaCEF;
const nativeWindow = () => C.chromeWindows().then((ws) => ws.filter((w) => w.hasRoot)[0].window);
const act = (a) => nativeWindow().then((n) => C.devWindow(n, a));
const TEXT = "netnyahoo.com";
then(() => { unsplit(); return goProfile("default"); });
// Only this history, so the dropdown shows nothing from other scenes.
then(() => { st().clearHistory("default"); return sleep(300); });
// History, so the field completes the address as it would for anyone who has been there.
then(() => { tabId = st().newTab(W, { url: "https://netnyahoo.com/" }); return sleep(6000).then(() => { st().navigate(tabId, "https://en.wikipedia.org/wiki/Chromium_(web_browser)"); return sleep(4000); }).then(() => picShown()).then(() => snap("before")); });
then(() => Promise.resolve(ac.shell.devKeyEquivalent(W, { key: "l", keyCode: 37, modifiers: ["command"] })).then(() => sleep(700)).then(() => snap("focus")));
Array.from({ length: TEXT.length }, (_, i) => TEXT[i]).forEach((c, i) => then(() => act("type:" + c).then(() => sleep(420)).then(() => snap("type:" + TEXT.slice(0, i + 1)))));
then(() => { const bar = ac.omnibox.get(W + ":panel"); if (bar) bar.submit(); else return act("type:\r"); });
then(() => sleep(200).then(() => snap("enter")));
then(() => sleep(9000).then(() => picShown("site")).then(() => sleep(1000)).then(() => picShown("site")).then(() => snap("site", { pageKey: { [tabId]: "site:" + tabId } })));
then(() => { st().closeTab(tabId); return sleep(500); });
return finish({ tabId, ids: ac.omnibox.ids() });
