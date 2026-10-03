// Split view: one page, then two; then the divider dragged, a step per film frame (the store's sizes, as the divider's
// own drag sets them), each step with both panes' own pictures as they reflow.
let splitId;
const sizesStep = (a, key) => {
  st().updateSplit(splitId, { sizes: [a, 1 - a] });
  return sleep(260).then(() => picShown(key)).then(() => snap("divider", { a, pageKey: Object.fromEntries(shownTabs().map((id) => [id, key + ":" + id])) }));
};
then(() => { unsplit(); return goProfile("work"); });
then(() => { st().activate("t7"); return sleep(1500).then(() => picShown("one")).then(() => snap("one", { pageKey: { t7: "one:t7" } })); });
then(() => { st().openSplitPane(W, { tabId: "t9" }); return sleep(2500).then(() => picShown("two")).then(() => snap("two", { pageKey: { t7: "two:t7", t9: "two:t9" } })); });
then(() => { splitId = Object.values(st().splits)[0].id; });
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const path = [];
Array.from({ length: 16 }, (_, i) => path.push(0.5 - 0.17 * ease((i + 1) / 16)));
Array.from({ length: 22 }, (_, i) => path.push(0.33 + 0.3 * ease((i + 1) / 22)));
Array.from({ length: 12 }, (_, i) => path.push(0.63 - 0.13 * ease((i + 1) / 12)));
path.forEach((a, i) => then(() => sizesStep(a, "d" + i)));
then(() => { st().openSplitPane(W, { tabId: "t8" }); return sleep(2500).then(() => picShown("three")).then(() => snap("three", { pageKey: { t7: "three:t7", t9: "three:t9", t8: "three:t8" } })); });
then(() => unsplit());
return finish();
