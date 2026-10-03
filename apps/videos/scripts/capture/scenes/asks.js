// The hook: what other sites ask for, as they really appear in a Netnyahoo window. Each opens in the Personal profile
// and is captured once its interruption shows (a sign-in modal, an AI pitch, a cookie banner, an upgrade page).
const ASKS = [
  ["signin", "https://www.pinterest.com/pin/1/"],
  ["ai", "https://www.notion.com/product/ai"],
  ["cookies", "https://www.nytimes.com/"],
  ["upgrade", "https://www.dropbox.com/upgrade"],
];
const opened = [];
then(() => { unsplit(); return goProfile("default"); });
ASKS.forEach(([name, url]) => then(() => {
  const id = st().newTab(W, { url });
  opened.push(id);
  return sleep(10000).then(() => picShown(name)).then(() => sleep(600)).then(() => picShown(name)).then(() => snap("ask:" + name, { pageKey: { [id]: name + ":" + id } }));
}));
then(() => { opened.forEach((id) => st().closeTab(id)); st().activate("t1"); return sleep(800); });
return finish();
