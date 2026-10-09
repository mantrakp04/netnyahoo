// Clicking down the Personal sidebar (each tab shown, then its page), then a real scroll of Mount Everest's page: one
// page picture per film frame, the page scrolled by script between them.
then(() => { unsplit(); return goProfile("default"); });
["t1", "t2", "t3", "t4", "t5", "t6"].forEach((id) => then(() => { st().activate(id); return sleep(3500).then(() => picShown()).then(() => sleep(800)).then(() => picShown()).then(() => snap("tab:" + id)); }));
then(() => { st().activate("t1"); return sleep(2500).then(() => picShown()); });
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
Array.from({ length: 40 }, (_, i) => i).forEach((i) => then(() => {
  const y = Math.round(ease(i / 39) * 1400);
  const h = ac.webviews.get("t1");
  return Promise.resolve(h && h.executeJavaScript("window.scrollTo({top:" + y + ",behavior:'instant'})")).then(() => sleep(140))
    .then(() => pic("t1", "scroll" + i + ":t1")).then(() => snap("scroll", { pageKey: { t1: "scroll" + i + ":t1" } }));
}));
then(() => { const h = ac.webviews.get("t1"); return Promise.resolve(h && h.executeJavaScript("window.scrollTo(0,0)")).then(() => sleep(500)); });
return finish();
