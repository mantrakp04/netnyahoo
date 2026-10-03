// Loads every tab once (a restored tab loads when first shown), so titles and favicons are real, and leaves each
// profile on the tab the film shows. Profiles change through the real swipe (goProfile).
[["default", "t1"], ["work", "t7"], ["campaign", "t14"]].forEach(([pid, shown]) => {
  then(() => goProfile(pid));
  Object.values(st().tabs).filter((t) => t.profileId === pid).forEach((t) => then(() => { st().activate(t.id); return sleep(2500); }));
  then(() => { st().activate(shown); return sleep(1000); });
});
then(() => goProfile("default"));
then(() => sleep(1000).then(() => snap("warm")));
return finish({ titles: Object.values(st().tabs).map((t) => [t.id, t.title]), toasts: nn.toasts ? Object.keys(nn.toasts) : null });
