#!/usr/bin/env node
// End to end: two, then three hidden Netnyahoo instances (A, B, C) syncing through one folder.
//
//   node packages/sync/scripts/e2e.mjs [Debug app] [work dir]
//
// Each instance runs through scripts/lib/instance.mjs with its own data dir (<work dir>/A, B, C) and DevTools port,
// and NETNYAHOO_SYNC_DEFAULT_FOLDER at <work dir>/folder. One line per check; everything else goes to
// <work dir>/e2e.log. Exit code 1 if any check failed.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, launch, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP = path.resolve(process.argv[2] ?? `${repo}/apps/browser/build-sync/Build/Products/Debug/Netnyahoo.app`);
const WORK = path.resolve(process.argv[3] ?? `${process.env.TMPDIR ?? "/tmp"}/nn-sync-e2e`);
const FOLDER = `${WORK}/folder`;
const PORT = await freePort();
const W = `http://127.0.0.1:${PORT}`;
const DEV = { A: {}, B: {}, C: {} };
for (const [name, d] of Object.entries(DEV)) d.dir = `${WORK}/${name}`;

// MARK: Harness

fs.rmSync(WORK, { recursive: true, force: true });
const report = reporter(`${WORK}/e2e.log`, { name: "sync e2e" });
// What happened since the last check: in the log, and printed under a failing check.
const note = report.log;
// An assertion on collected data (untimed).
const check = (name, ok, detail = "") => report.record(name, { error: ok ? null : detail || "the assertion failed" });

const apps = {};
async function start(name) {
  const { dir } = DEV[name];
  const app = (apps[name] = await launch(APP, {
    data: dir,
    env: { NETNYAHOO_SYNC_DEFAULT_FOLDER: FOLDER },
    ready: { timeout: 120_000, test: "return !!globalThis.nnSync && Object.keys(nn.store.getState().windows).length > 0" },
  }));
  note(`${name}: pid ${app.pid}, DevTools ${app.port}, log ${app.log}`);
}

const short = (x, n) => (x === undefined ? "undefined" : JSON.stringify(x).slice(0, n));
async function ev(name, body, timeout = 90_000) {
  const what = body.replace(/\s+/g, " ").trim().slice(0, 160);
  try {
    const result = await apps[name].eval(body, { timeout });
    note(`[${name}] ${what} -> ${short(result, 1000)}`);
    return result;
  } catch (e) {
    note(`[${name}] ${what} -> error ${e.message}`);
    throw new Error(`${name}: ${e.message}`);
  }
}

// Chrome records a page load in its history; the store's view shows it once Chrome reports it.
async function inHistory(name, url) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await ev(name, `return (nn.store.getState().history.default || []).some((h) => h.url === ${JSON.stringify(url)})`)) return;
    await sleep(300);
  }
  throw new Error(`${name}: ${url} never reached Chrome's history`);
}
// A page load, then its tab closes.
async function visit(name, url) {
  const tab = await ev(name, `const s = nn.store.getState(); return s.newTab(s.windowOrder[0], { url: ${JSON.stringify(url)} });`);
  await inHistory(name, url);
  await ev(name, `nn.store.getState().closeTab(${JSON.stringify(tab)}); return true;`);
}

const sync = async (...names) => {
  for (const n of names) await ev(n, "return nnSync.syncNow()");
};

async function state(name) {
  return ev(
    name,
    `
    const s = nn.store.getState();
    const b = s.bookmarks; const roots = b.roots.default;
    const walk = (id) => { const n = b.nodes[id]; return n.kind === "url" ? n.title + " " + n.url : { [n.title]: n.children.map(walk) }; };
    const u = nnSync.useSync.getState();
    return Promise.all([nnSync.native.readPasswords(""), globalThis.expo.modules.NetnyahooCEF.listPasswords("")]).then(([pw, list]) => ({
      status: u.status, error: u.error, enabled: u.enabled, pending: u.pending,
      bookmarks: [walk(roots.bar), walk(roots.other)],
      history: (s.history.default || []).map((h) => h.url).sort(),
      settings: { appearance: s.settings.appearance, searchEngine: s.settings.searchEngine, showFullUrl: s.settings.showFullUrl, cleanUp: s.settings.cleanUpInactiveTabsAfterHours },
      pinned: Object.values(s.tabs).filter((t) => t.pinned).map((t) => t.pinnedUrl || t.url).sort(),
      unloadedPins: Object.values(s.tabs).filter((t) => t.pinned && t.unloaded).length,
      passwords: (pw || []).map((p) => p.origin + " " + p.username + "=" + p.password).sort(),
      chromePasswords: ((list && list.passwords) || []).map((p) => p.origin + " " + p.username).sort(),
      devices: u.devices.map((d) => d.id),
      remoteTabs: (u.remoteTabs.default || []).map((d) => ({ id: d.deviceId, urls: d.tabs.map((t) => t.url) })),
      menu: nnSync.menu.syncedDevicesMenuItem("default"),
      deviceId: nnSync.doc().deviceId,
    }));
  `,
  );
}
const data = (x) => ({ bookmarks: x.bookmarks, history: x.history, settings: x.settings, pinned: x.pinned, passwords: x.passwords });
const same = (a, b) => JSON.stringify(data(a)) === JSON.stringify(data(b));
const text = (x) => JSON.stringify(x);

function bip39(entropy) {
  const list = fs.readFileSync(`${WORK}/english.txt`, "utf8").split("\n").filter(Boolean);
  const hash = crypto.createHash("sha256").update(entropy).digest()[0];
  const bits = [...entropy].map((b) => b.toString(2).padStart(8, "0")).join("") + hash.toString(2).padStart(8, "0");
  return bits.match(/.{11}/g).map((b) => list[parseInt(b, 2)]).join(" ");
}

const savePassword = (origin, user, password) =>
  `const c = globalThis.expo.modules.NetnyahooCEF; return c.deletePassword("", "${origin}", "${user}").then(() => c.savePassword("", "${origin}", "${user}", "${password}"));`;

// MARK: Run

fs.mkdirSync(FOLDER, { recursive: true });
const swift = fs.readFileSync(`${repo}/packages/sync/ios/Core/Wordlist.swift`, "utf8");
fs.writeFileSync(`${WORK}/english.txt`, [...swift.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).join("\n"));

const server = http
  .createServer((req, res) => {
    const name = new URL(req.url, W).pathname.slice(1).replace(".html", "");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>NNE2E ${name} page</title><h1>${name}</h1>`);
  })
  .listen(PORT, "127.0.0.1");
await new Promise((r, j) => (server.once("listening", r), server.once("error", j)));

try {
  // Both at once; one that never gets ready is quit by launch(), the other is in `apps` for the quit below.
  const started = await Promise.allSettled([start("A"), start("B")]);
  const notStarted = started.find((r) => r.status === "rejected");
  if (notStarted) throw notStarted.reason;

  check("A turns on sync", text(await ev("A", `return nnSync.turnOnSync(${JSON.stringify(FOLDER)})`)) === '{"ok":true}');
  const phrase = (await ev("A", "return nnSync.native.recoveryWords()")).join(" ");
  check("the phrase is 24 words", phrase.split(" ").length === 24);
  await ev(
    "A",
    `
    const s = nn.store.getState();
    const f = s.addBookmarkFolder({ profileId: "default", title: "NNE2E Folder" });
    s.addBookmark({ profileId: "default", url: "${W}/alpha.html?nne2e=bm1", title: "NNE2E Bookmark Alpha", parentId: f });
    s.addBookmark({ profileId: "default", url: "${W}/beta.html?nne2e=bm2", title: "NNE2E Bookmark Beta" });
    s.updateSettings({ appearance: "dark", searchEngine: "duckduckgo" });
    const w = nn.store.getState().windowOrder[0];
    nn.store.getState().pinTabs([s.newTab(w, { url: "${W}/pinned.html?nne2e=pin1" })], true);
    s.newTab(w, { url: "${W}/open.html?nne2e=tab1" });
    return true;`,
  );
  await visit("A", `${W}/visited.html?nne2e=hist1`);
  await ev("A", savePassword("https://nne2e-bank.example", "nne2e-alice", "NNE2E-hunter2-secret"));
  await sync("A");

  const words = phrase.split(" ");
  const swapped = [...words];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  const typo = [...words];
  typo[3] = "netnyahoo";
  const wrong = {
    "a valid phrase of someone else": [bip39(crypto.randomBytes(32)), "mismatch"],
    "two words swapped": [swapped[0] === swapped[1] ? [...words].reverse().join(" ") : swapped.join(" "), "checksum"],
    "a word not on the list": [typo.join(" "), "unknownWord"],
    "23 words": [words.slice(0, 23).join(" "), "wordCount"],
  };
  for (const [name, [p, error]] of Object.entries(wrong)) {
    const r = await ev("B", `return nnSync.enterRecoveryPhrase(${JSON.stringify(FOLDER)}, ${JSON.stringify(p)})`);
    const enabled = await ev("B", "return nnSync.useSync.getState().enabled");
    check(`B rejects the wrong phrase: ${name}`, r.error === error && !enabled, text(r));
  }
  await ev(
    "B",
    `
    const s = nn.store.getState();
    s.addBookmark({ profileId: "default", url: "${W}/gamma.html?nne2e=bmB", title: "NNE2E Bookmark Gamma from B" });
    s.updateSettings({ appearance: "light" });
    s.newTab(nn.store.getState().windowOrder[0], { url: "${W}/openb.html?nne2e=tabB" });
    return true;`,
  );
  await ev("B", savePassword("https://nne2e-shop.example", "nne2e-bob", "NNE2E-B-shop-pass"));
  const typed = words.map((w, i) => `${i + 1}. ${w.toUpperCase()}`).join("\n");
  check("B joins with the right phrase", text(await ev("B", `return nnSync.enterRecoveryPhrase(${JSON.stringify(FOLDER)}, ${JSON.stringify(typed)})`)) === '{"ok":true}');
  for (let i = 0; i < 3; i++) await sync("B", "A");
  let [a, b] = [await state("A"), await state("B")];
  check("A's bookmarks, history, pinned tab and password reach B", text(b).includes("NNE2E Bookmark Alpha") && b.history.some((u) => u.includes("hist1")) && b.pinned.some((u) => u.includes("pin1")) && b.passwords.some((p) => p.includes("NNE2E-hunter2-secret")), text(data(b)));
  check("B's own bookmark and password reach A (joining merges, nothing is lost)", text(a).includes("Gamma from B") && a.passwords.some((p) => p.includes("NNE2E-B-shop-pass")));
  check("Chrome's password manager on B lists A's login", b.chromePasswords.includes("https://nne2e-bank.example nne2e-alice"));
  check("B took the synced settings when it joined", b.settings.appearance === "dark" && b.settings.searchEngine === "duckduckgo", text(b.settings));
  check("synced pinned tabs arrive unloaded", b.unloadedPins === 1);
  check("A and B converge", same(a, b), text({ a: data(a), b: data(b) }));
  check("A sees B's open tabs (not its pinned tabs)", a.remoteTabs.length === 1 && text(a.remoteTabs).includes("tabB") && !text(a.remoteTabs).includes("pin1"), text(a.remoteTabs));
  check("B's overflow menu: \"Your MacBook Pro Tabs\"-style item with Recent Tabs", /^Your .+ Tabs$/.test(b.menu?.title ?? "") && b.menu.children[0].title === "Recent Tabs" && text(b.menu).includes("NNE2E open page"), text(b.menu));

  await ev(
    "B",
    `
    const s = nn.store.getState();
    const nodes = Object.values(s.bookmarks.nodes);
    s.updateBookmark(nodes.find((n) => n.title === "NNE2E Bookmark Beta").id, { title: "NNE2E Beta Renamed on B" });
    s.removeBookmark(nodes.find((n) => n.title === "NNE2E Bookmark Gamma from B").id);
    s.addBookmark({ profileId: "default", url: "${W}/delta.html?nne2e=bmD", title: "NNE2E Bookmark Delta from B" });
    s.removeHistory("default", ["${W}/visited.html?nne2e=hist1"]);
    s.updateSettings({ showFullUrl: true, cleanUpInactiveTabsAfterHours: 24 });
    return globalThis.expo.modules.NetnyahooCEF.deletePassword("", "https://nne2e-shop.example", "nne2e-bob");`,
  );
  await visit("B", `${W}/visited2.html?nne2e=hist2`);
  await ev("B", savePassword("https://nne2e-bank.example", "nne2e-alice", "NNE2E-changed-on-B"));
  await sync("B", "A", "B", "A");
  a = await state("A");
  check("B's rename, delete and new bookmark reach A", text(a.bookmarks).includes("Beta Renamed on B") && !text(a.bookmarks).includes("Gamma from B") && text(a.bookmarks).includes("Delta from B"));
  check("B's history delete and new visit reach A", !a.history.some((u) => u.includes("hist1")) && a.history.some((u) => u.includes("hist2")));
  check("B's settings reach A", a.settings.showFullUrl === true && a.settings.cleanUp === 24);
  check("B's password change and deletion reach A", text(a.passwords) === text(["https://nne2e-bank.example/ nne2e-alice=NNE2E-changed-on-B"]), text(a.passwords));

  await ev(
    "A",
    `
    const s = nn.store.getState();
    const nodes = Object.values(s.bookmarks.nodes);
    s.moveBookmark(nodes.find((n) => n.title === "NNE2E Bookmark Alpha").id, s.bookmarks.roots.default.bar, 0);
    s.removeBookmark(nodes.find((n) => n.title === "NNE2E Folder").id);
    s.addBookmark({ profileId: "default", url: "${W}/alpha.html?nne2e=bmA2", title: "NNE2E Second from A", parentId: s.bookmarks.roots.default.other });
    s.updateSettings({ appearance: "light", cleanUpInactiveTabsAfterHours: null });
    const w = nn.store.getState().windowOrder[0];
    nn.store.getState().pinTabs([s.newTab(w, { url: "${W}/beta.html?nne2e=pin2" })], true);
    return true;`,
  );
  await ev("A", savePassword("https://nne2e-mail.example", "nne2e-carol", "NNE2E-mail-from-A"));
  await sync("A", "B", "A", "B");
  b = await state("B");
  check("A's move, folder delete and new bookmark reach B", text(b.bookmarks).includes("NNE2E Second from A") && !text(b.bookmarks).includes("NNE2E Folder"), text(b.bookmarks));
  check("A's new pinned tab and settings reach B", b.pinned.some((u) => u.includes("pin2")) && b.settings.appearance === "light" && b.settings.cleanUp === null, text(b.settings));
  check("A's new password reaches B", b.passwords.some((p) => p.includes("NNE2E-mail-from-A")));

  await ev("A", `const s = nn.store.getState(); s.updateBookmark(Object.values(s.bookmarks.nodes).find((n) => n.title === "NNE2E Beta Renamed on B").id, { title: "NNE2E Concurrent A" }); s.updateSettings({ searchEngine: "bing" }); return true;`);
  await ev("A", savePassword("https://nne2e-bank.example", "nne2e-alice", "NNE2E-concurrent-A"));
  await sleep(20);
  await ev("B", `const s = nn.store.getState(); s.updateBookmark(Object.values(s.bookmarks.nodes).find((n) => n.title === "NNE2E Beta Renamed on B").id, { title: "NNE2E Concurrent B" }); s.updateSettings({ searchEngine: "google" }); return true;`);
  await ev("B", savePassword("https://nne2e-bank.example", "nne2e-alice", "NNE2E-concurrent-B"));
  await sync("A", "B", "A", "B", "A", "B");
  [a, b] = [await state("A"), await state("B")];
  check("concurrent edits converge on both Macs", same(a, b), text({ a: data(a), b: data(b) }));
  check("the later edit wins (bookmark, setting, password)", text(a.bookmarks).includes("NNE2E Concurrent B") && a.settings.searchEngine === "google" && a.passwords.some((p) => p.includes("NNE2E-concurrent-B")));

  const seqs = async () => text(await Promise.all(["A", "B"].map((n) => ev(n, "return Object.values(nnSync.doc().scopes).map((s) => s.seq)"))));
  const before = await seqs();
  await sync("A", "B", "A", "B", "A", "B");
  check("steady state: no files written while nothing changes", (await seqs()) === before);

  const list = () => execSync(`find ${FOLDER} -name '*.nns' -type f`).toString().trim().split("\n");
  const known = new Set(list());
  await ev("A", `nn.store.getState().addBookmark({ profileId: "default", url: "${W}/alpha.html?nne2e=partial1", title: "NNE2E Partial One" }); return nnSync.syncNow()`);
  const first = list().find((f) => !known.has(f));
  known.add(first);
  await ev("A", `nn.store.getState().addBookmark({ profileId: "default", url: "${W}/beta.html?nne2e=partial2", title: "NNE2E Partial Two" }); return nnSync.syncNow()`);
  const second = list().find((f) => !known.has(f));
  const full = fs.readFileSync(first);
  fs.writeFileSync(first, full.subarray(0, full.length >> 1));
  const stub = second.replace(/\/([^/]+)$/, "/.$1.icloud");
  fs.renameSync(second, `${second}.aside`);
  fs.writeFileSync(stub, "placeholder");
  await sync("B");
  b = await state("B");
  check("a half-copied file and an undownloaded one aren't applied", !text(b.bookmarks).includes("Partial One") && !text(b.bookmarks).includes("Partial Two") && b.pending === 1, `pending ${b.pending}`);
  fs.writeFileSync(first, full);
  fs.unlinkSync(stub);
  fs.renameSync(`${second}.aside`, second);
  await sync("B");
  b = await state("B");
  check("once they arrive whole, both apply", text(b.bookmarks).includes("Partial One") && text(b.bookmarks).includes("Partial Two") && b.pending === 0);

  const files = execSync(`find ${FOLDER} -mindepth 1`).toString().trim().split("\n");
  const needles = ["NNE2E", "nne2e", "hunter2", "127.0.0.1", "alpha.html", "Bookmark", "duckduckgo", "appearance", "MacBook", "https", "default", "pw:", "bm:"];
  const leaks = needles.filter((n) => files.some((f) => f.slice(FOLDER.length).includes(n) || (fs.statSync(f).isFile() && fs.readFileSync(f).includes(n))));
  check(`no plaintext in the sync folder (${files.filter((f) => f.endsWith(".nns")).length} files; ${needles.length} strings searched)`, leaks.length === 0, leaks.join(", "));
  check("every file is padded to 1 KiB steps", files.filter((f) => f.endsWith(".nns")).every((f) => (fs.statSync(f).size - 32) % 1024 === 0));
  const local = ["A", "B"].flatMap((n) => ["sync.json", "sync-state.nns", "sync-journal.nns"].map((f) => `${DEV[n].dir}/${f}`)).filter((f) => fs.existsSync(f));
  check("this Mac's own sync state holds no plaintext password", local.every((f) => !fs.readFileSync(f).includes("NNE2E-concurrent-B")));

  await start("C");
  await ev("C", `nn.store.getState().newTab(nn.store.getState().windowOrder[0], { url: "${W}/openc.html?nne2e=tabC" }); return true`);
  // Loaded before C joins, or its history entry lands after the syncs below and C can't converge with A.
  await inHistory("C", `${W}/openc.html?nne2e=tabC`);
  check("C joins", text(await ev("C", `return nnSync.enterRecoveryPhrase(${JSON.stringify(FOLDER)}, ${JSON.stringify(phrase)})`)) === '{"ok":true}');
  await sync("C", "C", "A", "B", "C");
  const c = await state("C");
  a = await state("A");
  check("C converges with A", same(a, c), text({ a: data(a), c: data(c) }));
  check("A lists three devices, and two other devices' tabs roll up into \"Your Devices\"", a.devices.length === 3 && (await ev("A", "return nnSync.menu.syncedDevicesMenuItem('default')")).title === "Your Devices");

  b = await state("B");
  await ev("B", "return nnSync.stopSync({ deleteData: false })");
  const off = await state("B");
  check("turning sync off on B leaves its bookmarks, history, settings, pinned tabs and passwords", same(b, off) && text(off.chromePasswords) === text(b.chromePasswords) && !off.enabled);
  check("B's key is gone from its data folder", !fs.readdirSync(DEV.B.dir).some((f) => f.startsWith("sync-key-")));
  await sync("A");
  a = await state("A");
  check("A drops B from its devices and its tabs", !a.devices.includes(b.deviceId) && !text(a.remoteTabs).includes(b.deviceId));
  await ev("B", `nn.store.getState().addBookmark({ profileId: "default", url: "${W}/delta.html?nne2e=off", title: "NNE2E Made While Off" }); return true`);
  await sync("A");
  check("what B does while off stays on B", !text((await state("A")).bookmarks).includes("Made While Off"));

  a = await state("A");
  const cBefore = await state("C");
  await ev("A", "return nnSync.stopSync({ deleteData: true })");
  await sync("C");
  const cAfter = await state("C");
  check("A's Delete My Sync Data empties the folder", execSync(`find ${FOLDER} -mindepth 1 | wc -l`).toString().trim() === "0");
  check("C shows Dia's reset message and stops", cAfter.status === "reset" && /reset from another device/.test(cAfter.error ?? "") && !cAfter.enabled, text(cAfter.status));
  check("A and C keep all their data", same(a, await state("A")) && same(cBefore, cAfter));
} catch (error) {
  check("the run finished", false, error.stack);
} finally {
  await Promise.all(Object.values(apps).map((app) => app.quit().catch((e) => note(`quit ${app.pid}: ${e.message}`))));
  server.close();
  process.exitCode = report.summary() ? 0 : 1;
}
