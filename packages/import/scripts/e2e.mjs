#!/usr/bin/env node
// End-to-end import of cookies, addresses and cards into a hidden Arcadia instance, from a fake Chrome home
// (scripts/e2e_fixture.py; never a real profile). It drives the real import window through the dev harness
// (apps/browser/src/lib/devHarness.ts) and its `globalThis.acImport` hook (components/import/ImportWindow.tsx,
// Debug builds only), reads the profile's cookies over CDP, and checks a local fixture site receives them.
//
//   node packages/import/scripts/e2e.mjs <Arcadia.app> <scratch dir> [import|restart|all] [--keep]
//
//   <Arcadia.app>  a Debug build at the current NATIVE_API_VERSION (Metro on :8081 serves it the JS)
//   <scratch dir>    data/ is ARCADIA_DATA_DIR and home/ the fake Chrome home (both wiped by the import phase);
//                    result-<phase>.json lists each phase's failures
//   import           a private profile is refused; the UI imports 5 cookies, 1 address and
//                    1 card; refused/expired cookies stay out; the site gets the session cookie; a re-import adds nothing
//   restart          relaunches on the same data dir: the persistent cookie survives
//   all              (default) import, then restart
//   --keep           leaves the last instance running (poke it with scripts/agent/ac eval <scratch dir>/data '<js>')
//
// The instance runs through scripts/lib/instance.mjs (hidden, its own DevTools port) with ARCADIA_IMPORT_SOURCE_DIR
// at the fake home and ARCADIA_IMPORT_TEST_SECRET, so the Keychain is never asked. One line per check; everything
// else goes to <scratch dir>/e2e.log. Exit code 1 if any check failed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { freePort, launch as launchInstance, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const [appArg, scratchArg, phaseArg = "all"] = args.filter((a) => !a.startsWith("--"));
if (args.includes("--help") || args.includes("-h") || !appArg || !scratchArg || !["import", "restart", "all"].includes(phaseArg)) {
  const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
  const header = lines.slice(0, lines.findIndex((l) => !l.startsWith("//")));
  console.log(header.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(args.includes("--help") || args.includes("-h") ? 0 : 64);
}
const APP = path.resolve(appArg);
if (APP.startsWith("/Applications/")) throw new Error("never run against an installed app; pass a build under apps/browser/build-*");
if (!fs.existsSync(path.join(APP, "Contents/MacOS"))) throw new Error(`not an app bundle: ${APP}`);
const SCRATCH = path.resolve(scratchArg);
const DATA = path.join(SCRATCH, "data");
const HOME = path.join(SCRATCH, "home");
const SECRET = "e2e-test-secret";

fs.mkdirSync(SCRATCH, { recursive: true });
const report = reporter(path.join(SCRATCH, "e2e.log"), { name: "import e2e" });
// What happened since the last check: in the log, and printed under a failing check.
const note = report.log;
// An assertion on collected data (untimed).
const record = (name, ok, detail = "") => report.record(name, { error: ok ? null : detail || "the assertion failed" });

// The fixture site: records the Cookie header of each request.
const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, cookie: req.headers.cookie ?? "" });
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<title>fixture</title>ok");
});
const SERVER_PORT = await freePort();
await new Promise((r) => server.listen(SERVER_PORT, "127.0.0.1", r));

// The instance of this phase (scripts/lib/instance.mjs): one at a time, on DATA.
let app = null;

async function launch() {
  app = await launchInstance(APP, {
    data: DATA,
    env: { ARCADIA_IMPORT_SOURCE_DIR: `${HOME}/Library/Application Support`, ARCADIA_IMPORT_TEST_SECRET: SECRET },
    ready: { timeout: 90_000, test: "return ac.store.getState().windowOrder.length > 0" },
  });
  note("pid", app.pid, "cdp", app.port, "log", app.log);
}

async function quit() {
  if (!app) return;
  note("quit:", (await app.quit()).how);
  app = null;
}

// The dev harness ($DATA/dev-eval.js); fails at once if the app dies.
const evaluate = (body, timeout = 60_000) => app.eval(body, { timeout });

async function until(body, test, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(body).catch((e) => ({ error: String(e) }));
    if (test(last)) return last;
    if (app.exited) break;
    await sleep(500);
  }
  throw new Error(`until timed out: ${JSON.stringify(last)?.slice(0, 300)}`);
}

// Chrome's browser target, one socket per call.
async function cdp(method, params = {}) {
  const browser = await app.browser();
  try {
    return await browser.send(method, params, { timeout: 20_000 });
  } finally {
    browser.close();
  }
}

const fixtureCookies = async () => (await cdp("Storage.getCookies")).cookies.filter((c) => c.name.startsWith("ac_"));

// Imports cookies straight through the module (no UI) and writes them into engine profile `profile`.
const nativeImport = (jobId, profile) => `
  const m = globalThis.expo.modules.ArcadiaImport;
  return m.unlockBrowser("chrome", null)
    .then(() => m.importData(${JSON.stringify(jobId)}, "chrome", "Default", ["cookies"], {}))
    .then((json) => {
      const r = JSON.parse(json);
      return m.writeImported(r.vaultToken, ${JSON.stringify(profile)}, ["cookies"])
        .then((w) => ({ count: r.cookieCount, keys: Object.keys(r), w: JSON.parse(w) }));
    });`;

async function importPhase(ok) {
  ok((await fixtureCookies()).length === 0, "fresh profile has no ac_ cookies");

  // A private profile: the native writer refuses it, so the engine never sees the cookies.
  const refused = await evaluate(nativeImport("e2e-private", "incognito-e2e")).catch((e) => ({ error: String(e) }));
  note("private:", JSON.stringify(refused));
  ok(refused.w?.cookiesFailed === 1 && refused.w?.cookies === 0, "a private profile is refused");
  ok(refused.keys && !refused.keys.includes("cookies"), "import JSON carries no cookie list");
  ok((await fixtureCookies()).length === 0, "nothing landed after the private attempt");

  // The real UI path: the import window, Chrome, unlock (with the injected test secret).
  await evaluate(`globalThis.expo.modules.ArcadiaImport.forgetUnlockedKeys(); ac.runCommand({ command: "importBrowserData" }); return true`);
  await until("return !!globalThis.acImport && globalThis.acImport.step", (r) => r === "choose", 30_000);
  ok((await evaluate(`return globalThis.acImport.select("chrome")`)) === true, "Chrome fixture is listed");
  const kinds = await until("return globalThis.acImport.kinds", (r) => Array.isArray(r) && r.includes("cookies"), 10_000);
  ok(kinds.includes("cookies") && kinds.includes("autofill"), `cookies and autofill on by default (${kinds.join(",")})`);
  await evaluate(`globalThis.acImport.next(); return true`);
  const step = await until("return globalThis.acImport.step", (r) => ["unlock", "progress", "done"].includes(r), 10_000);
  ok(step === "unlock", "unlock step shown for encrypted kinds");
  await evaluate(`globalThis.acImport.unlock(); return true`);
  const done = await until(
    "const g = globalThis.acImport; return { step: g.step, counts: g.counts, failures: g.failures, notes: g.notes }",
    (r) => r?.step === "done",
    60_000,
  );
  note("done:", JSON.stringify(done));
  ok(done.counts.cookies === 5, `5 cookies imported (got ${done.counts.cookies})`);
  ok(done.counts.addresses === 1 && done.counts.cards === 1, "1 address and 1 card imported");
  ok(done.failures.length === 0, "no failures");
  ok(done.notes?.some((n) => n.includes("1 cookie couldn't be decrypted")), `undecryptable note shown: ${JSON.stringify(done.notes)}`);

  const by = Object.fromEntries((await fixtureCookies()).map((c) => [c.name, c]));
  ok(by.ac_sid?.value === "s3ss10n-e2e" && by.ac_sid.secure && by.ac_sid.httpOnly && by.ac_sid.sameSite === "Lax" && by.ac_sid.priority === "High",
    "ac_sid: host-hashed v10 value, Secure, HttpOnly, Lax, High");
  ok(!by.ac_legacy, "a v24 row without its host hash is refused, as Chrome refuses it");
  ok(by.ac_session?.session === true && by.ac_session.value === "until-quit", "session cookie stays a session cookie");
  ok(!by.ac_expired, "expired cookie skipped");
  ok(by.ac_other_path?.path === "/private", "path kept");
  ok(by.ac_domain?.domain === ".example.com", "domain cookie stays a domain cookie");
  ok(by.ac_chips?.partitionKey, "partitioned cookie keeps its partition key");
  ok(!by.ac_dotdot && !by.ac_supercookie, 'a cookie whose scope Chrome would change (".." path, public-suffix domain) is refused');

  const cef = "globalThis.expo.modules.ArcadiaCEF";
  const autofill = await evaluate(`return Promise.all([${cef}.listAddresses(""), ${cef}.listCards("")])`);
  note("autofill:", JSON.stringify(autofill));

  // The site sees the cookies on its next request.
  await evaluate(`ac.actions.openUrls(["http://localhost:${SERVER_PORT}/"]); return true`);
  for (const deadline = Date.now() + 20_000; !seen.length && Date.now() < deadline; ) await sleep(250);
  const header = seen[0]?.cookie ?? "";
  note("server saw:", JSON.stringify(seen));
  ok(header.includes("ac_session=until-quit"), "fixture server got the imported session cookie");
  ok(!header.includes("ac_other_path") && !header.includes("ac_expired"), "path-scoped and expired cookies not sent");

  // Importing again keeps what's there.
  const again = await evaluate(nativeImport("e2e-again", ""));
  note("again:", JSON.stringify(again.w));
  ok(again.w.cookies === 0 && again.w.cookiesExisting === 5, "a second import keeps the profile's cookies");
}

async function restartPhase(ok) {
  const names = (await fixtureCookies()).map((c) => c.name);
  note("after restart:", names.join(","));
  ok(names.includes("ac_sid"), "persistent cookie survives a restart");
}

const phases = phaseArg === "all" ? ["import", "restart"] : [phaseArg];
try {
  if (phases[0] === "import") {
    for (const dir of [DATA, HOME]) fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("python3", [path.join(HERE, "e2e_fixture.py"), HOME, SECRET, String(SERVER_PORT)], { stdio: "ignore" });
  } else if (!fs.existsSync(DATA)) {
    throw new Error(`${DATA} doesn't exist: run the import phase first`);
  }
  for (const [i, phase] of phases.entries()) {
    const failed = [];
    const ok = (cond, msg) => {
      record(msg, cond);
      if (!cond) failed.push(msg);
    };
    note(`== ${phase}`);
    try {
      await launch();
      await (phase === "import" ? importPhase(ok) : restartPhase(ok));
    } catch (e) {
      // Named by its first line; the stack goes under it and into result-<phase>.json, as before.
      const stack = String(e?.stack ?? e);
      record(stack.split("\n")[0], false, stack);
      failed.push(stack);
    } finally {
      fs.writeFileSync(path.join(SCRATCH, `result-${phase}.json`), JSON.stringify({ failed }, null, 2));
      if (!(keep && i === phases.length - 1)) await quit();
    }
  }
} finally {
  server.close();
  if (keep && app && !app.exited) report.say(`kept pid ${app.pid}: scripts/agent/ac eval ${DATA} '<js>'`);
}
process.exit(report.summary() ? 0 : 1);
