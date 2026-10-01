// What a user's data looks like after an update: carryover.sh runs this twice on test copies, in a fake home.
//   node carryover.mjs create <previous app> <home> <cdp port> <pages origin> <extension dir> <out.json>
//     The previous build, with NETNYAHOO_DATA_DIR set to where an installed copy keeps its data: two profiles with
//     tabs, cookies (persistent and session), localStorage, a saved password each, bookmarks, history, an address, a
//     site permission, a zoom level and an unpacked extension. Reads it all back, quits as ⌘Q does.
//   node carryover.mjs read <new app> <home> <cdp port> <pages origin> <created.json> <out.json>
//     The new build with no NETNYAHOO_DATA_DIR, so it finds the installed copy's folder itself. Reads the same things
//     and prints a PASS/FAIL line for each; exits 1 on any FAIL.
//   node carryover.mjs use <new app> <home> <cdp port> <pages origin> - <used.json>          (rollback.sh)
//     The new build adds a second session: a tab with persistent and session cookies and localStorage, a visit, a
//     password, a bookmark, a zoom level, and the extension turned off. Reads it all back, quits.
//   node carryover.mjs back <previous app> <home> <cdp port> <pages origin> <used.json> <out.json>  (rollback.sh)
//     The previous build again (NETNYAHOO_DATA_DIR set, as in create): everything from both sessions must be there.
// The apps run hidden (NETNYAHOO_BACKGROUND=1, which also keeps them off the login keychain) with HOME and
// CFFIXED_USER_HOME at <home>; their data folder is named after their (test) bundle id.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [phase, app, home, port, origin, extra, out] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const bundleId = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", `${app}/Contents/Info.plist`]).toString().trim();
const docs = path.join(home, "Library/Application Support", bundleId);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pid = null;
const alive = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
setTimeout(() => { console.error("carryover: no result in 240 s"); if (pid) try { process.kill(Number(pid), "SIGKILL"); } catch {} process.exit(3); }, 240_000).unref();

try { await fetch(`http://127.0.0.1:${port}/json/version`); console.error(`carryover: port ${port} is taken`); process.exit(4); } catch {}
fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, "perf-probe"), ""); // starts the dev harness in a release build's isolated instance
const exe = `${app}/Contents/MacOS/Netnyahoo`;
const pids = () => { try { return execSync(`pgrep -f '^${exe}'`).toString().trim().split("\n").filter(Boolean); } catch { return []; } };
const before = new Set(pids());
const env = ["NETNYAHOO_BACKGROUND=1", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, `HOME=${home}`, `CFFIXED_USER_HOME=${home}`,
  "NETNYAHOO_TEST_REAUTH=granted", "NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows"];
if (phase === "create" || phase === "back") env.push(`NETNYAHOO_DATA_DIR=${docs}`);
execFileSync("open", ["-g", "-n", ...env.flatMap((e) => ["--env", e]), app]);
for (let i = 0; i < 40 && !pid; i++) { await sleep(500); pid = pids().find((p) => !before.has(p)) ?? null; }
if (!pid) { console.error("carryover: the app didn't start"); process.exit(2); }

const step = (what) => { if (process.env.CARRYOVER_VERBOSE) console.error(`carryover ${phase}: ${what}`); };
let seq = 0;
async function inApp(body, timeoutMs = 30_000) { // lib/devHarness.ts; Hermes has no async functions here
  step(body.trim().split("\n")[0].slice(0, 100));
  const id = `c${Date.now()}-${seq++}`;
  fs.writeFileSync(path.join(docs, "dev-eval.js"), `// ${id}\n${body}`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!alive()) throw new Error("the app quit");
    try {
      const r = JSON.parse(fs.readFileSync(path.join(docs, "dev-eval-result.json"), "utf8"));
      if (r.id === id) { if (r.error) throw new Error(r.error); return r.result; }
    } catch (e) { if (!(e instanceof SyntaxError) && e.code !== "ENOENT") throw e; }
    await sleep(200);
  }
  throw new Error(`timed out: ${body.slice(0, 80)}`);
}
async function inPage(urlPart, expression) { // Runtime.evaluate in the first page whose URL has urlPart
  for (let i = 0; i < 40; i++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
    const t = targets.find((t) => t.type === "page" && t.url.includes(urlPart));
    if (t) {
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      const v = await new Promise((r) => {
        ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m.result?.result?.value); };
        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
      });
      ws.close();
      if (v !== undefined) return v;
    }
    await sleep(500);
  }
  return `(no page ${urlPart})`;
}
const window = `Object.keys(nn.store.getState().windows)[0]`;
const show = (pattern) => inApp(`const s = nn.store.getState(); const t = Object.values(s.tabs).find((t) => ${pattern}.test(t.url));
  if (t) { nn.actions.switchProfile(${window}, t.profileId); nn.actions.switchToTab(t.id); } return !!t;`);

// Everything this test covers, per profile, as the app's own APIs report it.
const READ = `
const s = nn.store.getState(), C = globalThis.expo.modules.NetnyahooCEF, X = globalThis.expo.modules.NetnyahooExtensions;
const O = ${JSON.stringify(origin)};
const seq = (items, f) => items.reduce((p, x) => p.then(() => f(x)), Promise.resolve());
const safe = (p, f) => Promise.resolve().then(() => p).then(f, (e) => "error: " + e);
const flat = (n, acc) => { acc = acc || []; if (!n) return acc; if (n.u) acc.push(n.t + " " + n.u); (n.c || []).forEach((c) => flat(c, acc)); return acc; };
const r = { profiles: s.profileOrder.map((id) => s.profiles[id].name), tabs: [] };
for (const t of Object.values(s.tabs)) if (t.url) r.tabs.push(s.profiles[t.profileId].name + " " + t.url);
r.tabs.sort();
return safe(C.engineInfo(), (i) => { r.dataDirectory = i && i.dataDirectory; }).then(() => seq(s.profileOrder, (id) => {
  const p = id === "default" ? "" : id, name = s.profiles[id].name, put = (k, v) => { r[name + " " + k] = v; };
  return C.unlockPasswords(p).then(() => C.listPasswords(p))
    .then((list) => { const pw = []; put("passwords", pw); return seq((list && list.passwords) || [], (e) => C.getPassword(p, e.origin, e.username).then((v) => { pw.push(e.username + " " + (v && v.password)); })); })
    .then(() => safe(C.engineCall("nn_bookmarks_tree", p, null), (t) => { t = JSON.parse(t); put("bookmarks", flat(t.bar).concat(flat(t.other))); }))
    .then(() => safe(C.engineCall("nn_history_query", p, JSON.stringify({ maxUrls: 100, maxVisits: 5 })), (h) => put("history", (JSON.parse(h).entries || []).map((e) => e.u).sort())))
    .then(() => safe(C.listAddresses(p), (a) => put("addresses", ((a && a.addresses) || []).map((x) => x.name + ", " + x.city))))
    .then(() => safe(C.getSiteSettings(p, O), (v) => put("notifications", v && v.notifications && v.notifications.value)))
    .then(() => safe(C.getZoomLevels(p), (z) => put("zoom", z)))
    .then(() => safe(X.list(p), (l) => put("extensions", ((l && l.extensions) || []).filter((e) => !/uBlock/.test(e.name)).map((e) => e.name + (e.enabled ? "" : " (off)")).sort())));
})).then(() => r);`;

const report = {};
try {
  let w = null;
  for (let i = 0; i < 60 && !w; i++) { w = await inApp(`return ${window} || null;`, 3000).catch(() => null); if (!w) await sleep(1000); }
  if (!w) throw new Error("no window");
  if (phase === "create") {
    const W = JSON.stringify(w);
    await inApp(`const s = nn.store.getState(); s.newTab(${W}, { url: "${origin}/page2.html" }); nn.actions.switchToTab(s.newTab(${W}, { url: "${origin}/page1.html" })); return 1;`);
    report.setPersonal = await inPage("page1.html", `document.cookie = "p_persist=yes; max-age=31536000; path=/"; document.cookie = "p_session=yes; path=/"; localStorage.setItem("p_ls", "yes"); document.cookie`);
    await show("/page2/"); await sleep(1500); // a visit to page2 too
    const work = await inApp(`const s = nn.store.getState(); const id = s.createProfile({ name: "Work", color: "blue" }); nn.actions.switchProfile(${W}, id); return id;`);
    await sleep(1500);
    await inApp(`nn.actions.switchToTab(nn.store.getState().newTab(${W}, { url: "${origin}/work.html", profileId: ${JSON.stringify(work)} })); return 1;`);
    report.setWork = await inPage("work.html", `document.cookie = "w_persist=yes; max-age=31536000; path=/"; document.cookie = "w_session=yes; path=/"; localStorage.setItem("w_ls", "yes"); document.cookie`);
    report.made = await inApp(`
      const s = nn.store.getState(), C = globalThis.expo.modules.NetnyahooCEF, O = ${JSON.stringify(origin)}, work = ${JSON.stringify(work)};
      s.addBookmark({ profileId: "default", url: O + "/page2.html", title: "Carryover bookmark" });
      s.addBookmark({ profileId: work, url: O + "/work.html", title: "Work bookmark" });
      return C.savePassword("", O, "alice", "pw-personal-123")
        .then(() => C.savePassword(work, O, "bob", "pw-work-456"))
        .then(() => C.saveAddress("", { name: "Ada Lovelace", city: "London", street: "12 St James's Square", postalCode: "SW1Y 4JH", country: "GB" }))
        .then(() => C.setSiteSetting("", O, "notifications", "allow"))
        .then(() => C.setZoom("", "127.0.0.1", 1.5))
        .then(() => globalThis.expo.modules.NetnyahooExtensions.install(${JSON.stringify(extra)}, ""));`, 60_000);
    await sleep(4000);
  }
  if (phase === "use") {
    const W = JSON.stringify(w);
    await inApp(`nn.actions.switchProfile(${W}, "default"); nn.actions.switchToTab(nn.store.getState().newTab(${W}, { url: "${origin}/page3.html", profileId: "default" })); return 1;`);
    report.setNew = await inPage("page3.html", `document.cookie = "n_persist=yes; max-age=31536000; path=/"; document.cookie = "n_session=yes; path=/"; localStorage.setItem("n_ls", "yes"); document.cookie`);
    report.made = await inApp(`
      const s = nn.store.getState(), C = globalThis.expo.modules.NetnyahooCEF, X = globalThis.expo.modules.NetnyahooExtensions, O = ${JSON.stringify(origin)};
      s.addBookmark({ profileId: "default", url: O + "/page3.html", title: "New build bookmark" });
      return C.savePassword("", O, "carol", "pw-new-789")
        .then(() => C.setZoom("", "localhost", 0.9))
        .then(() => X.list(""))
        .then((l) => { const e = ((l && l.extensions) || []).find((e) => e.name === "NNCore spike extension"); return e ? X.setEnabled(e.id, "", false) : "no extension"; });`, 60_000);
    await sleep(4000);
  }
  report.read = await inApp(READ, 90_000);
  if (phase === "use" || phase === "back") {
    await show("/page3/"); await sleep(2500);
    report.read["New build page"] = await inPage("page3.html", `document.cookie + "; localStorage " + localStorage.getItem("n_ls")`);
  }
  // Cookies and localStorage as each profile's page sees them (showing a tab loads it).
  await show("/work/"); await sleep(2500);
  report.read["Work page"] = await inPage("work.html", `document.cookie + "; localStorage " + localStorage.getItem("w_ls")`);
  await show("/page1/"); await sleep(2500);
  report.read["Personal page"] = await inPage("page1.html", `document.cookie + "; localStorage " + localStorage.getItem("p_ls")`);
  // Files the app has open in the real home's Netnyahoo folders: must be none.
  const real = path.join(os.userInfo().homedir, "Library");
  const tree = [pid];
  for (let i = 0; i < tree.length; i++) { try { tree.push(...execSync(`pgrep -P ${tree[i]}`).toString().trim().split("\n").filter(Boolean)); } catch {} }
  const open = execSync(`lsof -p ${tree.join(",")} -Fn`).toString(); // throws (and fails the run) if lsof can't look
  report.realHomeFiles = open.split("\n").filter((l) => l.startsWith(`n${real}/Application Support/com.netnyahoo`) || l.startsWith(`n${real}/Caches/com.netnyahoo`));
  report.processesChecked = tree.length;
} catch (e) {
  report.error = String(e.stack || e);
}
execFileSync(process.env.CARRYOVER_QUIT, [pid]); // the quit Apple event, so Chrome flushes its stores
for (let i = 0; i < 60 && alive(); i++) await sleep(500);
report.quit = !alive();
if (alive()) process.kill(Number(pid), "SIGKILL");

if (phase === "use") {
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const ok = !report.error && report.quit && /n_session/.test(report.setNew) && /pw-new-789/.test(JSON.stringify(report.read)) && /\(off\)/.test(JSON.stringify(report.read));
  if (!ok) { console.log(`FAIL  the new build added its session  (${report.error ?? JSON.stringify(report).slice(0, 300)})`); process.exit(1); }
  process.exit(0);
}
if (phase === "create") {
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  // Everything the run made must read back as made, or a later "carried over" compares nothing.
  const r = report.read ?? {};
  const want = {
    "profiles": '["Personal","Work"]', "Personal passwords": '["alice pw-personal-123"]', "Work passwords": '["bob pw-work-456"]',
    "Personal bookmarks": `["Carryover bookmark ${origin}/page2.html"]`, "Work bookmarks": `["Work bookmark ${origin}/work.html"]`,
    "Personal addresses": '["Ada Lovelace, London"]', "Personal notifications": '"allow"', "Personal zoom": '{"127.0.0.1":1.5}',
    "Personal extensions": '["NNCore spike extension"]',
    "Personal page": '"p_persist=yes; p_session=yes; localStorage yes"', "Work page": '"w_persist=yes; w_session=yes; localStorage yes"',
  };
  const wrong = Object.entries(want).filter(([k, v]) => JSON.stringify(r[k]) !== v).map(([k]) => `${k}: ${JSON.stringify(r[k])}`);
  if (!(r["Personal history"] ?? []).includes(`${origin}/page1.html`) || !(r["Work history"] ?? []).includes(`${origin}/work.html`)) wrong.push("history");
  const ok = !report.error && report.quit && !wrong.length;
  if (!ok && !report.error) report.error = `not as made: ${wrong.join("; ")}`;
  if (!ok) { console.log(`FAIL  the previous build made the test data  (${report.error ?? JSON.stringify(report).slice(0, 300)})`); process.exit(1); }
  process.exit(0);
}

const created = JSON.parse(fs.readFileSync(extra, "utf8")).read;
fs.writeFileSync(out, JSON.stringify(report, null, 2));
let failed = !!report.error;
if (report.error) console.log(`FAIL  the new build read the data  (${report.error})`);
// Key order aside (Chrome lists zoom levels in its own order).
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
// The previous build may drop session cookies at its own launch (0.2.21 does, at every launch): reported, not failed.
const sessionless = (v) => (typeof v === "string" ? v.replace(/\w+_session=yes; /g, "") : v);
const line = (ok, name, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  carried over: ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed = true; };
const expected = path.join(docs, "Chromium");
if (phase !== "back") line(report.read?.dataDirectory?.replace(/^\/private/, "") === expected.replace(/^\/private/, ""), "the installed copy's folder, found without NETNYAHOO_DATA_DIR", report.read?.dataDirectory);
for (const [key, was] of Object.entries(created)) {
  if (key === "dataDirectory") continue;
  const now = report.read?.[key];
  // History may gain entries; every earlier one must still be there.
  const failedRead = typeof now === "string" && now.startsWith("error:");
  const ok = !failedRead && key.endsWith(" history") && Array.isArray(was) && Array.isArray(now) ? was.every((u) => now.includes(u)) : !failedRead && (stable(now) === stable(was) || (phase === "back" && key.endsWith(" page") && sessionless(now) === sessionless(was)));
  if (phase === "back" && key.endsWith(" page") && ok && stable(now) !== stable(was))
    console.log(`INFO  ${key}: the previous build dropped session cookies at launch (${(String(was).match(/\w+_session/g) || []).join(", ")})`);
  const shown = JSON.stringify(now ?? null);
  line(ok, key, ok ? shown.slice(0, 120) : `${JSON.stringify(was).slice(0, 150)} → ${shown.slice(0, 150)}`);
}
line(report.realHomeFiles?.length === 0, "nothing opened in the real home's Netnyahoo folders", report.realHomeFiles?.slice(0, 2).join(", "));
line(report.quit, "it quits on the quit Apple event");
process.exit(failed ? 1 : 0);
