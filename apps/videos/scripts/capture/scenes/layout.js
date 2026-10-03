// The address bar in a toolbar, then dissolved into the sidebar; then the sidebar hidden (the page gets the window).
then(() => { unsplit(); return goProfile("default"); });
then(() => { st().activate("t1"); return sleep(800).then(() => picShown()); });
then(() => { st().updateSettings({ addressBar: "toolbar" }); return sleep(1500).then(() => picShown("toolbar")).then(() => snap("toolbar", { pageKey: { t1: "toolbar:t1" } })); });
then(() => { st().updateSettings({ addressBar: "sidebar" }); return sleep(1500).then(() => picShown("sidebar")).then(() => snap("sidebar", { pageKey: { t1: "sidebar:t1" } })); });
then(() => { st().toggleSidebar(W); return sleep(1500).then(() => picShown("hidden")).then(() => snap("hidden", { pageKey: { t1: "hidden:t1" } })); });
then(() => { st().toggleSidebar(W); return sleep(1000); });
then(() => { const id = st().newTab(W, {}); return sleep(2500).then(() => snap("newtab")).then(() => { st().closeTab(id); st().activate("t1"); return sleep(500); }); });
return finish();
