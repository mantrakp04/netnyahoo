// Split view: one page, then two, then three, each on its own snapshot (the layout settles at once). Each state keeps
// its own page pictures (a pane narrows as another opens).
then(() => { unsplit(); return goProfile("work"); });
then(() => { st().activate("t7"); return sleep(1500).then(() => picShown("one")).then(() => snap("one", { pageKey: { t7: "one:t7" } })); });
then(() => { st().openSplitPane(W, { tabId: "t9" }); return sleep(2500).then(() => picShown("two")).then(() => snap("two", { pageKey: { t7: "two:t7", t9: "two:t9" } })); });
then(() => { st().openSplitPane(W, { tabId: "t8" }); return sleep(2500).then(() => picShown("three")).then(() => snap("three", { pageKey: { t7: "three:t7", t9: "three:t9", t8: "three:t8" } })); });
then(() => unsplit());
return finish();
