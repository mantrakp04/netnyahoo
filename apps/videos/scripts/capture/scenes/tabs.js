// Clicking down each profile's sidebar: every tab shown, then its page captured.
[["default", ["t1", "t2", "t3", "t4", "t5", "t6"], "t1"], ["work", ["t7", "t8", "t9", "t10", "t11", "t12"], "t7"], ["campaign", ["t13", "t14", "t15", "t16", "t17", "t18"], "t14"]].forEach(([pid, ids, shown]) => {
  then(() => { unsplit(); return goProfile(pid); });
  // A page shown again repaints in stages: wait, then capture twice and keep the second.
  ids.forEach((id) => then(() => { st().activate(id); return sleep(3500).then(() => picShown()).then(() => sleep(800)).then(() => picShown()).then(() => snap("tab:" + id)); }));
  // Leave each profile on the tab the other scenes show.
  then(() => { st().activate(shown); return sleep(800); });
});
then(() => goProfile("default"));
return finish();
