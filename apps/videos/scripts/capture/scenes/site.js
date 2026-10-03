// netnyahoo.com in a new tab of the Personal profile, then scrolled from the hero down the page.
let tabId;
then(() => { unsplit(); return goProfile("default"); });
then(() => { tabId = st().newTab(W, { url: "https://netnyahoo.com/" }); return sleep(7000).then(() => picShown("s0")).then(() => snap("site", { pageKey: { [tabId]: "s0:" + tabId } })); });
[1, 2, 3, 4, 5, 6].forEach((k) => then(() => {
  const h = nn.webviews.get(tabId);
  return Promise.resolve(h && h.executeJavaScript("window.scrollTo({top:" + k * 450 + ",behavior:'instant'})")).then(() => sleep(1200)).then(() => picShown("s" + k)).then(() => snap("scroll" + k, { pageKey: { [tabId]: "s" + k + ":" + tabId } }));
}));
then(() => { st().closeTab(tabId); st().activate("t1"); return sleep(500); });
return finish();
