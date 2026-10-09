// The hook: what other sites ask for, as it interrupts you. Four stand-in sites (sites/*.example, built for the film:
// no real brand) open in the Personal profile; each interruption is played a step per film frame (the page's own
// __t(0…1)), with the page's picture taken at every step.
const ASKS = [
  ["signin", "http://moodwall.example/"],
  ["ai", "http://dailyledger.example/"],
  ["cookies", "http://crumbs.example/"],
  ["upgrade", "http://docpad.example/"],
];
const STEPS = 12;
const opened = [];
then(() => { unsplit(); return goProfile("default"); });
ASKS.forEach(([name, url]) => {
  let id;
  let title;
  then(() => { id = st().newTab(W, { url }); opened.push(id); return sleep(4000).then(() => { title = st().tabs[id].title; }); });
  Array.from({ length: STEPS + 1 }, (_, i) => i).forEach((i) => then(() => {
    const h = ac.webviews.get(id);
    return Promise.resolve(h && h.executeJavaScript("window.__t && window.__t(" + i / STEPS + ")")).then(() => sleep(150))
      .then(() => pic(id, name + i + ":" + id))
      // The button the ask wants pressed, in window points (page frame + its rect): the film's pointer heads for it.
      // (Read back through the page's title: the harness's evaluate never answers in a hidden instance.)
      .then(() => (i === STEPS && h ? Promise.resolve(h.executeJavaScript("document.title='rect:'+JSON.stringify(document.getElementById('go').getBoundingClientRect())")).then(() => sleep(500)).then(() => { const r = st().tabs[id].title; return Promise.resolve(h.executeJavaScript("document.title=" + JSON.stringify(title))).then(() => sleep(500)).then(() => r); }) : null))
      .then((r) => {
        const p = pages[name + i + ":" + id];
        const rect = r && r.indexOf("rect:") === 0 ? JSON.parse(r.slice(5)) : null;
        const mark = rect && p ? { x: (p.frame[0] + rect.x + rect.width / 2) / 1440, y: (p.frame[1] + rect.y + rect.height / 2) / 900 } : undefined;
        return snap("ask:" + name, { step: i, mark, pageKey: { [id]: name + i + ":" + id } });
      });
  }));
});
then(() => { opened.forEach((id) => st().closeTab(id)); st().activate("t1"); return sleep(800); });
return finish();
