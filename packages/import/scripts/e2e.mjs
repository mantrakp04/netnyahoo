#!/usr/bin/env node
// End-to-end import of cookies, addresses and cards into a hidden Netnyahoo instance, from a fake Chrome home
// (scripts/e2e_fixture.py; never a real profile). It drives the real import window through the dev harness
// (apps/browser/src/lib/devHarness.ts) and its `globalThis.nnImport` hook (components/import/ImportWindow.tsx,
// Debug builds only), reads the profile's cookies over CDP, and checks a local fixture site receives them.
//
//   node packages/import/scripts/e2e.mjs <Netnyahoo.app> <scratch dir> [import|restart|all] [--keep]
//
//   <Netnyahoo.app>  a Debug build at the current NATIVE_API_VERSION (Metro on :8081 serves it the JS)
//   <scratch dir>    data/ is NETNYAHOO_DATA_DIR and home/ the fake Chrome home (both wiped by the import phase);
//                    result-<phase>.json lists each phase's failures
//   import           a private profile is refused; the UI imports 5 cookies, 1 address and
//                    1 card; refused/expired cookies stay out; the site gets the session cookie; a re-import adds nothing
//   restart          relaunches on the same data dir: the persistent cookie survives
//   all              (default) import, then restart
//   --keep           leaves the last instance running (poke it with scripts/ev.mjs <scratch dir>/data '<js>')
//
// The instance runs with NETNYAHOO_BACKGROUND=1 (no focus), its own DevTools port, NETNYAHOO_IMPORT_SOURCE_DIR at
// the fake home and NETNYAHOO_IMPORT_TEST_SECRET, so the Keychain is never asked. Exit code 1 if any check failed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// The fixture site: records the Cookie header of each request.
const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, cookie: req.headers.cookie ?? "" });
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<title>fixture</title>ok");
});
const SERVER_PORT = await freePort();
await new Promise((r) => server.listen(SERVER_PORT, "127.0.0.1", r));

let pid = 0;
let cdpPort = 0;
const alive = () => {
  try {
    return !!pid && (process.kill(pid, 0), true);
  } catch {
    return false;
  }
};

async function launch() {
  cdpPort = await freePort();
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of ["dev-eval.js", "dev-eval-result.json"]) fs.rmSync(path.join(DATA, f), { force: true });
  execFileSync("open", [
    "-g", "-n",
    "--env", "NETNYAHOO_BACKGROUND=1",
    "--env", `NETNYAHOO_DATA_DIR=${DATA}`,
    "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${cdpPort}`,
    "--env", `NETNYAHOO_IMPORT_SOURCE_DIR=${HOME}/Library/Application Support`,
    "--env", `NETNYAHOO_IMPORT_TEST_SECRET=${SECRET}`,
    APP,
  ]);
  // The browser process is the one whose environment names our data dir (helpers carry --type=).
  const binary = path.join(APP, "Contents/MacOS/");
  for (let i = 0; i < 60 && !pid; i++) {
    await sleep(500);
    let pids = [];
    try {
      pids = execFileSync("pgrep", ["-f", binary], { encoding: "utf8" }).trim().split("\n");
    } catch {}
    for (const p of pids) {
      const cmd = execFileSync("ps", ["eww", "-o", "command=", "-p", p], { encoding: "utf8" });
      if (cmd.includes(`NETNYAHOO_DATA_DIR=${DATA}`) && !cmd.includes("--type=")) pid = Number(p);
    }
  }
  if (!pid) throw new Error("instance didn't start");
  console.log("pid", pid, "cdp", cdpPort);
  await until("return !!nn.store.getState().windowOrder.length", (r) => r === true, 90_000);
}

async function quit() {
  if (!alive()) return;
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 40 && alive(); i++) await sleep(250);
  if (alive()) process.kill(pid, "SIGKILL");
  pid = 0;
}

// The dev harness: write $DATA/dev-eval.js (first line `// <id>`), read $DATA/dev-eval-result.json.
let seq = 0;
async function evaluate(body, timeout = 60_000) {
  const id = `e2e-${Date.now()}-${++seq}`;
  fs.writeFileSync(path.join(DATA, "dev-eval.js"), `// ${id}\n${body}`);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error("instance died");
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DATA, "dev-eval-result.json"), "utf8"));
      if (r.id === id) {
        if (r.error) throw new Error(r.error);
        return r.result;
      }
    } catch (e) {
      if (!(e instanceof SyntaxError) && e.code !== "ENOENT") throw e;
    }
    await sleep(250);
  }
  throw new Error(`eval timed out: ${body.slice(0, 80)}`);
}

async function until(body, test, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(body).catch((e) => ({ error: String(e) }));
    if (test(last)) return last;
    if (!alive()) break;
    await sleep(500);
  }
  throw new Error(`until timed out: ${JSON.stringify(last)?.slice(0, 300)}`);
}

async function cdp(method, params = {}) {
  const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const reply = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`cdp ${method} timed out`)), 20_000);
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) {
        clearTimeout(t);
        resolve(d);
      }
    };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  if (reply.error) throw new Error(JSON.stringify(reply.error));
  return reply.result;
}

const fixtureCookies = async () => (await cdp("Storage.getCookies")).cookies.filter((c) => c.name.startsWith("nn_"));

// Imports cookies straight through the module (no UI) and writes them into engine profile `profile`.
const nativeImport = (jobId, profile) => `
  const m = globalThis.expo.modules.NetnyahooImport;
  return m.unlockBrowser("chrome", null)
    .then(() => m.importData(${JSON.stringify(jobId)}, "chrome", "Default", ["cookies"], {}))
    .then((json) => {
      const r = JSON.parse(json);
      return m.writeImported(r.vaultToken, ${JSON.stringify(profile)}, ["cookies"])
        .then((w) => ({ count: r.cookieCount, keys: Object.keys(r), w: JSON.parse(w) }));
    });`;

async function importPhase(ok) {
  ok((await fixtureCookies()).length === 0, "fresh profile has no nn_ cookies");

  // A private profile: the native writer refuses it, so the engine never sees the cookies.
  const refused = await evaluate(nativeImport("e2e-private", "incognito-e2e")).catch((e) => ({ error: String(e) }));
  console.log("private:", JSON.stringify(refused));
  ok(refused.w?.cookiesFailed === 1 && refused.w?.cookies === 0, "a private profile is refused");
  ok(refused.keys && !refused.keys.includes("cookies"), "import JSON carries no cookie list");
  ok((await fixtureCookies()).length === 0, "nothing landed after the private attempt");

  // The real UI path: the import window, Chrome, unlock (with the injected test secret).
  await evaluate(`globalThis.expo.modules.NetnyahooImport.forgetUnlockedKeys(); nn.runCommand({ command: "importBrowserData" }); return true`);
  await until("return !!globalThis.nnImport && globalThis.nnImport.step", (r) => r === "choose", 30_000);
  ok((await evaluate(`return globalThis.nnImport.select("chrome")`)) === true, "Chrome fixture is listed");
  const kinds = await until("return globalThis.nnImport.kinds", (r) => Array.isArray(r) && r.includes("cookies"), 10_000);
  ok(kinds.includes("cookies") && kinds.includes("autofill"), `cookies and autofill on by default (${kinds.join(",")})`);
  await evaluate(`globalThis.nnImport.next(); return true`);
  const step = await until("return globalThis.nnImport.step", (r) => ["unlock", "progress", "done"].includes(r), 10_000);
  ok(step === "unlock", "unlock step shown for encrypted kinds");
  await evaluate(`globalThis.nnImport.unlock(); return true`);
  const done = await until(
    "const g = globalThis.nnImport; return { step: g.step, counts: g.counts, failures: g.failures, notes: g.notes }",
    (r) => r?.step === "done",
    60_000,
  );
  console.log("done:", JSON.stringify(done));
  ok(done.counts.cookies === 5, `5 cookies imported (got ${done.counts.cookies})`);
  ok(done.counts.addresses === 1 && done.counts.cards === 1, "1 address and 1 card imported");
  ok(done.failures.length === 0, "no failures");
  ok(done.notes?.some((n) => n.includes("1 cookie couldn't be decrypted")), `undecryptable note shown: ${JSON.stringify(done.notes)}`);

  const by = Object.fromEntries((await fixtureCookies()).map((c) => [c.name, c]));
  ok(by.nn_sid?.value === "s3ss10n-e2e" && by.nn_sid.secure && by.nn_sid.httpOnly && by.nn_sid.sameSite === "Lax" && by.nn_sid.priority === "High",
    "nn_sid: host-hashed v10 value, Secure, HttpOnly, Lax, High");
  ok(!by.nn_legacy, "a v24 row without its host hash is refused, as Chrome refuses it");
  ok(by.nn_session?.session === true && by.nn_session.value === "until-quit", "session cookie stays a session cookie");
  ok(!by.nn_expired, "expired cookie skipped");
  ok(by.nn_other_path?.path === "/private", "path kept");
  ok(by.nn_domain?.domain === ".example.com", "domain cookie stays a domain cookie");
  ok(by.nn_chips?.partitionKey, "partitioned cookie keeps its partition key");
  ok(!by.nn_dotdot && !by.nn_supercookie, 'a cookie whose scope Chrome would change (".." path, public-suffix domain) is refused');

  const cef = "globalThis.expo.modules.NetnyahooCEF";
  const autofill = await evaluate(`return Promise.all([${cef}.listAddresses(""), ${cef}.listCards("")])`);
  console.log("autofill:", JSON.stringify(autofill));

  // The site sees the cookies on its next request.
  await evaluate(`nn.actions.openUrls(["http://localhost:${SERVER_PORT}/"]); return true`);
  for (const deadline = Date.now() + 20_000; !seen.length && Date.now() < deadline; ) await sleep(250);
  const header = seen[0]?.cookie ?? "";
  console.log("server saw:", JSON.stringify(seen));
  ok(header.includes("nn_session=until-quit"), "fixture server got the imported session cookie");
  ok(!header.includes("nn_other_path") && !header.includes("nn_expired"), "path-scoped and expired cookies not sent");

  // Importing again keeps what's there.
  const again = await evaluate(nativeImport("e2e-again", ""));
  console.log("again:", JSON.stringify(again.w));
  ok(again.w.cookies === 0 && again.w.cookiesExisting === 5, "a second import keeps the profile's cookies");
}

async function restartPhase(ok) {
  const names = (await fixtureCookies()).map((c) => c.name);
  console.log("after restart:", names.join(","));
  ok(names.includes("nn_sid"), "persistent cookie survives a restart");
}

const phases = phaseArg === "all" ? ["import", "restart"] : [phaseArg];
let failures = 0;
try {
  if (phases[0] === "import") {
    for (const dir of [DATA, HOME]) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(SCRATCH, { recursive: true });
    execFileSync("python3", [path.join(HERE, "e2e_fixture.py"), HOME, SECRET, String(SERVER_PORT)], { stdio: "ignore" });
  } else if (!fs.existsSync(DATA)) {
    throw new Error(`${DATA} doesn't exist: run the import phase first`);
  }
  for (const [i, phase] of phases.entries()) {
    const failed = [];
    const ok = (cond, msg) => {
      console.log(cond ? "ok  " : "FAIL", msg);
      if (!cond) failed.push(msg);
    };
    console.log(`== ${phase}`);
    try {
      await launch();
      await (phase === "import" ? importPhase(ok) : restartPhase(ok));
    } catch (e) {
      ok(false, String(e?.stack ?? e));
    } finally {
      fs.writeFileSync(path.join(SCRATCH, `result-${phase}.json`), JSON.stringify({ failed }, null, 2));
      failures += failed.length;
      if (!(keep && i === phases.length - 1)) await quit();
    }
  }
} finally {
  server.close();
  if (keep && alive()) console.log(`kept pid ${pid}: node ${path.join(HERE, "ev.mjs")} ${DATA} '<js>'`);
  console.log(failures ? `${failures} failed` : "all passed");
}
process.exit(failures ? 1 : 0);
