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
//     untouched and a second run does nothing.
//
//   node packages/sync/scripts/legacy-migration-e2e.mjs --seed-from <instance data dir> <fake home>
//     Turns a quit test instance's data dir (made by today's build) into an old install at <fake home>, for the
//     hidden-instance check: launch the app with ARCADIA_DATA_DIR=<new dir> ARCADIA_LEGACY_SOURCE=<fake home>.
import { execFileSync, spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  const journal = JSON.parse(readFileSync(join(data, ".legacy-migration.json"), "utf8"));
  check(`${label}: journal done`, journal.phase === "done" && journal.outcome === "migrated", JSON.stringify(journal));
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
console.log(failures ? `${failures} failed (scratch: ${root})` : `all passed (scratch: ${root})`);
if (!failures && !process.argv[2]) rmSync(root, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
