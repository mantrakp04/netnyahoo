const DIR = "pour-block";
const s = nn.store.getState();
if (!s.windows[W].sidebarOpen) s.toggleSidebar(W);
const t = tab("merriam-webster");
s.activate(t.id);
return sleep(2500)
  .then(() => snap(DIR, "page"))
  .then(() => { nn.pageState.setState((p) => ({ popover: { ...p.popover, [t.id]: "siteControls" } })); return sleep(1500); })
  .then(() => snapFor(DIR, "popover", 1500))
  .then(() => JSON.stringify({ log, blocked: nn.pageState.getState().pages?.[t.id]?.blocked ?? null, page: Object.keys(nn.pageState.getState()) }));
