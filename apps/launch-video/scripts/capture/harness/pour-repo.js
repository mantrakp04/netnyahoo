// "Pour": the source. The repository's page is active in the sidebar.
const DIR = "pour-repo";
const s = nn.store.getState();
if (!s.windows[W].sidebarOpen) s.toggleSidebar(W);
for (const [id, p] of Object.entries(nn.pageState.getState().popover || {})) if (p) nn.pageState.setState((st) => ({ popover: { ...st.popover, [id]: null } }));
s.activate(tab("github.com/mantrakp04").id);
return sleep(2500).then(() => snap(DIR, "repo")).then(() => JSON.stringify({ log }));
