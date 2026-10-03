// The built-in content blocker: Site Controls on a page full of ads and trackers.
let tabId;
then(() => { unsplit(); return goProfile("default"); });
then(() => { tabId = st().newTab(W, { url: "https://www.merriam-webster.com/dictionary/immunity" }); return sleep(8000).then(() => picShown()).then(() => snap("page")); });
then(() => { nn.pageState.setState((p) => ({ popover: Object.assign({}, p.popover, { [tabId]: "siteControls" }) })); return sleep(1500).then(() => snap("controls")).then(() => sleep(1500)).then(() => snap("controls2")); });
then(() => { nn.pageState.setState((p) => ({ popover: Object.assign({}, p.popover, { [tabId]: null }) })); return sleep(500); });
return finish({ blocked: JSON.stringify((nn.pageState.getState().pages || {})[tabId] || null).slice(0, 400) });
