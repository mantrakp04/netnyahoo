#!/usr/bin/env node
// The launch migration from the app's former name, end to end, against a fake old install in a scratch dir (never
// the real Library or keychain). The old names come from the migration itself (`legacy-migration names`), so this
// file doesn't spell them.
//
//   node packages/sync/scripts/legacy-migration-e2e.mjs [scratch dir]
//     Seeds an old install (documents, a Chrome profile whose saved password and cookie are encrypted with the old
//     Safe Storage key, preferences, a fake keychain), runs the migration as a test instance runs it, crashes it at
//     each step and resumes, and checks what came across: the key (it decrypts the password and the cookie), tabs,
//     pins, settings, shortcuts, bookmarks, renamed files, preferences, keychain items; and that the old install is
//     untouched and a second run does nothing. The old app was the default browser (the fake home's LaunchServices
//     choices), so the migration leaves the offer to be the default again; without that choice it leaves none.
//     Then the app's rename of its own bundle (`legacy-migration move`) on fake bundles: an old-named bundle becomes
//     Arcadia.app and the process starts over from it with the same arguments and environment; a clash, a link, another
//     name, a translocated copy and a read-only folder all stay where they are.
//
//   node packages/sync/scripts/legacy-migration-e2e.mjs --seed-from <instance data dir> <fake home>
//     Turns a quit test instance's data dir (made by today's build) into an old install at <fake home>, for the
//     hidden-instance check: launch the app with ARCADIA_DATA_DIR=<new dir> ARCADIA_LEGACY_SOURCE=<fake home>.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratchPath = join(tmpdir(), "arcadia-sync-swiftpm");
const NEW_ID = "com.arcadia.browser";

function tool() {
  execFileSync("swift", ["build", "--product", "legacy-migration", "--scratch-path", scratchPath], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] });
  const bin = execFileSync("swift", ["build", "--product", "legacy-migration", "--scratch-path", scratchPath, "--show-bin-path"], { cwd: pkg }).toString().trim();
  return join(bin, "legacy-migration");
}

const bin = tool();
const names = JSON.parse(execFileSync(bin, ["names"]).toString());
const oldKey = (now) => Object.keys(names.jsonKeys).find((k) => names.jsonKeys[k] === now);
const [[oldGame], [oldChromeGame], [oldScheme]] = names.urls;
const oldPath = (now) => names.paths.find(([, n]) => n === now)[0];
const safeStorage = names.keychain[0];
const oldService = (now) => names.keychain.find((k) => k.newService === now).oldService;

// MARK: Chrome's macOS encryption (os_crypt): "v10" + AES-128-CBC, key PBKDF2-SHA1(Safe Storage secret, "saltysalt", 1003).
const chromeKey = (secret) => pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1");
const IV = Buffer.alloc(16, " ");
const encrypt = (secret, text) => {
  const c = createCipheriv("aes-128-cbc", chromeKey(secret), IV);
  return Buffer.concat([Buffer.from("v10"), c.update(text), c.final()]);
};
const decrypt = (secret, blob) => {
  if (blob.subarray(0, 3).toString() !== "v10") return null;
  try {
    const d = createDecipheriv("aes-128-cbc", chromeKey(secret), IV);
    return Buffer.concat([d.update(blob.subarray(3)), d.final()]).toString();
  } catch {
    return null;
  }
};
const sqlite = (db, sql) => execFileSync("sqlite3", [db, sql]).toString().trim();

// MARK: Plists (preferences)

const plistJSON = (path) => JSON.parse(execFileSync("plutil", ["-convert", "json", "-r", "-o", "-", path]).toString());
// A preferences domain as cfprefsd has it (it writes the file when it gets round to it).
const domainJSON = (plist) =>
  JSON.parse(execFileSync("plutil", ["-convert", "json", "-r", "-o", "-", "-"], { input: execFileSync("defaults", ["export", plist.replace(/\.plist$/, ""), "-"]) }).toString());
function writePlist(path, object) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".json", JSON.stringify(object));
  execFileSync("plutil", ["-convert", "binary1", "-o", path, path + ".json"]);
  rmSync(path + ".json");
}

// The user's default apps as LaunchServices keeps them, in a fake home: the old app handles http and https.
const LAUNCH_SERVICES = "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist";
const writeOldDefaultBrowser = (home) => writePlist(join(home, LAUNCH_SERVICES), {
  LSHandlers: ["http", "https"].map((scheme) => ({ LSHandlerURLScheme: scheme, LSHandlerRoleAll: names.bundleId })),
});
const OFFER = "default-browser-offer.json";

const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p, { throwIfNoEntry: false });
      if (s?.isDirectory()) walk(p);
      else out[relative(dir, p)] = s ? createHash("sha256").update(readFileSync(p)).digest("hex") : "link";
    }
  };
  walk(dir);
  return out;
};

// MARK: --seed-from: today's test instance → an old install

function toOld(text) {
  let out = text.split("arcadia://game").join(oldGame).split("chrome://game").join(oldChromeGame).split("arcadia://").join(oldScheme);
  for (const [old, now] of Object.entries(names.jsonKeys)) out = out.split(`"${now}"`).join(`"${old}"`);
  return out;
}

function seedFrom(instance, home) {
  const oldData = join(home, "Library/Application Support", names.bundleId);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(dirname(oldData), { recursive: true });
  // Its documents and Chrome profile; not the test instance's own files (defaults, logs, isolated secrets).
  mkdirSync(oldData);
  for (const name of readdirSync(instance)) {
    if (["Preferences", "Connected Accounts.json", "activation.log"].includes(name) || name.startsWith(".") || name.startsWith("sync-key-")) continue;
    if (name.endsWith(".log") || name.startsWith("dev-")) continue;
    cpSync(join(instance, name), join(oldData, name), { recursive: true, verbatimSymlinks: true });
  }
  for (const name of readdirSync(oldData).filter((n) => n.endsWith(".json"))) {
    writeFileSync(join(oldData, name), toOld(readFileSync(join(oldData, name), "utf8")));
  }
  const chromium = join(oldData, "Chromium");
  for (const profile of existsSync(chromium) ? readdirSync(chromium) : []) {
    for (const file of ["Bookmarks", "Bookmarks.bak"]) {
      const p = join(chromium, profile, file);
      if (existsSync(p)) writeFileSync(p, toOld(readFileSync(p, "utf8")));
    }
  }
  for (const [old, now] of names.paths) {
    const expand = (pattern, name) => pattern.replace("*", name);
    const star = now.indexOf("*");
    const parents = star < 0 ? [""] : readdirSync(join(oldData, now.slice(0, star))).map((n) => n);
    for (const p of parents) {
      const from = join(oldData, expand(now, p)), to = join(oldData, expand(old, p));
      if (existsSync(from)) renameSync(from, to);
    }
  }
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(chromium, name), { force: true });
  const prefs = join(instance, "Preferences", `${NEW_ID}.plist`);
  const values = existsSync(prefs) ? domainJSON(prefs) : {};
  const back = Object.fromEntries(Object.entries(names.defaultsKeys).map(([o, n]) => [n, o]));
  writePlist(join(home, "Library/Preferences", `${names.bundleId}.plist`), {
    ...Object.fromEntries(Object.entries(values).map(([k, v]) => [back[k] ?? k, v])),
    // An icon choice under its old key, for the check to find under the new one.
    [back.ACAppIcon]: values.ACAppIcon ?? "plum",
  });
  // The engine of a test instance runs on Chrome's mock keychain ("mock_password"): the old install's key.
  writeFileSync(join(home, "keychain.json"), JSON.stringify({
    [safeStorage.oldService]: { [safeStorage.oldAccount]: Buffer.from("mock_password").toString("base64") },
    [oldService("Arcadia Connected Accounts")]: { github: Buffer.from("e2e-token").toString("base64") },
  }));
  writeOldDefaultBrowser(home);
  console.log(`old install at ${home} (from ${instance})`);
}

// MARK: The synthetic run

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) failures++;
};

function seedSynthetic(home, secret) {
  const oldData = join(home, "Library/Application Support", names.bundleId);
  const chromium = join(oldData, "Chromium");
  mkdirSync(join(chromium, "Default"), { recursive: true });
  writeFileSync(join(oldData, "session.json"), JSON.stringify({
    version: 2,
    settings: { [oldKey("openLinksInLittleArcadia")]: false, [oldKey("littleArcadiaSize")]: [800, 600], shortcuts: { [oldKey("newLittleArcadia")]: ["cmd+opt+y"] } },
    windows: [{ id: "w1" }],
    tabs: [
      { id: "t1", windowId: "w1", url: `${oldScheme}history`, title: "History" },
      { id: "t2", windowId: "w1", url: oldChromeGame, title: "Game" },
      { id: "t3", windowId: "w1", url: "https://example.com/", title: "Example" },
    ],
    groups: [{ id: "g1", windowId: "w1", pinned: true, tabIds: ["t3"] }],
    launchTab: { id: "t1", url: `${oldScheme}history`, profile: "" },
  }));
  writeFileSync(join(oldData, "downloads.json"), JSON.stringify({ version: 2, downloads: [] }));
  writeFileSync(join(chromium, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" } } } }));
  writeFileSync(join(chromium, "Default/Bookmarks"), JSON.stringify({
    roots: { bookmark_bar: { type: "folder", children: [{ type: "url", name: "Downloads", url: `${oldScheme}downloads`, meta_info: { [oldKey("ac_sync_key")]: "bm-7" } }] } },
    version: 1,
  }));
  writeFileSync(join(oldData, oldPath("Chromium/ArcadiaPictureInPicture.plist")), '<?xml version="1.0"?><plist version="1.0"><array><real>320</real></array></plist>');
  mkdirSync(join(chromium, "NativeMessagingHosts"));
  writeFileSync(join(oldData, oldPath("Chromium/NativeMessagingHosts/.arcadia-managed.json")), "[]");
  mkdirSync(join(chromium, "Default", oldPath("Chromium/*/Arcadia Favicons").split("/").pop()));
  sqlite(join(chromium, "Default/Login Data"), "CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB);");
  sqlite(join(chromium, "Default/Login Data"), `INSERT INTO logins VALUES ('https://example.com/', 'e2e', X'${encrypt(secret, "hunter2-e2e").toString("hex")}');`);
  sqlite(join(chromium, "Default/Cookies"), "CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB);");
  sqlite(join(chromium, "Default/Cookies"), `INSERT INTO cookies VALUES ('.example.com', 'sid', X'${encrypt(secret, "cookie-e2e").toString("hex")}');`);
  symlinkSync(`${process.env.HOST ?? "host"}-999999`, join(chromium, "SingletonLock"));
  writePlist(join(home, "Library/Preferences", `${names.bundleId}.plist`), {
    [Object.keys(names.defaultsKeys).find((k) => names.defaultsKeys[k] === "ACAppIcon")]: "ocean",
    [`${names.defaultsKeyPrefixes[0][0]}Settings`]: "1 2 3 4",
    SUAutomaticallyUpdate: false,
  });
  writeFileSync(join(home, "keychain.json"), JSON.stringify({
    [safeStorage.oldService]: { [safeStorage.oldAccount]: Buffer.from(secret).toString("base64") },
    [oldService("Arcadia Connected Accounts")]: { github: Buffer.from("gh-e2e").toString("base64") },
    [oldService("Arcadia Sync Key")]: { "device-e2e": randomBytes(32).toString("base64") },
  }));
  writeOldDefaultBrowser(home);
  return oldData;
}

function run(home, data, crashAfter) {
  const env = { ...process.env, ARCADIA_DATA_DIR: data, ARCADIA_LEGACY_SOURCE: home };
  if (crashAfter) env.ARCADIA_LEGACY_CRASH_AFTER = crashAfter;
  else delete env.ARCADIA_LEGACY_CRASH_AFTER;
  return spawnSync(bin, ["run"], { env, stdio: ["ignore", "ignore", "pipe"] }).status;
}

function verify(label, data, secret) {
  const session = JSON.parse(readFileSync(join(data, "session.json"), "utf8"));
  check(`${label}: tabs' app URLs`, JSON.stringify(session.tabs.map((t) => t.url)) === JSON.stringify(["arcadia://history", "chrome://game", "https://example.com/"]), JSON.stringify(session.tabs.map((t) => t.url)));
  check(`${label}: pinned group`, session.groups?.[0]?.pinned === true && session.groups[0].tabIds[0] === "t3");
  check(`${label}: settings`, session.settings.openLinksInLittleArcadia === false && session.settings.littleArcadiaSize?.[0] === 800 && !(oldKey("openLinksInLittleArcadia") in session.settings));
  check(`${label}: shortcuts`, JSON.stringify(session.settings.shortcuts) === JSON.stringify({ newLittleArcadia: ["cmd+opt+y"] }));
  check(`${label}: launch hint`, session.launchTab.url === "arcadia://history");
  const bookmarks = readFileSync(join(data, "Chromium/Default/Bookmarks"), "utf8");
  check(`${label}: bookmark URL and sync key`, bookmarks.includes('"url":"arcadia://downloads"') && bookmarks.includes('"ac_sync_key":"bm-7"'));
  for (const [, now] of names.paths) {
    const p = join(data, now.replace("*", "Default"));
    check(`${label}: ${now}`, existsSync(p));
  }
  const keychain = JSON.parse(readFileSync(join(data, "legacy-keychain.json"), "utf8"));
  const key = Buffer.from(keychain[safeStorage.newService]?.[safeStorage.newAccount] ?? "", "base64").toString();
  check(`${label}: Safe Storage key under its new name`, key === secret);
  const password = Buffer.from(sqlite(join(data, "Chromium/Default/Login Data"), "SELECT hex(password_value) FROM logins"), "hex");
  check(`${label}: saved password decrypts with it`, decrypt(key, password) === "hunter2-e2e");
  const cookie = Buffer.from(sqlite(join(data, "Chromium/Default/Cookies"), "SELECT hex(encrypted_value) FROM cookies"), "hex");
  check(`${label}: cookie decrypts with it`, decrypt(key, cookie) === "cookie-e2e");
  check(`${label}: connected account`, JSON.parse(readFileSync(join(data, "Connected Accounts.json"), "utf8")).github === "gh-e2e");
  check(`${label}: sync key`, existsSync(join(data, "sync-key-device-e2e")) && statSync(join(data, "sync-key-device-e2e")).size === 32);
  const prefs = domainJSON(join(data, "Preferences", `${NEW_ID}.plist`));
  check(`${label}: preferences`, prefs.ACAppIcon === "ocean" && prefs["NSWindow Frame ArcadiaSettings"] === "1 2 3 4" && prefs.SUAutomaticallyUpdate === false, JSON.stringify(prefs));
  const offer = existsSync(join(data, OFFER)) ? JSON.parse(readFileSync(join(data, OFFER), "utf8")) : null;
  check(`${label}: the offer to be the default browser again`, offer?.version === 1 && offer.askedAt === null, JSON.stringify(offer));
  const journal = JSON.parse(readFileSync(join(data, ".legacy-migration.json"), "utf8"));
  check(`${label}: journal done`, journal.phase === "done" && journal.outcome === "migrated" && journal.defaultBrowser === "offered", JSON.stringify(journal));
}

if (process.argv[2] === "--seed-from") {
  seedFrom(process.argv[3], process.argv[4]);
  process.exit(0);
}

// Under /tmp: cfprefsd won't read or write a preferences file under $TMPDIR (/var/folders/…/T).
const root = process.argv[2] ?? mkdtempSync("/tmp/legacy-migration-e2e-");
mkdirSync(root, { recursive: true });
const secret = randomBytes(12).toString("base64");
for (const crashAfter of [null, "staged", "secrets", "journal", "published", "defaults"]) {
  const label = crashAfter ? `crash after ${crashAfter}` : "clean";
  const dir = join(root, crashAfter ?? "clean");
  rmSync(dir, { recursive: true, force: true });
  const home = join(dir, "home"), data = join(dir, "data");
  const oldData = seedSynthetic(home, secret);
  const before = snapshot(oldData);
  if (crashAfter) {
    check(`${label}: the interrupted run stops`, run(home, data, crashAfter) === 3);
    check(`${label}: not marked done`, !existsSync(join(data, ".legacy-migration.json")) || !readFileSync(join(data, ".legacy-migration.json"), "utf8").includes('"done"'));
  }
  check(`${label}: the run goes on to launch`, run(home, data) === 0);
  verify(label, data, secret);
  check(`${label}: the old install is untouched`, JSON.stringify(snapshot(oldData)) === JSON.stringify(before));
  const after = snapshot(data);
  check(`${label}: a second run changes nothing`, run(home, data) === 0 && JSON.stringify(snapshot(data)) === JSON.stringify(after));
}
{
  const dir = join(root, "not-default");
  rmSync(dir, { recursive: true, force: true });
  const home = join(dir, "home"), data = join(dir, "data");
  seedSynthetic(home, secret);
  rmSync(join(home, LAUNCH_SERVICES));
  check("another default browser: the run goes on", run(home, data) === 0);
  check("another default browser: no offer", !existsSync(join(data, OFFER)));
  check("another default browser: the journal says so", JSON.parse(readFileSync(join(data, ".legacy-migration.json"), "utf8")).defaultBrowser === "no");
}
{
  // An install migrated by a build from before the offer: its next launch answers it, once.
  const dir = join(root, "before-the-offer");
  rmSync(dir, { recursive: true, force: true });
  const home = join(dir, "home"), data = join(dir, "data");
  seedSynthetic(home, secret);
  run(home, data);
  const journalFile = join(data, ".legacy-migration.json");
  const { defaultBrowser, ...older } = JSON.parse(readFileSync(journalFile, "utf8"));
  writeFileSync(journalFile, JSON.stringify(older));
  rmSync(join(data, OFFER));
  check("before the offer: the next launch goes on", run(home, data) === 0);
  check("before the offer: it leaves the offer", JSON.parse(readFileSync(join(data, OFFER), "utf8")).askedAt === null);
  check("before the offer: the journal says it did", JSON.parse(readFileSync(journalFile, "utf8")).defaultBrowser === "offered");
  // The app has asked: that stays as it is.
  writeFileSync(join(data, OFFER), JSON.stringify({ version: 1, askedAt: 1 }));
  writeFileSync(journalFile, JSON.stringify(older));
  run(home, data);
  check("before the offer: an offer already answered stays answered", JSON.parse(readFileSync(join(data, OFFER), "utf8")).askedAt === 1);
}

// MARK: The app's rename of its own bundle

// A bundle whose executable is this tool: `move` runs the rename as the app does, from inside it.
const NEW_APP = "Arcadia.app";
function fakeBundle(folder, name = names.appFileName) {
  const bundle = join(folder, name);
  mkdirSync(join(bundle, "Contents/MacOS"), { recursive: true });
  cpSync(bin, join(bundle, "Contents/MacOS/Arcadia"));
  return bundle;
}
const exe = (bundle) => join(bundle, "Contents/MacOS/Arcadia");
const moveArgs = (wait) => ["move", ...(wait ? ["--wait", wait] : [])];
const move = (bundle) => spawnSync(exe(bundle), moveArgs(), { env: { ...process.env, MOVE_MARK: "kept" }, encoding: "utf8" }).stdout.trim();
// What it prints once it stays: the path the process last started from (an exec's, after a move).
const ranFrom = (bundle, wait) => `at ${exe(bundle)}|kept|${moveArgs(wait).join(" ")}`;
const moves = join(root, "move");
rmSync(moves, { recursive: true, force: true });
{
  const folder = join(moves, "plain");
  const bundle = fakeBundle(folder);
  const out = move(bundle);
  check("move: the old name becomes Arcadia.app", !existsSync(bundle) && existsSync(join(folder, NEW_APP)), readdirSync(folder).join(", "));
  check("move: it starts over from there, with its arguments and environment", out === ranFrom(join(folder, NEW_APP)), out);
}
{
  // Two launches of the same bundle: one is held up after it started while the other renames the bundle; it must go
  // where its bundle went, not run on from a path that no longer exists.
  const folder = join(moves, "race");
  const bundle = fakeBundle(folder);
  const go = join(moves, "race-go");
  const held = spawn(exe(bundle), moveArgs(go), { env: { ...process.env, MOVE_MARK: "kept" } });
  let heldOut = "";
  held.stdout.on("data", (d) => (heldOut += d));
  const heldExit = new Promise((r) => held.on("exit", r));
  await new Promise((r) => setTimeout(r, 300));
  const out = move(bundle);
  writeFileSync(go, "");
  await Promise.race([heldExit, new Promise((r) => setTimeout(r, 10000))]);
  held.kill();
  check("move: the first launch moves it", out === ranFrom(join(folder, NEW_APP)), out);
  check("move: the held-up launch follows its bundle there", heldOut.trim() === ranFrom(join(folder, NEW_APP), go), heldOut.trim());
}
{
  // A launch whose bundle was moved away and replaced by another folder under the old name before it got to rename:
  // it must neither rename that folder nor start what's inside it.
  const folder = join(moves, "replaced");
  const bundle = fakeBundle(folder);
  const go = join(moves, "replaced-go");
  const held = spawn(exe(bundle), moveArgs(go), { env: { ...process.env, MOVE_MARK: "kept" } });
  let heldOut = "";
  held.stdout.on("data", (d) => (heldOut += d));
  const heldExit = new Promise((r) => held.on("exit", r));
  await new Promise((r) => setTimeout(r, 300));
  renameSync(bundle, join(folder, "Elsewhere.app"));
  fakeBundle(folder);
  writeFileSync(go, "");
  await Promise.race([heldExit, new Promise((r) => setTimeout(r, 10000))]);
  held.kill();
  check("move: a folder that replaced the bundle is left under the old name, and not started",
    heldOut.trim() === ranFrom(bundle, go) && readdirSync(folder).sort().join(", ") === `Elsewhere.app, ${names.appFileName}`,
    `${heldOut.trim()}; ${readdirSync(folder).join(", ")}`);
}
const stays = (label, folder, bundle) => {
  const before = readdirSync(folder).sort().join(", ");
  const out = move(bundle);
  check(`move: ${label} stays`, out === ranFrom(bundle) && readdirSync(folder).sort().join(", ") === before, `${out}; ${readdirSync(folder).join(", ")}`);
};
{
  const folder = join(moves, "clash");
  const bundle = fakeBundle(folder);
  fakeBundle(folder, NEW_APP);
  stays("beside an Arcadia.app", folder, bundle);
}
{
  const folder = join(moves, "link");
  const target = fakeBundle(join(moves, "elsewhere"), "Real.app");
  mkdirSync(folder, { recursive: true });
  symlinkSync(target, join(folder, names.appFileName));
  stays("a link", folder, join(folder, names.appFileName));
  check("move: the link and its target are untouched", lstatSync(join(folder, names.appFileName)).isSymbolicLink() && existsSync(target));
}
{
  const folder = join(moves, "other");
  stays("another name", folder, fakeBundle(folder, "Arcadia Beta.app"));
}
{
  const folder = join(moves, "AppTranslocation/ABCD/d");
  stays("a translocated copy", folder, fakeBundle(folder));
}
{
  const folder = join(moves, "readonly");
  const bundle = fakeBundle(folder);
  chmodSync(folder, 0o555);
  try {
    stays("a folder it can't write", folder, bundle);
  } finally {
    chmodSync(folder, 0o755);
  }
}

console.log(failures ? `${failures} failed (scratch: ${root})` : `all passed (scratch: ${root})`);
if (!failures && !process.argv[2]) rmSync(root, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
