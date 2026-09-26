const L = "__CAPTURE_DIR__";
const s0 = nn.store.getState(); const W = s0.windowOrder[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = []; let seq = 0;
const snap = (dir, label) => { const f = `${L}/steps2/${dir}/${String(seq++).padStart(4, "0")}.png`; const t = Date.now(); return nn.shell.devSnapshotWindow(W, f).then(() => { log.push({ f, t, t1: Date.now(), label }); }); };
const snapFor = (dir, label, ms) => { const end = Date.now() + ms; const loop = () => (Date.now() > end ? Promise.resolve() : snap(dir, label).then(loop)); return loop(); };
const tab = (m) => Object.values(nn.store.getState().tabs).find((t) => t.url && t.url.includes(m));
