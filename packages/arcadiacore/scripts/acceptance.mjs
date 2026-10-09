#!/usr/bin/env node
// Stage 1 acceptance for the app on ArcadiaCore (docs/arcadiacore-parity.md): boots the ArcadiaCore build of the app hidden
// (ARCADIA_BACKGROUND=1, its own data dir and DevTools port; scripts/lib/instance.mjs), serves fixture pages, and
// drives the real app through its dev harness (lib/devHarness.ts) and Chrome's DevTools protocol.
//
//   node packages/arcadiacore/scripts/acceptance.mjs <Arcadia.app> <scratch dir> [--keep] [check…]
//   node packages/arcadiacore/scripts/acceptance.mjs --attach <scratch dir> [check…]
//   node packages/arcadiacore/scripts/acceptance.mjs --list
//
//   [check…]   only these, plus the checks they depend on (`--list` shows them; a kept instance already has most)
//   --keep     leave the instance running at the end (and reuse the one this scratch dir already keeps)
//   --attach   run against the instance a --keep run left in <scratch dir>: no boot, seconds per check
//   SKIP=a,b   leave checks out; VERBOSE=1 prints the log as it goes; METRO_PORT (default 8081)
//
// Output: one line per check (PASS/FAIL, ms); a failure adds its first lines; the rest (evidence, state at a failure,
// diagnostics) goes to <scratch dir>/data/acceptance.log, results to <scratch dir>/results.json. It never takes focus
// and never touches a real profile: the data dir is <scratch dir>/data, wiped first (not when attaching).
//
// Sections (// MARK:): Fixtures (the HTTP/HTTPS fixture server, extensions, a CRX) · The app (launch, evalApp, cdp)
// · Helpers · Checks (in run order: windows and tabs, pages, choosers and Cast, capture, restore, extensions, content
// blocker, crashes, downloads, autofill, settings) · Media, Picture in Picture, page focus · Page full screen · moving
// tabs, startup · quitting and relaunching · Camera and microphone (a copy without device entitlements) · crash-guard.
//
// Helpers (top level; `first` is page A's tab from open-url, `mainWindow` the run's window from boot):
//   evalApp(body, ms)              the app's JS (dev harness): `return …`; throws at once if the app exited
//   until(what, fn, ms)            polls fn until truthy (200 ms), else throws with the last value
//   state()                        the main window: { windowId, profileId, tabs: [{ id, url, title, loading, … }], active }
//   targets() · pageTarget(urlPart) · pageFor(tabId, urlPart) · cdp(target, method, params) · closeFromPage(target)
//   cef(call) · exts(call)         ArcadiaCEF / ArcadiaExtensions module calls
//   browserOf(tabId) · eventsOf(tabId) · lastEvent(tabId, name, test) · live(tabId) · pipWindows()
//   openTab(url, title, background) · closeTab(id) · shownAndMounted(id) · freshTab(url) · backToA() · startVideo(tabId, audio)
//   launch(log, env, args, opts) · appUp(log)   (re)start the app on the run's data dir; `exited` is set once it's gone
//   onScreenWindows() · firstPixel(png) · writePopupExtension(opts) · fixtureCrx()
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { basename, join, resolve } from "node:path";
import { X509Certificate, createHash, createSign, generateKeyPairSync } from "node:crypto";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { attach as attachInstance, launch as launchInstance, onScreenWindows as windowsOf, reporter, sleep } from "../../../scripts/lib/instance.mjs";

// MARK: What each check needs

// Checks run in file order. A check named on the command line brings the checks it needs (and theirs) with it; every
// run starts with boot. A kept instance (--keep, --attach) recovers what boot and open-url leave (the run's window,
// page A's tab) instead of running them again. Add a check here when it uses what an earlier one leaves behind.
const usesPageA = [
  "visibility", "occlusion", "favicon", "navigate-back-forward-reload", "target-blank", "window-open",
  "cmd-click", "evaluate", "tab-strips", "tab-switch", "status-text", "load-error", "chrome-strings",
  "context-menu-search", "duplicate-and-reopen", "device-chooser", "bluetooth-chooser",
  "bluetooth-settings", "cast-dialog", "cast-routes", "theme-commit", "user-selection",
  "password-prompt", "screen-share-picker", "tab-capture", "share-instead-two-captures",
  "restore-after-close", "discard-outcomes", "capture-picture", "unresponsive", "permission-dismissed",
  "save-page", "activate-request", "extension-popup-and-panel", "scroll-zoom", "print-preview",
  "extension-prompts", "traffic-lights-after-profile-switch", "extension-configure",
  "private-windows-create", "extension-installed-bubble", "popup-window", "autofill-save-prompts",
  "settings-services", "download-navigation", "page-events", "page-background", "external-app-answer",
  "notifications", "now-playing", "media-state", "auto-picture-in-picture", "pip-window", "page-focus",
  "fullscreen-tab-switch", "fullscreen-native", "fullscreen-transition-picture", "fullscreen-hidden-page", "fullscreen-split-sibling",
  "fullscreen-pip", "autofill-suggestions", "images", "extension-surfaces", "frozen", "discard",
  "permission-prompt", "popup-blocked", "move-tab-slow-mount", "move-last-tab-slow-mount",
  "move-tab-closed-while-parked", "move-tab-to-window", "title-bar-close", "last-used-profile",
];
const needs = {
  ...Object.fromEntries([...usesPageA, "kill-task", "internal-pages-not-history", "second-profile"].map((name) => [name, ["open-url"]])),
  // Another tab with a page: target-blank's C, cmd-click's D in the background, window-open's E.
  "tab-switch": ["open-url", "target-blank"],
  "tab-keys-from-page": ["open-url", "target-blank"],
  "window-close": ["window-open"],
  "frozen": ["open-url", "cmd-click"],
  "discard": ["open-url", "cmd-click"],
  // A's back list (navigate-back-forward-reload), the menu context-menu-search showed, a second window.
  "duplicate-and-reopen": ["open-url", "navigate-back-forward-reload"],
  "context-menu-activation-log": ["context-menu-search"],
  "title-bar-close": ["open-url", "move-tab-to-window"],
  // The relaunch with ARCADIA_CONTEXT_MENU_LOG and its page.
  "context-menu-incognito": ["context-menu-log"],
  // Personal set its cookie and the window showed Play when the app quit.
  "relaunch-profile": ["last-used-profile", "quit"],
};
// Every check's name and section, from this file's source (no app needed).
function checkIndex() {
  let section = "Checks";
  const index = [];
  for (const line of readFileSync(new URL(import.meta.url), "utf8").split("\n")) {
    const mark = /^\s*\/\/ MARK: (.*)$/.exec(line)?.[1];
    if (mark) section = mark.replace(/ \(.*$/, "");
    const name = /^\s*await (?:check|mediaCheck)\("([a-z0-9-]+)"/.exec(line)?.[1];
    if (name) index.push({ name, section });
  }
  return index;
}
function listChecks() {
  const index = checkIndex();
  const width = Math.max(...index.map((c) => c.name.length));
  for (const { name, section } of index) console.log(`${name.padEnd(width)}  ${section.padEnd(28)}  ${(needs[name] ?? []).join(", ")}`);
  console.log(`${index.length} checks (name, section, needs). Every run starts with boot.`);
  process.exit(0);
}
// The checks a run runs: those asked for, the ones they need, and boot.
function selection(asked) {
  const index = checkIndex().map((c) => c.name);
  const unknown = asked.filter((n) => !index.includes(n));
  if (unknown.length) {
    console.error(`no such check: ${unknown.join(", ")} (--list shows them)`);
    process.exit(64);
  }
  if (!asked.length) return { run: new Set(index), deps: new Map() };
  const run = new Set(["boot", ...asked]);
  const deps = new Map();  // dependency → the asked checks that need it
  const add = (name, by) => {
    for (const dep of needs[name] ?? []) {
      if (!asked.includes(dep)) deps.set(dep, [...(deps.get(dep) ?? []), by]);
      if (!run.has(dep)) {
        run.add(dep);
        add(dep, by);
      }
    }
  };
  for (const name of asked) add(name, name);
  return { run, deps };
}

const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? (argv.splice(argv.indexOf(name), 1), true) : false);
if (flag("--help") || flag("-h")) {
  const lines = readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
if (flag("--list")) listChecks();
const attaching = argv[0] === "--attach";
if (attaching) argv.shift();
const keep = flag("--keep") || attaching;
// With --attach the scratch dir comes first and the app is the kept instance's. --keep reuses a kept instance of the
// same app (another build's is quit first: a cold run then starts on that data dir).
let kept = null;
if (attaching || keep) {
  try {
    kept = attachInstance(join(resolve(argv[attaching ? 0 : 1] ?? "."), "data"));
  } catch (e) {
    if (attaching) {
      console.error(`--attach: ${e.message}`);
      process.exit(66);
    }
  }
  if (kept && !attaching && kept.app !== resolve(argv[0])) {
    await kept.quit();
    kept = null;
  }
}
const [appArg, scratchArg, ...only] = attaching ? [kept.app, ...argv] : argv;
const { run: selected, deps } = selection(only);
if (!appArg || !scratchArg) {
  console.error("usage: acceptance.mjs <Arcadia.app> <scratch dir> [--keep] [check…] | --attach <scratch dir> [check…] | --list | --help");
  process.exit(64);
}
const app = resolve(appArg);
const scratch = resolve(scratchArg);
const data = join(scratch, "data");
let port;
const downloadsDir = join(scratch, "downloads");
// ARCADIA_TRAFFIC_LIGHTS_LOG (every launch): each change to a window's buttons and each AppKit layout pass of them.
// A kept instance keeps writing to its file (checks read what's added after they start).
const lightsLog = join(scratch, "traffic-lights.log");
if (!kept) {
  rmSync(lightsLog, { force: true });
  rmSync(data, { recursive: true, force: true });
}
rmSync(downloadsDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });
mkdirSync(data, { recursive: true });

const results = [];
const report = reporter(join(data, "acceptance.log"), { name: `acceptance ${kept ? `attached to pid ${kept.pid}` : app}` });
const log = (...a) => report.log(...a);
const stamp = () => new Date().toISOString().slice(11, 23);

// MARK: Fixtures

// Requests that reached a host other than the fixture's own (the ad hosts mapped here, content-blocker-blocks).
const adServed = [];
// Every request's path and query, counted (js-reload-keeps-pages: a page loaded once).
const served = new Map();
const server = createServer((req, res) => {
  if (!req.headers.host?.startsWith("127.0.0.1")) adServed.push(`${req.headers.host}${req.url}`);
  served.set(req.url, (served.get(req.url) ?? 0) + 1);
  const url = new URL(req.url, "http://x");
  const page = (title, body, extra = "") =>
    `<!doctype html><html><head><title>${title}</title><link rel="icon" href="/icon.png">${extra}</head><body>${body}</body></html>`;
  if (url.pathname === "/icon.png") {
    // A 1×1 red PNG.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(png);
  }
  if (url.pathname === "/file.bin") {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="arcadiacore-test.bin"' });
    return res.end(Buffer.alloc(64 * 1024, 7));
  }
  if (url.pathname === "/slow.bin") {
    // 2 MB over about 8 s, for pausing, resuming and cancelling a download that is still running.
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(40 * 50 * 1024), "content-disposition": 'attachment; filename="arcadiacore-slow.bin"' });
    let sent = 0;
    const timer = setInterval(() => {
      if (res.destroyed || sent >= 40) {
        clearInterval(timer);
        if (!res.destroyed) res.end();
        return;
      }
      sent++;
      res.write(Buffer.alloc(50 * 1024, 3));
    }, 200);
    req.on("close", () => clearInterval(timer));
    return;
  }
  if (url.pathname === "/webstore/crx") {
    // The Web Store's update URL in this run (--apps-gallery-update-url): Chrome installs what it serves, as the .crx
    // of a Web Store install (extension-download-hidden).
    res.writeHead(200, { "content-type": "application/x-chrome-extension" });
    return res.end(fixtureCrx());
  }
  if (url.pathname === "/tone.wav") {
    // One second of a quiet 440 Hz tone (the tab is muted while it plays).
    const rate = 8000, n = rate;
    const wav = Buffer.alloc(44 + n * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
    res.writeHead(200, { "content-type": "audio/wav", "content-length": String(wav.length) });
    return res.end(wav);
  }
  res.writeHead(200, { "content-type": "text/html" });
  // Camera and microphone (fake devices only: every hidden instance gets --use-fake-device-for-media-stream). `ask(c)`
  // records the getUserMedia answer and the tracks' states; /element is the <usermedia> element (Chrome's embedded flow).
  if (url.pathname === "/cam")
    return res.end(page("Cam", "cam", `<script>
      window.__asks = []; window.__streams = [];
      window.ask = (c) => {
        const entry = { state: "pending" }; window.__asks.push(entry);
        navigator.mediaDevices.getUserMedia(c).then((s) => { window.__streams.push(s); Object.assign(entry, { state: "ok", audio: s.getAudioTracks().map((t) => t.readyState), video: s.getVideoTracks().map((t) => t.readyState) }); },
          (e) => Object.assign(entry, { state: "err", error: e.name }));
        return window.__asks.length - 1;
      };
      window.stopAll = () => { for (const s of window.__streams) s.getTracks().forEach((t) => t.stop()); return true; };
    </script>`));
  if (url.pathname === "/element")
    return res.end(page("Element", `<usermedia id="um" style="display:block;font-size:20px;margin:40px"></usermedia>`, `<script>
      window.__ev = [];
      addEventListener("DOMContentLoaded", () => {
        const um = document.getElementById("um");
        um.addEventListener("stream", () => __ev.push({ audio: um.stream?.getAudioTracks().map((t) => t.readyState), video: um.stream?.getVideoTracks().map((t) => t.readyState) }));
        um.addEventListener("cancel", () => __ev.push("cancel"));
        window.box = () => { const r = um.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        window.stopAll = () => { um.stream?.getTracks().forEach((t) => t.stop()); return true; };
      });
    </script>`));
  if (url.pathname === "/blocking") return res.end(page("Blocking", `<img src="/nnblock-1.png"><img src="/nnblock-2.png"><img src="/icon.png">`));
  // A page whose own markup asks for ads as it loads, each request tagged with the page's query (the content
  // blocker's first page in a profile, a restored tab at launch).
  if (url.pathname === "/adfirst") {
    const tag = url.search.slice(1);
    return res.end(page("Ad first", "ads", `<script src="http://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?${tag}"></script>
      <script src="http://securepubads.g.doubleclick.net/tag/js/gpt.js?${tag}"></script><img src="http://ib.adnxs.com/ut/v3?${tag}">`));
  }
  if (url.pathname === "/login") return res.end(page("Login", `<form action="/b" method="get"><input name="u" id="u" autocomplete="username"><input type="password" name="p" id="p" autocomplete="current-password"><button id="go">Sign in</button></form>`));
  if (url.pathname === "/text") return res.end(page("Text", `<p id="t" style="font: 20px sans-serif; margin: 40px">Hello selection world, select me please</p>`));
  if (url.pathname === "/capture-target") return res.end(page("Capture Target", "the tab that tab capture picks"));
  // One flat colour (?c=rrggbb), titled ?t: a captured tab whose frames say which tab they are.
  if (url.pathname === "/solid")
    return res.end(page(url.searchParams.get("t") ?? "Solid", "", `<style>html, body { margin: 0; height: 100%; background: #${url.searchParams.get("c") ?? "808080"} }</style>`));
  // A page that shares a tab (getDisplayMedia, the app's picker answers) and reads its stream's middle pixel.
  if (url.pathname === "/capturer")
    return res.end(page(url.searchParams.get("t") ?? "Capturer", "capturer", `<script>
      window.__cap = "idle";
      window.share = () => { window.__cap = "pending"; navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { window.__stream = s; window.__cap = "live"; }, (e) => (window.__cap = e.name)); return true; };
      window.pixel = async () => {
        const bitmap = await new ImageCapture(window.__stream.getVideoTracks()[0]).grabFrame();
        const c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        return Array.from(g.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data.slice(0, 3));
      };
    </script>`));
  if (url.pathname === "/media") return res.end(page("Media", `<audio id="tone" src="/tone.wav" loop></audio>`));
  // The release smoke test's form (.claude/skills/release/scripts/pages/form.html): one field Chrome remembers.
  if (url.pathname === "/form")
    return res.end(page("Form", `<form action="/form" method="get" autocomplete="on"><input id="c" name="city" autocomplete="on" style="font-size: 20px; margin: 80px; width: 300px"><button id="b">go</button></form>`));
  // A video drawn from a canvas (start(true) adds a WebAudio tone): Picture in Picture without a media file. With
  // ?docpip the page handles Media Session's "enterpictureinpicture" with a document Picture in Picture window.
  if (url.pathname === "/video")
    return res.end(page("Video", `<video id="v" playsinline style="width: 320px; height: 180px"></video><script>
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      const g = c.getContext("2d"); let n = 0;
      setInterval(() => { g.fillStyle = "hsl(" + ((n++ * 7) % 360) + ", 70%, 50%)"; g.fillRect(0, 0, 320, 180); }, 33);
      window.start = (audio) => {
        const stream = c.captureStream(30);
        if (audio) {
          const ac = new AudioContext(), osc = ac.createOscillator(), out = ac.createMediaStreamDestination();
          osc.connect(out); osc.start(); stream.addTrack(out.stream.getAudioTracks()[0]);
        }
        const v = document.getElementById("v"); v.srcObject = stream;
        return v.play().then(() => "ok", (e) => e.name);
      };
      if (location.search.includes("docpip"))
        navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
          const w = await documentPictureInPicture.requestWindow({ width: 320, height: 180 });
          w.document.body.append(document.getElementById("v"));
        });
      // ?fkey: "f" toggles the player's full screen, as on YouTube; ?handlers: Media Session handlers, as YouTube's.
      if (location.search.includes("fkey"))
        document.addEventListener("keydown", (e) => {
          if (e.key === "f") document.fullscreenElement ? document.exitFullscreen() : document.body.requestFullscreen();
        });
      if (location.search.includes("handlers")) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "Fixture video", artist: "Arcadia" });
        for (const action of ["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack", "seekto"])
          navigator.mediaSession.setActionHandler(action, () => {});
      }
    </script>`));
  // An extension's rules on a page (content-blocked-count): an image they block, a script they send to a stand-in.
  if (url.pathname === "/ac-ads") return res.end(page("Ads", `<img src="/nnblock-ad.png"><script src="/nnredirect-ad.js"></script>`));
  if (url.pathname === "/a") return res.end(page("Page A", `<a id="next" href="/b">to B</a> <a id="blank" target="_blank" href="/c">blank</a> <a id="cmd" href="/d">cmd</a>`));
  // A page whose toolbar colour comes from the page script alone (a fixed header, no <meta name="theme-color">).
  if (url.pathname === "/red-header")
    return res.end(page("Red header", `<div style="position: fixed; top: 0; left: 0; right: 0; height: 60px; background: rgb(200, 0, 0)"></div><p style="margin-top: 80px">red</p>`));
  if (url.pathname === "/painted") return res.end(page("Painted", "painted", "<style>html, body { background: rgb(60, 60, 60) }</style>"));
  if (url.pathname === "/scheme-dark") return res.end(page("Dark scheme", "dark scheme", `<meta name="color-scheme" content="dark">`));
  // Page full screen's two layouts, told apart by colour (fullscreen-transition-picture): in the window a blue masthead,
  // a red player and an orange title row on YouTube's dark background; in full screen the red player alone. "f" toggles
  // the player's full screen, as on YouTube.
  if (url.pathname === "/fs-layout")
    return res.end(page("FS layout", `<div id="mast"></div><div id="player"></div><div id="title"></div><script>
      document.addEventListener("keydown", (e) => {
        if (e.key === "f") document.fullscreenElement ? document.exitFullscreen() : document.getElementById("player").requestFullscreen();
      });
    </script>`, `<style>html, body { margin: 0; background: rgb(15, 15, 15) } #mast { height: 56px; background: rgb(30, 60, 200) }
      #player { margin: 24px; width: 640px; height: 360px; background: rgb(220, 30, 30) }
      #title { margin: 0 24px; width: 640px; height: 60px; background: rgb(240, 160, 0) }
      #player:fullscreen { margin: 0; width: 100vw; height: 100vh }</style>`));
  if (url.pathname === "/b") return res.end(page("Page B", "B"));
  if (url.pathname === "/c") return res.end(page("Page C", "C"));
  if (url.pathname === "/d") return res.end(page("Page D", "D"));
  if (url.pathname === "/e") return res.end(page("Page E", "E"));
  if (url.pathname === "/cookie") return res.end(page("Cookie", `<script>document.cookie="who=" + location.search.slice(1) + "; path=/"</script>`));
  // Chrome's address and card forms (served over HTTPS too: Chrome offers to save cards from secure pages only). A
  // POST to /saved, so the values stay out of URLs; ?email adds an email field.
  const field = (id, autocomplete, label) => `<label>${label} <input id="${id}" name="${id}" autocomplete="${autocomplete}"></label><br>`;
  if (url.pathname === "/address")
    return res.end(page("Address", `<form action="/saved" method="post">${field("name", "name", "Name")}${url.searchParams.has("email") ? field("email", "email", "Email") : ""}${field("street", "street-address", "Street")}${field("city", "address-level2", "City")}${field("state", "address-level1", "State")}${field("zip", "postal-code", "ZIP")}${field("country", "country-name", "Country")}<button id="go">Save</button></form>`));
  if (url.pathname === "/card")
    return res.end(page("Card", `<form action="/saved" method="post">${field("ccname", "cc-name", "Name on card")}${field("ccnumber", "cc-number", "Number")}${field("ccmonth", "cc-exp-month", "Month")}${field("ccyear", "cc-exp-year", "Year")}<button id="go">Pay</button></form>`));
  if (url.pathname === "/saved") {
    req.resume();
    return res.end(page("Saved", "saved"));
  }
  return res.end(page(url.pathname, url.pathname));
});
// A kept instance's switches name the fixture's ports (host rules, the Web Store URL): the same ports again.
const listen = (srv, at) => new Promise((r, j) => {
  srv.once("error", (e) => j(new Error(`fixture port ${at}: ${e.message} (the kept instance needs it back; quit it and run without --attach)`)));
  srv.listen(at, "127.0.0.1", r);
});
await listen(server, kept?.meta.http ?? 0);
const base = `http://127.0.0.1:${server.address().port}`;
// The same pages over HTTPS, with a certificate made for this run that only this run's instances trust
// (--ignore-certificate-errors-spki-list: Chrome then treats the page as secure, as the autofill checks need).
const tlsDir = join(scratch, "tls");
mkdirSync(tlsDir, { recursive: true });
if (!kept || !existsSync(join(tlsDir, "cert.pem"))) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=127.0.0.1",
  "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", join(tlsDir, "key.pem"), "-out", join(tlsDir, "cert.pem")], { stdio: "ignore" });
const tlsCert = readFileSync(join(tlsDir, "cert.pem"));
const tlsServer = createHttpsServer({ key: readFileSync(join(tlsDir, "key.pem")), cert: tlsCert }, (req, res) => server.emit("request", req, res));
await listen(tlsServer, kept?.meta.https ?? 0);
const secureBase = `https://127.0.0.1:${tlsServer.address().port}`;
const tlsSpki = createHash("sha256").update(new X509Certificate(tlsCert).publicKey.export({ type: "spki", format: "der" })).digest("base64");

// MARK: The app

// The app's JS comes from Metro (METRO_PORT, default 8081) through a proxy that passes the bundle and refuses Metro's
// websockets (scripts/lib/instance.mjs, js "pinned"): other agents' edits and reload broadcasts can't restart the
// app's JS mid-run, and a kept instance keeps its proxy between runs.
let exe, stdout, pid, child, launchedAt, exited = null;
let instance = null;
// Cast without network devices: the engine's test sink, and Chrome's own Cast/DIAL discovery off (on a Mac it can
// raise the Local Network prompt). A Bluetooth chooser without an adapter (no Bluetooth permission prompt). Passed with
// the other test switches below.
process.env.ARCADIA_CHROMIUM_SWITCHES = `--arcadia-test-media-route-provider --disable-media-route-providers-for-test --arcadia-test-bluetooth-chooser ${process.env.ARCADIA_CHROMIUM_SWITCHES ?? ""}`.trim();
// The content blocker's check: ad hosts (and a site to allow) answered by the fixture server, never the network.
process.env.ARCADIA_CHROMIUM_SWITCHES += ` --host-resolver-rules=${["ib.adnxs.com", "securepubads.g.doubleclick.net", "pagead2.googlesyndication.com", "adpage.test"]
  .map((host) => `MAP ${host} 127.0.0.1:${server.address().port}`).join(", ")}`;
// The Web Store's update URL: a .crx downloaded from it is a Web Store install's (extension-download-hidden).
process.env.ARCADIA_CHROMIUM_SWITCHES += ` --apps-gallery-update-url=${base}/webstore/crx`;
// The HTTPS fixture's certificate (autofill-save-prompts).
process.env.ARCADIA_CHROMIUM_SWITCHES += ` --ignore-certificate-errors-spki-list=${tlsSpki}`;
// Starts the app on the run's data dir (again for the relaunch checks), with a fresh DevTools port. `opts.app` runs
// another bundle (the media checks' copy), `opts.switches` adds Chromium switches. The pid is the DevTools port's
// listener, checked against the bundle's binary (scripts/lib/instance.mjs): never another run's instance.
async function launch(logName = "app.out.log", env = {}, args = [], opts = {}) {
  instance = await launchInstance(opts.app ?? app, {
    data, log: join(scratch, logName), args, ready: false,
    env: {
      ARCADIA_TEST_REAUTH: "granted", ARCADIA_DOWNLOADS_DIR: downloadsDir,
      // Passed through for experiments (e.g. ARCADIA_ALLOW_OCCLUSION=1).
      ...Object.fromEntries(["ARCADIA_ALLOW_OCCLUSION", "ARCADIA_TRACE_VISIBILITY", "ARCADIA_TRACE_PIP"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
      ARCADIA_TRAFFIC_LIGHTS_LOG: lightsLog,
      ...env,
    },
    // Tab capture without Chrome's picker: getDisplayMedia takes the tab titled "Capture Target" (Chrome's browser-test
    // switch; a tab, so no macOS screen-recording prompt).
    switches: `--auto-select-tab-capture-source-by-title=Capture Target --arcadia-test-external-protocol-no-launch ${process.env.ARCADIA_CHROMIUM_SWITCHES ?? ""} ${opts.switches ?? ""}`.trim(),
    meta: { http: server.address().port, https: tlsServer.address().port },
  });
  adopt(instance);
}
// The globals the checks use, from a launched or kept instance.
function adopt(i) {
  instance = i;
  ({ pid, port, launchedAt, binary: exe, log: stdout } = i);
  const own = pid;
  child = { pid: own, kill: (sig) => { if (i.stillOwned()) try { process.kill(own, sig); } catch {} } };
  exited = null;
  writeFileSync(join(scratch, "app.pid"), String(own));
}
if (kept) adopt(kept);
else await launch();
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
setInterval(() => { if (!exited && !alive()) exited = { pid }; }, 300).unref();
const appLog = { join: () => (existsSync(stdout) ? readFileSync(stdout, "utf8") : "") };

async function evalApp(body, timeoutMs = 20000) {
  if (exited) throw new Error(`app exited ${JSON.stringify(exited)}`);
  try {
    return await instance.eval(body, { timeout: timeoutMs });
  } catch (e) {
    if (e.appDied) throw new Error(`app exited ${JSON.stringify(exited ?? { pid })}`);
    throw e;
  }
}

async function until(what, fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function cdp(target, method, params = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = () => j(new Error(`DevTools connection to ${target.url} failed (${method})`)))));
  const reply = new Promise((r) => {
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === 1) r(msg);
    };
    // The target went (its page closed) with the call unanswered: say so now rather than wait out the 10 s.
    ws.onclose = () => r({ error: `the target closed before replying (${method})` });
  });
  ws.send(JSON.stringify({ id: 1, method, params }));
  const msg = await Promise.race([reply, sleep(10000).then(() => ({ error: "cdp timeout" }))]);
  ws.close();
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return msg.result;
}

// The first pixel of a PNG (8-bit RGB or RGBA) as [r, g, b, a]: a scanline's first pixel is stored unfiltered
// whatever its filter (no left neighbour, and the first row has no row above).
function firstPixel(base64) {
  const png = Buffer.from(base64, "base64");
  let ihdr = null;
  const idat = [];
  for (let off = 8; off < png.length; ) {
    const len = png.readUInt32BE(off), type = png.toString("latin1", off + 4, off + 8);
    if (type === "IHDR") ihdr = png.subarray(off + 8, off + 8 + len);
    if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const depth = ihdr[8], channels = { 2: 3, 6: 4 }[ihdr[9]];
  if (depth !== 8 || !channels) throw new Error(`PNG depth ${depth}, color type ${ihdr[9]}`);
  const px = inflateSync(Buffer.concat(idat)).subarray(1, 1 + channels);
  return [px[0], px[1], px[2], channels === 4 ? px[3] : 255];
}

const pageTarget = async (urlPart) => (await targets()).find((t) => t.type === "page" && t.url.includes(urlPart));
// A page's window.close(), a turn after DevTools' reply. Closed inside the evaluate, the page asks to close (its frame's
// pipe, RequestClose) right behind the reply (the DevTools session's pipe): Mojo doesn't order the two, and when the
// close comes first Chrome closes the tab at once (the renderer already ran unload) and the queued reply is dropped,
// so the call got no answer though the tab closed (window-close's "cdp timeout", about half the full runs).
const closeFromPage = (target) => cdp(target, "Runtime.evaluate", { expression: "setTimeout(() => window.close()); true" });
const cef = (call) => evalApp(`return globalThis.expo.modules.ArcadiaCEF.${call}`);
const exts = (call) => evalApp(`return globalThis.expo.modules.ArcadiaExtensions.${call}`);
// A copy in the scratch dir: the app reading the checkout under ~/Documents would raise macOS's folder-access
// prompt (and block the main thread on it) for every re-signed build.
const extPath = join(scratch, "fixture-ext");
cpSync(resolve(new URL(".", import.meta.url).pathname, "../../../spikes/arcadiacore-host/fixtures/ext"), extPath, { recursive: true });
// An extension made here (no Web Store): an action popup; rules that block /nnblock-* and send /nnredirect-* to its
// stand-in script; an options page; with `welcome`, a worker that opens a tab when installed, as Dark Reader opens its
// help page.
const extPopupPath = join(scratch, "fixture-ext-popup");
function writePopupExtension({ welcome = false } = {}) {
  rmSync(extPopupPath, { recursive: true, force: true });
  mkdirSync(extPopupPath, { recursive: true });
  const files = {
    "manifest.json": JSON.stringify({
      manifest_version: 3, name: "ArcadiaCore popup fixture", version: "1.0",
      action: { default_popup: "popup.html", default_title: "Popup fixture" },
      background: { service_worker: "worker.js" },
      options_page: "options.html",
      permissions: ["tabs", "declarativeNetRequest"],
      host_permissions: ["http://127.0.0.1/*"],
      web_accessible_resources: [{ resources: ["standin.js"], matches: ["http://127.0.0.1/*"] }],
      declarative_net_request: { rule_resources: [{ id: "rules", enabled: true, path: "rules.json" }] },
    }),
    "popup.html": `<!doctype html><title>Popup fixture</title><body style="width: 200px; height: 80px">popup</body>`,
    "options.html": `<!doctype html><title>Popup fixture options</title><body>options</body>`,
    "standin.js": "window.__nnStandIn = true;",
    "worker.js": welcome ? `chrome.runtime.onInstalled.addListener((d) => { if (d.reason === "install") chrome.tabs.create({ url: "${base}/e?installed" }); });` : "",
    "rules.json": JSON.stringify([
      { id: 1, priority: 1, action: { type: "block" }, condition: { urlFilter: "nnblock-", resourceTypes: ["image", "script", "xmlhttprequest"] } },
      { id: 2, priority: 1, action: { type: "redirect", redirect: { extensionPath: "/standin.js" } }, condition: { urlFilter: "nnredirect-", resourceTypes: ["script"] } },
    ]),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(extPopupPath, name), text);
}
// A signed CRX3 of a one-file extension: a store-only zip, one RSA proof over its signed data and the archive.
let crxCache = null;
function fixtureCrx() {
  if (crxCache) return crxCache;
  const files = { "manifest.json": JSON.stringify({ manifest_version: 3, name: "ArcadiaCore crx fixture", version: "1.0" }) };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nameBytes = Buffer.from(name), sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22), count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, directory, end]);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ type: "spki", format: "der" });
  const varint = (n) => { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
  const field = (number, bytes) => Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
  const signedData = field(1, createHash("sha256").update(der).digest().subarray(0, 16));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedData.length);
  const signature = createSign("sha256").update(Buffer.concat([Buffer.from("CRX3 SignedData\x00", "latin1"), size, signedData, zip])).sign(privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, der), field(2, signature)])), field(10000, signedData)]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1"); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8);
  return (crxCache = Buffer.concat([prefix, header, zip]));
}
// The app's windows on screen (CoreGraphics' window numbers).
const onScreenWindows = () => windowsOf(pid);
// The module's browser id of an app tab.
const browserOf = (tabId) => evalApp(`return ac.pageState.getState().browsers ? Object.entries(ac.pageState.getState().browsers).find(([, t]) => t === "${tabId}")?.[0] ?? null : null`);
// The DevTools target of one app tab (several tabs can show the same URL): marked through the app, then found.
async function pageFor(tabId, urlPart) {
  const candidates = (await targets()).filter((t) => t.type === "page" && t.url.includes(urlPart));
  if (candidates.length <= 1) return candidates[0];
  await evalApp(`return ac.webviews.get(${JSON.stringify(tabId)})?.executeJavaScript(${JSON.stringify(`window.__nnTab = ${JSON.stringify(tabId)}`)})`);
  await sleep(200);
  for (const t of candidates) {
    const r = await cdp(t, "Runtime.evaluate", { expression: "String(window.__nnTab)", returnByValue: true }).catch(() => null);
    if (r?.result?.value === tabId) return t;
  }
  return candidates[0];
}
// The window the run works in: the first one, then the one its first tab is in.
let mainWindow = null;
let first;
// Personal's profile id, from last-used-profile (relaunch-profile switches back to it).
let personal = null;
// The dev event log (ArcadiaCoreWebView's devEvents) of an app tab.
const eventsOf = async (tabId) => {
  const browser = await browserOf(tabId);
  return browser ? evalApp(`return globalThis.expo.modules.ArcadiaCEF.devEvents(${browser})`) : [];
};
const state = () =>
  evalApp(`const s = ac.store.getState(); const w = s.windows[${JSON.stringify(mainWindow)}] ?? Object.values(s.windows).filter((w) => !w.incognito && w.kind !== "small").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    return { windowId: w?.id, profileId: w?.profileId, tabs: (w?.tabIds ?? []).map((id) => ({ id, url: s.tabs[id]?.url, title: s.tabs[id]?.title, favicon: s.tabs[id]?.favicon?.slice(0, 40), adoptId: s.tabs[id]?.adoptId, profileId: s.tabs[id]?.profileId, loading: s.live[id]?.isLoading, back: s.live[id]?.canGoBack, fwd: s.live[id]?.canGoForward })), active: w ? w.activeTabIds[w.profileId] : null, windows: Object.keys(s.windows).length, profiles: s.profileOrder };`);

// MARK: Helpers

// A tab of the main window at `url`, loaded; foreground or behind.
const openTab = async (url, title, background = false) => {
  const before = new Set((await state()).tabs.map((t) => t.id));
  await evalApp(`ac.actions.openUrls([${JSON.stringify(url)}], ${JSON.stringify(mainWindow)}); return true`);
  const tab = await until(`a tab for ${url}`, async () => (await state()).tabs.find((t) => !before.has(t.id) && t.title === title && !t.loading), 15000);
  if (background) {
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
  }
  return tab;
};
const closeTab = (id) => evalApp(`ac.store.getState().closeTab("${id}"); return true`);
// A tab's WebView is mounted (a background or restored tab mounts when shown).
const shownAndMounted = async (id) => {
  await evalApp(`ac.actions.switchToTab(${JSON.stringify(id)}); return true`);
  await until(`${id}'s WebView`, () => evalApp(`return !!ac.webviews.get(${JSON.stringify(id)})`), 15000);
};
// A new foreground tab on `url` in the run's window, mounted and loaded (for checks after move-tab-to-window took
// the first tab to a window of its own).
const freshTab = async (url) => {
  const id = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: ${JSON.stringify(url)} })`);
  await shownAndMounted(id);
  await until(`${url} loaded`, () => evalApp(`const s = ac.store.getState(); return s.tabs[${JSON.stringify(id)}]?.url && !s.live[${JSON.stringify(id)}]?.isLoading ? true : null`));
  return id;
};
const backToA = async () => {
  await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
  await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
  await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
};
// The last event of a kind an app tab sent, and the app's own media state for it.
const lastEvent = async (tabId, name, test = () => true) => (await eventsOf(tabId)).findLast((x) => x.name === name && test(x.payload ?? {})) ?? null;
const live = (tabId) => evalApp(`return ac.store.getState().live["${tabId}"] ?? null`);
const pipWindows = () => cef(`devPictureInPicture()`).catch(() => null);
const startVideo = async (tabId, audio) => {
  const t = await pageFor(tabId, `${base}/video`);
  const r = await cdp(t, "Runtime.evaluate", { expression: `start(${audio})`, awaitPromise: true, userGesture: true, returnByValue: true });
  if (r.result?.value !== "ok") throw new Error(`the video didn't play: ${JSON.stringify(r.result ?? r)}`);
  await until("the video's first frames", async () => (await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('v').videoWidth", returnByValue: true })).result?.value > 0, 8000);
  return t;
};
// Quits the app (the quit Apple event, then signals: scripts/lib/instance.mjs) before a check starts it again.
const stopApp = async () => {
  if (!exited) await instance.quit();
  await until("the app to exit", async () => exited || !alive(), 5000);
  exited ??= { pid };  // at once, not at the next 300 ms poll: appUp relaunches on it
};
// Starts the app on the run's data dir when it isn't running (the quit checks), and waits for its window.
const appUp = async (logName) => {
  if (exited) await launch(logName);
  await until("the app", async () => {
    try {
      return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
    } catch (e) {
      if (exited) throw e;
      return null;
    }
  }, 90000);
  mainWindow = null;
  return (mainWindow = await until("a window", async () => (await state()).windowId, 30000));
};

// ARCADIA_TRACE_VISIBILITY: the first tab's document.visibilityState, sampled every 250 ms over one DevTools
// connection, each change logged with the time and the check running (the app logs its side as [arcadiacore-vis]).
let currentCheck = "";
let visibilityWatch = null;
function watchVisibility(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let last = null, seq = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const value = msg.result?.result?.value;
    if (value && value !== last) {
      log(`  [vis ${stamp()}] ${last ?? "-"} → ${value} during ${currentCheck}`);
      last = value;
    }
  };
  const timer = setInterval(() => {
    if (ws.readyState === 1)
      ws.send(JSON.stringify({ id: ++seq, method: "Runtime.evaluate", params: { expression: "document.visibilityState + '/' + location.pathname + '/' + document.hasFocus()", returnByValue: true } }));
  }, 250);
  ws.onclose = () => clearInterval(timer);
  visibilityWatch = { stop: () => { clearInterval(timer); try { ws.close(); } catch {} } };
}

// What a kept instance already has: boot's window, open-url's page A (wherever it is now).
const recovered = new Set();
async function recoverKept() {
  await until("the kept instance's dev harness", () => evalApp("return true", 3000).catch(() => null), 30000);
  mainWindow = (await state()).windowId;
  recovered.add("boot");
  const a = await evalApp(`const s = ac.store.getState(); const ids = [...(s.windows[${JSON.stringify(mainWindow)}]?.tabIds ?? []), ...Object.keys(s.tabs)];
    const id = ids.find((i) => s.tabs[i]?.url?.startsWith(${JSON.stringify(`${base}/a`)}) && s.tabs[i]?.title === "Page A");
    return id ? { id, url: s.tabs[id].url, title: "Page A" } : null`);
  if (a) {
    first = a;
    recovered.add("open-url");
  }
}

async function check(name, fn) {
  if (!selected.has(name)) return;
  if ((process.env.SKIP ?? "").split(",").includes(name)) return;
  if (recovered.has(name)) return;
  currentCheck = name;
  if (process.env.ARCADIA_TRACE_VISIBILITY) log(`  [check ${stamp()}] ${name}`);
  let failure = null;
  const started = Date.now();
  await report.check(name, async () => {
    const evidence = await fn();
    results.push({ name, ok: true, evidence, ms: Date.now() - started });
    return evidence;
  }, {
    async onFail(e) {
      let snapshot = null;
      try {
        snapshot = await state();
      } catch {}
      results.push({ name, ok: false, error: String(e?.message ?? e), state: snapshot, ms: Date.now() - started });
      log(`state: ${JSON.stringify(snapshot)}`);
      if (first)
        try {
          log(`events of ${first.id}: ${JSON.stringify((await eventsOf(first.id)).slice(-12))}`);
        } catch {}
    },
  });
}

// MARK: Checks

try {
  if (kept) await recoverKept();
  if (kept) report.say(`attached to pid ${pid}${recovered.size ? ` (has ${[...recovered].join(", ")})` : ""}`);
  const running = [...deps.keys()].filter((dep) => !recovered.has(dep));
  if (running.length) report.say(`first, as ${[...new Set(running.flatMap((d) => deps.get(d)))].join(", ")} need: ${running.join(", ")}`);
  // MARK: Windows, tabs and navigation

  await check("boot", async () => {
    const info = await until("the dev harness", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    if (info.engine !== "arcadiacore") throw new Error(`engine ${info.engine}`);
    const s = await until("a window", async () => ((await state()).windowId ? state() : null), 30000);
    const front = execFileSync("lsappinfo", ["front"]).toString();
    const asn = execFileSync("lsappinfo", ["info", "-only", "pid", front.trim()]).toString();
    if (asn.includes(`=${child.pid}`)) throw new Error("the app took focus");
    mainWindow = s.windowId;
    // One JS runtime: a second one (the launch callbacks sent twice) makes a second window with its own id prefix.
    await sleep(2000);
    const native = await evalApp(`return ac.shell.windowIds()`);
    if (native.length !== 1) throw new Error(`windows ${JSON.stringify(native)} (a second JS runtime?)`);
    return { chromium: info.chromiumVersion, windows: s.windows, tabs: s.tabs.length, pid: child.pid };
  });

  await check("window-profiles", async () => {
    // A window never gets a dead or missing profile (the 0.2.22 RC crashed in WindowHost::BrowserFor(null) opening
    // one), and a private window never shows Personal's: private and second-profile windows right after launch, at
    // once after their profile's last window closed, and a while after (Chrome destroys an off-the-record profile
    // with its last Browser); a private window's new tab after its last tab closed.
    const home = (await state()).windowId;
    const titles = (w) => evalApp(`const s = ac.store.getState(); return (s.windows[${JSON.stringify(w)}]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
    const shows = (w, title) => until(`${title} in ${w}`, async () => ((await titles(w)).includes(title) ? true : null), 15000);
    const cookie = async (urlPart) => (await cdp(await until(urlPart, () => pageTarget(urlPart)), "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    const open = (o) => evalApp(`return ac.actions.openWindow(${JSON.stringify(o)})`);
    const close = (w) => evalApp(`ac.store.getState().closeWindow(${JSON.stringify(w)}); return true`);
    const personalTab = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(home)}, { url: "${base}/cookie?personal" })`);
    await shows(home, "Cookie");
    const steps = [];
    // Private windows.
    const p1 = await open({ incognito: true, url: `${base}/cookie?private1` });
    await shows(p1, "Cookie");
    if ((await cookie("/cookie?private1")).includes("personal")) throw new Error("a private window sees Personal's cookie");
    await close(p1);
    const p2 = await open({ incognito: true, url: `${base}/b?private2` });
    await shows(p2, "Page B");
    steps.push("private, reopened at once");
    if ((await cookie("/b?private2")).includes("personal")) throw new Error("the reopened private window sees Personal's cookie");
    // Its last tab closed (Chrome closes its Browser), then a new tab in the same window.
    await evalApp(`const s = ac.store.getState(); s.closeTabs([...s.windows[${JSON.stringify(p2)}].tabIds]); return true`);
    await sleep(2500);
    await evalApp(`ac.store.getState().newTab(${JSON.stringify(p2)}, { url: "${base}/c?private3" }); return true`);
    await shows(p2, "Page C");
    steps.push("private, a tab after its last tab closed");
    await close(p2);
    await sleep(2500);
    const p4 = await open({ incognito: true, url: `${base}/d?private4` });
    await shows(p4, "Page D");
    steps.push("private, reopened later");
    if ((await cookie("/d?private4")).includes("personal")) throw new Error("a later private window sees Personal's cookie");
    // ⌘W on the last private window and ⇧⌘N in the same turn, a few times: Chrome is still destroying the old
    // profile when the new window asks for one.
    let last = p4;
    for (let round = 0; round < 4; round++) {
      const next = await evalApp(`const s = ac.store.getState(); s.closeWindow(${JSON.stringify(last)}); return ac.actions.openWindow({ incognito: true, url: "${base}/e?churn${round}" })`);
      await shows(next, "Page E");
      await sleep(round % 2 ? 200 : 1500);
      await evalApp(`ac.store.getState().newTab(${JSON.stringify(next)}, { url: "${base}/b?churn${round}" }); return true`);
      await shows(next, "Page B");
      last = next;
    }
    steps.push("private, closed and reopened in one turn (4 rounds)");
    await close(last);
    // A second profile's windows.
    const id = await evalApp(`return ac.store.getState().createProfile({ name: "Spare" })`);
    const w1 = await open({ profileId: id, url: `${base}/cookie?spare` });
    await shows(w1, "Cookie");
    await close(w1);
    const w2 = await open({ profileId: id, url: `${base}/b?spare2` });
    await shows(w2, "Page B");
    steps.push("profile, reopened at once");
    await close(w2);
    await sleep(2500);
    const w3 = await open({ profileId: id, url: `${base}/c?spare3` });
    await shows(w3, "Page C");
    steps.push("profile, reopened later");
    const spare = await cookie("/c?spare3");
    await close(w3);
    await evalApp(`ac.store.getState().closeTab(${JSON.stringify(personalTab)}); return true`);
    if (!spare.includes("spare") || spare.includes("personal")) throw new Error(`the profile's window sees "${spare}"`);
    return { steps, spareCookie: spare };
  });

  await check("window-size", async () => {
    // The first window is CEF's 1360 × 860 (frame), centred by AppKit.
    const frame = await evalApp(`return ac.shell.windowFrame(${JSON.stringify(mainWindow)})`);
    if (frame?.[2] !== 1360 || frame?.[3] !== 860) throw new Error(`frame ${JSON.stringify(frame)}`);
    return { frame };
  });

  await check("open-url", async () => {
    await evalApp(`ac.actions.openUrls(["${base}/a"], ${JSON.stringify(mainWindow)}); return true`);
    const s = await until("tab A titled", async () => {
      const s = await state();
      const t = s.tabs.find((t) => t.url?.startsWith(`${base}/a`));
      return t && t.title === "Page A" && !t.loading ? { s, t } : null;
    });
    first = s.t;
    const t = await pageTarget(`${base}/a`);
    if (!t) throw new Error("no CDP target for A");
    if (process.env.ARCADIA_TRACE_VISIBILITY) watchVisibility(t);
    return { tab: s.t.id, title: s.t.title, active: s.s.active === s.t.id };
  });

  await check("visibility", async () => {
    // Diagnostic: how Chrome sees the shown page of a hidden (background-mode) window.
    const t = await pageFor(first.id, `${base}/a`);
    const vis = (await cdp(t, "Runtime.evaluate", { expression: "document.visibilityState + '/' + document.hasFocus()", returnByValue: true })).result.value;
    const windows = (await evalApp(`return globalThis.expo.modules.ArcadiaCEF.chromeWindows()`)).map((w) => ({ visible: w.visible, alpha: w.alpha, key: w.key, frame: w.frame }));
    return { page: vis, windows };
  });

  await check("occlusion", async () => {
    // A background-mode window that something covers (here: one of the app's own windows right above it, which macOS
    // reports as occluding it) keeps its shown page visible and taking input: hidden instances must not depend on
    // the owner's windows (Chrome hides an occluded window's pages and drops their input).
    // With ARCADIA_ALLOW_OCCLUSION=1 (Chrome's own behaviour, as the user's app has it) the page goes hidden while
    // covered and must come back visible once uncovered.
    const allow = !!process.env.ARCADIA_ALLOW_OCCLUSION;
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const t = await pageFor(first.id, `${base}/a`);
    const vis = async () => (await cdp(t, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value;
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindowNumber(${browser})`);
    const chromeSees = async () => (await evalApp(`return globalThis.expo.modules.ArcadiaCEF.chromeWindows()`)).find((x) => x.window === windowNumber);
    await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindow(${windowNumber}, "cover")`);
    let samples = [], escape = null, w = null;
    try {
      // macOS reports the window occluded (Chrome's occlusion checker follows it, and waits a second more before
      // telling the page; with the background switch it doesn't run).
      w = await until("macOS to see the window occluded", async () => {
        const x = await chromeSees();
        return x && !x.occlusionVisible && (!allow || x.chromeOccluded) ? x : null;
      }, 10000);
      for (let i = 0; i < 8; i++) {
        samples.push(await vis());
        await sleep(400);
      }
      if (!allow) {
        // Input still reaches the covered page: an Esc it leaves alone comes back to the app.
        const s = await state();
        const before = (await eventsOf(first.id)).filter((x) => x.name === "command" && x.payload?.command === "escape").length;
        await evalApp(`return ac.webviews.get("${first.id}").focus()`);
        await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "\u001b", keyCode: 53, modifiers: [], focus: "page" })`);
        escape = await until("Esc while covered", async () =>
          (await eventsOf(first.id)).filter((x) => x.name === "command" && x.payload?.command === "escape").length > before ? true : null, 5000);
      }
    } finally {
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindow(${windowNumber}, "uncover")`);
    }
    const back = await until("visible again", async () => ((await vis()) === "visible" ? "visible" : null), 10000);
    const expected = allow ? "hidden" : "visible";
    if (allow ? !samples.slice(4).every((v) => v === "hidden") : !samples.every((v) => v === "visible"))
      throw new Error(`while covered the page was ${JSON.stringify(samples)}, expected ${expected}`);
    return { chromeOccluded: w.chromeOccluded, macOSVisible: w.occlusionVisible, samples, escape, back };
  });

  await check("favicon", async () => {
    const t = await until("a favicon", async () => (await state()).tabs.find((t) => t.id === first?.id && t.favicon));
    return { favicon: String(t.favicon).slice(0, 60) };
  });

  await check("navigate-back-forward-reload", async () => {
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/b", { userInitiated: true }); return true`);
    await until("B", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page B" && t.back));
    await evalApp(`return ac.webviews.get("${first.id}").goBack()`);
    await until("back to A", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && t.fwd));
    await evalApp(`return ac.webviews.get("${first.id}").goForward()`);
    await until("forward to B", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page B"));
    const target = await pageTarget(`${base}/b`);
    await cdp(target, "Runtime.evaluate", { expression: "window.__mark = 1" });
    await evalApp(`return ac.webviews.get("${first.id}").reload()`);
    await until("reloaded", async () => {
      const t = await pageTarget(`${base}/b`);
      const r = t && (await cdp(t, "Runtime.evaluate", { expression: "String(window.__mark)", returnByValue: true }));
      return r?.result?.value === "undefined";
    });
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    return { ok: true };
  });

  await check("target-blank", async () => {
    const before = (await state()).tabs.length;
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('blank').click()", userGesture: true });
    const s = await until("a new tab for C", async () => {
      const s = await state();
      const c = s.tabs.find((x) => x.url?.startsWith(`${base}/c`) && x.title === "Page C");
      return s.tabs.length > before && c ? { s, c } : null;
    });
    await sleep(2500);
    const later = (await state()).tabs.find((x) => x.id === s.c.id);
    if (!later) throw new Error("the popup's tab went away");
    return { tabs: s.s.tabs.length, adoptId: s.c.adoptId ?? null, stays: !!later };
  });

  await check("window-open", async () => {
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: `window.open("${base}/e", "_blank")`, userGesture: true });
    const e = await until("E in a tab", async () => (await state()).tabs.find((x) => x.url?.startsWith(`${base}/e`) && x.title === "Page E"));
    return { tab: e.id, adoptId: e.adoptId ?? null };
  });

  await check("cmd-click", async () => {
    const activeBefore = (await state()).active;
    const t = await pageTarget(`${base}/a`);
    const r = await cdp(t, "Runtime.evaluate", {
      expression: "JSON.stringify(document.getElementById('cmd').getBoundingClientRect())",
      returnByValue: true,
    });
    const box = JSON.parse(r.result.value);
    const x = box.x + 4, y = box.y + box.height / 2;
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp(t, "Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, modifiers: 4 });
    const d = await until("D in a background tab", async () => (await state()).tabs.find((x) => x.url?.startsWith(`${base}/d`)));
    const s = await state();
    if (s.active !== activeBefore) throw new Error("the ⌘-clicked tab came to the front");
    return { tab: d.id, adoptId: d.adoptId ?? null, background: true };
  });

  await check("evaluate", async () => {
    // The page channel (ArcadiaCore's renderer side): evaluate runs in the page's main world and answers with post.
    const title = await evalApp(`return ac.webviews.get("${first.id}").evaluate("post('result', JSON.stringify(document.title))")`);
    if (title !== "Page A") throw new Error(`evaluate gave ${JSON.stringify(title)}`);
    const script = await evalApp(`return ac.webviews.get("${first.id}").evaluate("post('result', JSON.stringify(typeof window.Notification))")`);
    return { title, notification: script };
  });

  await check("tab-strips", async () => {
    const tx = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.tabStrips()`);
    const s = await state();
    const strip = tx.strips.find((x) => x.tabs.some((t) => t.key === first.id));
    if (!strip) throw new Error(`no strip names ${first.id}: ${JSON.stringify(tx)}`);
    const keys = strip.tabs.map((t) => t.key);
    const missing = s.tabs.filter((t) => t.url && !keys.includes(t.id)).map((t) => t.id);
    if (missing.length) throw new Error(`tabs missing from the strip: ${missing}`);
    return { rev: tx.rev, strips: tx.strips.length, tabs: keys.length, active: strip.tabs.find((t) => t.active)?.key };
  });

  await check("tab-switch", async () => {
    const s = await state();
    const other = s.tabs.find((x) => x.id !== first.id && x.url);
    await evalApp(`ac.actions.switchToTab("${other.id}"); return true`);
    await until("switched", async () => (await state()).active === other.id);
    const back = await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("switched back", async () => (await state()).active === first.id);
    return { to: other.id, back };
  });

  await check("cmd-t-cmd-w", async () => {
    const s = await state();
    const before = s.tabs.length;
    const t = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "t", keyCode: 17, modifiers: ["command"], focus: "page" })`);
    log("  ⌘T:", JSON.stringify(t));
    const afterT = await until("a new tab (⌘T)", async () => {
      const n = await state();
      return n.tabs.length > before || n.active !== s.active ? n : null;
    });
    const w = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "w", keyCode: 13, modifiers: ["command"], focus: "window" })`);
    await sleep(800);
    const afterW = await state();
    return { t, w, tabs: [before, afterT.tabs.length, afterW.tabs.length] };
  });

  await check("cmd-l-from-page", async () => {
    const s = await state();
    const r = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "l", keyCode: 37, modifiers: ["command"], focus: "page" })`);
    if (!r.fired?.some((f) => f.command === "focusCommandBar")) throw new Error(`⌘L didn't reach the menu: ${JSON.stringify(r)}`);
    return { handledBy: r.handledBy, fired: r.fired.map((f) => f.command) };
  });

  await check("tab-keys-from-page", async () => {
    const s = await state();
    // ⌃Tab opens the tab switcher (it switches when ⌃ is released); ⌘⇧] goes to the next tab at once.
    const ctrlTab = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "\t", keyCode: 48, modifiers: ["control"], focus: "page" })`);
    if (!ctrlTab.fired?.some((f) => f.command === "tabSwitcher")) throw new Error(`⌃Tab: ${JSON.stringify(ctrlTab)}`);
    // Esc in the switcher, as the user ends it without switching (left open, it covers the page for later checks).
    await evalApp(`ac.switcher.cancelSwitcher(); return true`);
    const next = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "}", keyCode: 30, modifiers: ["command", "shift"], focus: "page" })`);
    const after = await until("the next tab", async () => {
      const n = await state();
      return n.active !== s.active ? n : null;
    }, 5000);
    return { ctrlTab: ctrlTab.fired.map((f) => f.command), next: (next.fired ?? []).map((f) => f.command), from: s.active, to: after.active };
  });

  await check("window-close", async () => {
    const e = (await state()).tabs.find((x) => x.url?.startsWith(`${base}/e`));
    if (!e) throw new Error("no window.open tab to close");
    const t = await pageTarget(`${base}/e`);
    await closeFromPage(t);
    await until("the tab gone from the store", async () => !(await state()).tabs.some((x) => x.id === e.id));
    return { closed: e.id };
  });


  // MARK: Page UI

  await check("status-text", async () => {
    // Hovering a link shows its URL (Chrome's UpdateTargetURL → onStatus → the status bubble's state).
    const t = await pageFor(first.id, `${base}/a`);
    const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('next').getBoundingClientRect())", returnByValue: true });
    const box = JSON.parse(r.result.value);
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 3, y: box.y + box.height / 2 });
    const status = await until("a status", async () => (await evalApp(`return ac.pageState.getState().pages["${first.id}"]?.status ?? ""`)) || null, 8000);
    return { status };
  });

  await check("load-error", async () => {
    await evalApp(`ac.store.getState().navigate("${first.id}", "http://127.0.0.1:9/nothing", { userInitiated: true }); return true`);
    const e = await until("onLoadError", async () => (await eventsOf(first.id)).find((x) => x.name === "loadError"), 10000);
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    return { loadError: e.payload };
  });

  await check("chrome-strings", async () => {
    // Chrome's own strings name the product Arcadia, as on CEF (a WebUI page, browser side; ACHost's S29 also
    // checks a renderer error page); the credit still names the Chromium Authors.
    // On screen: a background tab's WebUI page can sit "loading" (Chrome defers it while hidden).
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    await evalApp(`ac.store.getState().navigate("${first.id}", "chrome://version", { userInitiated: true }); return true`);
    // The app shows Chrome's pages under its own scheme (arcadia://version).
    await until("chrome://version", async () => (await state()).tabs.find((t) => t.id === first.id && /^(chrome|arcadia):\/\/version/.test(t.url ?? "") && t.title === "About Version"), 20000);
    try {
      const t = await pageFor(first.id, "chrome://version");
      const text = (await cdp(t, "Runtime.evaluate", { expression: "document.body?.innerText ?? ''", returnByValue: true })).result?.value ?? "";
      const product = text.split("\n").find((l) => /^\w+\t\d+\.\d+\./.test(l) && !/^CEF/.test(l));
      const credit = text.match(/Copyright \d+ The Chromium Authors/)?.[0];
      if (!/^Arcadia\t/.test(product ?? "") || !credit) throw new Error(`version page: ${product} / ${credit}`);
      return { product, credit };
    } finally {
      // (backToA is defined further down.)
      await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
      await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    }
  });

  await check("context-menu-search", async () => {
    // Chrome's own page menu, with the app's "Search <engine> for …" after Copy (background mode reports it
    // instead of showing it).
    await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setSearchEngineName("Acceptance").then(() => true)`);
    // A page on screen: Chrome doesn't run a hidden tab's context menu.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    await sleep(300);
    let t = await pageFor(first.id, `${base}/a`);
    const rightClick = async () => {
    const r = await cdp(t, "Runtime.evaluate", {
      expression: `(() => { const el = document.getElementById('next'); const range = document.createRange(); range.selectNodeContents(el);
        getSelection().removeAllRanges(); getSelection().addRange(range); return JSON.stringify(el.getBoundingClientRect()); })()`,
      returnByValue: true,
    });
    const box = JSON.parse(r.result.value);
    const at = { x: box.x + 3, y: box.y + box.height / 2, button: "right", clickCount: 1 };
    let e = null;
    for (let attempt = 0; attempt < 3 && !e; attempt++) {
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
      e = await until("a context menu", async () => (await eventsOf(first.id)).findLast((x) => x.name === "contextMenu"), 4000).catch(() => null);
    }
    return e;
    };
    let e = await rightClick();
    if (!e) {
      // Once more on a freshly loaded page (seen flaky in long runs only).
      log("  context menu: none after 3 right-clicks; reloading the page and trying again");
      await evalApp(`return ac.webviews.get("${first.id}").reload()`);
      await sleep(1500);
      t = await pageFor(first.id, `${base}/a`);
      e = await rightClick();
    }
    if (!e) {
      const vis = (await cdp(t, "Runtime.evaluate", { expression: "document.visibilityState + '/' + document.hasFocus()", returnByValue: true })).result.value;
      throw new Error(`no context menu reported (page ${vis}); events: ${JSON.stringify((await eventsOf(first.id)).slice(-6).map((x) => x.name))}`);
    }
    const selection = !!(await eventsOf(first.id)).findLast((x) => x.name === "pageMessage" && x.payload?.kind === "selection");
    const labels = e.payload.items.filter((i) => !i.separator).map((i) => i.label);
    const search = labels.filter((l) => /^Search .* for /.test(l));
    if (!search.some((l) => l.startsWith("Search Acceptance for “to B”"))) throw new Error(`no app search item: ${JSON.stringify(labels)}`);
    await cdp(t, "Runtime.evaluate", { expression: "getSelection().removeAllRanges()" });
    return { items: labels.length, search, selectionMessage: selection };
  });

  await check("context-menu-activation-log", async () => {
    // As CEF's background guard: the menu not shown is a line in activation.log (the release smoke test reads it).
    const line = await until("the activation.log line", async () =>
      (existsSync(join(data, "activation.log")) ? readFileSync(join(data, "activation.log"), "utf8") : "").split("\n").findLast((l) => l.includes("context menu (not shown): ")), 5000);
    if (!line.includes("Search Acceptance for “to B”")) throw new Error(`activation.log: ${line}`);
    return { line: line.slice(line.indexOf("context menu")) };
  });

  await check("duplicate-and-reopen", async () => {
    // Duplicate copies the tab's back/forward list (clone:), and ⇧⌘T brings a closed tab back with its own list
    // (restore:, through Chrome's TabRestoreService entry tagged with the tab's id).
    const copyId = await evalApp(`const c = ac.store.getState().duplicateTab("${first.id}"); return typeof c === "string" ? c : c?.id ?? null`);
    if (!copyId) throw new Error("no copy");
    await until("the copy on A with history", async () => (await state()).tabs.find((t) => t.id === copyId && t.title === "Page A" && t.back && !t.loading), 15000);
    await evalApp(`ac.store.getState().closeTab("${copyId}"); return true`);
    await until("the copy closed", async () => !(await state()).tabs.some((t) => t.id === copyId));
    await sleep(500);
    const before = new Set((await state()).tabs.map((t) => t.id));
    await evalApp(`ac.store.getState().reopenClosedTab(${JSON.stringify(mainWindow)}); return true`);
    const back = await until("the reopened tab with history", async () => {
      const s = await state();
      return s.tabs.find((t) => !before.has(t.id) && t.title === "Page A" && t.back && !t.loading);
    }, 15000);
    await evalApp(`ac.store.getState().closeTab("${back.id}"); return true`);
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("first tab active", async () => (await state()).active === first.id);
    return { copy: copyId, reopened: back.id };
  });

  // MARK: Choosers and Cast

  await check("device-chooser", async () => {
    // WebUSB requestDevice: Chrome's chooser comes to the app's sheet (onDeviceChooser); cancelling it rejects
    // the page's promise with NotFoundError.
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      expression: "window.__usb = 'pending'; navigator.usb.requestDevice({ filters: [] }).then(() => (window.__usb = 'picked'), (e) => (window.__usb = e.name))",
      userGesture: true,
    });
    const chooser = await until("the app's chooser", async () => {
      const c = await evalApp(`return globalThis.acDeviceChoosers?.useChoosers.getState().byTab["${first.id}"] ?? null`);
      if (c) return c;
      const r = await cdp(t, "Runtime.evaluate", { expression: "String(window.__usb)", returnByValue: true });
      if (r.result.value !== "pending") throw new Error(`no chooser; the page got ${r.result.value}`);
      return null;
    }, 10000);
    await evalApp(`return globalThis.acDeviceChoosers.cancelDeviceChooser(${chooser.id}).then(() => true)`);
    const result = await until("the page's answer", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "window.__usb", returnByValue: true });
      return r.result.value !== "pending" ? r.result.value : null;
    }, 8000);
    await until("the sheet gone", async () => !(await evalApp(`return globalThis.acDeviceChoosers.useChoosers.getState().byTab["${first.id}"] ?? null`)), 5000);
    if (result !== "NotFoundError") throw new Error(`page got ${result}`);
    return { chooser: { id: chooser.id, title: chooser.title, options: chooser.options?.length }, page: result };
  });

  // Chrome's Bluetooth chooser with no adapter behind it (--arcadia-test-bluetooth-chooser: its real
  // ChromeBluetoothChooserController, no IOBluetooth, no macOS prompt; what its answers tell the page's side is recorded).
  const chromeUI = (call) => evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.${call}`);
  const chooserOf = (tabId) => evalApp(`return globalThis.acDeviceChoosers?.useChoosers.getState().byTab["${tabId}"] ?? null`);
  const bluetoothChooser = async (unauthorized) => {
    if (!(await chromeUI(`devShowBluetoothChooser(${await browserOf(first.id)}, ${unauthorized})`))) throw new Error("devShowBluetoothChooser said no (switch off?)");
    return until("the app's Bluetooth chooser", async () => {
      const c = await chooserOf(first.id);
      return c && (unauthorized ? c.unauthorized : c.options?.length) ? c : null;
    }, 10000);
  };
  const chooserEvents = () => chromeUI(`devChooserEvents()`);
  const chooserGone = () => until("the sheet gone", async () => !(await chooserOf(first.id)), 5000);

  await check("bluetooth-chooser", async () => {
    // A Bluetooth chooser's device list in the app's sheet: the app's Scan again (refreshDeviceChooser) asks Chrome to
    // rescan and the list comes back; its pick (selectDevice) answers the page's side with that device.
    await evalApp(`globalThis.__nnChooser = []; globalThis.__nnChooserSub?.remove();
      globalThis.__nnChooserSub = globalThis.expo.modules.ArcadiaChromeUI.addListener("onDeviceChooser", (e) => globalThis.__nnChooser.push(e)); return true`);
    try {
      const before = (await chooserEvents()).length;
      const chooser = await bluetoothChooser(false);
      const sent = (await evalApp(`return globalThis.__nnChooser`)).length;
      await chromeUI(`refreshDeviceChooser(${chooser.id}).then(() => true)`);
      const rescan = await until("Chrome's rescan", async () => (await chooserEvents()).slice(before).find((e) => e.event === "rescan") ?? null, 5000);
      const refreshed = await until("the list sent again", async () => {
        const list = await evalApp(`return globalThis.__nnChooser`);
        return list.slice(sent).find((c) => c.open && c.options?.length && !c.refreshing) ?? null;
      }, 5000);
      await chromeUI(`selectDevice(${chooser.id}, 0).then(() => true)`);
      const selected = await until("the pick answered", async () => (await chooserEvents()).slice(before).find((e) => e.event === "selected") ?? null, 5000);
      await chooserGone();
      if (selected.device !== "ac-test-device") throw new Error(`picked ${selected.device}`);
      return { title: chooser.title, options: refreshed.options.map((o) => o.name), rescan: !!rescan, selected: selected.device };
    } finally {
      await evalApp(`globalThis.__nnChooserSub?.remove(); return true`).catch(() => null);
      const c = await chooserOf(first.id).catch(() => null);
      if (c) await chromeUI(`cancelDeviceChooser(${c.id}).then(() => true)`).catch(() => null);
    }
  });

  await check("bluetooth-settings", async () => {
    // A Bluetooth chooser without macOS's Bluetooth permission shows "Open Bluetooth Settings" (unauthorized):
    // openBluetoothSettings asks Chrome for its System Settings pane, recorded rather than opened
    // (--arcadia-test-external-protocol-no-launch), and the chooser stays. On a WebUSB chooser it does nothing
    // (Chrome's default is NOTREACHED).
    const launches = () => evalApp(`return globalThis.expo.modules.ArcadiaCEF.devExternalLaunches()`);
    const isSettings = (x) => /Privacy_Bluetooth/.test(x.url ?? "");
    const t = await pageFor(first.id, `${base}/a`);
    try {
      const before = (await launches()).filter(isSettings).length;
      const events = (await chooserEvents()).length;
      const bt = await bluetoothChooser(true);
      await chromeUI(`openBluetoothSettings(${bt.id}).then(() => true)`);
      const recorded = await until("the Bluetooth settings pane recorded", async () => {
        const list = (await launches()).filter(isSettings);
        return list.length > before ? list.at(-1) : null;
      }, 5000);
      if ((await chooserOf(first.id))?.id !== bt.id) throw new Error("the chooser closed on openBluetoothSettings");
      await chromeUI(`cancelDeviceChooser(${bt.id}).then(() => true)`);
      await chooserGone();
      const cancelled = await until("the cancel answered", async () => (await chooserEvents()).slice(events).find((e) => e.event === "cancelled") ?? null, 5000);
      await cdp(t, "Runtime.evaluate", {
        expression: "window.__usb = 'pending'; navigator.usb.requestDevice({ filters: [] }).then(() => (window.__usb = 'picked'), (e) => (window.__usb = e.name))",
        userGesture: true,
      });
      const usb = await until("the WebUSB chooser", () => chooserOf(first.id), 10000);
      await chromeUI(`openBluetoothSettings(${usb.id}).then(() => true)`);
      await sleep(500);
      const after = (await launches()).filter(isSettings).length;
      if (after !== before + 1) throw new Error(`the WebUSB chooser recorded ${after - before - 1} settings pane(s)`);
      if ((await chooserOf(first.id))?.id !== usb.id) throw new Error("the WebUSB chooser closed on openBluetoothSettings");
      await chromeUI(`cancelDeviceChooser(${usb.id}).then(() => true)`);
      await chooserGone();
      return { unauthorized: bt.unauthorized, recorded: recorded.url, cancelled: !!cancelled, webUSB: "ignored" };
    } finally {
      const c = await chooserOf(first.id).catch(() => null);
      if (c) await chromeUI(`cancelDeviceChooser(${c.id}).then(() => true)`).catch(() => null);
    }
  });

  await check("cast-dialog", async () => {
    // Chrome's Cast dialog for the tab comes to the app's popover (onCastDialog), the profile's routes to
    // onCastRoutes, and closing it from the app closes Chrome's.
    const browser = await browserOf(first.id);
    const shown = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.showCastDialog(${browser})`);
    if (!shown) throw new Error("showCastDialog said no (media router off?)");
    const dialog = await until("the app's Cast dialog", async () => evalApp(`return globalThis.acCast?.useCast.getState().dialogs["${first.id}"] ?? null`), 10000);
    const routes = await evalApp(`return globalThis.acCast.useCast.getState().routes`);
    await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.closeCastDialog(${dialog.id}).then(() => true)`);
    await until("the dialog closed", async () => !(await evalApp(`return globalThis.acCast.useCast.getState().dialogs["${first.id}"] ?? null`)), 5000);
    return { header: dialog.header, sinks: dialog.sinks?.length ?? 0, routeProfiles: Object.keys(routes ?? {}) };
  });

  await check("cast-routes", async () => {
    // Casting the tab to the engine's test sink (--arcadia-test-media-route-provider: Chrome's media router with no
    // network device; the real providers are off): the app's picker starts it (startCasting), the route reaches
    // onCastRoutes and the dialog's sink, and both ways the app stops it end it: the picker's Stop (stopCasting) and
    // the toolbar's "Stop Casting" menu (terminateCastRoute).
    const browser = await browserOf(first.id);
    const routesNow = () => evalApp(`return Object.values(globalThis.acCast.useCast.getState().routes).flat()`);
    const dialogNow = () => evalApp(`return globalThis.acCast.useCast.getState().dialogs["${first.id}"] ?? null`);
    const openDialog = async () => {
      if (!(await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.showCastDialog(${browser})`))) throw new Error("showCastDialog said no");
      return until("the test sink in the app's dialog", async () => {
        const d = await dialogNow();
        const sink = d?.sinks?.find((s) => s.name === "Arcadia Test Sink" && s.state === "available");
        return sink ? { dialog: d, sink } : null;
      }, 10000).catch(async (e) => { throw new Error(`${e.message}; dialog ${JSON.stringify(await dialogNow())}`); });
    };
    const casting = async (dialogId, sink) => {
      await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.startCasting(${dialogId}, ${JSON.stringify(sink.id)}, 2).then(() => true)`);
      return until("the route in onCastRoutes", async () => (await routesNow()).find((r) => r.sink === sink.id) ?? null, 10000);
    };
    try {
      const { dialog, sink } = await openDialog();
      if (!(sink.modes & 2)) throw new Error(`the test sink can't cast a tab (modes ${sink.modes})`);
      const route = await casting(dialog.id, sink);
      const connected = await until("the sink connected in the dialog", async () => {
        const d = await dialogNow();
        const s = d?.sinks?.find((x) => x.id === sink.id);
        return s?.routeId === route.id && s.state === "connected" ? { dialog: d, sink: s } : null;
      }, 10000);
      await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.stopCasting(${dialog.id}, ${JSON.stringify(route.id)}).then(() => true)`);
      await until("the route gone after stopCasting", async () => !(await routesNow()).some((r) => r.id === route.id), 10000);
      // Again, then the dialog closed and the route ended from the toolbar's menu.
      const second = await casting(dialog.id, sink);
      await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.closeCastDialog(${dialog.id}).then(() => true)`);
      await until("the dialog closed", async () => !(await dialogNow()), 5000);
      if (!(await routesNow()).some((r) => r.id === second.id)) throw new Error("closing the dialog ended the route");
      await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.terminateCastRoute(${JSON.stringify(second.id)}).then(() => true)`);
      await until("the route gone after terminateCastRoute", async () => !(await routesNow()).some((r) => r.id === second.id), 10000);
      return {
        sink: { name: sink.name, modes: sink.modes },
        started: { route: route.description, source: route.source, castingStarted: connected.dialog.castingStarted, state: connected.sink.state },
        stopped: true,
        terminated: true,
      };
    } finally {
      const d = await dialogNow().catch(() => null);
      if (d) await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.closeCastDialog(${d.id}).then(() => true)`).catch(() => null);
      for (const r of await routesNow().catch(() => []))
        await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.terminateCastRoute(${JSON.stringify(r.id)}).then(() => true)`).catch(() => null);
    }
  });

  // MARK: Page state and prompts

  await check("theme-commit", async () => {
    // The toolbar colour belongs to the page shown: a page the page script never runs in (an error page) doesn't keep
    // the last site's colour, and a page back from the back/forward cache brings its own colour back.
    const tab = await openTab(`${base}/red-header?commit`, "Red header");
    const color = () => evalApp(`return ac.store.getState().live["${tab.id}"]?.themeColor ?? null`);
    const settled = (title) => until(title, async () => (await state()).tabs.find((t) => t.id === tab.id && t.title === title && !t.loading));
    try {
      await until("the red header's colour", async () => (await color()) === "#C80000", 5000);
      const failed = "http://127.0.0.1:9/theme-commit";
      await evalApp(`ac.store.getState().navigate("${tab.id}", "${failed}", { userInitiated: true }); return true`);
      await until("the error page", async () => (await state()).tabs.find((t) => t.id === tab.id && t.url === failed && !t.loading), 10000);
      await sleep(100);
      const error = await color();

      // Back/forward cache: red header → Page C (white) → Back restores the red page as it was.
      await evalApp(`ac.store.getState().navigate("${tab.id}", "${base}/red-header?bf", { userInitiated: true }); return true`);
      await settled("Red header");
      await until("red again", async () => (await color()) === "#C80000", 5000);
      const red = await pageFor(tab.id, "/red-header?bf");
      await cdp(red, "Runtime.evaluate", { expression: "window.__bf = 1" });
      await evalApp(`ac.store.getState().navigate("${tab.id}", "${base}/c?bf", { userInitiated: true }); return true`);
      await settled("Page C");
      await until("Page C's colour", async () => (await color()) === "#FFFFFF", 5000);
      await evalApp(`return ac.webviews.get("${tab.id}").goBack()`);
      await settled("Red header");
      const back = await pageFor(tab.id, "/red-header?bf");
      const cached = (await cdp(back, "Runtime.evaluate", { expression: "String(window.__bf)", returnByValue: true })).result.value === "1";
      if (!cached) throw new Error("Back didn't restore the page from the back/forward cache");
      const restored = await until("the restored page's colour", async () => ((await color()) === "#C80000" ? "#C80000" : null), 2000).catch(color);
      if (error === "#C80000" || restored !== "#C80000") throw new Error(`the error page shows ${error}, the page back from the cache ${restored}`);
      return { error, restored };
    } finally {
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("user-selection", async () => {
    // A mouse selection of page text: the page script reports it (onPageMessage "selection").
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/text", { userInitiated: true }); return true`);
    await until("the text page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Text" && !t.loading));
    try {
      const t = await pageFor(first.id, `${base}/text`);
      const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('t').getBoundingClientRect())", returnByValue: true });
      const box = JSON.parse(r.result.value);
      const y = box.y + box.height / 2;
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + 2, y, button: "left", buttons: 1, clickCount: 1 });
      for (let k = 1; k <= 8; k++)
        await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 2 + ((box.width - 10) * k) / 8, y, button: "left", buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.width - 8, y, button: "left", buttons: 0, clickCount: 1 });
      const e = await until("onPageMessage selection", async () =>
        (await eventsOf(first.id)).findLast((x) => x.name === "pageMessage" && x.payload?.kind === "selection" && x.payload?.data), 6000);
      return { text: String(JSON.stringify(e.payload.data)).slice(0, 80) };
    } finally {
      await backToA();
    }
  });

  await check("password-prompt", async () => {
    // A sign-in form submitted with typed values: Chrome's password manager offers to save (onPasswordPrompt), and
    // the app's answer saves it (resolvePasswordPrompt).
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/login", { userInitiated: true }); return true`);
    await until("the login page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Login" && !t.loading));
    try {
      const t = await pageFor(first.id, `${base}/login`);
      for (const [field, text] of [["u", "nnformuser"], ["p", "form-s3cret"]]) {
        await cdp(t, "Runtime.evaluate", { expression: `document.getElementById('${field}').focus()` });
        await cdp(t, "Input.insertText", { text });
      }
      const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('go').getBoundingClientRect())", returnByValue: true });
      const box = JSON.parse(r.result.value);
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2, button: "left", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at, buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at, buttons: 0 });
      const e = await until("onPasswordPrompt", async () => (await eventsOf(first.id)).findLast((x) => x.name === "passwordPrompt"), 10000);
      // packages/cef's PasswordPrompt: state, origin, username, passwordLength, federation, usernames.
      const p = e.payload;
      if (p.state !== "save" || p.username !== "nnformuser" || p.passwordLength !== 11 || p.federation !== "" || !Array.isArray(p.usernames) || p.origin !== base)
        throw new Error(`prompt ${JSON.stringify(p)}`);
      await evalApp(`return ac.webviews.get("${first.id}").resolvePasswordPrompt("save")`);
      const saved = await until("the saved login", async () => {
        const list = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.listPasswords("")`);
        return list.passwords?.find((x) => x.username === "nnformuser") ?? null;
      }, 10000);
      // The same user with a new password: "update", answered with the app's edited password.
      const seen = (await eventsOf(first.id)).filter((x) => x.name === "passwordPrompt").length;
      await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/login?again", { userInitiated: true }); return true`);
      await until("the login page again", async () => (await state()).tabs.find((t) => t.id === first.id && t.url?.endsWith("/login?again") && !t.loading));
      const t2 = await pageFor(first.id, `${base}/login?again`);
      await cdp(t2, "Runtime.evaluate", { expression: "document.getElementById('u').value = ''; document.getElementById('p').value = ''" });
      for (const [field, text] of [["u", "nnformuser"], ["p", "form-s3cret-2"]]) {
        await cdp(t2, "Runtime.evaluate", { expression: `document.getElementById('${field}').focus()` });
        await cdp(t2, "Input.insertText", { text });
      }
      const r2 = await cdp(t2, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('go').getBoundingClientRect())", returnByValue: true });
      const box2 = JSON.parse(r2.result.value);
      const at2 = { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2, button: "left", clickCount: 1 };
      await cdp(t2, "Input.dispatchMouseEvent", { type: "mousePressed", ...at2, buttons: 1 });
      await cdp(t2, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at2, buttons: 0 });
      const u = await until("the update prompt", async () => (await eventsOf(first.id)).filter((x) => x.name === "passwordPrompt")[seen], 10000);
      if (u.payload.state !== "update" || !u.payload.usernames.includes("nnformuser") || u.payload.passwordLength !== 13)
        throw new Error(`update prompt ${JSON.stringify(u.payload)}`);
      await evalApp(`return ac.webviews.get("${first.id}").resolvePasswordPrompt("update", { password: "edited-s3cret" })`);
      const edited = await until("the edited password", async () => {
        const r = await cef(`getPassword("", ${JSON.stringify(saved.origin)}, "nnformuser")`);
        return r?.password === "edited-s3cret" ? r : null;
      }, 10000);
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.deletePassword("", ${JSON.stringify(saved.origin)}, "nnformuser")`);
      return { prompt: { state: p.state, passwordLength: p.passwordLength, usernames: p.usernames }, update: u.payload.state, edited: !!edited, origin: saved.origin };
    } finally {
      await backToA();
    }
  });

  // MARK: Screen and tab capture

  await check("screen-share-picker", async () => {
    // getDisplayMedia through the app's source picker (setDisplayMediaPicker, as the app sets it): the request reaches
    // the app (onDisplayMediaRequest, with displayMediaSources' list), the app picks another tab (its
    // mediaCaptureSourceId), and the engine grants that source to the page (resolveDisplayMedia): the page captures it.
    const target = await openTab(`${base}/capture-target?picker`, "Capture Target", true);
    const t = await pageFor(first.id, `${base}/a`);
    try {
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setDisplayMediaPicker(true).then(() => true)`);
      await evalApp(`return ac.webviews.get("${first.id}").reload()`);
      await until("A loaded", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Page A" && !x.loading), 10000);
      await sleep(500);
      const page = await pageFor(first.id, `${base}/a`);
      await cdp(page, "Runtime.evaluate", {
        expression: "window.__cap = 'pending'; navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { window.__stream = s; window.__cap = 'live'; }, (e) => (window.__cap = e.name)); true",
        userGesture: true,
      });
      const request = await until("onDisplayMediaRequest", async () => (await eventsOf(first.id)).findLast((x) => x.name === "displayMediaRequest"), 10000);
      const sourceId = await evalApp(`return ac.webviews.get("${target.id}").mediaCaptureSourceId()`);
      if (!sourceId) throw new Error("no capture source id for the target tab");
      // As the app's picker answers (it closes the sheet too).
      await evalApp(`globalThis.acSharePicker.answerDisplayMedia("${first.id}", ${JSON.stringify(sourceId)}); return true`);
      const live = await until("a live capture", async () => {
        const v = (await cdp(page, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value;
        if (v !== "pending" && v !== "live") throw new Error(`getDisplayMedia: ${v}`);
        return v === "live" ? v : null;
      }, 15000);
      await cdp(page, "Runtime.evaluate", { expression: "window.__stream?.getTracks().forEach((x) => x.stop()); true" });
      return { sources: Array.isArray(request.payload.sources) ? request.payload.sources.length : request.payload.sources, sourceId: String(sourceId).slice(0, 40), live };
    } finally {
      await closeTab(target.id);
    }
  });

  await check("tab-capture", async () => {
    // Chrome's own picker (the app's turned off; the test switch picks the tab titled "Capture Target"): the capturing
    // tab's media access (onMediaAccess), "Share this tab instead" (changeCaptureSource) and Stop sharing
    // (stopCapture, which ends the page's track).
    const target = await openTab(`${base}/capture-target`, "Capture Target", true);
    const other = await openTab(`${base}/d?share-instead`, "Page D", true);
    await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setDisplayMediaPicker(false).then(() => true)`);
    await evalApp(`return ac.webviews.get("${first.id}").reload()`);
    await until("A loaded", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Page A" && !x.loading), 10000);
    await sleep(500);
    const t = await pageFor(first.id, `${base}/a`);
    try {
      await cdp(t, "Runtime.evaluate", {
        expression: "window.__cap = 'pending'; navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { window.__stream = s; s.getVideoTracks()[0].onended = () => (window.__cap = 'ended'); window.__cap = 'live'; }, (e) => (window.__cap = e.name)); true",
        userGesture: true,
      });
      const live = await until("a live capture", async () => {
        const v = (await cdp(t, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value;
        if (v !== "pending" && v !== "live") throw new Error(`getDisplayMedia: ${v}`);
        return v === "live" ? v : null;
      }, 15000);
      const access = await until("onMediaAccess", async () => {
        for (const id of [first.id, target.id]) {
          const e = (await eventsOf(id)).findLast((x) => x.name === "mediaAccess");
          if (e) return { tab: id === first.id ? "capturer" : "captured", access: e.payload };
        }
        return null;
      }, 8000);
      const sourceId = await evalApp(`return ac.webviews.get("${target.id}")?.mediaCaptureSourceId() ?? null`);
      const capturer = await browserOf(first.id);
      const instead = await browserOf(other.id);
      const changed = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.changeCaptureSource(${capturer}, ${instead})`);
      if (changed !== true) throw new Error(`changeCaptureSource answered ${changed} (Chrome's last-used profile: ${(await cef(`engineInfo()`)).lastUsedProfile})`);
      await sleep(1000);
      const stopped = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.stopCapture(${capturer})`);
      const ended = await until("the track ended", async () =>
        (await cdp(t, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value === "ended" ? true : null, 8000);
      // Chrome's picker, which the test switch answered, is gone: with the screen locked its close animation never
      // ended, and the dialog left over the page kept Chrome's autofill dropdown from opening there for the rest of the run.
      const windowNumber = await cef(`devWindowNumber(${capturer})`);
      const picker = await until("the picker closed", async () => {
        const children = JSON.parse(await cef(`devWindow(${windowNumber}, "children")`));
        return children.some((c) => c.visible && c.title.startsWith("Choose what to share")) ? null : "closed";
      }, 5000);
      return { live, access, sourceId: sourceId ? String(sourceId).slice(0, 40) : null, changed, stopped, ended, picker };
    } finally {
      await cdp(t, "Runtime.evaluate", { expression: "window.__stream?.getTracks().forEach((x) => x.stop())" }).catch(() => null);
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setDisplayMediaPicker(true).then(() => true)`);
      await closeTab(target.id);
      await closeTab(other.id);
      await evalApp(`return ac.webviews.get("${first.id}").reload()`);
      await until("A loaded", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Page A" && !x.loading), 10000);
    }
  });

  await check("share-instead-two-captures", async () => {
    // Two calls in one profile share two tabs (red, green) through the app's picker. "Share this tab instead" on a
    // third tab (blue) for the second call moves that call only: each call's own frames say what it gets.
    const opened = [];
    const pages = {};
    try {
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setDisplayMediaPicker(true).then(() => true)`);
      for (const [c, t] of [["ff0000", "Red"], ["00ff00", "Green"], ["0000ff", "Blue"]]) opened.push(await openTab(`${base}/solid?c=${c}&t=${t}`, t, true));
      for (const t of ["CallA", "CallB"]) opened.push(await openTab(`${base}/capturer?t=${t}`, t, true));
      const [red, green, blue, callA, callB] = opened;
      const hooks = await evalApp(`return { picker: !!globalThis.acSharePicker?.shareTab, bar: !!globalThis.acShareBar }`);
      const share = async (call, target) => {
        await evalApp(`ac.actions.switchToTab("${call.id}"); return true`);
        await until(`${call.title} shown`, async () => (await state()).active === call.id);
        const page = await pageFor(call.id, `/capturer?t=${call.title}`);
        await cdp(page, "Runtime.evaluate", { expression: "share()", userGesture: true });
        await until(`${call.title}'s picker`, async () => (await eventsOf(call.id)).findLast((x) => x.name === "displayMediaRequest"), 10000);
        // As a click on the target in the app's picker.
        if (hooks.picker) await evalApp(`return globalThis.acSharePicker.shareTab("${call.id}", "${target.id}")`);
        else {
          const source = await evalApp(`return ac.webviews.get("${target.id}").mediaCaptureSourceId()`);
          await evalApp(`globalThis.acSharePicker.answerDisplayMedia("${call.id}", ${JSON.stringify(source)}); return true`);
        }
        await until(`${call.title} live`, async () => {
          const v = (await cdp(page, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value;
          if (v !== "pending" && v !== "live") throw new Error(`${call.title} getDisplayMedia: ${v}`);
          return v === "live" ? v : null;
        }, 15000);
        return page;
      };
      pages.A = await share(callA, red);
      pages.B = await share(callB, green);
      const colour = async (page) => {
        const p = (await cdp(page, "Runtime.evaluate", { expression: "pixel()", awaitPromise: true, returnByValue: true })).result.value;
        const i = p.indexOf(Math.max(...p));
        return p[i] > 150 && p.filter((x) => x > 100).length === 1 ? ["red", "green", "blue"][i] : `rgb(${p})`;
      };
      const both = async () => ({ A: await colour(pages.A), B: await colour(pages.B) });
      const before = await until("red and green", async () => {
        const c = await both();
        return c.A === "red" && c.B === "green" ? c : null;
      }, 10000);
      const recorded = hooks.bar && (await evalApp(`const s = globalThis.acShareBar.tabShares(); return [s["${callA.id}"]?.capturedTabId === "${red.id}", s["${callB.id}"]?.capturedTabId === "${green.id}"]`));
      if (hooks.bar && !(recorded[0] && recorded[1])) throw new Error(`app records before: ${JSON.stringify(recorded)}`);
      await evalApp(`ac.actions.switchToTab("${blue.id}"); return true`);
      await until("blue shown", async () => (await state()).active === blue.id);
      const changed = hooks.bar
        ? await evalApp(`return globalThis.acShareBar.shareInstead("${callB.id}", "${blue.id}")`)
        : await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.changeCaptureSource(${await browserOf(callB.id)}, ${await browserOf(blue.id)})`);
      if (changed !== true) throw new Error(`share instead answered ${JSON.stringify(changed)}`);
      let after = null;
      try {
        after = await until("B on blue", async () => {
          const c = await both();
          return c.B === "blue" ? c : null;
        }, 8000);
      } catch {
        after = await both();
      }
      await sleep(1000);
      const settled = await both();
      if (settled.A !== "red" || settled.B !== "blue") throw new Error(`after B's share instead: A ${settled.A} (want red), B ${settled.B} (want blue)`);
      let records = null;
      if (hooks.bar) {
        // Past the moment the switch turns B's capture off (ShareBar's SHARE_END_MS): the share stays, on blue.
        await sleep(2000);
        records = await evalApp(`const s = globalThis.acShareBar.tabShares(); return { A: s["${callA.id}"]?.capturedTabId ?? null, B: s["${callB.id}"]?.capturedTabId ?? null }`);
        if (records.A !== red.id || records.B !== blue.id) throw new Error(`app records ${JSON.stringify(records)} (want A ${red.id}, B ${blue.id})`);
      }
      return { before, after: settled, changed, records: records && { A: "red", B: "blue" } };
    } finally {
      for (const page of Object.values(pages)) await cdp(page, "Runtime.evaluate", { expression: "window.__stream?.getTracks().forEach((x) => x.stop()); true" }).catch(() => null);
      for (const t of opened) await closeTab(t.id).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`).catch(() => null);
    }
  });

  // MARK: Tab lifecycle

  await check("restore-after-close", async () => {
    // A → B, then the tab goes with its window, or by itself from Chrome's side, at once; reopened, Back reaches A.
    // Its Chrome TabRestoreService entry has to carry the app's key before the close starts (ac_tab_restore_tag on
    // attach and each new NavigationEntry), not from the app's teardown that comes after.
    const shell = "globalThis.expo.modules.ArcadiaShell";
    const s = (expr) => evalApp(`const s = ac.store.getState(); return ${expr}`);
    const toB = async (tabId, tag) => {
      await until(`A?${tag} loaded`, async () => (await s(`s.tabs["${tabId}"]?.title === "Page A" && !s.live["${tabId}"]?.isLoading && !!ac.webviews.get("${tabId}")`)) || null, 15000);
      await evalApp(`ac.store.getState().navigate("${tabId}", "${base}/b?${tag}", { userInitiated: true }); return true`);
      await until(`B?${tag} with Back`, async () => (await s(`s.tabs["${tabId}"]?.title === "Page B" && s.live["${tabId}"]?.canGoBack && !s.live["${tabId}"]?.isLoading`)) || null, 15000);
    };
    // The reopened tab (shown): Page B with Back, and Back reaches A.
    const backReachesA = async (tabId, tag) => {
      await evalApp(`ac.actions.switchToTab("${tabId}"); return true`);
      await until(`the reopened B?${tag}`, async () => (await s(`s.tabs["${tabId}"]?.title === "Page B" && !s.live["${tabId}"]?.isLoading && !!ac.webviews.get("${tabId}")`)) || null, 15000);
      const canGoBack = await s(`!!s.live["${tabId}"]?.canGoBack`);
      if (!canGoBack) return { canGoBack };
      await evalApp(`return ac.webviews.get("${tabId}").goBack()`);
      const a = await until(`Back to A?${tag}`, async () => (await s(`s.tabs["${tabId}"]?.title === "Page A" && s.tabs["${tabId}"]?.url`)) || null, 10000).catch(() => null);
      return { canGoBack, back: a ? new URL(a).pathname + new URL(a).search : null };
    };
    const windowCase = async (tag, close) => {
      const w = await evalApp(`return ac.store.getState().createWindow({ url: "${base}/a?${tag}", background: true })`);
      const tabId = await s(`s.windows["${w}"].tabIds[0]`);
      await toB(tabId, tag);
      const windowsBefore = new Set(await s(`Object.keys(s.windows)`));
      await close(w, tabId);
      await until(`window ${tag} closed`, async () => !(await s(`!!s.windows["${w}"]`)), 15000);
      await evalApp(`ac.store.getState().reopenClosedWindow(); return true`);
      const reopened = await until("the reopened window", async () => (await s(`Object.keys(s.windows)`)).find((id) => !windowsBefore.has(id) && id !== w), 10000);
      const again = await until("its tab", async () => s(`s.windows["${reopened}"]?.tabIds.find((id) => s.tabs[id]?.url?.includes("/b?${tag}")) ?? null`), 10000);
      try {
        return await backReachesA(again, tag);
      } finally {
        await evalApp(`ac.store.getState().closeWindow("${reopened}"); return true`);
      }
    };
    const closeButton = async (tabId) => {
      const number = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindowNumber(${await browserOf(tabId)})`);
      return evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindow(${number}, "close-button")`);
    };
    const warn = await s(`s.settings.warnBeforeClosingWindow`);
    const results = {};
    try {
      results.appCommand = await windowCase("r1", (w) => evalApp(`ac.store.getState().closeWindow("${w}"); return true`));
      results.closeWarning = await windowCase("r2", async (w, tabId) => {
        // Two tabs, so the app asks; its dialog (an AppKit sheet) answers Close All Tabs.
        await evalApp(`ac.store.getState().newTab("${w}", { url: "${base}/c?r2", background: true }); ac.store.getState().updateSettings({ warnBeforeClosingWindow: true }); return true`);
        await sleep(300);
        await evalApp(`globalThis.__nnConfirm = ${shell}.confirm; ${shell}.confirm = (o) => { globalThis.__nnAsked = o.title; return Promise.resolve({ confirmed: true, suppressed: false }); }; return true`);
        await closeButton(tabId);
        await until("the close warning", () => evalApp(`return globalThis.__nnAsked ?? null`), 5000);
      });
      await evalApp(`${shell}.confirm = globalThis.__nnConfirm; return true`);
      results.nativeClose = await windowCase("r3", async (w, tabId) => {
        await evalApp(`ac.store.getState().updateSettings({ warnBeforeClosingWindow: false }); return true`);
        await sleep(300);
        await closeButton(tabId);
      });
      // Tabs Chrome closes itself: an extension's chrome.tabs.remove, and a page's window.close().
      const tabCase = async (tag, close) => {
        const tab = await openTab(`${base}/a?${tag}`, "Page A", true);
        await toB(tab.id, tag);
        await close(tab);
        await until(`tab ${tag} closed`, async () => !(await s(`!!s.tabs["${tab.id}"]`)), 10000);
        const before = new Set(await s(`s.windows["${mainWindow}"].tabIds`));
        await evalApp(`ac.store.getState().reopenClosedTab("${mainWindow}"); return true`);
        const again = await until("the reopened tab", async () => (await s(`s.windows["${mainWindow}"].tabIds`)).find((id) => !before.has(id)), 10000);
        try {
          return await backReachesA(again, tag);
        } finally {
          await closeTab(again);
        }
      };
      const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
      if (installed?.error) throw new Error(installed.error);
      try {
        const worker = await until("the extension's worker", async () =>
          (await targets()).find((t) => t.type === "service_worker" && t.url.includes(installed.id)) ?? null, 15000);
        results.tabsRemove = await tabCase("r4", async () => {
          const r = await cdp(worker, "Runtime.evaluate", {
            expression: `chrome.tabs.query({}).then((ts) => { const t = ts.find((t) => (t.url || "").includes("/b?r4")); return t ? chrome.tabs.remove(t.id).then(() => t.id) : null; })`,
            awaitPromise: true, returnByValue: true,
          });
          if (!r.result.value) throw new Error(`chrome.tabs.remove: ${JSON.stringify(r)}`);
        });
      } finally {
        await exts(`uninstall("${installed.id}", "")`);
      }
      // window.close() closes a tab a script opened (whatever its history).
      results.windowClose = await (async () => {
        const opener = await pageFor(first.id, `${base}/a`);
        const before = new Set((await state()).tabs.map((t) => t.id));
        await cdp(opener, "Runtime.evaluate", { expression: `window.__r5 = window.open("${base}/a?r5", "_blank"); true`, userGesture: true });
        const tab = await until("the opened tab", async () => (await state()).tabs.find((t) => !before.has(t.id) && t.url?.includes("/a?r5")), 10000);
        await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
        await toB(tab.id, "r5");
        const page = await pageTarget(`${base}/b?r5`);
        await closeFromPage(page);
        await until("tab r5 closed", async () => !(await s(`!!s.tabs["${tab.id}"]`)), 10000);
        const now = new Set(await s(`s.windows["${mainWindow}"].tabIds`));
        await evalApp(`ac.store.getState().reopenClosedTab("${mainWindow}"); return true`);
        const again = await until("the reopened tab", async () => (await s(`s.windows["${mainWindow}"].tabIds`)).find((id) => !now.has(id)), 10000);
        try {
          return await backReachesA(again, "r5");
        } finally {
          await closeTab(again);
        }
      })();
    } finally {
      await evalApp(`if (globalThis.__nnConfirm) ${shell}.confirm = globalThis.__nnConfirm; ac.store.getState().updateSettings({ warnBeforeClosingWindow: ${warn} }); ac.actions.switchToTab("${first.id}"); return true`).catch(() => null);
    }
    const failed = Object.entries(results).filter(([, r]) => !r.canGoBack || !r.back?.startsWith("/a?"));
    if (failed.length) throw new Error(`no Back to A after: ${failed.map(([k, r]) => `${k} ${JSON.stringify(r)}`).join(", ")}`);
    return results;
  });

  await check("discard-outcomes", async () => {
    // What discard answers is what happened, and the app records only that: a discard (the renderer goes, the tab
    // sleeps, and wakes when shown), an already-discarded tab, a refusal, and unload (unsupported under ArcadiaCore).
    const tab = await openTab(`${base}/d?discard`, "Page D", true);
    const browser = await browserOf(tab.id);
    const renderer = async () => (await evalApp(`return globalThis.expo.modules.ArcadiaCEF.listTasks()`)).some((t) => t.browserIds?.includes(Number(browser)));
    const flags = () => evalApp(`const l = globalThis.acLifecycle.state(); return { sleeping: !!l.discarded["${tab.id}"], loaded: l.loaded.includes("${tab.id}") }`);
    const raw = (opts = "") => evalApp(`return ac.webviews.get("${tab.id}").discard(${opts})`);
    try {
      const out = {};
      if (!(await renderer())) throw new Error("no renderer before the discard");
      // unload: ArcadiaCore keeps the tab (and a regular profile): it says so, and nothing changes.
      out.unload = await raw("{ unload: true }");
      out.afterUnload = { renderer: await renderer(), ...(await flags()) };
      // A discard through the app's policy.
      out.slept = await evalApp(`return globalThis.acLifecycle.sleepTab("${tab.id}")`);
      out.afterSleep = { renderer: await until("the renderer gone", async () => ((await renderer()) ? null : "gone"), 5000).catch(() => "still there"), ...(await flags()) };
      // Again: already discarded.
      out.again = await raw();
      // A refusal (as Chrome's for a tab outside a tab strip), through the app's policy: nothing recorded.
      const other = await openTab(`${base}/e?refused`, "Page E", true);
      try {
        out.refusedSlept = await evalApp(`const h = ac.webviews.get("${other.id}"); h.discard = () => Promise.resolve("refused"); return globalThis.acLifecycle.sleepTab("${other.id}")`);
        out.refusedFlags = await evalApp(`return !!globalThis.acLifecycle.state().discarded["${other.id}"]`);
      } finally {
        await closeTab(other.id);
      }
      // Wake: shown, Chrome loads it again and the app's flag clears.
      await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
      out.woke = await until("awake", async () => {
        const f = await flags();
        return !f.sleeping && (await renderer()) ? { renderer: true, ...f } : null;
      }, 10000).catch(async () => ({ renderer: await renderer(), ...(await flags()) }));
      const problems = [];
      if (out.unload !== "unsupported" || !out.afterUnload.renderer || out.afterUnload.sleeping) problems.push(`unload: ${JSON.stringify([out.unload, out.afterUnload])}`);
      if (out.slept !== true || out.afterSleep.renderer !== "gone" || !out.afterSleep.sleeping) problems.push(`discard: ${JSON.stringify([out.slept, out.afterSleep])}`);
      if (out.again !== "already") problems.push(`again: ${JSON.stringify(out.again)}`);
      if (out.refusedSlept !== false || out.refusedFlags) problems.push(`refused: ${JSON.stringify([out.refusedSlept, out.refusedFlags])}`);
      if (out.woke.sleeping || !out.woke.renderer || !out.woke.loaded) problems.push(`wake: ${JSON.stringify(out.woke)}`);
      if (problems.length) throw new Error(problems.join("; "));
      return out;
    } finally {
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`).catch(() => null);
    }
  });

  await check("capture-picture", async () => {
    // The page as painted (capturePicture, the dragged tab's picture): a JPEG and the view's frame.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const picture = await evalApp(`return ac.webviews.get("${first.id}").capturePicture(0.3)`);
    if (!picture?.data || !Buffer.from(picture.data, "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])))
      throw new Error(`no JPEG: ${JSON.stringify(picture)?.slice(0, 120)}`);
    return { bytes: Buffer.from(picture.data, "base64").length, frame: picture.frame };
  });

  await check("unresponsive", async () => {
    // A page that stops answering: Chrome's hang monitor (onUnresponsive), the app's "wait" (resolveUnresponsive),
    // and the page answering again (onResponsive).
    const busy = await openTab(`${base}/b?busy`, "Page B");
    try {
      // No DevTools client on the page meanwhile: Chrome ignores a hang while a debugger is attached.
      await evalApp(`return ac.webviews.get("${busy.id}").focus()`);
      // The page says it's busy (its title) as the loop starts: a key sent before then (a loaded run delays the script)
      // was answered at once, and the loop that followed had no input to hang on.
      await evalApp(`return ac.webviews.get("${busy.id}").executeJavaScript("setTimeout(() => { document.title = 'Busy'; const end = Date.now() + 40000; while (Date.now() < end); }, 50)")`);
      await until("the page busy", async () => (await state()).tabs.find((t) => t.id === busy.id && t.title === "Busy"), 10000);
      await sleep(300);
      const s = await state();
      // Input the busy page can't answer: Chrome's hang monitor starts with it.
      const sent = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "a", keyCode: 0, modifiers: [], focus: "page" })`);
      const busyNow = "-";
      const hung = await until("onUnresponsive", async () => (await eventsOf(busy.id)).find((x) => x.name === "unresponsive"), 35000)
        .catch(async (e) => { throw new Error(`${e.message}; page ${busyNow}; key ${JSON.stringify(sent)}; events ${JSON.stringify((await eventsOf(busy.id)).map((x) => x.name).slice(-8))}; active ${(await state()).active === busy.id}`); });
      await evalApp(`return ac.webviews.get("${busy.id}").resolveUnresponsive(false)`);
      const back = await until("onResponsive", async () => (await eventsOf(busy.id)).find((x) => x.name === "responsive"), 45000)
        .catch(async (e) => { throw new Error(`${e.message}; events ${JSON.stringify((await eventsOf(busy.id)).map((x) => x.name).slice(-10))}`); });
      return { unresponsive: !!hung, responsive: !!back };
    } finally {
      await closeTab(busy.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("permission-dismissed", async () => {
    // A prompt Chrome drops on its own (its tab closes before the app answers): the app hears so
    // (onPermissionDismissed). A navigation doesn't show it: the app answers "dismiss" itself then.
    await evalApp(`globalThis.__nnDismissed = []; globalThis.__nnDismissSub?.remove(); globalThis.__nnDismissSub = globalThis.expo.modules.ArcadiaCEF.addListener("onPermissionDismissed", (e) => globalThis.__nnDismissed.push(e)); return true`);
    const asker = await openTab(`${base}/c?asker`, "Page C");
    try {
      const t = await pageFor(asker.id, `${base}/c?asker`);
      await cdp(t, "Runtime.evaluate", { expression: "navigator.requestMIDIAccess({ sysex: true }).catch(() => {}); true", userGesture: true });
      const request = await until("the prompt", async () => evalApp(`return ac.pageState.getState().pages["${asker.id}"]?.permission ?? null`), 10000);
      await closeTab(asker.id);
      const dismissed = await until("onPermissionDismissed", async () => {
        const list = await evalApp(`return globalThis.__nnDismissed`);
        return list.find((x) => x.id === request.id) ?? null;
      }, 10000).catch(async (e) => { throw new Error(`${e.message}; request ${request.id}; got ${JSON.stringify(await evalApp(`return globalThis.__nnDismissed`))}`); });
      return { request: request.id, dismissed };
    } finally {
      await evalApp(`globalThis.__nnDismissSub?.remove(); return true`);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("kill-task", async () => {
    // Chrome's task manager ends a tab's renderer (killTask): the tab shows its crash (onCrashed).
    const victim = await openTab(`${base}/c?kill`, "Page C", true);
    try {
      const browser = Number(await browserOf(victim.id));
      const task = await until("the tab's task", async () => {
        const tasks = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.listTasks()`);
        return tasks.find((x) => (x.browserIds ?? []).includes(browser)) ?? null;
      }, 10000);
      const killed = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.killTask(${task.id})`);
      const crashed = await until("onCrashed", async () => (await eventsOf(victim.id)).find((x) => x.name === "crashed"), 10000);
      return { task: task.title ?? task.id, killed, crashed: crashed.payload.reason };
    } finally {
      await closeTab(victim.id);
    }
  });

  await check("module-events", async () => {
    // Events with no WebView: the blocker's state (onContentBlocker), extensions changing (onChanged); and the
    // screen-share picker's sources (displayMediaSources: screens and windows, no macOS prompt).
    await evalApp(`globalThis.__nnEvents = []; globalThis.__nnSubs?.forEach((x) => x.remove());
      globalThis.__nnSubs = [globalThis.expo.modules.ArcadiaCEF.addListener("onContentBlocker", (e) => globalThis.__nnEvents.push(["blocker", e])),
        globalThis.expo.modules.ArcadiaExtensions.addListener("onChanged", (e) => globalThis.__nnEvents.push(["extensions", e]))]; return true`);
    try {
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setContentBlockerEnabled(false)`);
      await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setContentBlockerEnabled(true)`);
      const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
      const configured = await exts(`configure("${installed.id}", "", { incognito: true })`);
      if (configured?.error) throw new Error(`configure: ${configured.error}`);
      await exts(`uninstall("${installed.id}", "")`);
      const events = await until("both events", async () => {
        const list = await evalApp(`return globalThis.__nnEvents`);
        return list.some((x) => x[0] === "blocker") && list.filter((x) => x[0] === "extensions").length >= 2 ? list : null;
      }, 15000).catch(async (e) => { throw new Error(`${e.message}; got ${JSON.stringify(await evalApp(`return globalThis.__nnEvents`)).slice(0, 300)}`); });
      const sources = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.displayMediaSources()`);
      if (!sources.some((x) => x.kind === "screen")) throw new Error("no screen among the display media sources");
      return { blocker: events.filter((x) => x[0] === "blocker").length, extensions: events.filter((x) => x[0] === "extensions").map((x) => x[1].event), configured: true, sources: sources.length };
    } finally {
      await evalApp(`globalThis.__nnSubs?.forEach((x) => x.remove()); return true`);
    }
  });

  // A download opens the downloads popover, whose backdrop (a click outside closes it) covers the page: a check that
  // downloads closes it again, so a later one's mouse or scroll lands on the page.
  const closeDownloads = () => evalApp(`ac.store.getState().setDownloadsOpen(${JSON.stringify(mainWindow)}, false); return true`).catch(() => null);

  await check("save-page", async () => {
    // Chrome's Save Page As (runPageCommand "savePage"), its save panel answered from file-chooser.txt.
    const file = join(scratch, "saved-page.html");
    writeFileSync(join(data, "file-chooser.txt"), file + "\n");
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`return ac.webviews.get("${first.id}").runPageCommand("savePage")`);
    try {
      const saved = await until("the saved page", async () => existsSync(file) && readFileSync(file, "utf8").includes("Page A"), 15000);
      // The popover opens as the app hears of the download; closed before that, it would open over the page later.
      await until("the saved page in the app's downloads", () =>
        evalApp(`return ac.store.getState().downloads.some((d) => d.state === "finished" && (d.path ?? d.filename ?? "").endsWith("saved-page.html"))`), 10000);
      return { saved };
    } finally {
      await closeDownloads();
    }
  });

  await check("activate-request", async () => {
    // A page focusing the popup it opened (window.focus() on it) while the app shows the opener: Chrome asks the app
    // to bring the popup forward (onActivateRequest "page").
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    const t = await pageFor(first.id, `${base}/a`);
    const before = new Set((await state()).tabs.map((x) => x.id));
    await cdp(t, "Runtime.evaluate", { expression: `window.__popup = window.open("${base}/c?focus-me", "_blank"); true`, userGesture: true });
    const popup = await until("the popup", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.title === "Page C" && !x.loading), 10000);
    try {
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
      await until("A shown", async () => (await state()).active === first.id);
      await cdp(t, "Runtime.evaluate", { expression: "window.__popup.focus(); true", userGesture: true });
      const e = await until("onActivateRequest", async () => (await eventsOf(popup.id)).findLast((x) => x.name === "activateRequest"), 8000)
        .catch(async (err) => { throw new Error(`${err.message}; popup events ${JSON.stringify((await eventsOf(popup.id)).map((x) => x.name).slice(-8))}`); });
      return { reason: e.payload.reason };
    } finally {
      await closeTab(popup.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("private-release", async () => {
    // A private window's profile goes when its last window closes (releaseProfile): a new private window starts
    // without the old one's cookies.
    const a = await evalApp(`return ac.actions.openWindow({ incognito: true, url: "${base}/cookie?private1" })`);
    await until("the private cookie set", async () => {
      const tabs = await evalApp(`const s = ac.store.getState(); return (s.windows["${a}"]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
      return tabs.includes("Cookie") ? true : null;
    }, 10000);
    await sleep(500);
    await evalApp(`ac.store.getState().closeWindow("${a}"); return true`);
    await sleep(2000);
    const b = await evalApp(`return ac.actions.openWindow({ incognito: true, url: "${base}/b?private2" })`);
    try {
      await until("the second private window's page", async () => {
        const tabs = await evalApp(`const s = ac.store.getState(); return (s.windows["${b}"]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
        return tabs.includes("Page B") ? true : null;
      }, 10000);
      const pt = await pageTarget(`${base}/b?private2`);
      const cookie = (await cdp(pt, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
      if (cookie.includes("private1")) throw new Error(`the first private window's cookie survived: ${cookie}`);
      return { cookie: cookie || "(none)" };
    } finally {
      await evalApp(`ac.store.getState().closeWindow("${b}"); return true`);
    }
  });

  await check("private-churn", async () => {
    // ⌘W on the last private window and ⇧⌘N in the same turn, 50 times: each new window gets a live tab, though the
    // old window's profile is still going when it asks (the engine hands out a new one once the old one is gone), and
    // the tab stays (it never lands in the dying profile, which would close it). Every other round waits out
    // Chrome's destruction (≤ 1 s) before checking the tab is still there.
    const titles = (w) => evalApp(`const s = ac.store.getState(); return (s.windows[${JSON.stringify(w)}]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
    let last = await evalApp(`return ac.actions.openWindow({ incognito: true, url: "${base}/e?churn-start" })`);
    const waits = [];
    try {
      await until("the first private page", async () => ((await titles(last)).includes("Page E") ? true : null), 15000);
      for (let round = 0; round < 50; round++) {
        const started = Date.now();
        const next = await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(last)}); return ac.actions.openWindow({ incognito: true, url: "${base}/e?churn${round}" })`);
        last = next;
        await until(`round ${round}: a live tab`, async () => ((await titles(next)).includes("Page E") ? true : null), 15000);
        waits.push(Date.now() - started);
        if (round % 2) {
          await sleep(1200);
          const after = await titles(next);
          if (!after.includes("Page E")) throw new Error(`round ${round}: the tab went: ${JSON.stringify(after)}`);
        }
      }
      // Then 10 windows each closed as soon as it's made, before its profile or tab could come: the last one still
      // gets a live tab, and keeps it.
      for (let round = 0; round < 10; round++)
        last = await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(last)}); return ac.actions.openWindow({ incognito: true, url: "${base}/e?burst${round}" })`);
      await until("the burst's last window: a live tab", async () => ((await titles(last)).includes("Page E") ? true : null), 15000);
      await sleep(1500);
      if (!(await titles(last)).includes("Page E")) throw new Error(`the burst's last tab went: ${JSON.stringify(await titles(last))}`);
      if (exited) throw new Error("the app exited");
      return { rounds: 50, burst: 10, slowestMs: Math.max(...waits), medianMs: waits.sort((a, b) => a - b)[25] };
    } finally {
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(last)}); return true`).catch(() => null);
    }
  });

  // MARK: Chrome services and extensions

  await check("extension-popup-and-panel", async () => {
    // The extension's action (executeExtensionAction) opens its popup, and its side panel opens beside the page:
    // both are standalone WebViews, whose tabs stay out of the window's tab strip and close with them.
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const windowsBefore = (await cef(`chromeWindows()`)).length;
    try {
      await evalApp(`return ac.extensions.refreshExtensions("").then(() => true)`);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
      await evalApp(`const lists = ac.extensions.useExtensions.getState().lists; const ext = Object.values(lists).flat().find((x) => x.id === "${installed.id}");
        return ac.extensions.activateExtension(${JSON.stringify(mainWindow)}, ext, { x: 100, y: 40, width: 20, height: 20 }).then(() => !!ac.extensions.useExtensions.getState().popup)`);
      const popupTarget = await until("the popup page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/popup.html`)), 10000);
      const strips = await cef(`tabStrips()`);
      const inStrip = strips.strips.some((st) => st.tabs.some((x) => x.key == null));
      const popupVisible = (await cdp(popupTarget, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value;
      // The popup sizes itself as Chrome's (its page's auto-resize): it follows the page down as well as up (it only
      // grew while the app measured the page).
      const pageSize = async (t) => (await cdp(t, "Runtime.evaluate", { expression: "[innerWidth, innerHeight]", returnByValue: true })).result.value;
      const grown = await until("the popup sized to its page", async () => { const s = await pageSize(popupTarget); return s[0] > 100 ? s : null; }, 5000);
      await cdp(popupTarget, "Runtime.evaluate", { expression: "document.body.style.height = '30px'" });
      const shrunk = await until("the popup shrunk with its page", async () => { const s = await pageSize(popupTarget); return s[1] < grown[1] ? s : null; }, 5000)
        .catch(async () => { throw new Error(`the popup kept its size: ${JSON.stringify(grown)} → ${JSON.stringify(await pageSize(popupTarget))}`); });
      // chrome.action.openPopup() from its worker opens it afresh over the active tab, as 1Password does once its Mac
      // app unlocks (it failed with "Browser window has no toolbar" before).
      await cdp(popupTarget, "Runtime.evaluate", { expression: "window.__nnOld = 1" });
      const worker = await until("the extension's worker", async () =>
        (await targets()).find((t) => t.type === "service_worker" && t.url.includes(`${installed.id}/worker.js`)) ?? null, 10000);
      const opened = (await cdp(worker, "Runtime.evaluate", { expression: "chrome.action.openPopup().then(() => 'ok', (e) => e.message)", awaitPromise: true, returnByValue: true })).result.value;
      if (opened !== "ok") throw new Error(`chrome.action.openPopup(): ${opened}`);
      await until("the popup reopened", async () => {
        const t = (await targets()).find((x) => x.type === "page" && x.url.includes(`${installed.id}/popup.html`));
        return t && (await cdp(t, "Runtime.evaluate", { expression: "window.__nnOld === undefined", returnByValue: true })).result.value ? t : null;
      }, 8000);
      await evalApp(`ac.extensions.closeExtensionPopup(); return true`);
      await until("the popup gone", async () => !(await targets()).some((t) => t.url.includes(`${installed.id}/popup.html`)), 8000);
      await evalApp(`return ac.extensions.openSidePanel(${JSON.stringify(mainWindow)}, "${installed.id}").then(() => !!ac.extensions.useExtensions.getState().sidePanels[${JSON.stringify(mainWindow)}])`);
      const panelTarget = await until("the side panel page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/panel.html`)), 10000);
      const panelVisible = (await cdp(panelTarget, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value;
      const stripsWithPanel = await cef(`tabStrips()`);
      const panelInStrip = stripsWithPanel.strips.some((st) => st.tabs.length !== strips.strips.find((x) => x.strip === st.strip)?.tabs.length);
      await evalApp(`ac.extensions.closeSidePanel(${JSON.stringify(mainWindow)}); return true`);
      await until("the panel gone", async () => !(await targets()).some((t) => t.url.includes(`${installed.id}/panel.html`)), 8000);
      const windowsAfter = await until("the standalone window closed", async () => {
        const n = (await cef(`chromeWindows()`)).length;
        return n <= windowsBefore ? n : null;
      }, 8000).catch(async () => (await cef(`chromeWindows()`)).length);
      if (inStrip || panelInStrip) throw new Error("a standalone WebView's tab is in the window's strip");
      if (popupVisible !== "visible" || panelVisible !== "visible") throw new Error(`popup ${popupVisible}, panel ${panelVisible}`);
      return { popup: popupVisible, panel: panelVisible, popupSize: `${grown.join("x")} → ${shrunk.join("x")}`, openPopup: opened, windowsBefore, windowsAfter };
    } finally {
      await evalApp(`ac.extensions.closeExtensionPopup(); ac.extensions.closeSidePanel(${JSON.stringify(mainWindow)}); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`);
    }
  });

  await check("scroll-zoom", async () => {
    // ⌘-scroll zooms the page with a wheel or a Magic Mouse and scrolls it with a trackpad (devScrollZoom, as
    // packages/cef's zoom-scroll-test).
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const zoom = () => evalApp(`return ac.store.getState().tabs["${first.id}"]?.zoom ?? 1`);
    const reset = async () => {
      await evalApp(`return ac.webviews.get("${first.id}").zoomStep(0)`);
      await until("zoom 100%", async () => ((await zoom()) === 1 ? true : null), 5000);
    };
    const browser = await browserOf(first.id);
    const scroll = (steps) => evalApp(`return globalThis.expo.modules.ArcadiaCEF.devScrollZoom(${JSON.stringify(steps)}, ${browser})`);
    const gesture = (trackpad) => [
      { phase: "mayBegin", dy: 0, trackpad }, { phase: "began", dy: 12, trackpad },
      ...Array.from({ length: 4 }, () => ({ phase: "changed", dy: 40, trackpad })),
      { phase: "ended", dy: 0, trackpad }, ...Array.from({ length: 3 }, () => ({ phase: "momentum", dy: 30 })),
    ];
    await reset();
    const trackpad = await scroll(gesture(true));
    await sleep(800);
    const afterTrackpad = await zoom();
    const wheel = await scroll([{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }]);
    const afterWheel = await until("zoomed", async () => { const z = await zoom(); return z > 1 ? z : null; }, 5000)
      .catch(async (e) => {
        // Why (devScrollZoom logs each ⌘-wheel step that didn't zoom), and the app's UI that can cover the page.
        const why = appLog.join().split("\n").filter((l) => l.includes("[scroll-zoom]")).slice(-3).map((l) => l.replace(/^.*\[scroll-zoom\] /, ""));
        const ui = await evalApp(`return ac.store.getState().windowUi[${JSON.stringify(mainWindow)}] ?? null`).catch(() => null);
        throw new Error(`${e.message}; trackpad ${JSON.stringify(trackpad)} wheel ${JSON.stringify(wheel)} zoom ${await zoom()} why ${JSON.stringify(why)} ui ${JSON.stringify(ui)} events ${JSON.stringify((await eventsOf(first.id)).filter((x) => x.name === "zoom").slice(-2))}`);
      });
    await reset();
    if (trackpad.some(Boolean) || afterTrackpad !== 1) throw new Error(`a trackpad ⌘-scroll zoomed: ${JSON.stringify(trackpad)} → ${afterTrackpad}`);
    if (!wheel.some(Boolean)) throw new Error(`the wheel didn't zoom: ${JSON.stringify(wheel)}`);
    return { trackpad, wheel, afterWheel };
  });

  await check("print-preview", async () => {
    // Print (WebViewHandle.print): Chrome's print preview for the page; closed again.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`return ac.webviews.get("${first.id}").print()`);
    const preview = await until("the print preview", async () => (await targets()).find((t) => t.url.startsWith("chrome://print")), 15000);
    // Chrome closes a print preview when its page navigates.
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a?after-print", { userInitiated: true }); return true`);
    await until("the preview closed", async () => !(await targets()).some((t) => t.url.startsWith("chrome://print")), 10000);
    await backToA();
    return { preview: preview.url };
  });

  await check("extension-prompts", async () => {
    // An extension asking for an optional permission: Chrome's install prompt goes to the app's dialog
    // (onInstallPrompt), and the app's answer grants it (resolveInstallPrompt). Its action opening its side panel
    // (chrome.sidePanel.open from the action's click): the app shows the panel (onSidePanel).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    try {
      await evalApp(`return ac.extensions.refreshExtensions("").then(() => true)`);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
      const activate = () => evalApp(`const lists = ac.extensions.useExtensions.getState().lists; const ext = Object.values(lists).flat().find((x) => x.id === "${installed.id}");
        return ac.extensions.activateExtension(${JSON.stringify(mainWindow)}, ext, { x: 100, y: 40, width: 20, height: 20 }).then(() => true)`);
      await activate();
      const popup = await until("the popup page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/popup.html`)), 10000);
      // Not granted yet (an earlier install of the same extension may have it): Chrome asks again.
      await cdp(popup, "Runtime.evaluate", { expression: "chrome.permissions.remove({ permissions: ['bookmarks'] }).then(() => true)", awaitPromise: true });
      await cdp(popup, "Runtime.evaluate", { expression: "window.__perm = 'pending'; chrome.permissions.request({ permissions: ['bookmarks'] }).then((g) => (window.__perm = String(g)), (e) => (window.__perm = String(e))); true", userGesture: true });
      const request = await until("the app's install dialog", async () => evalApp(`return ac.extensions.useExtensions.getState().install ?? null`), 10000);
      const requestId = request.requestId ?? request.prompt?.requestId ?? request.request?.requestId;
      await exts(`resolveInstallPrompt(${JSON.stringify(requestId)}, true)`);
      const granted = await until("the page's answer", async () => {
        const v = (await cdp(popup, "Runtime.evaluate", { expression: "window.__perm", returnByValue: true })).result.value;
        return v !== "pending" ? v : null;
      }, 10000);
      if (granted !== "true") throw new Error(`permissions.request answered ${granted}`);
      await evalApp(`ac.extensions.closeExtensionPopup(); return true`);
      // The action's click opens the side panel instead of a popup.
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.sidePanel?.open", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      await cdp(worker, "Runtime.evaluate", { expression: "chrome.action.setPopup({ popup: '' }); chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id })); true" });
      await sleep(300);
      await activate();
      const panel = await until("the side panel", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/panel.html`)), 10000);
      const shown = await evalApp(`return !!ac.extensions.useExtensions.getState().sidePanels[${JSON.stringify(mainWindow)}]`);
      return { prompt: request.type ?? request.prompt?.type ?? Object.keys(request), granted, panel: !!panel, shown };
    } finally {
      await evalApp(`ac.extensions.closeExtensionPopup(); ac.extensions.closeSidePanel(${JSON.stringify(mainWindow)}); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`);
    }
  });

  await check("crash", async () => {
    // A renderer crash reaches the app (onCrashed → the sad tab), and the app keeps running.
    await evalApp(`ac.actions.openUrls(["${base}/crash-me"], ${JSON.stringify(mainWindow)}); return true`);
    // Its page committed and loaded (its title), not only the tab's URL: on a fresh instance the first navigation is
    // slow, and Page.crash then took the initial empty document's renderer, which the navigation replaced.
    const tab = await until("the tab to crash", async () => (await state()).tabs.find((x) => x.url?.includes("crash-me") && x.title === "/crash-me" && x.loading === false));
    const t = await pageTarget("crash-me");
    // Page.crash never answers (the page is gone): not waited for.
    cdp(t, "Page.crash").catch(() => null);
    const crashed = await until("onCrashed", async () => evalApp(`return ac.pageState.getState().pages["${tab.id}"]?.crashed ?? null`), 10000);
    return { crashed };
  });

  await check("traffic-lights-after-profile-switch", async () => {
    const s = await state();
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindowNumber(${browser})`);
    const lights = () => evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindow(${windowNumber}, "lights")`);
    const before = await lights();
    const id = await evalApp(`return ac.store.getState().createProfile({ name: "Lights" })`);
    await evalApp(`ac.actions.switchProfile("${s.windowId}", "${id}"); return true`);
    await until("profile shown", async () => (await state()).profileId === id);
    await sleep(500);
    const during = await lights();
    await evalApp(`ac.actions.switchProfile("${s.windowId}", "${s.profileId}"); return true`);
    await until("profile back", async () => (await state()).profileId === s.profileId);
    await sleep(500);
    const after = await lights();
    if (during !== before || after !== before) throw new Error(`lights moved: ${before} → ${during} → ${after}`);
    return { lights: before };
  });


  await check("passwords", async () => {
    // Chrome's password store through //chrome/browser/arcadia (ac_passwords_*).
    const origin = "https://example.test";
    const saved = await cef(`savePassword("", "${origin}", "nnuser", "s3cret")`);
    if (saved?.error) throw new Error(saved.error);
    const list = await until("the saved login", async () => {
      const r = await cef(`listPasswords("")`);
      return r.passwords?.find((p) => p.username === "nnuser") ? r : null;
    });
    const revealed = await cef(`getPassword("", "${origin}", "nnuser")`);
    await cef(`deletePassword("", "${origin}", "nnuser")`);
    const after = await cef(`listPasswords("")`);
    if (after.passwords?.some((p) => p.username === "nnuser")) throw new Error("not deleted");
    const autofill = await cef(`getPasswordAutofill("")`);
    await cef(`setPasswordAutofill("", false)`);
    const off = await cef(`getPasswordAutofill("")`);
    await cef(`setPasswordAutofill("", true)`);
    return { listed: list.passwords.length, revealed: revealed?.password ?? revealed, autofill, off };
  });

  await check("autofill", async () => {
    const saved = await cef(`saveAddress("", { fullName: "The mascot", city: "Tel Aviv", country: "IL" })`);
    if (saved?.error) throw new Error(saved.error);
    const list = await until("the address", async () => {
      const r = await cef(`listAddresses("")`);
      return r.addresses?.length ? r : null;
    });
    const id = list.addresses[0].id;
    await cef(`deleteAutofillEntry("", "${id}")`);
    const settings = await cef(`getAutofillSettings("")`);
    return { addresses: list.addresses.length, first: list.addresses[0].fullName ?? list.addresses[0].name, settings };
  });

  await check("zoom-levels", async () => {
    await cef(`setZoom("", "zoom.test", 1.5)`);
    const levels = await until("the zoom level", async () => {
      const l = await cef(`getZoomLevels("")`);
      return l["zoom.test"] ? l : null;
    });
    await cef(`setZoom("", "zoom.test", 1)`);
    return { levels };
  });

  await check("extensions", async () => {
    const inspected = await exts(`inspectUnpacked(${JSON.stringify(extPath)})`);
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const list = await until("the extension listed", async () => {
      const r = await exts(`list("")`);
      return r.extensions?.find((e) => e.id === installed.id) ? r : null;
    });
    await exts(`setEnabled("${installed.id}", "", false)`);
    await exts(`uninstall("${installed.id}", "")`);
    const engines = await exts(`searchEngineList("")`);
    return { id: installed.id, name: inspected.name, listed: list.extensions.length, engines: !!engines.list };
  });

  await check("extension-configure", async () => {
    // What the app's Extensions settings pass to configure (pinned, incognito, siteAccess; fileAccess as CEF's API
    // takes it) lands in Chrome: list reads each back, onChanged says "configured", and site access "on click"
    // stops the extension's content script on a fresh page until "on all sites" lets it run again.
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const id = installed.id;
    const info = async () => (await exts(`list("")`)).extensions?.find((e) => e.id === id) ?? null;
    const configure = async (options) => {
      const r = await exts(`configure("${id}", "", ${JSON.stringify(options)})`);
      if (r?.error) throw new Error(`configure ${JSON.stringify(options)}: ${r.error}`);
    };
    // The content script's mark on a freshly loaded page (it runs at document_idle), or null after a grace period.
    const scriptRan = async (tag) => {
      const tab = await openTab(`${base}/e?cfg-${tag}`, "Page E");
      try {
        const t = await pageFor(tab.id, `/e?cfg-${tag}`);
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "document.documentElement.dataset.nnext ?? null", returnByValue: true });
          if (r.result.value) return r.result.value;
          await sleep(200);
        }
        return null;
      } finally {
        await closeTab(tab.id);
      }
    };
    await evalApp(`globalThis.__nnCfg = []; globalThis.__nnCfgSub?.remove();
      globalThis.__nnCfgSub = globalThis.expo.modules.ArcadiaExtensions.addListener("onChanged", (e) => globalThis.__nnCfg.push(e)); return true`);
    try {
      const before = await until("the extension listed", info);
      if (!before.siteAccess) throw new Error("the fixture has no site access to change");
      if (!(await scriptRan("before"))) throw new Error("the content script didn't run before any change");
      const set = { pinned: !before.pinned, incognito: !before.incognito, fileAccess: !before.fileAccess };
      for (const [key, value] of Object.entries(set)) {
        await configure({ [key]: value });
        await until(`${key} = ${value}`, async () => (await info())?.[key] === value);
      }
      await configure({ siteAccess: "onClick" });
      const onClick = await until("site access on click", async () => {
        const e = await info();
        return e?.siteAccess === "ON_CLICK" ? e : null;
      });
      const ranOnClick = await scriptRan("onclick");
      if (ranOnClick) throw new Error(`the content script ran with site access on click (${ranOnClick})`);
      await configure({ siteAccess: "allSites" });
      const allSites = await until("site access on all sites", async () => {
        const e = await info();
        return e?.siteAccess === "ON_ALL_SITES" ? e : null;
      });
      const ranAgain = await scriptRan("allsites");
      if (!ranAgain) throw new Error("the content script didn't run again on all sites");
      const configured = await until("onChanged configured", async () => {
        const list = await evalApp(`return globalThis.__nnCfg`);
        const mine = list.filter((x) => x.event === "configured" && x.id === id);
        return mine.length >= 5 ? mine : null;
      }, 10000).catch(async (e) => { throw new Error(`${e.message}; got ${JSON.stringify(await evalApp(`return globalThis.__nnCfg`)).slice(0, 300)}`); });
      // Back as it was (pinning and incognito are profile prefs that would outlive an uninstall-free run).
      await configure({ pinned: before.pinned, incognito: before.incognito, fileAccess: before.fileAccess });
      return {
        set,
        siteAccess: [before.siteAccess, onClick.siteAccess, allSites.siteAccess],
        contentScript: { onClick: ranOnClick, allSites: ranAgain },
        configuredEvents: configured.length,
      };
    } finally {
      await evalApp(`globalThis.__nnCfgSub?.remove(); return true`).catch(() => null);
      await exts(`uninstall("${id}", "")`).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`).catch(() => null);
    }
  });

  await check("chrome-windows-create", async () => {
    // A window an extension makes (chrome.windows.create): its tab lands in the app's window, live (tab:<id>).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    // The installed copy's worker (an earlier install's target can linger, without the chrome API).
    const worker = await until("the extension's worker", async () => {
      for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
        const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.windows?.create", returnByValue: true }).catch(() => null);
        if (r?.result?.value === "function") return t;
      }
      return null;
    }, 15000);
    const made = await cdp(worker, "Runtime.evaluate", {
      expression: `chrome.windows.create({ url: "${base}/e?window" }).then((w) => JSON.stringify({ id: w.id, tabs: w.tabs?.length }))`,
      awaitPromise: true,
      returnByValue: true,
    });
    log("  chrome.windows.create:", JSON.stringify(made.result?.value ?? made.exceptionDetails?.exception?.description ?? made));
    const tab = await until("the window's tab in the app", async () => {
      const tabs = await evalApp(`const s = ac.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, adoptId: t.adoptId, windowId: t.windowId }))`);
      return tabs.find((t) => t.url?.includes("e?window")) ?? null;
    }, 15000);
    await exts(`uninstall("${installed.id}", "")`);
    return { tab: tab.id, adoptId: tab.adoptId ?? null, window: tab.windowId };
  });

  await check("private-windows-create", async () => {
    // A private window an extension makes (chrome.windows.create({incognito: true}), allowed in private windows): its
    // tab lands in a private window of the app, live, never in a normal window. With one open, it goes there.
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    await exts(`configure("${installed.id}", "", { incognito: true })`);
    const privateTabs = () => evalApp(`const s = ac.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, title: t.title, windowId: t.windowId, incognito: !!s.windows[t.windowId]?.incognito, adoptId: t.adoptId }))`);
    const opened = [];
    try {
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.windows?.create", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      const create = async (tag) => {
        const made = await cdp(worker, "Runtime.evaluate", {
          expression: `chrome.windows.create({ url: "${base}/cookie?${tag}", incognito: true }).then((w) => JSON.stringify({ incognito: w.incognito }), (e) => "error: " + e.message)`,
          awaitPromise: true,
          returnByValue: true,
        });
        const tab = await until(`the ${tag} tab in the app`, async () => (await privateTabs()).find((t) => t.url?.includes(`cookie?${tag}`) && t.title === "Cookie") ?? null, 15000)
          .catch((e) => { throw new Error(`${e.message}; windows.create: ${made.result?.value ?? JSON.stringify(made.exceptionDetails ?? made)}`); });
        opened.push(tab.windowId);
        return { tab, created: made.result?.value };
      };
      // Personal's cookie, which a private page must not see.
      await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/cookie?personal", { userInitiated: true }); return true`);
      await until("Personal's cookie", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Cookie" && !t.loading));
      const lone = await create("private-ext1");
      if (!lone.tab.incognito) throw new Error(`the private tab landed in a normal window: ${JSON.stringify(lone)}`);
      const cookie = (await cdp(await pageTarget("cookie?private-ext1"), "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
      if (cookie.includes("personal")) throw new Error(`the private page sees Personal's cookie: ${cookie}`);
      const second = await create("private-ext2");
      if (!second.tab.incognito || second.tab.windowId !== lone.tab.windowId) throw new Error(`the second private tab: ${JSON.stringify(second)} (first in ${lone.tab.windowId})`);
      return { first: { window: lone.tab.windowId, adoptId: lone.tab.adoptId ?? null, cookie: cookie || "(none)" }, second: { sameWindow: true } };
    } finally {
      for (const w of new Set(opened)) await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(w)}); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
      await backToA().catch(() => null);
    }
  });

  // The popup fixture installed for one check, and gone after it.
  const withPopupExtension = async (options, fn) => {
    writePopupExtension(options);
    const installed = await exts(`install(${JSON.stringify(extPopupPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    try {
      await evalApp(`return ac.extensions.refreshExtensions("").then(() => true)`);
      return await fn(installed.id);
    } finally {
      await evalApp(`ac.extensions.closeExtensionPopup(); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
    }
  };
  // The Chrome window id of the run's window for Personal (tabStrips' strip).
  const mainStrip = async () => (await cef(`tabStrips()`)).strips.find((st) => st.appWindow === mainWindow && st.profile === "");

  await check("extension-popup-window", async () => {
    // B9: an action's popup is Chrome's own extension view, bound to the window it was clicked in, as Chrome's popup:
    // its current window is that window and its active tab the page under it (not a hidden window and the popup
    // itself, which made Dark Reader call every page "protected by browser"). It is in no tab strip and makes no
    // window. Esc in it closes it (Chrome's close reaches the app), as in Chrome.
    return withPopupExtension({}, async (id) => {
      const tab = await freshTab(`${base}/b?under-popup`);
      try {
        const windowsBefore = (await cef(`chromeWindows()`)).length;
        const opened = await evalApp(`const ext = Object.values(ac.extensions.useExtensions.getState().lists).flat().find((x) => x.id === "${id}");
          return ac.extensions.activateExtension(${JSON.stringify(mainWindow)}, ext, { x: 100, y: 40, width: 20, height: 20 }).then(() => !!ac.extensions.useExtensions.getState().popup)`);
        if (!opened) throw new Error("no popup in the app");
        const popup = await until("the popup page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${id}/popup.html`)), 10000);
        const seen = JSON.parse((await cdp(popup, "Runtime.evaluate", {
          expression: `Promise.all([chrome.windows.getCurrent(), chrome.tabs.query({ active: true, currentWindow: true }), chrome.extension.getViews({ type: "popup" }).length])
            .then(([w, tabs, popups]) => JSON.stringify({ window: w.id, tabs: tabs.map((t) => t.url), popups }))`,
          awaitPromise: true,
          returnByValue: true,
        })).result.value);
        const strip = await mainStrip();
        if (seen.window !== strip?.strip) throw new Error(`the popup's current window is ${seen.window}, the app's is ${strip?.strip}`);
        if (seen.tabs.length !== 1 || seen.tabs[0] !== `${base}/b?under-popup`) throw new Error(`the popup's active tab: ${JSON.stringify(seen.tabs)}`);
        if (seen.popups !== 1) throw new Error(`chrome.extension.getViews({ type: "popup" }): ${seen.popups}`);
        const strips = await cef(`tabStrips()`);
        if (strips.strips.some((st) => st.tabs.some((x) => x.key == null))) throw new Error("the popup is a tab in a strip");
        const windowsWith = (await cef(`chromeWindows()`)).length;
        if (windowsWith !== windowsBefore) throw new Error(`windows ${windowsBefore} → ${windowsWith} with the popup open`);
        // The popup may go before DevTools acknowledges the key.
        for (const type of ["rawKeyDown", "keyUp"])
          await cdp(popup, "Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53 }).catch(() => null);
        await until("Esc closing the popup", async () => (await evalApp(`return ac.extensions.useExtensions.getState().popup === null`)) ? true : null, 8000);
        await until("the popup page gone", async () => !(await targets()).some((t) => t.url.includes(`${id}/popup.html`)), 8000);
        return { window: seen.window, activeTab: seen.tabs[0], popups: seen.popups, windows: windowsWith };
      } finally {
        await closeTab(tab).catch(() => null);
      }
    });
  });

  await check("extension-windows-hidden", async () => {
    // B10/B11: Chrome never picks one of the host's hidden windows (the content blocker's page, a standalone view's) for
    // an extension: chrome.windows lists only the app's windows; the tab an extension opens when installed (as Dark
    // Reader opens its help page) and its options page (chrome.runtime.openOptionsPage shows Chrome's last tabbed window,
    // as the "added" bubble does) land in the app's window; no window the app didn't show comes on screen.
    const appWindows = async () => (await cef(`chromeWindows()`)).map((w) => w.window);
    const before = new Set([...onScreenWindows(), ...(await appWindows())]);
    return withPopupExtension({ welcome: true }, async (id) => {
      const opened = [];
      try {
        const welcome = await until("the extension's install tab in the app", async () => {
          const tabs = await evalApp(`const s = ac.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, windowId: t.windowId }))`);
          return tabs.find((t) => t.url?.includes("e?installed")) ?? null;
        }, 15000);
        opened.push(welcome.id);
        if (welcome.windowId !== mainWindow) throw new Error(`the install tab is in ${welcome.windowId}, not the run's window`);
        const worker = await until("the extension's worker", async () => {
          for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(id))) {
            const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.windows?.getAll", returnByValue: true }).catch(() => null);
            if (r?.result?.value === "function") return t;
          }
          return null;
        }, 15000);
        const listed = JSON.parse((await cdp(worker, "Runtime.evaluate", { expression: "chrome.windows.getAll().then((ws) => JSON.stringify(ws.map((w) => w.id)))", awaitPromise: true, returnByValue: true })).result.value);
        const strips = new Set((await cef(`tabStrips()`)).strips.map((st) => st.strip));
        const hidden = listed.filter((w) => !strips.has(w));
        if (hidden.length) throw new Error(`chrome.windows.getAll lists windows the app doesn't show: ${JSON.stringify(hidden)} (app's: ${JSON.stringify([...strips])})`);
        await cdp(worker, "Runtime.evaluate", { expression: "chrome.runtime.openOptionsPage().then(() => true)", awaitPromise: true });
        const options = await until("the options page in the app", async () => {
          const tabs = await evalApp(`const s = ac.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, windowId: t.windowId }))`);
          return tabs.find((t) => t.url?.includes(`${id}/options.html`)) ?? null;
        }, 15000);
        opened.push(options.id);
        if (options.windowId !== mainWindow) throw new Error(`the options page is in ${options.windowId}, not the run's window`);
        await sleep(1000);
        const app = new Set(await appWindows());
        const stray = onScreenWindows().filter((w) => !before.has(w) && !app.has(w));
        if (stray.length) throw new Error(`windows on screen the app didn't show: ${JSON.stringify(stray)}`);
        return { listed, installTab: welcome.url, options: options.url };
      } finally {
        for (const tab of opened) await closeTab(tab).catch(() => null);
      }
    });
  });

  await check("content-blocked-count", async () => {
    // B8: the blocked count counts what extensions' rules stopped, as Chrome's action count does: a blocked image and a
    // script sent to the extension's stand-in (uBlock Origin Lite answers most ad scripts so), each once.
    return withPopupExtension({}, async () => {
      const tab = await freshTab(`${base}/ac-ads`);
      try {
        const target = await until("the page", () => pageTarget("/ac-ads"));
        const standIn = (await cdp(target, "Runtime.evaluate", { expression: "window.__nnStandIn === true", returnByValue: true })).result.value;
        if (!standIn) throw new Error("the script wasn't sent to the stand-in");
        const blocked = await until("the count", async () => {
          const n = await evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tab)}]?.blocked ?? 0`);
          return n >= 2 ? n : null;
        }, 8000).catch(async () => evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tab)}]?.blocked ?? 0`));
        await sleep(500);
        const settled = await evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tab)}]?.blocked ?? 0`);
        if (settled !== 2) throw new Error(`blocked ${settled} (then ${blocked}), not 2 (the image and the redirected script)`);
        return { blocked: settled, standIn };
      } finally {
        await closeTab(tab).catch(() => null);
      }
    });
  });

  await check("extension-download-hidden", async () => {
    // B12: a Web Store install's .crx (Chrome downloads it, installs it and deletes it) is never one of the user's
    // downloads, and doesn't open the downloads popover. The run's Web Store update URL serves one; it has no Web Store
    // proof, so Chrome stops at checking the package, after the download.
    const listed = () => evalApp(`return ac.store.getState().downloads.map((d) => d.url ?? "")`);
    const open = () => evalApp(`return !!ac.store.getState().windowUi[${JSON.stringify(mainWindow)}]?.downloadsOpen`);
    const wasOpen = await open();
    const tab = await freshTab(`${base}/b?crx`);
    try {
      const target = await until("the page", () => pageTarget("/b?crx"));
      const url = `${base}/webstore/crx?ac=${Date.now()}`;
      await cdp(target, "Runtime.evaluate", { expression: `(() => { const a = document.createElement("a"); a.href = "${url}"; document.body.append(a); a.click(); return true; })()`, userGesture: true });
      // Chrome made it a download (the page stays: onDownloadNavigation).
      await until("the .crx becoming a download", async () => (await eventsOf(tab)).some((x) => x.name === "downloadNavigation" && JSON.stringify(x.payload).includes("/webstore/crx")), 10000);
      const seen = [];
      for (let i = 0; i < 10; i++) {
        seen.push(...(await listed()));
        await sleep(300);
      }
      if (seen.some((u) => u.includes("/webstore/crx"))) throw new Error(`the .crx is one of the user's downloads: ${JSON.stringify([...new Set(seen)])}`);
      if (!wasOpen && (await open())) throw new Error("the downloads popover opened");
      return { downloads: new Set(seen).size };
    } finally {
      await closeTab(tab).catch(() => null);
    }
  });

  await check("extension-installed-bubble", async () => {
    // The "<name> has been added" bubble after an install with Chrome's UI (a .crx, as one dropped on
    // chrome://extensions): over the window the app shows for the profile; with none on screen (its windows closed
    // mid-install), held until one shows a page, never put in a hidden window. Chrome's own path added a tab to a
    // Browser without one (the app's New Tab page is its own) and then read that Browser's active tab after the app
    // had closed it: a crash. The bubble closes with its window.
    const crxPath = join(scratch, "fixture.crx");
    writeFileSync(crxPath, fixtureCrx());
    const profile = await evalApp(`return ac.store.getState().createProfile({ name: "Installs" })`);
    const opened = [];
    const bubbleIn = async (windowId) => {
      for (const w of await cef(`chromeWindows()`)) {
        const children = JSON.parse(await cef(`devWindow(${w.window}, "children")`));
        if (children.some((c) => /has been added/.test(c.title))) return w.window;
      }
      return null;
    };
    const profileWindow = async (path) => {
      const before = new Set((await cef(`chromeWindows()`)).map((w) => w.window));
      const id = await evalApp(`return ac.actions.openWindow({ profileId: ${JSON.stringify(profile)}, url: "${base}${path}" })`);
      opened.push(id);
      await until(`${path} shown`, () => pageTarget(path));
      const native = await until("its window", async () => (await cef(`chromeWindows()`)).find((w) => !before.has(w.window))?.window ?? null);
      return { id, native };
    };
    const install = async (closeFirst) => {
      await evalApp(`ac.extensions.cancelInstall(); globalThis.__nnCrx = null;
        globalThis.expo.modules.ArcadiaExtensions.installCrx(${JSON.stringify(crxPath)}, ${JSON.stringify(profile)}).then((r) => (globalThis.__nnCrx = r)); return true`);
      const prompt = await until("the install prompt", async () => {
        const p = await evalApp(`return ac.extensions.useExtensions.getState().install?.prompt ?? null`);
        return p?.name === "ArcadiaCore crx fixture" ? p : null;
      }, 15000);
      if (closeFirst) await closeFirst();
      await exts(`resolveInstallPrompt(${JSON.stringify(prompt.requestId)}, true)`);
      const result = await until("the install", () => evalApp(`return globalThis.__nnCrx`), 15000);
      if (!result.id) throw new Error(`install: ${JSON.stringify(result)}`);
      return result.id;
    };
    let id = null;
    try {
      // A window of the profile on screen: the bubble shows over it; the window closes with the bubble up.
      const first = await profileWindow("/b?installs-1");
      id = await install();
      const shown = await until("the bubble", () => bubbleIn(), 8000);
      if (shown !== first.native) throw new Error(`the bubble is in window ${shown}, not the profile's ${first.native}`);
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(first.id)}); return true`);
      await sleep(1500);
      await exts(`uninstall("${id}", ${JSON.stringify(profile)})`);
      // Its windows closed mid-install: nothing shows, nothing crashes, until a window of the profile shows a page.
      const before = new Set([...onScreenWindows(), ...(await cef(`chromeWindows()`)).map((w) => w.window)]);
      const second = await profileWindow("/c?installs-2");
      id = await install(async () => {
        await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(second.id)}); return true`);
        await until("the profile's window closed", async () => !(await cef(`chromeWindows()`)).some((w) => w.window === second.native && w.visible), 8000)
          .catch(async (e) => { throw new Error(`${e.message}; windows ${JSON.stringify(await cef(`chromeWindows()`))}; app ${JSON.stringify(await evalApp(`return ac.store.getState().windowOrder`))}`); });
      });
      await sleep(2000);
      const early = await bubbleIn();
      if (early) throw new Error(`the bubble showed in window ${early} with no window of the profile`);
      const stray = onScreenWindows().filter((w) => !before.has(w));
      if (stray.length) throw new Error(`windows on screen the app didn't show: ${JSON.stringify(stray)}`);
      const third = await profileWindow("/d?installs-3");
      const later = await until("the waiting bubble", () => bubbleIn(), 8000);
      if (later !== third.native) throw new Error(`the waiting bubble is in window ${later}, not the profile's ${third.native}`);
      return { immediate: shown, waited: later };
    } finally {
      await evalApp(`ac.extensions.cancelInstall(); return true`).catch(() => null);
      for (const w of opened) await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(w)}); return true`).catch(() => null);
      if (id) await exts(`uninstall("${id}", ${JSON.stringify(profile)})`).catch(() => null);
    }
  });

  await check("context-menu-reading-mode", async () => {
    // B7: Chrome's page menu has no "Open in Reading Mode" (or "Listen to this page"): both open Chrome's side panel,
    // which the app's windows don't have, so picking one did nothing. CEF's menu had neither. No separator is doubled.
    const tab = await freshTab(`${base}/text`);
    try {
      const target = await until("the page", () => pageTarget("/text"));
      const before = (await eventsOf(tab)).filter((x) => x.name === "contextMenu").length;
      let menu = null;
      for (let attempt = 0; attempt < 3 && !menu; attempt++) {
        const at = { x: 300, y: 300, button: "right", clickCount: 1 };
        await cdp(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
        await cdp(target, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
        await cdp(target, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
        menu = await until("a context menu", async () => {
          const menus = (await eventsOf(tab)).filter((x) => x.name === "contextMenu");
          return menus.length > before ? menus.at(-1) : null;
        }, 4000).catch(() => null);
      }
      if (!menu) throw new Error("no context menu reported");
      const items = menu.payload.items;
      const flat = (list) => list.flatMap((i) => [i, ...flat(i.submenu ?? [])]);
      const found = flat(items).filter((i) => i.id === 50169 || /reading mode|listen to this page/i.test(i.label ?? ""));
      if (found.length) throw new Error(`still there: ${JSON.stringify(found.map((i) => i.label))}`);
      const doubled = items.some((i, n) => i.separator && (n === 0 || n === items.length - 1 || items[n + 1]?.separator));
      if (doubled) throw new Error(`a doubled or end separator: ${JSON.stringify(items.map((i) => (i.separator ? "—" : i.label)))}`);
      return { items: items.filter((i) => !i.separator).map((i) => i.label) };
    } finally {
      await closeTab(tab).catch(() => null);
    }
  });

  // MARK: Content blocker

  await check("content-blocker", async () => {
    // The built-in uBlock Origin Lite, loaded as a component extension and driven through its runtime messages.
    const state = await until("the blocker's state", async () => {
      const s = await cef(`getContentBlocker()`);
      return s?.stats?.ready ? s : null;
    }, 30000);
    await cef(`setContentBlockerAllowed("allowed.test", true)`);
    const allowed = await cef(`isContentBlockerAllowed("allowed.test")`);
    await cef(`setContentBlockerAllowed("allowed.test", false)`);
    return { enabled: state.enabled, lists: state.lists.length, version: state.version, allowed };
  });

  await check("content-blocker-fails-closed", async () => {
    // A change whose read fails (uBOL's service worker waking up, its page reloading) changes nothing and reports the
    // error: devContentBlockerFailNextMessage fails the next call's first message, here the read of the enabled lists.
    const enabled = async () => (await cef(`getContentBlocker()`)).lists.filter((l) => l.enabled).map((l) => l.id).sort();
    const before = await enabled();
    const off = (await cef(`getContentBlocker()`)).lists.find((l) => !l.enabled);
    await cef(`devContentBlockerFailNextMessage()`);
    const error = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.setFilterListEnabled(${JSON.stringify(off.id)}, true).then(() => null, (e) => e.message)`);
    const after = await enabled();
    if (!error) throw new Error("the failed change reported no error");
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the lists changed: ${before} → ${after}`);
    return { error, enabled: after.length };
  });

  // Requests for ads tagged `tag` (the /adfirst page's) that reached the ad hosts (not the page itself).
  const adsServedFor = (tag) => adServed.filter((s) => !s.startsWith("adpage.test") && s.endsWith(`?${tag}`));

  // The content blocker's rounds on an ad page in a new tab of `profileId` (the window's own when undefined): its first
  // page (the profile's very first, in a profile made now) asks for ads as it loads, and none goes out; then blocked,
  // allowed for the site (and reloaded, as the app does), blocked again.
  const contentBlockerRounds = async (profileId) => {
    await until("the blocker's state", async () => ((await cef(`getContentBlocker()`))?.stats?.ready ? true : null), 30000);
    const origin = `http://adpage.test:${server.address().port}`;
    const page = `${origin}/adpage`;
    const tag0 = profileId ? profileId : "personal";
    const firstTag = `first-${tag0}-${Date.now()}`;
    const firstPage = `${origin}/adfirst?${firstTag}`;
    // Another profile's page in a window of its own: closing its only tab in the main window would close that window.
    const ownWindow = profileId ? await evalApp(`return ac.actions.openWindow({ profileId: ${JSON.stringify(profileId)}, url: "${firstPage}" })`) : null;
    const tab = ownWindow
      ? await until("the profile's tab", () => evalApp(`return ac.store.getState().windows[${JSON.stringify(ownWindow)}]?.tabIds[0] ?? null`))
      : await evalApp(`return ac.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${firstPage}" })`);
    try {
      // Chrome reads an extension's rulesets from disk after loading it, and a profile loaded just now must not show a
      // page before they're in force (ArcadiaCore holds its navigations): none of the first page's ads goes out.
      await until("the first page", () => evalApp(`const s = ac.store.getState(); const t = s.tabs[${JSON.stringify(tab)}];
        return t?.title === "Ad first" && !s.live[${JSON.stringify(tab)}]?.isLoading ? true : null`), 20000);
      await sleep(500);
      const first = adsServedFor(firstTag);
      if (first.length) throw new Error(`the first page's ads went out: ${JSON.stringify(first)}`);
      const round = async (tag) => {
        tag = `${tag0}-${tag}`;
        await evalApp(`ac.store.getState().navigate(${JSON.stringify(tab)}, "${page}?${tag}", { userInitiated: true }); return true`);
        await until(`the page (${tag})`, () => evalApp(`const s = ac.store.getState(); const t = s.tabs[${JSON.stringify(tab)}];
          return t?.url?.endsWith(${JSON.stringify(`?${tag}`)}) && !s.live[${JSON.stringify(tab)}]?.isLoading ? true : null`));
        const t = await until("its target", () => pageTarget(`/adpage?${tag}`));
        const reached = async (url) => {
          const before = adServed.length;
          const r = (await cdp(t, "Runtime.evaluate", { expression: `fetch("${url}", { mode: "no-cors" }).then(() => "loaded", () => "failed")`, awaitPromise: true, returnByValue: true })).result.value;
          return { fetch: r, reached: adServed.slice(before).some((s) => url.includes(s.split("?")[0])) };
        };
        // The release smoke test's ad script as a <script>: uBOL answers it with its stand-in (an adsbygoogle that does
        // nothing), so it "loads" without the request leaving the browser. CEF failed the stand-in's load instead
        // (ERR_BLOCKED_BY_CLIENT on the extension's web_accessible_resources), which the smoke test took as "blocked".
        const script = async () => {
          const before = adServed.length;
          const url = `http://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?${tag}`;
          const r = (await cdp(t, "Runtime.evaluate", { expression: `new Promise((r) => { const s = document.createElement("script"); s.src = "${url}";
            s.onload = () => r(window.adsbygoogle?.loaded === true ? "stand-in" : "loaded"); s.onerror = () => r("failed"); document.head.append(s); })`, awaitPromise: true, returnByValue: true })).result.value;
          return { script: r, reached: adServed.slice(before).some((s) => s.startsWith("pagead2.")) };
        };
        return { adnxs: await reached(`http://ib.adnxs.com/ut/v3?${tag}`), gpt: await reached(`http://securepubads.g.doubleclick.net/tag/js/gpt.js?${tag}`), adsbygoogle: await script() };
      };
      const stopped = (r) => !r.adnxs.reached && !r.gpt.reached && r.adnxs.fetch === "failed" && !r.adsbygoogle.reached && r.adsbygoogle.script === "stand-in";
      const blocked = await round("blocked");
      await cef(`setContentBlockerAllowed("adpage.test", true)`);
      const allowed = await round("allowed");
      await cef(`setContentBlockerAllowed("adpage.test", false)`);
      const again = await round("again");
      if (!stopped(blocked)) throw new Error(`not blocked: ${JSON.stringify(blocked)}`);
      if (!allowed.adnxs.reached || !allowed.gpt.reached || !allowed.adsbygoogle.reached) throw new Error(`allowing the site let nothing through: ${JSON.stringify(allowed)}`);
      if (!stopped(again)) throw new Error(`blocked again? ${JSON.stringify(again)}`);
      return { firstPage: "blocked", blocked, allowed, again };
    } finally {
      if (ownWindow) await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(ownWindow)}); return true`);
      else await evalApp(`ac.store.getState().closeTab(${JSON.stringify(tab)}); return true`);
    }
  };

  await check("content-blocker-blocks", async () => {
    // A page's ad requests never reach the ad server: a block rule fails them, and uBOL sends some (gpt.js) to its
    // stand-in script instead, so check the server, not the fetch. Allowing the site lets them through; turning it back
    // off blocks them again. The hosts are mapped to the fixture server.
    return contentBlockerRounds(undefined);
  });

  await check("content-blocker-profile", async () => {
    // The same in a profile made now (the release smoke test's page is in its Work profile): uBOL loads into every
    // profile, and its rulesets must block there from its very first page, and follow Personal's allow-list.
    const id = await evalApp(`return ac.store.getState().createProfile({ name: "Blocker" })`);
    if (!id) throw new Error("no profile made");
    return { profile: id, ...(await contentBlockerRounds(id)) };
  });

  await check("content-blocker-held", async () => {
    // The hold itself, made certain: the next profile's blocker loads 1.5 s late (devContentBlockerDelayNextLoad), so
    // its first page asks to load long before the rules are in force. ArcadiaCore holds it until they are (an explicit
    // signal from Chrome's ruleset load, not a timer): it loads after the delay, and none of its ads goes out.
    const delay = 1500;
    await cef(`devContentBlockerDelayNextLoad(${delay})`);
    const id = await evalApp(`return ac.store.getState().createProfile({ name: "Held" })`);
    const tag = `held-${Date.now()}`;
    const started = Date.now();
    const w = await evalApp(`return ac.actions.openWindow({ profileId: ${JSON.stringify(id)}, url: "http://adpage.test:${server.address().port}/adfirst?${tag}" })`);
    try {
      await until("the held page", () => evalApp(`const s = ac.store.getState(); const t = s.windows[${JSON.stringify(w)}]?.tabIds[0];
        return t && s.tabs[t]?.title === "Ad first" && !s.live[t]?.isLoading ? true : null`), 20000);
      const loadedAfterMs = Date.now() - started;
      await sleep(500);
      const served = adsServedFor(tag);
      if (served.length) throw new Error(`the held page's ads went out: ${JSON.stringify(served)}`);
      if (loadedAfterMs < delay) throw new Error(`the page loaded ${loadedAfterMs} ms in, before the blocker (not held)`);
      return { profile: id, loadedAfterMs };
    } finally {
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(w)}); return true`);
    }
  });

  await check("content-blocker-private", async () => {
    // A private window's first page, and the first page of the next one after the first's profile went (released with
    // its last window): uBOL, a component extension, runs in private windows on its profile's rules.
    const origin = `http://adpage.test:${server.address().port}`;
    const out = [];
    for (const step of ["first", "after-release"]) {
      const tag = `private-${step}-${Date.now()}`;
      const w = await evalApp(`return ac.actions.openWindow({ incognito: true, url: "${origin}/adfirst?${tag}" })`);
      try {
        await until(`the ${step} private page`, () => evalApp(`const s = ac.store.getState(); const id = s.windows[${JSON.stringify(w)}]?.tabIds[0];
          return id && s.tabs[id]?.title === "Ad first" && !s.live[id]?.isLoading ? true : null`), 20000);
        await sleep(500);
        const served = adsServedFor(tag);
        if (served.length) throw new Error(`the ${step} private window's ads went out: ${JSON.stringify(served)}`);
        out.push(step);
      } finally {
        await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(w)}); return true`);
      }
      await sleep(2000);  // its profile goes (private-release)
    }
    return { blocked: out };
  });

  // MARK: Data, downloads and crashes

  await check("internal-pages-not-history", async () => {
    // The host's own pages never reach a profile's history or the omnibox: the content blocker's hidden page
    // (chrome-extension://<uBOL>/manifest.json, opened in every profile it loads into), extension popups and side
    // panels. A page the user visits does, an extension's page opened as a tab too (an options page: Chrome records
    // chrome-extension: URLs, CanAddURLToHistory, as extension-windows-hidden opens one).
    const userOpened = (u) => /^chrome-extension:\/\/[a-p]{32}\/options\.html/.test(u);
    const profiles = ["", ...(await evalApp(`return ac.store.getState().profileOrder.filter((p) => p !== "default")`))];
    await sleep(1500);
    const found = {};
    let pages = 0;
    for (const profile of profiles) {
      const r = JSON.parse(await cef(`engineCall("ac_history_query", ${JSON.stringify(profile)}, ${JSON.stringify(JSON.stringify({ maxUrls: 1000, maxVisits: 1 }))})`));
      const urls = (r.entries ?? []).map((e) => e.u ?? "");
      pages += urls.filter((u) => u.startsWith("http")).length;
      const internal = urls.filter((u) => u.startsWith("chrome-extension://") && !userOpened(u));
      if (internal.length) found[profile || "personal"] = internal;
    }
    if (Object.keys(found).length) throw new Error(`extension pages in history: ${JSON.stringify(found)}`);
    if (!pages) throw new Error("no history at all (the check proves nothing)");
    return { profiles: profiles.length, webPages: pages };
  });

  await check("crash-reload", async () => {
    // A crashed tab's Reload brings the page back and drops the sad tab (pageState.crashed), as CEF: its first
    // report after the crash names no URL, so the app takes the reload for a new page.
    const tab = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${base}/crash-reload" })`);
    try {
      await until("the page", async () => (await state()).tabs.find((t) => t.id === tab && t.title === "/crash-reload" && !t.loading));
      await cdp(await pageTarget("/crash-reload"), "Page.crash").catch(() => null);
      const crashed = await until("the sad tab", () => evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null`), 10000);
      await evalApp(`return ac.webviews.get(${JSON.stringify(tab)}).reload()`);
      const title = await until("the page again", async () => {
        const t = await pageTarget("/crash-reload");
        const r = t && (await cdp(t, "Runtime.evaluate", { expression: "document.title", returnByValue: true }).catch(() => null));
        return r?.result?.value === "/crash-reload" ? r.result.value : null;
      });
      const after = await until("no sad tab", async () => {
        const p = await evalApp(`return { crashed: ac.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null, url: ac.store.getState().tabs[${JSON.stringify(tab)}]?.url }`);
        return !p.crashed && p.url?.endsWith("/crash-reload") ? p : null;
      }, 5000).catch(async () => { throw new Error(`still crashed: ${JSON.stringify(await evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed`))}`); });
      return { crashed: crashed.reason, title, url: after.url };
    } finally {
      await evalApp(`ac.store.getState().closeTab(${JSON.stringify(tab)}); return true`);
    }
  });

  await check("crash-debug-url", async () => {
    // chrome://crash crashes the page without committing: the tab keeps its URL (a reload or the restored session
    // doesn't crash it again), as CEF.
    const tab = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${base}/crash-url" })`);
    try {
      await until("the page", async () => (await state()).tabs.find((t) => t.id === tab && t.title === "/crash-url" && !t.loading));
      await evalApp(`ac.actions.switchToTab(${JSON.stringify(tab)}); ac.store.getState().navigate(${JSON.stringify(tab)}, "chrome://crash", { userInitiated: true }); return true`);
      await until("the sad tab", () => evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null`), 10000);
      await sleep(1000);
      const url = await evalApp(`return ac.store.getState().tabs[${JSON.stringify(tab)}]?.url`);
      if (!url?.startsWith(`${base}/crash-url`)) throw new Error(`the tab's URL became ${url}`);
      await evalApp(`return ac.webviews.get(${JSON.stringify(tab)}).reload()`);
      await until("the page again, not crashed", async () => {
        const p = await evalApp(`return { crashed: ac.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null, url: ac.store.getState().tabs[${JSON.stringify(tab)}]?.url }`);
        const t = await pageTarget("/crash-url");
        const r = t && (await cdp(t, "Runtime.evaluate", { expression: "document.title", returnByValue: true }).catch(() => null));
        return !p.crashed && p.url?.startsWith(`${base}/crash-url`) && r?.result?.value === "/crash-url" ? p : null;
      });
      return { url };
    } finally {
      await evalApp(`ac.store.getState().closeTab(${JSON.stringify(tab)}); return true`);
    }
  });

  await check("popup-window", async () => {
    // A sized window.open (OAuth, payments) gets a window of its own, as CEF's ACPopupWindow: not a tab, its page the
    // size asked for, window.opener kept both ways; window.close() in it closes the window.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    const opener = await pageFor(first.id, `${base}/a`);
    const popups = async () => (await cef(`engineInfo()`)).popupWindows;
    const before = await popups();
    await cdp(opener, "Runtime.evaluate", { expression: `window.__msg = null; addEventListener("message", (e) => (window.__msg = e.data)); window.open("${base}/popup-page", "pop", "width=480,height=360"); true`, userGesture: true });
    const t = await until("the popup's page", () => pageTarget("/popup-page"));
    await until("a popup window", async () => ((await popups()) === before + 1 ? true : null), 10000);
    const page = (await cdp(t, "Runtime.evaluate", { expression: `JSON.stringify({ size: innerWidth + "x" + innerHeight, opener: !!window.opener })`, returnByValue: true })).result.value;
    await cdp(t, "Runtime.evaluate", { expression: `window.opener.postMessage("from-popup", "*")` });
    const message = await until("the opener's message", async () => (await cdp(opener, "Runtime.evaluate", { expression: "window.__msg", returnByValue: true })).result.value);
    const asTab = (await state()).tabs.some((x) => x.url?.includes("/popup-page"));
    await closeFromPage(t);
    await until("the popup window closed", async () => ((await popups()) === before && !(await pageTarget("/popup-page")) ? true : null), 10000);
    const { size, opener: hasOpener } = JSON.parse(page);
    if (asTab) throw new Error("the popup became a tab");
    if (size !== "480x360" || !hasOpener) throw new Error(`popup page ${page}`);
    return { size, opener: hasOpener, message };
  });

  await check("download", async () => {
    // Chrome's download manager through //chrome/browser/arcadia (ac_downloads_*): the app's list fills in.
    await evalApp(`ac.actions.openUrls(["${base}/file.bin"], ${JSON.stringify(mainWindow)}); return true`);
    const d = await until("the finished download", async () => {
      const list = await evalApp(`return ac.store.getState().downloads.map((d) => ({ id: d.id, state: d.state, filename: d.filename, path: d.path, received: d.received }))`);
      return list.find((x) => x.filename?.includes("arcadiacore-test") && x.state === "finished") ?? null;
    }, 20000);
    await closeDownloads();
    if (!d.path.startsWith(downloadsDir)) throw new Error(`downloaded to ${d.path}, not the scratch dir`);
    return d;
  });

  await check("site-settings", async () => {
    const origin = "https://settings.test";
    await cef(`setSiteSetting("", "${origin}", "popups", "allow")`);
    const settings = await until("the setting", async () => {
      const s = await cef(`getSiteSettings("", "${origin}")`);
      return s?.popups?.value === "allow" ? s : null;
    });
    const origins = await cef(`getSiteSettingsOrigins("")`);
    await cef(`resetSiteSettings("", "${origin}")`);
    const cleared = await cef(`clearSiteData("", "${origin}")`);
    return { popups: settings.popups, origins: origins.length, cleared };
  });

  await check("passwords-more", async () => {
    // The rest of Settings › Passwords: edit, the never-save list, unlock (ARCADIA_TEST_REAUTH), export to a file.
    const origin = "https://more.test";
    await cef(`savePassword("", "${origin}", "olduser", "pw1")`);
    const updated = await cef(`updatePassword("", "${origin}", "olduser", "newuser", "pw2")`);
    if (updated?.error) throw new Error(`update: ${updated.error}`);
    const revealed = await until("the edited login", async () => {
      const r = await cef(`getPassword("", "${origin}", "newuser")`);
      return r?.password === "pw2" ? r : null;
    });
    const unlocked = await cef(`unlockPasswords("")`);
    const never = await cef(`getNeverSavePasswordOrigins("")`);
    const allowed = await cef(`allowSavingPasswords("", "https://never.test")`);
    const file = join(scratch, "passwords.csv");
    // The save panel a background instance doesn't show answers from file-chooser.txt.
    writeFileSync(join(data, "file-chooser.txt"), file + "\n");
    const exported = await cef(`exportPasswords("")`);
    const written = await until("the export file", async () => existsSync(file) && readFileSync(file, "utf8").includes("newuser"), 10000);
    await cef(`deletePassword("", "${origin}", "newuser")`);
    return { updated: revealed.password, unlocked, never: never?.origins?.length ?? never, allowed, exported: exported?.status ?? exported, written };
  });

  await check("autofill-cards", async () => {
    // Cards in Chrome's personal data manager: save (with a published test number), list, reveal, delete; settings.
    const saved = await cef(`saveCard("", { name: "Acceptance Test", expMonth: 12, expYear: 2031 }, "4111111111111111")`);
    if (saved?.error) throw new Error(`save: ${saved.error}`);
    const card = await until("the card listed", async () => {
      const r = await cef(`listCards("")`);
      return r?.cards?.find((c) => c.id === saved.id) ?? null;
    });
    const number = await cef(`revealCardNumber("", "${saved.id}")`);
    if (number?.number !== "4111111111111111") throw new Error(`reveal: ${JSON.stringify(number)}`);
    await cef(`deleteAutofillEntry("", "${saved.id}")`);
    await until("the card gone", async () => !(await cef(`listCards("")`))?.cards?.some((c) => c.id === saved.id));
    await cef(`setAutofillSettings("", null, false)`);
    const off = await cef(`getAutofillSettings("")`);
    await cef(`setAutofillSettings("", null, true)`);
    if (off.cards !== false) throw new Error(`cards setting: ${JSON.stringify(off)}`);
    return { card: { last4: card.lastFour ?? card.last4 ?? null, name: card.name }, revealed: true, cardsOff: true };
  });

  await check("autofill-save-prompts", async () => {
    // Chrome's offers after a form is sent, as a person sends it (typed values, a click): save an address, update it,
    // save a card. Chrome's controllers (AddressBubblesController, SaveCardBubbleControllerImpl) ask ArcadiaCore's bubble
    // handler, the app shows the offer on the page (onAutofillPrompt) and answers it (resolveAutofillPrompt); Chrome's
    // personal data manager then has what was accepted, and nothing that was declined. Switching tabs closes a pending
    // offer, as Chrome's tab switch does; switching profiles keeps it for when the page is back. A made-up address and
    // the networks' published test card numbers.
    // The tab's event log keeps its last 80 events: offers are told apart by their ids, which only grow.
    const prompts = async () => (await eventsOf(first.id)).filter((x) => x.name === "autofillPrompt");
    const lastId = async () => Math.max(0, ...(await prompts()).map((x) => x.payload.id));
    const offerAfter = (id, what) =>
      until(what, async () => (await prompts()).findLast((x) => !x.payload.closed && x.payload.id > id)?.payload ?? null, 10000);
    const closed = async (id) => (await prompts()).some((x) => x.payload.closed && x.payload.id === id);
    const appPrompt = () => evalApp(`return ac.pageState.getState().pages[${JSON.stringify(first.id)}]?.autofillPrompt ?? null`);
    const answer = (id, action) => evalApp(`return ac.webviews.get(${JSON.stringify(first.id)}).resolveAutofillPrompt(${id}, ${JSON.stringify(action)})`);
    const addresses = async (profile = "") => (await cef(`listAddresses(${JSON.stringify(profile)})`))?.addresses ?? [];
    const cards = async (profile = "") => (await cef(`listCards(${JSON.stringify(profile)})`))?.cards ?? [];
    const sendForm = async (path, title, values) => {
      await evalApp(`ac.store.getState().navigate(${JSON.stringify(first.id)}, ${JSON.stringify(secureBase + path)}, { userInitiated: true }); return true`);
      await until(title, async () => (await state()).tabs.find((x) => x.id === first.id && x.title === title && x.url?.endsWith(path) && !x.loading), 15000);
      const t = await pageFor(first.id, path);
      for (const [id, text] of values) {
        await cdp(t, "Runtime.evaluate", { expression: `document.getElementById(${JSON.stringify(id)}).focus()` });
        await cdp(t, "Input.insertText", { text });
      }
      const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('go').getBoundingClientRect())", returnByValue: true })).result.value);
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2, button: "left", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at, buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at, buttons: 0 });
      await until("the form sent", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Saved" && !x.loading), 15000);
    };
    const address = [["name", "Jane Doe"], ["street", "1 Meadow Lane"], ["city", "Springfield"], ["state", "IL"], ["zip", "62701"], ["country", "United States"]];
    const card = (number, name) => [["ccname", name], ["ccnumber", number], ["ccmonth", "12"], ["ccyear", "2031"]];
    let profileB = null;
    let other = null;
    try {
      await evalApp(`ac.actions.switchToTab(${JSON.stringify(first.id)}); return true`);
      await until("A shown", async () => (await state()).active === first.id);
      const saveSeen = await lastId();

      // A new address: "Save address?" on the page, saved on accept.
      await sendForm("/address", "Address", address);
      const save = await offerAfter(saveSeen, "the save-address offer");
      if (save.kind !== "saveAddress" || !save.title || !save.accept || !save.decline || !JSON.stringify(save.lines).includes("Springfield"))
        throw new Error(`save offer ${JSON.stringify(save)}`);
      const shown = await until("the offer in the app", async () => ((await appPrompt())?.id === save.id ? true : null), 5000);
      await answer(save.id, "accept");
      const saved = await until("the address saved", async () => (await addresses()).find((a) => a.city === "Springfield") ?? null);
      await until("the offer gone from the page", async () => ((await appPrompt()) === null ? true : null), 5000);

      // The same address with an email: "Update address?", pending while another tab is shown: Chrome's tab switch
      // closes it (the app's offer goes) and it doesn't come back; the address is untouched.
      const email = "big.mascot@example.com";
      let seen = await lastId();
      await sendForm("/address?email", "Address", [...address.slice(0, 1), ["email", email], ...address.slice(1)]);
      const update = await offerAfter(seen, "the update-address offer");
      if (update.kind !== "updateAddress" || !JSON.stringify(update.changes ?? []).includes(email))
        throw new Error(`update offer ${JSON.stringify(update)}`);
      other = await openTab(`${base}/b`, "Page B");
      await until("the offer closed by the tab switch", () => closed(update.id), 8000);
      await evalApp(`ac.actions.switchToTab(${JSON.stringify(first.id)}); return true`);
      await until("A shown again", async () => (await state()).active === first.id);
      await sleep(1500);
      if (await appPrompt()) throw new Error(`the offer came back after the tab switch: ${JSON.stringify(await appPrompt())}`);
      if ((await addresses()).some((a) => a.email === email)) throw new Error("the ignored update was saved");

      // Again, pending through a profile switch: still offered when the profile is back, and accepting it updates
      // this profile's address only.
      seen = await lastId();
      await sendForm("/address?email", "Address", [...address.slice(0, 1), ["email", email], ...address.slice(1)]);
      const update2 = await offerAfter(seen, "the update offer again");
      if (update2.kind !== "updateAddress") throw new Error(`second update offer ${JSON.stringify(update2)}`);
      const s = await state();
      profileB = await evalApp(`return ac.store.getState().createProfile({ name: "Prompts" })`);
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(s.windowId)}, ${JSON.stringify(profileB)}); return true`);
      await until("profile B shown", async () => (await state()).profileId === profileB);
      await sleep(1000);
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(s.windowId)}, ${JSON.stringify(s.profileId)}); return true`);
      await until("profile A back", async () => (await state()).profileId === s.profileId && (await state()).active === first.id);
      await sleep(500);
      const kept = await appPrompt();
      if (kept?.id !== update2.id) throw new Error(`after the profile switch the page offers ${JSON.stringify(kept)}`);
      if (await closed(update2.id)) throw new Error("the profile switch closed the offer");
      await answer(update2.id, "accept");
      const updated = await until("the address updated", async () => (await addresses()).find((a) => a.email === email) ?? null);
      if ((await addresses()).length !== 1) throw new Error(`addresses ${JSON.stringify(await addresses())}`);
      if ((await addresses(profileB)).length) throw new Error("profile B got the address");

      // A card: "Save card?", saved on accept; a second one declined ("No thanks") saves nothing.
      seen = await lastId();
      await sendForm("/card", "Card", card("4111111111111111", "The mascot"));
      const cardOffer = await offerAfter(seen, "the save-card offer");
      if (cardOffer.kind !== "saveCard" || !JSON.stringify(cardOffer.lines).includes("1111")) throw new Error(`card offer ${JSON.stringify(cardOffer)}`);
      await answer(cardOffer.id, "accept");
      const savedCard = await until("the card saved", async () => (await cards()).find((c) => c.last4 === "1111") ?? null);
      seen = await lastId();
      await sendForm("/card", "Card", card("5555555555554444", "The mascot"));
      const declined = await offerAfter(seen, "the second card's offer");
      await answer(declined.id, "decline");
      await until("the declined offer closed", () => closed(declined.id), 5000);
      await sleep(1000);
      if ((await cards()).some((c) => c.last4 === "4444")) throw new Error("the declined card was saved");
      // A stale answer (an offer already answered) changes nothing.
      await answer(cardOffer.id, "accept");
      return {
        save: { title: save.title, accept: save.accept, decline: save.decline, lines: save.lines, shown },
        saved: { name: saved.name, city: saved.city },
        update: { title: update.title, changes: update.changes, closedOnTabSwitch: true, keptOverProfileSwitch: true },
        updated: { email: updated.email },
        card: { title: cardOffer.title, lines: cardOffer.lines, saved: savedCard.last4, declined: true },
      };
    } finally {
      for (const a of await addresses().catch(() => [])) await cef(`deleteAutofillEntry("", ${JSON.stringify(a.id)})`).catch(() => null);
      for (const c of await cards().catch(() => [])) await cef(`deleteAutofillEntry("", ${JSON.stringify(c.id)})`).catch(() => null);
      if (other) await closeTab(other.id).catch(() => null);
      if (profileB) await evalApp(`ac.store.getState().deleteProfile(${JSON.stringify(profileB)}); return true`).catch(() => null);
      await backToA();
    }
  });

  await check("settings-services", async () => {
    // Clearing browsing data, resetting a site, the blocker's switches and an external-app allowance, as Settings does.
    await evalApp(`return globalThis.expo.modules.ArcadiaCEF.clearBrowsingData("", ["cache", "history"], null)`, 90000);
    await cef(`setSiteSetting("", "https://reset.test", "sound", "block")`);
    await cef(`resetSiteSettings("", "https://reset.test")`);
    const reset = await until("the site reset", async () => {
      const r = await cef(`getSiteSettings("", "https://reset.test")`);
      return r?.sound?.isDefault ? r.sound : null;
    });
    const before = await cef(`getContentBlocker()`);
    await cef(`setContentBlockerEnabled(false)`);
    const off = await until("the blocker off", async () => ((await cef(`getContentBlocker()`)).enabled === false ? true : null), 15000);
    await cef(`setContentBlockerEnabled(true)`);
    await until("the blocker on", async () => ((await cef(`getContentBlocker()`)).enabled === true ? true : null), 15000);
    const list = before.lists.find((l) => !l.enabled) ?? before.lists[0];
    await cef(`setFilterListEnabled(${JSON.stringify(list.id)}, ${!list.enabled})`);
    const toggled = await until("the list toggled", async () =>
      (await cef(`getContentBlocker()`)).lists.find((l) => l.id === list.id)?.enabled === !list.enabled ? true : null, 20000);
    await cef(`setFilterListEnabled(${JSON.stringify(list.id)}, ${list.enabled})`);
    await cef(`removeExternalAppAllowance("", "https://none.test", "arcadiacore-no-such-app")`);
    const siteData = await evalApp(`return ac.webviews.get("${first.id}")?.clearSiteData() ?? null`);
    if (!siteData || siteData.error) throw new Error(`clearSiteData: ${JSON.stringify(siteData)}`);
    return { reset: reset.value, blockerOff: off, list: list.id, toggled, siteData };
  });

  await check("download-controls", async () => {
    // A running download paused, resumed and cancelled from the app (ac_downloads_pause/_resume/_cancel).
    await evalApp(`ac.actions.openUrls(["${base}/slow.bin"], ${JSON.stringify(mainWindow)}); return true`);
    const find = () => evalApp(`return ac.store.getState().downloads.map((d) => ({ id: d.id, state: d.state, paused: d.paused, filename: d.filename, received: d.received }))`)
      .then((l) => l.find((x) => x.filename?.includes("arcadiacore-slow")) ?? null);
    try {
      const d = await until("the slow download running", async () => { const x = await find(); return x?.state === "downloading" && !x.paused && x.received > 0 ? x : null; }, 15000);
      await cef(`pauseDownload("${d.id}")`);
      await until("paused", async () => ((await find())?.paused ? true : null), 8000);
      await cef(`resumeDownload("${d.id}")`);
      await until("running again", async () => { const x = await find(); return x?.state === "downloading" && !x.paused ? true : null; }, 8000);
      await cef(`cancelDownload("${d.id}")`);
      const last = await until("cancelled", async () => { const x = await find(); return x?.state === "cancelled" ? x : null; }, 8000);
      return { id: d.id, state: last.state };
    } finally {
      // The new download opened the popover over the page; it stayed open for the rest of the run.
      await closeDownloads();
    }
  });

  await check("tasks-components", async () => {
    const tasks = await until("tasks", async () => {
      const t = await cef(`listTasks()`);
      return t.length ? t : null;
    });
    const components = await cef(`components()`);
    const allowances = await cef(`getExternalAppAllowances("")`);
    return { tasks: tasks.length, browserTasks: tasks.filter((t) => t.browserIds.length).length, components: components.length, allowances: allowances.length };
  });

  await check("download-navigation", async () => {
    // A page navigating to a download stays where it was, and the app hears of it (onDownloadNavigation).
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/file.bin?nav", { userInitiated: true }); return true`);
    const e = await until("onDownloadNavigation", async () => (await eventsOf(first.id)).find((x) => x.name === "downloadNavigation"), 15000);
    return e.payload;
  });

  await check("tracing", async () => {
    const started = await cef(`beginTracing()`);
    const during = await cef(`isTracing()`);
    const path = await cef(`endTracing(false)`);
    const after = await cef(`isTracing()`);
    if (!started || !during || after) throw new Error(`tracing ${started} ${during} ${after}`);
    return { started, during, after, path };
  });

  await check("delete-profile-data", async () => {
    // A loaded profile's data goes through Chrome's profile deletion (one never loaded is its folder alone).
    const folder = join(data, "Chromium", "Profile scratch-delete");
    await cef(`listPasswords("scratch-delete")`);
    await until("the profile loaded", async () => existsSync(folder), 10000);
    const result = await cef(`deleteProfileData("scratch-delete")`);
    if (result.remaining.length) throw new Error(`remaining ${JSON.stringify(result)}`);
    // Chrome removes the folder once the profile is destroyed (its Browsers closed, its services gone).
    const gone = await until("the folder gone", async () => !existsSync(folder), 15000).catch(() => false);
    if (!gone) throw new Error("the profile's folder is still there");
    // And it stays gone: nothing working for the profile (the content blocker's messages) loads it back.
    await sleep(3000);
    if (existsSync(folder)) throw new Error("the profile's folder came back");
    // The app window still shows its own profile (Chrome's deletion moves "last used", not the window).
    const shown = (await cef(`chromeWindows()`)).filter((w) => w.visible || w.alpha >= 0).map((w) => w.profile);
    return { ...result, folderGone: true, windowProfiles: shown };
  });

  // MARK: Page events

  await check("page-events", async () => {
    // Zoom steps, the security report, an app link with no app on this Mac, and an Esc the page leaves alone.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A's WebView", async () => evalApp(`return !!ac.webviews.get("${first.id}")`), 8000);
    await evalApp(`return ac.webviews.get("${first.id}").zoomStep(1)`);
    const zoom = await until("onZoom", async () => (await eventsOf(first.id)).filter((x) => x.name === "zoom").pop(), 8000);
    await evalApp(`return ac.webviews.get("${first.id}").zoomStep(0)`);
    const security = await evalApp(`return ac.webviews.get("${first.id}").getSecurityInfo()`);
    // Esc first: the external-app prompt below is the app's own sheet, which takes Esc itself.
    const s = await state();
    await evalApp(`return ac.webviews.get("${first.id}").focus()`);
    await sleep(300);
    const sent = await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "\u001b", keyCode: 53, modifiers: [], focus: "page" })`);
    const escape = await until("onCommand escape", async () => (await eventsOf(first.id)).find((x) => x.name === "command" && x.payload?.command === "escape"), 5000)
      .catch(async (e) => {
        const profile = await evalApp(`const s = ac.store.getState(); return s.windows["${s.windowId}"]?.profileId ?? null`);
        const pt = await pageFor(first.id, `${base}/a`);
        const vis = (await cdp(pt, "Runtime.evaluate", { expression: "document.visibilityState + '/' + document.hasFocus()", returnByValue: true })).result.value;
        const tx = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.tabStrips()`);
        const chromeActive = tx.strips.map((st) => st.tabs.find((x) => x.active)?.key ?? null);
        throw new Error(`${e.message}; key: ${JSON.stringify(sent)}; window profile: ${profile}; active: ${(await state()).active}; Chrome's active: ${JSON.stringify(chromeActive)}; page ${vis}`);
      });
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: "location.href = 'arcadiacore-no-such-app://hello'", userGesture: true });
    const external = await until("onExternalApp", async () => evalApp(`return ac.pageState.getState().pages["${first.id}"]?.externalApp ?? null`), 10000);
    const securityEvent = (await eventsOf(first.id)).some((x) => x.name === "security");
    if (!securityEvent) throw new Error("no onSecurity");
    const focused = (await eventsOf(first.id)).some((x) => x.name === "focus");
    // A background tab's window.focus() asks the app to bring it forward (onActivateRequest "page").
    const other = (await state()).tabs.find((x) => x.id !== first.id && x.url?.startsWith(`${base}/d`));
    let activate = null;
    if (other) {
      const ot = await pageTarget(`${base}/d`);
      await cdp(ot, "Runtime.evaluate", { expression: "window.focus()", userGesture: true });
      activate = await until("onActivateRequest", async () => (await eventsOf(other.id)).find((x) => x.name === "activateRequest"), 3000).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
    return { zoom: zoom.payload.zoom, security: security?.level, securityEvent, focused, activate: activate?.payload?.reason ?? null,
      external: { scheme: external.scheme, app: external.app }, escape: escape.payload.command };
  });

  await check("page-background", async () => {
    // A page that paints no background gets Chrome's canvas, as in Chrome and Dia: white, or Chrome's dark canvas when
    // its color-scheme is dark. The tab's base background was transparent (53ed19ca to 0.2.30), which showed the app's
    // card through such pages: dark text on the dark card (workspace.google.com). The same after a reload (a new
    // document) and after an opaque page (a new document's view once kept the last page's gray); a page that paints
    // its own background covers it.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const pixel = async (t) => {
      const shot = await cdp(t, "Page.captureScreenshot", { format: "png", clip: { x: 600, y: 400, width: 1, height: 1, scale: 1 } });
      return firstPixel(shot.data);
    };
    const visit = async (path, title) => {
      await evalApp(`ac.store.getState().navigate("${first.id}", "${base}${path}", { userInitiated: true }); return true`);
      await until(`the ${title} page`, async () => (await state()).tabs.find((t) => t.id === first.id && t.title === title && !t.loading), 10000);
      await sleep(500);
      return pixel(await pageFor(first.id, `${base}${path}`));
    };
    const plain = await pixel(await pageFor(first.id, `${base}/a`));
    await evalApp(`return ac.webviews.get("${first.id}").reload()`);
    await sleep(1000);
    await until("A reloaded", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading), 10000);
    await sleep(500);
    const reloaded = await pixel(await pageFor(first.id, `${base}/a`));
    let painted, darkScheme;
    try {
      painted = await visit("/painted", "Painted");
      darkScheme = await visit("/scheme-dark", "Dark scheme");
    } finally {
      await backToA();
    }
    await sleep(500);
    const after = await pixel(await pageFor(first.id, `${base}/a`));
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
    const white = [255, 255, 255, 255];
    const result = { plainPage: plain, reloaded, paintedPage: painted, darkSchemePage: darkScheme, afterPainted: after };
    if (!near(plain, white) || !near(reloaded, white) || !near(after, white))
      throw new Error(`a page with no background isn't on Chrome's white canvas: ${JSON.stringify(result)}`);
    // Neutral grays: the screenshot is in the display's color space, where sRGB grays keep their values.
    if (!near(darkScheme, [18, 18, 18, 255])) throw new Error(`the color-scheme: dark page isn't on Chrome's dark canvas: ${JSON.stringify(result)}`);
    if (!near(painted, [60, 60, 60, 255])) throw new Error(`the painted page shows ${JSON.stringify(painted)}`);
    return result;
  });

  await check("external-app-answer", async () => {
    // A link to an app this Mac has (shortcuts:, Shortcuts.app, looked up, never launched): the app's prompt
    // (onExternalApp) offers "always allow" for this trustworthy origin; the app's Cancel with the box ticked
    // (resolveExternalApp(id, false, true)) launches nothing and Chrome records no allowance, so the next link asks
    // again. Open with the box ticked (open: true, remember: true) launches it (recorded instead under the run's
    // --arcadia-test-external-protocol-no-launch) and Chrome records the allowance.
    const running = () => { try { return execFileSync("pgrep", ["-x", "Shortcuts"]).toString().trim().length > 0; } catch { return false; } };
    const wasRunning = running();
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const ask = async (n) => {
      await evalApp(`ac.pageState.setState((s) => ({ pages: { ...s.pages, "${first.id}": { ...s.pages["${first.id}"], externalApp: null } } })); return true`);
      const t = await pageFor(first.id, `${base}/a`);
      // A click first: Chrome takes one external link per user interaction (its anti-flood guard); a DevTools
      // userGesture isn't one.
      for (const type of ["mousePressed", "mouseReleased"])
        await cdp(t, "Input.dispatchMouseEvent", { type, x: 600, y: 400, button: "left", clickCount: 1 });
      await cdp(t, "Runtime.evaluate", { expression: `location.href = 'shortcuts://arcadiacore-acceptance-${n}'`, userGesture: true });
      return until(`prompt ${n}`, async () => evalApp(`return ac.pageState.getState().pages["${first.id}"]?.externalApp ?? null`), 10000);
    };
    const decline = async (request) => {
      await evalApp(`ac.pageState.setState((s) => ({ pages: { ...s.pages, "${first.id}": { ...s.pages["${first.id}"], externalApp: null } } }));
        return globalThis.expo.modules.ArcadiaCEF.resolveExternalApp(${JSON.stringify(request.id)}, false, true).then(() => true)`);
      await sleep(1500);
    };
    const firstAsk = await ask(1);
    if (!firstAsk.app || !firstAsk.appPath?.endsWith("Shortcuts.app")) throw new Error(`no app found: ${JSON.stringify({ ...firstAsk, icon: !!firstAsk.icon })}`);
    if (!firstAsk.remember) throw new Error("no \"always allow\" offered for a trustworthy origin");
    await decline(firstAsk);
    const allowances = await cef(`getExternalAppAllowances("")`);
    if (JSON.stringify(allowances).includes("shortcuts")) throw new Error(`Chrome recorded an allowance: ${JSON.stringify(allowances)}`);
    const again = await ask(2);
    if (again.id === firstAsk.id) throw new Error("the second link reused the first request");
    await decline(again);
    const third = await ask(3);
    await evalApp(`ac.pageState.setState((s) => ({ pages: { ...s.pages, "${first.id}": { ...s.pages["${first.id}"], externalApp: null } } }));
      return globalThis.expo.modules.ArcadiaCEF.resolveExternalApp(${JSON.stringify(third.id)}, true, true).then(() => true)`);
    const launch = await until("the recorded launch", async () =>
      (await cef(`devExternalLaunches()`)).find((l) => l.url?.includes("arcadiacore-acceptance-3")) ?? null, 8000);
    const remembered = await until("Chrome's allowance", async () => {
      const list = await cef(`getExternalAppAllowances("")`);
      return list.find((a) => a.scheme === "shortcuts") ?? null;
    }, 8000);
    await cef(`removeExternalAppAllowance("", ${JSON.stringify(remembered.origin)}, "shortcuts")`);
    const after = await cef(`getExternalAppAllowances("")`);
    if (after.some((a) => a.scheme === "shortcuts")) throw new Error(`the allowance stayed: ${JSON.stringify(after)}`);
    if (!wasRunning && running()) throw new Error("Shortcuts was launched");
    return { app: firstAsk.app, origin: firstAsk.origin, remember: firstAsk.remember, icon: !!firstAsk.icon,
      declined: [firstAsk.id, again.id], allowancesAfterDecline: allowances.length, opened: launch, allowance: remembered,
      removed: true, launched: false };
  });

  await check("notifications", async () => {
    // A page's Notification goes to the app (onNotification), and the app's click reaches the page.
    await cef(`setSiteSetting("", "${base}", "notifications", "allow")`);
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      expression: "window.__clicked = false; const n = new Notification('Acceptance', { body: 'hello', tag: 'ac' }); n.onclick = () => (window.__clicked = true); true",
      userGesture: true,
    });
    const e = await until("onNotification", async () => (await eventsOf(first.id)).findLast((x) => x.name === "notification"), 8000);
    await evalApp(`return ac.webviews.get("${first.id}").notificationAction(${JSON.stringify(e.payload.id)}, "click")`);
    const clicked = await until("the page's click", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "window.__clicked", returnByValue: true });
      return r.result.value === true ? true : null;
    }, 8000);
    await cdp(t, "Runtime.evaluate", { expression: "window.__n2 = new Notification('Second'); setTimeout(() => window.__n2.close(), 300); true", userGesture: true });
    const closed = await until("onNotificationClose", async () => (await eventsOf(first.id)).find((x) => x.name === "notificationClose"), 8000);
    await cef(`setSiteSetting("", "${base}", "notifications", "default")`);
    return { title: e.payload.title, body: e.payload.body, clicked, closed: !!closed };
  });

  await check("now-playing", async () => {
    // A playing <audio> with Media Session metadata: onNowPlaying, onMedia, and the app's pause (mediaCommand).
    // The tab is muted first: nothing is heard.
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/media", { userInitiated: true }); return true`);
    await until("the media page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Media" && !t.loading), 10000);
    await evalApp(`return ac.webviews.get("${first.id}").setMuted(true)`);
    const t = await pageTarget(`${base}/media`);
    await cdp(t, "Runtime.evaluate", {
      expression: "navigator.mediaSession.metadata = new MediaMetadata({ title: 'NN Tone', artist: 'Acceptance' }); window.__play = 'pending'; document.getElementById('tone').play().then(() => (window.__play = 'ok'), (e) => (window.__play = e.name)); true",
      userGesture: true,
    });
    try {
    const playing = await until("onNowPlaying playing", async () =>
      (await eventsOf(first.id)).findLast((x) => x.name === "nowPlaying" && x.payload?.state?.title === "NN Tone" && x.payload?.state?.playbackState === "playing"), 10000);
    await evalApp(`return ac.webviews.get("${first.id}").mediaCommand("pause")`);
    await until("paused by the app", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('tone').paused", returnByValue: true });
      return r.result.value === true ? true : null;
    }, 8000);
    const media = (await eventsOf(first.id)).filter((x) => x.name === "media").length;
    if (!media) throw new Error("no onMedia while playing");
    return { title: playing.payload.state.title, artist: playing.payload.state.artist, mediaEvents: media };
    } finally {
      await evalApp(`return ac.webviews.get("${first.id}").setMuted(false)`).catch(() => null);
      await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
      await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    }
  });

  // MARK: Media, Picture in Picture, page focus

  await check("media-state", async () => {
    // onMedia as packages/cef reports it: `playing` from the page script (a playing element the page hasn't muted),
    // `muted` from Chrome's mute; the app's live.playingAudio follows. The tab is muted: nothing is heard.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/media", { userInitiated: true }); return true`);
    await until("the media page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Media" && !t.loading), 10000);
    try {
      await evalApp(`return ac.webviews.get("${first.id}").setMuted(true)`);
      const mutedEvent = await until("onMedia muted", async () => lastEvent(first.id, "media", (p) => p.muted === true), 5000);
      const t = await pageFor(first.id, `${base}/media`);
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('tone').play(); true", userGesture: true });
      const on = await until("onMedia playing", async () => {
        const e = await lastEvent(first.id, "media");
        return e?.payload.playing && e.payload.muted ? e : null;
      }, 8000);
      await until("live.playingAudio", async () => (await live(first.id))?.playingAudio === true, 5000);
      const pausedAt = Date.now();
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('tone').pause(); true" });
      const off = await until("onMedia stopped", async () => {
        const e = await lastEvent(first.id, "media");
        return e && !e.payload.playing ? e : null;
      }, 8000);
      const stoppedAfterMs = Date.now() - pausedAt;
      await until("live.playingAudio off", async () => (await live(first.id))?.playingAudio === false, 5000);
      await evalApp(`return ac.webviews.get("${first.id}").setMuted(false)`);
      const unmuted = await until("onMedia unmuted", async () => {
        const e = await lastEvent(first.id, "media");
        return e && e.payload.muted === false ? e : null;
      }, 5000);
      return { muted: mutedEvent.payload, playing: on.payload, stopped: off.payload, stoppedAfterMs, unmuted: unmuted.payload };
    } finally {
      await evalApp(`return ac.webviews.get("${first.id}").setMuted(false)`).catch(() => null);
      await backToA();
    }
  });

  await check("picture-in-picture", async () => {
    // The app's requestPictureInPicture / exitPictureInPicture on a playing video → onPictureInPicture (video), then a
    // page's own documentPictureInPicture.requestWindow → onPictureInPicture (document). Chrome's window is styled as
    // on CEF (rounded, kept on top), and in a hidden run it is transparent and lets clicks through.
    const tab = await openTab(`${base}/video`, "Video");
    try {
      await evalApp(`return ac.webviews.get("${tab.id}").setMuted(true)`);
      const t = await startVideo(tab.id, false);
      const requested = await evalApp(`return ac.webviews.get("${tab.id}").requestPictureInPicture()`);
      if (requested !== true) throw new Error(`requestPictureInPicture answered ${requested}`);
      const on = await until("onPictureInPicture video", async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === "video" && p.active), 5000);
      const element = (await cdp(t, "Runtime.evaluate", { expression: "document.pictureInPictureElement?.id ?? null", returnByValue: true })).result.value;
      // Chrome's window, styled as packages/cef styles it (ArcadiaCorePictureInPicture), invisible and click-through here.
      const video = await until("Chrome's PiP window, styled", async () => (await pipWindows())?.find((w) => w.video && w.styled) ?? null, 5000)
        .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(await pipWindows())}`); });
      if (!video.rounded || !video.keepOnTop || video.rim !== 1 || video.level < 3 || video.host !== "127.0.0.1" || !video.backToTab)
        throw new Error(`not styled as on CEF: ${JSON.stringify(video)}`);
      await sleep(800);
      const videoShown = (await pipWindows())?.find((w) => w.window === video.window) ?? video;
      if (videoShown.alpha !== 0 || !videoShown.ignoresMouseEvents) throw new Error(`a hidden run's PiP window shows: ${JSON.stringify(videoShown)}`);
      const menu = await cef(`devPictureInPictureAction("menu")`);
      await evalApp(`return ac.webviews.get("${tab.id}").exitPictureInPicture()`);
      const off = await until("onPictureInPicture video off", async () => {
        const e = await lastEvent(tab.id, "pictureInPicture");
        return e && e.payload.kind === "video" && !e.payload.active ? e : null;
      }, 5000);
      // Document Picture in Picture, opened by the page.
      const doc = await cdp(t, "Runtime.evaluate", {
        expression: "documentPictureInPicture.requestWindow({ width: 320, height: 180 }).then(() => 'ok', (e) => e.name)",
        awaitPromise: true, userGesture: true, returnByValue: true,
      });
      const docOn = await until("onPictureInPicture document", async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === "document" && p.active), 5000)
        .catch((e) => { throw new Error(`${e.message}; requestWindow: ${JSON.stringify(doc.result)}`); });
      const docWindow = await until("the document PiP window", async () => (await pipWindows())?.find((w) => w.document) ?? null, 5000)
        .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(await pipWindows())}`); });
      // Past Chrome's 500 ms fade-in, which would show it again.
      await sleep(800);
      const docShown = (await pipWindows())?.find((w) => w.window === docWindow.window) ?? docWindow;
      if (docShown.alpha !== 0 || !docShown.ignoresMouseEvents) throw new Error(`a hidden run's document PiP window shows: ${JSON.stringify(docShown)}`);
      await evalApp(`return ac.webviews.get("${tab.id}").exitPictureInPicture()`);
      const docOff = await until("onPictureInPicture document off", async () => {
        const e = await lastEvent(tab.id, "pictureInPicture");
        return e && e.payload.kind === "document" && !e.payload.active ? e : null;
      }, 5000);
      return { requested, on: on.payload, element, window: { frame: video.frame, level: video.level, alpha: video.alpha }, menu, off: off.payload,
        docOn: docOn.payload, docWindow: { title: docWindow.title, alpha: docWindow.alpha }, docOff: docOff.payload };
    } finally {
      await closeTab(tab.id);
    }
  });

  await check("auto-picture-in-picture", async () => {
    // autoPictureInPicture (Arc's, the app's default): a tab playing a video with sound pops it out when the app
    // shows another tab, and takes it back when shown again; a page handling Media Session's "enterpictureinpicture"
    // opens its own document Picture in Picture instead (as on CEF). The tab is muted: nothing is heard.
    const results = {};
    for (const [path, kind] of [["/video?auto", "video"], ["/video?docpip", "document"]]) {
      const tab = await openTab(`${base}${path}`, "Video");
      try {
        await evalApp(`return ac.webviews.get("${tab.id}").setMuted(true)`);
        await startVideo(tab.id, true);
        await until("live.playingAudio", async () => (await live(tab.id))?.playingAudio === true, 8000);
        await until("onNowPlaying with video", async () => lastEvent(tab.id, "nowPlaying", (p) => p.state?.hasVideo && p.state?.playbackState === "playing"), 5000);
        await sleep(300);
        await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
        const out = await until(`auto PiP (${kind})`, async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === kind && p.active), 8000);
        await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
        const back = await until(`auto PiP ended (${kind})`, async () => {
          const e = await lastEvent(tab.id, "pictureInPicture");
          return e && e.payload.kind === kind && !e.payload.active ? e : null;
        }, 8000);
        results[kind] = { out: out.payload, back: back.payload };
      } finally {
        await closeTab(tab.id);
      }
    }
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    return results;
  });

  await check("pip-window", async () => {
    // Chrome's PiP window as packages/cef handles it (its self-test, ArcadiaCorePictureInPicture): rounded, stashed past
    // either screen edge with a peek and its handle, Chrome remembering the place, Keep Window on Top, Back to Tab
    // (onActivateRequest "pictureInPicture"); then Chrome's own close button (X), which leaves the video playing
    // (the release smoke test's ARCADIA_PIP_SELFTEST=close).
    const tab = await openTab(`${base}/video?window`, "Video");
    const selftest = join(data, "pip-selftest.json"), button = join(data, "pip-button-selftest.json");
    rmSync(selftest, { force: true });
    rmSync(button, { force: true });
    try {
      await evalApp(`return ac.webviews.get("${tab.id}").setMuted(true)`);
      const t = await startVideo(tab.id, false);
      const open = async () => {
        if ((await evalApp(`return ac.webviews.get("${tab.id}").requestPictureInPicture()`)) !== true) throw new Error("requestPictureInPicture failed");
        await until("the styled PiP window", async () => (await pipWindows())?.find((w) => w.video && w.styled && w.visible) ?? null, 5000);
      };
      await open();
      if ((await cef(`devPictureInPictureAction("selftest")`)) !== "started") throw new Error("no self-test");
      const result = await until("the PiP self-test", async () => (existsSync(selftest) ? JSON.parse(readFileSync(selftest, "utf8")) : null), 20000);
      const failed = result.steps.filter((x) => !x.pass);
      if (failed.length) throw new Error(`self-test steps failed: ${JSON.stringify(failed)}`);
      const activate = await lastEvent(tab.id, "activateRequest", (p) => p.reason === "pictureInPicture");
      if (!activate) throw new Error("Back to Tab sent no onActivateRequest");
      await until("PiP closed by Back to Tab", async () => lastEvent(tab.id, "pictureInPicture", (p) => !p.active), 5000);
      // Chrome's own buttons, clicked with the user in another app (the app-active seam). The window carries
      // WindowServer's prevents-activation tag, so a click on it never activates the app (which then made the browser
      // window key and brought it over the user's app as the window closed): the close button activates nothing and
      // keys or raises no window of ours; Back to Tab activates the app (once) and shows the tab.
      const n = await cef(`devWindowNumber(${await browserOf(first.id)})`);
      const appActive = (on) => cef(`devWindow(${n}, "fakeAppActive:${on ? 1 : 0}")`);
      const logLines = () => (existsSync(join(data, "activation.log")) ? readFileSync(join(data, "activation.log"), "utf8").split("\n") : []);
      const clickButton = async (name) => {
        await sleep(500);
        rmSync(button, { force: true });
        await open();
        if ((await appActive(false)) !== "0") throw new Error("no app-active seam");
        const from = logLines().length;
        try {
          if ((await cef(`devPictureInPictureAction("${name}")`)) !== "started") throw new Error("no button self-test");
          const clicked = await until(`the ${name} click`, async () => (existsSync(button) ? JSON.parse(readFileSync(button, "utf8")) : null), 10000);
          await sleep(300);  // activation.log is written off the main thread
          const raised = logLines().slice(from).filter((l) => /^\S+ \S+ \S+ (makeKey|orderFront)/.test(l) && !l.includes("NativeWidgetMacFramelessNSWindow"));
          return { ...clicked, raised };
        } finally {
          await appActive(true);
        }
      };
      const closed = await clickButton("close");
      const time = async () => (await cdp(t, "Runtime.evaluate", { expression: "({ paused: v.paused, time: v.currentTime, pip: !!document.pictureInPictureElement })", returnByValue: true })).result.value;
      const before = await time();
      await sleep(1000);
      const after = await time();
      if (!closed.closed || after.pip || after.paused || after.time === before.time) throw new Error(`close: ${JSON.stringify({ closed, before, after })}`);
      if (!closed.preventsActivation || closed.activations !== 0 || closed.appActive || closed.raised.length)
        throw new Error(`the close click activated or raised something: ${JSON.stringify(closed)}`);
      const requests = (await eventsOf(tab.id)).filter((x) => x.name === "activateRequest").length;
      const back = await clickButton("backToTab");
      const backRequests = (await eventsOf(tab.id)).filter((x) => x.name === "activateRequest").length - requests;
      if (!back.closed || !back.preventsActivation || back.activations !== 1 || backRequests !== 1)
        throw new Error(`Chrome's Back to Tab: ${JSON.stringify({ back, backRequests })}`);
      return {
        steps: result.steps.map((x) => x.step),
        closeButton: closed.point,
        playing: [before.time.toFixed(1), after.time.toFixed(1)],
        close: { activations: closed.activations, raised: closed.raised.length },
        backToTab: { activations: back.activations, activateRequests: backRequests },
      };
    } finally {
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("page-focus", async () => {
    // onPageFocus: a click into the other page of a split (Chrome's focus path as in a key window: devFocusPage) makes
    // that tab the active one, as the app does on CEF. The app's own focus() isn't the user's and sends none.
    const other = await openTab(`${base}/b?focus`, "Page B", true);
    try {
      const split = await evalApp(`return ac.store.getState().createSplit(["${first.id}", "${other.id}"])`);
      if (!split) throw new Error("no split");
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
      await until("A active, both shown", async () => (await state()).active === first.id && (await evalApp(`return !!ac.webviews.get("${other.id}")`)), 8000);
      await sleep(500);
      const before = (await eventsOf(other.id)).filter((x) => x.name === "focus").length;
      await evalApp(`return ac.webviews.get("${other.id}").focus()`);
      await sleep(600);
      const fromApp = (await eventsOf(other.id)).filter((x) => x.name === "focus").length - before;
      await evalApp(`return ac.webviews.get("${first.id}").focus()`);
      await sleep(600);
      if ((await state()).active !== first.id) throw new Error("the app's focus() switched tabs");
      const took = await cef(`devFocusPage(${await browserOf(other.id)})`);
      const focus = await until("onPageFocus", async () => {
        const all = (await eventsOf(other.id)).filter((x) => x.name === "focus");
        return all.length > before + fromApp ? all.at(-1) : null;
      }, 5000);
      await until("the clicked pane active", async () => (await state()).active === other.id, 5000);
      if (fromApp) throw new Error(`the app's own focus() sent onPageFocus (${fromApp})`);
      const front = execFileSync("lsappinfo", ["front"]).toString();
      if (execFileSync("lsappinfo", ["info", "-only", "pid", front.trim()]).toString().includes(`=${child.pid}`)) throw new Error("the app took focus");
      return { took, focus: focus.name, active: "clicked pane" };
    } finally {
      await closeTab(other.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  // MARK: Page full screen
  // A page's element full screen (requestFullscreen, with a gesture): the fullscreen event for that tab, the app's flag
  // (pageState, which hides the toolbar and sidebar), the page's document.fullscreenElement and the window's macOS full
  // screen. A test instance acts the window's full screen out (no Space on the owner's screen): devWindow "fullScreen"
  // reads it, "fakeFullScreen:<1|0>" stands in for the green button and ⌃⌘F.
  const fsFlag = (tabId) => evalApp(`return !!ac.pageState.getState().pages[${JSON.stringify(tabId)}]?.fullscreen`);
  const fsWindow = async (tabId, action = "fullScreen") => {
    const n = await cef(`devWindowNumber(${await browserOf(tabId)})`);
    const out = await cef(`devWindow(${n}, ${JSON.stringify(action)})`);
    try {
      return JSON.parse(out);
    } catch {
      throw new Error(`devWindow ${action}: ${JSON.stringify(out)} (a build without page full screen?)`);
    }
  };
  const fsElement = async (t) => (await cdp(t, "Runtime.evaluate", { expression: "!!document.fullscreenElement", returnByValue: true })).result.value;
  const fsRequest = (t) => cdp(t, "Runtime.evaluate", { expression: "document.documentElement.requestFullscreen().then(() => 'ok', (e) => e.name)", awaitPromise: true, userGesture: true, returnByValue: true });
  const fsEvents = async (tabId) => (await eventsOf(tabId)).filter((x) => x.name === "fullscreen").map((x) => x.payload.fullscreen);
  // The page in full screen: its event, the app's flag and the page itself agree.
  const fsEnter = async (tabId, t) => {
    const asked = await fsRequest(t);
    await until("the page in full screen", async () => (await fsFlag(tabId)) && (await fsElement(t)), 6000)
      .catch((e) => { throw new Error(`${e.message}; requestFullscreen: ${JSON.stringify(asked.result?.value)}`); });
  };
  const fsLeft = (tabId, t, what) => until(what, async () => !(await fsFlag(tabId)) && !(await fsElement(t)), 6000);
  const fsEscape = async (t) => {
    for (const type of ["rawKeyDown", "keyUp"])
      await cdp(t, "Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53 });
  };

  await check("fullscreen-tab-switch", async () => {
    // A in full screen, then B and back (A → B → A): Chrome ends A's full screen on the switch, and the app hears it
    // for A (not for B, the tab Chrome selected by then), so A comes back with its toolbar and sidebar. The window
    // leaves the macOS full screen it entered for A.
    const tab = await openTab(`${base}/b?fs-switch`, "Page B");
    try {
      const t = await pageFor(tab.id, "/b?fs-switch");
      await fsEnter(tab.id, t);
      const during = await fsWindow(tab.id);
      const bBefore = await fsEvents(first.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
      await until("B shown", async () => (await state()).active === first.id);
      await until("A's flag cleared on the switch", async () => !(await fsFlag(tab.id)), 5000)
        .catch(async (e) => { throw new Error(`${e.message}; A's events ${JSON.stringify(await fsEvents(tab.id))}, B's ${JSON.stringify((await fsEvents(first.id)).slice(bBefore.length))}`); });
      await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
      await until("A shown again", async () => (await state()).active === tab.id);
      await sleep(600);
      const back = { flag: await fsFlag(tab.id), element: await fsElement(t), window: await fsWindow(tab.id) };
      const bGot = (await fsEvents(first.id)).slice(bBefore.length);
      if (back.flag || back.element || back.window.fullScreen) throw new Error(`A back in full screen: ${JSON.stringify(back)}`);
      if (bGot.length) throw new Error(`B got A's full-screen events: ${JSON.stringify(bGot)}`);
      if (!during.fullScreen || !during.pageFullScreen?.entered) throw new Error(`the window didn't go full screen for A: ${JSON.stringify(during)}`);
      return { during, aEvents: await fsEvents(tab.id), bEvents: bGot.length, back };
    } finally {
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("fullscreen-native", async () => {
    // Page full screen takes the window into macOS full screen and back, as Chrome on the Mac and 0.2.21: from a normal
    // window (Esc, the green button), from a window already in full screen (which stays), and with the page leaving or
    // its tab closing while the window's transition runs.
    const tab = await openTab(`${base}/b?fs-native`, "Page B");
    const out = {};
    try {
      const t = await pageFor(tab.id, "/b?fs-native");
      const win = () => fsWindow(tab.id);
      const settled = (what, test) => until(what, async () => {
        const w = await win();
        return !w.pageFullScreen?.transitioning && test(w) ? w : null;
      }, 6000).catch(async (e) => { throw new Error(`${e.message}; window ${JSON.stringify(await win())}`); });
      // From a normal window: in with the page, out with Esc.
      await fsEnter(tab.id, t);
      out.entered = await settled("the window in full screen", (w) => w.fullScreen && w.chromeCounts && w.pageFullScreen?.entered);
      await fsEscape(t);
      await fsLeft(tab.id, t, "Esc ended the page's full screen");
      out.esc = await settled("the window out of full screen after Esc", (w) => !w.fullScreen);
      // The green button (⌃⌘F) ends the page's full screen too.
      await fsEnter(tab.id, t);
      await settled("the window in full screen again", (w) => w.fullScreen);
      await fsWindow(tab.id, "fakeFullScreen:0");
      await fsLeft(tab.id, t, "the green button ended the page's full screen");
      out.greenButton = await settled("the window out after the green button", (w) => !w.fullScreen);
      // A window already in full screen: the page fills it, Esc leaves the window in full screen.
      await fsWindow(tab.id, "fakeFullScreen:1");
      await settled("the window in full screen by hand", (w) => w.fullScreen);
      await fsEnter(tab.id, t);
      out.alreadyEntered = await settled("the page full screen in a full-screen window", (w) => w.fullScreen && w.pageFullScreen && !w.pageFullScreen.entered);
      await fsEscape(t);
      await fsLeft(tab.id, t, "Esc in a window already full screen");
      await sleep(400);
      out.alreadyEsc = await win();
      if (!out.alreadyEsc.fullScreen) throw new Error(`Esc took the user's full-screen window out: ${JSON.stringify(out.alreadyEsc)}`);
      // ... and the green button there ends both.
      await fsEnter(tab.id, t);
      await fsWindow(tab.id, "fakeFullScreen:0");
      await fsLeft(tab.id, t, "the green button in a window already full screen");
      out.alreadyGreen = await settled("the window out", (w) => !w.fullScreen);
      // The page leaves while the window's transition into full screen runs: the window comes back out once it ends.
      await fsWindow(tab.id, "fakeFullScreenMs:1500");
      await fsEnter(tab.id, t);
      // The window's transition starts once the page has drawn its full-screen layout (a frame or a few).
      const mid = await until("the window's transition started", async () => {
        const w = await win();
        return w.pageFullScreen?.transitioning ? w : null;
      }, 2000).catch(() => win());
      await cdp(t, "Runtime.evaluate", { expression: "document.exitFullscreen().then(() => 'ok', (e) => e.name)", awaitPromise: true, returnByValue: true });
      await fsLeft(tab.id, t, "the page out mid-transition");
      out.midTransition = { during: mid.pageFullScreen, after: await settled("the window out after the transition", (w) => !w.fullScreen && !w.pageFullScreen?.entered) };
      if (!mid.pageFullScreen?.transitioning) throw new Error(`the transition had ended before the page left: ${JSON.stringify(mid)}`);
      // Its tab closes while the window goes full screen.
      await fsEnter(tab.id, t);
      const n = await cef(`devWindowNumber(${await browserOf(tab.id)})`);
      const closing = await until("the window's transition started", async () => {
        const w = JSON.parse(await cef(`devWindow(${n}, "fullScreen")`)).pageFullScreen;
        return w?.transitioning ? w : null;
      }, 2000).catch(async () => JSON.parse(await cef(`devWindow(${n}, "fullScreen")`)).pageFullScreen);
      if (!closing?.transitioning) throw new Error(`the transition had ended before the close: ${JSON.stringify(closing)}`);
      await closeTab(tab.id);
      // The window finishes going in (AppKit ignores a toggle mid-transition), then comes back out: two transitions.
      out.closedMidTransition = await until("the window out after its tab closed mid-transition", async () => {
        const w = JSON.parse(await cef(`devWindow(${n}, "fullScreen")`));
        return !w.fullScreen && !w.pageFullScreen?.transitioning && w.pageFullScreen?.page == null ? w : null;
      }, 6000).catch(async (e) => { throw new Error(`${e.message}; closing the tab mid-transition left ${await cef(`devWindow(${n}, "fullScreen")`)}`); });
      // A transition slower than the 3 s the window waits for one: the page's exit, after those 3 s and before the
      // window is in full screen, still takes the window out once it is.
      const slow = await openTab(`${base}/b?fs-slow`, "Page B");
      try {
        const st = await pageFor(slow.id, "/b?fs-slow");
        await fsWindow(slow.id, "fakeFullScreenMs:4500");
        await fsEnter(slow.id, st);
        await sleep(3300);
        await cdp(st, "Runtime.evaluate", { expression: "document.exitFullscreen().then(() => 'ok', (e) => e.name)", awaitPromise: true, returnByValue: true });
        await fsLeft(slow.id, st, "the page out during a slow transition");
        out.slowTransition = await until("the window out after a slow transition", async () => {
          const w = await fsWindow(slow.id);
          return !w.fullScreen && !w.pageFullScreen?.transitioning ? w : null;
        }, 15000).catch(async (e) => { throw new Error(`${e.message}; window ${JSON.stringify(await fsWindow(slow.id))}`); });
      } finally {
        await fsWindow(slow.id, "fakeFullScreenMs:0").catch(() => null);
        await closeTab(slow.id);
      }
      // The page leaves, then comes back while the window's slow way out runs (past 3 s): that transition's late end is
      // the app's own, not the user leaving by hand, so the page stays in full screen and the window goes back in.
      const again = await openTab(`${base}/b?fs-again`, "Page B");
      try {
        const at = await pageFor(again.id, "/b?fs-again");
        await fsEnter(again.id, at);
        await until("the window in full screen", async () => {
          const w = await fsWindow(again.id);
          return w.fullScreen && !w.pageFullScreen?.transitioning ? w : null;
        }, 6000);
        await fsWindow(again.id, "fakeFullScreenMs:4500");
        await cdp(at, "Runtime.evaluate", { expression: "document.exitFullscreen().then(() => 'ok', (e) => e.name)", awaitPromise: true, returnByValue: true });
        await fsLeft(again.id, at, "the page out, the window on its slow way out");
        await sleep(3300);
        await fsEnter(again.id, at);
        out.backDuringSlowExit = await until("the window back in full screen for the page", async () => {
          const w = await fsWindow(again.id);
          return w.fullScreen && !w.pageFullScreen?.transitioning ? w : null;
        }, 15000).catch(async (e) => { throw new Error(`${e.message}; page ${await fsFlag(again.id)}/${await fsElement(at)}, window ${JSON.stringify(await fsWindow(again.id))}`); });
        await sleep(800);
        if (!(await fsFlag(again.id)) || !(await fsElement(at))) throw new Error(`the late end of the app's transition took the page out: ${JSON.stringify(await fsWindow(again.id))}`);
      } finally {
        await fsWindow(again.id, "fakeFullScreenMs:0").catch(() => null);
        await closeTab(again.id);
      }
      const log = readFileSync(join(data, "activation.log"), "utf8").split("\n").filter((l) => l.includes("toggleFullScreen")).length;
      out.actedToggles = log;
      return out;
    } finally {
      await cef(`devWindow(${await cef(`devWindowNumber(${await browserOf(first.id)})`)}, "fakeFullScreenMs:0")`).catch(() => null);
      await closeTab(tab.id).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("fullscreen-transition-picture", async () => {
    // Through the window's full-screen transition AppKit shows only pictures of the window rendered from its own layers,
    // which hold none of a page's pixels (ACPageCover, ArcadiaCoreChromeWindow.mm): the probe renders the window that way at
    // every frame of an acted transition. In every one the page's place shows the page's picture with the layout it is
    // going to (the full-screen player on the way in, the windowed layout on the way out), never its bare background or
    // the layout it left. With the picture off (as up to 0.2.30) the same frames must be bare background, or the probe
    // proves nothing.
    const tab = await openTab(`${base}/fs-layout`, "FS layout");
    const act = async (action) => cef(`devWindow(${await cef(`devWindowNumber(${await browserOf(tab.id)})`)}, ${JSON.stringify(action)})`);
    try {
      const t = await pageFor(tab.id, "/fs-layout");
      const key = async () => {
        for (const type of ["keyDown", "keyUp"])
          await cdp(t, "Input.dispatchKeyEvent", { type, key: "f", code: "KeyF", text: type === "keyDown" ? "f" : undefined, windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 3 });
      };
      const settled = (what, full) => until(what, async () => {
        const w = await fsWindow(tab.id);
        const p = w.pageFullScreen;
        return w.fullScreen === full && p && !p.transitioning && !p.covered && !p.picturing && !p.telling ? w : null;
      }, 8000).catch(async (e) => { throw new Error(`${e.message}; window ${JSON.stringify(await fsWindow(tab.id))}`); });
      // A frame's page place, from its 8 × 6 grid of mean colours: the bare background, the full-screen player (red), the
      // windowed layout (the blue masthead along the top, the red player) or something else.
      const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const near = (c, ref, tol) => c.every((v, i) => Math.abs(v - ref[i]) <= tol);
      const kind = (f) => {
        if (!f.grid) return "none";
        const cells = f.grid.map(rgb);
        // Bare: one dark colour (the page's background, black once it's in full screen: Chrome's gutter).
        if (f.uniform >= 0.97 && cells.every((c) => Math.max(...c) < 32)) return "bare";
        if (cells.filter((c) => near(c, [220, 30, 30], 45)).length >= 44) return "full";
        if (cells.slice(0, 8).some((c) => c[2] > c[0] + 30) && cells.some((c) => c[0] > c[1] + 80)) return "windowed";
        return "other";
      };
      const run = async (cover) => {
        await act(`pageCover:${cover ? 1 : 0}`);
        await act("fakeFullScreenMs:800");
        await act("fullScreenProbe:9000");
        await key();
        await settled("the window in full screen", true);
        await key();
        await settled("the window out of full screen", false);
        const frames = JSON.parse(await act("fullScreenProbe"));
        // The acted transitions' frames, in and out, as AppKit's pictures would show them.
        const runs = [];
        for (const f of frames) {
          if (!f.transitioning) continue;
          const last = runs.at(-1);
          if (last && frames.indexOf(f) - last.end === 1) { last.frames.push(f); last.end = frames.indexOf(f); }
          else runs.push({ frames: [f], end: frames.indexOf(f) });
        }
        if (runs.length !== 2) throw new Error(`expected two transitions in the probe, got ${runs.length} (${frames.length} frames)`);
        // A frame rendered in the one main-thread turn between the window's resize and the app's layout at its new size
        // (ProbeFrame's relayout: the views still have the old size, shifted in the window's layer space) shows where
        // the views aren't; it's counted apart, and a transition may have at most one.
        const tally = (r, want) => {
          const laid = r.frames.filter((f) => !f.relayout);
          const kinds = laid.map(kind);
          return { frames: kinds.length, relayout: r.frames.length - laid.length, bare: kinds.filter((k) => k === "bare").length,
            stale: kinds.filter((k) => k !== want && k !== "bare").length, uncovered: laid.filter((f) => !f.cover).length,
            kinds: [...new Set(kinds)], bareAtMs: laid.filter((f, i) => kinds[i] === "bare").map((f) => f.t - r.frames[0].t) };
        };
        // From the key (the probe starts just before it) to each transition's start, and from its end to the page
        // showing through again.
        const keyAt = frames[0]?.t ?? 0;
        const timing = (r) => {
          const start = r.frames[0].t, end = r.frames.at(-1).t;
          const shown = frames.find((f) => f.t > end && !f.cover)?.t;
          return { startsMs: start - keyAt, lastsMs: end - start, uncoversMs: shown != null ? shown - end : null };
        };
        return { in: { ...tally(runs[0], "full"), ...timing(runs[0]) }, out: { ...tally(runs[1], "windowed"), ...timing(runs[1]) } };
      };
      const off = await run(false);
      const on = await run(true);
      if (off.in.bare < off.in.frames * 0.9 || off.out.bare < off.out.frames * 0.9)
        throw new Error(`without the page's picture the probe didn't see the bare background: ${JSON.stringify(off)}`);
      for (const [dir, r] of Object.entries({ in: on.in, out: on.out }))
        if (r.bare || r.stale || r.uncovered || r.frames < 10 || r.relayout > 1) throw new Error(`the way ${dir}: ${JSON.stringify(r)}; all ${JSON.stringify(on)}`);
      // A split: on the way out both panes come back, and both lend the window their pictures.
      const other = await openTab(`${base}/fs-layout?pane`, "FS layout");
      let split;
      try {
        if (!(await evalApp(`return ac.store.getState().createSplit(["${tab.id}", "${other.id}"])`))) throw new Error("no split");
        await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
        await until("the split shown", async () => (await state()).active === tab.id && (await evalApp(`return !!ac.webviews.get("${other.id}")`)), 8000);
        await sleep(500);
        await key();
        await settled("the pane's window in full screen", true);
        await act("fullScreenProbe:5000");
        await key();
        await settled("the split's window out of full screen", false);
        const frames = JSON.parse(await act("fullScreenProbe")).filter((f) => f.transitioning);
        split = { frames: frames.length, bothCovered: frames.filter((f) => f.covers >= 2).length };
        if (frames.length < 10 || split.bothCovered !== frames.length) throw new Error(`a split's way out left a pane without its picture: ${JSON.stringify(split)}`);
      } finally {
        await closeTab(other.id);
      }
      return { on, off: { in: off.in.kinds, out: off.out.kinds }, split };
    } finally {
      await act("pageCover:1").catch(() => null);
      await act("fakeFullScreenMs:0").catch(() => null);
      await closeTab(tab.id).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("fullscreen-hidden-page", async () => {
    // The app hiding a full-screen page without Chrome's tab strip changing (its New Tab page, another Space) ends the
    // page's full screen (and its locks), as a tab switch does; a split's other pane hiding while one pane fills the
    // window doesn't end that pane's.
    const tab = await openTab(`${base}/b?fs-hide`, "Page B");
    const s = await state();
    let profileB = null;
    const out = {};
    try {
      const t = await pageFor(tab.id, "/b?fs-hide");
      // The app's New Tab page.
      await fsEnter(tab.id, t);
      const lock = (await cdp(t, "Runtime.evaluate", { expression: "Promise.resolve(document.body.requestPointerLock()).then(() => !!document.pointerLockElement, (e) => e.name)", awaitPromise: true, userGesture: true, returnByValue: true })).result.value;
      const keys = (await cdp(t, "Runtime.evaluate", { expression: "navigator.keyboard.lock().then(() => 'locked', (e) => e.name)", awaitPromise: true, userGesture: true, returnByValue: true })).result.value;
      const ntp = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(s.windowId)})`);
      await until("the New Tab page shown", async () => (await state()).active === ntp);
      await fsLeft(tab.id, t, "the New Tab page ended the page's full screen");
      out.newTab = { pointerLock: lock, keyboardLock: keys, pointerLockAfter: (await cdp(t, "Runtime.evaluate", { expression: "!!document.pointerLockElement", returnByValue: true })).result.value, window: await fsWindow(tab.id) };
      if (out.newTab.pointerLockAfter) throw new Error(`pointer lock kept: ${JSON.stringify(out.newTab)}`);
      await closeTab(ntp);
      await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
      await until("the page shown again", async () => (await state()).active === tab.id);
      await sleep(500);
      if ((await fsFlag(tab.id)) || (await fsElement(t))) throw new Error("the page came back in full screen");
      // Another Space.
      await fsEnter(tab.id, t);
      profileB = await evalApp(`return ac.store.getState().createProfile({ name: "Full screen" })`);
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(s.windowId)}, ${JSON.stringify(profileB)}); return true`);
      await until("the other Space shown", async () => (await state()).profileId === profileB);
      await fsLeft(tab.id, t, "the Space switch ended the page's full screen");
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(s.windowId)}, ${JSON.stringify(s.profileId)}); return true`);
      await until("the first Space back", async () => (await state()).profileId === s.profileId && (await state()).active === tab.id);
      await sleep(500);
      out.space = { flag: await fsFlag(tab.id), element: await fsElement(t), window: await fsWindow(tab.id) };
      if (out.space.flag || out.space.element || out.space.window.fullScreen) throw new Error(`back from the Space in full screen: ${JSON.stringify(out.space)}`);
      // A split: the other pane hides while this one fills the window; this one stays in full screen.
      const split = await evalApp(`return ac.store.getState().createSplit(["${tab.id}", "${first.id}"])`);
      if (!split) throw new Error("no split");
      await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
      await until("the split shown", async () => (await state()).active === tab.id && (await evalApp(`return !!ac.webviews.get("${first.id}")`)), 8000);
      await sleep(400);
      await fsEnter(tab.id, t);
      await sleep(1000);
      out.split = { flag: await fsFlag(tab.id), element: await fsElement(t) };
      if (!out.split.flag || !out.split.element) throw new Error(`the split pane's full screen ended: ${JSON.stringify(out.split)}`);
      await cdp(t, "Runtime.evaluate", { expression: "document.exitFullscreen().then(() => 'ok', (e) => e.name)", awaitPromise: true, returnByValue: true });
      await fsLeft(tab.id, t, "the split pane out of full screen");
      return out;
    } finally {
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(s.windowId)}, ${JSON.stringify(s.profileId)}); return true`).catch(() => null);
      if (profileB) await evalApp(`ac.store.getState().deleteProfile(${JSON.stringify(profileB)}); return true`).catch(() => null);
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("fullscreen-split-sibling", async () => {
    // One pane of a split in page full screen: the split stays shown under it, so the other pane's playing video
    // doesn't pop out into Picture in Picture and Chrome still counts that page as shown. The tab is muted.
    const video = await openTab(`${base}/video?split`, "Video");
    const tab = await openTab(`${base}/b?fs-split`, "Page B");
    try {
      await evalApp(`return ac.webviews.get("${video.id}").setMuted(true)`);
      const split = await evalApp(`return ac.store.getState().createSplit(["${tab.id}", "${video.id}"])`);
      if (!split) throw new Error("no split");
      await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
      await until("the split shown", async () => (await state()).active === tab.id && (await evalApp(`return !!ac.webviews.get("${video.id}")`)), 8000);
      const v = await startVideo(video.id, true);
      await until("live.playingAudio", async () => (await live(video.id))?.playingAudio === true, 8000);
      await sleep(500);
      const pipBefore = (await eventsOf(video.id)).filter((x) => x.name === "pictureInPicture").length;
      const t = await pageFor(tab.id, "/b?fs-split");
      await fsEnter(tab.id, t);
      await sleep(1500);
      const pip = (await eventsOf(video.id)).filter((x) => x.name === "pictureInPicture").slice(pipBefore).map((x) => x.payload);
      const sibling = (await cdp(v, "Runtime.evaluate", { expression: "({ pip: !!document.pictureInPictureElement, visibility: document.visibilityState, paused: v.paused })", returnByValue: true })).result.value;
      await cdp(t, "Runtime.evaluate", { expression: "document.exitFullscreen().then(() => 'ok', (e) => e.name)", awaitPromise: true, returnByValue: true });
      await fsLeft(tab.id, t, "the pane out of full screen");
      if (pip.length || sibling.pip || sibling.visibility !== "visible" || sibling.paused)
        throw new Error(`the other pane counted as hidden: ${JSON.stringify({ pip, sibling })}`);
      return { sibling };
    } finally {
      await closeTab(tab.id);
      await closeTab(video.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("fullscreen-pip", async () => {
    // "f", then "f" on a playing video (the owner's YouTube case), 20 times on a page without Media Session handlers
    // and 20 on one with YouTube's, the window's full screen acted out at a real transition's length (700 ms) and its
    // occlusion as a real Space animation reports it: occluded as the transition starts, visible again from before the
    // did-enter/did-exit notification to well after it. Picture in Picture never opens, not even for a moment. Then
    // the window really leaves the user (occluded, no transition): the video pops out, and comes back when the window
    // shows again. The tab is muted: nothing is heard.
    const n = await cef(`devWindowNumber(${await browserOf(first.id)})`);
    const win = (action) => cef(`devWindow(${n}, ${JSON.stringify(action)})`);
    const pressF = async (t) => {
      for (const type of ["keyDown", "keyUp"])
        await cdp(t, "Input.dispatchKeyEvent", { type, key: "f", code: "KeyF", text: type === "keyDown" ? "f" : undefined, windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 3 });
    };
    const pipEvents = async (tabId) => (await eventsOf(tabId)).filter((x) => x.name === "pictureInPicture");
    const gaps = [-150, 0, 40, 120, 300];
    const out = {};
    try {
      await win("fakeOcclusion:visible");
      await win("fakeFullScreenMs:700");
      for (const [path, name] of [["/video?fkey", "plain"], ["/video?fkey&handlers", "handlers"]]) {
        const tab = await openTab(`${base}${path}`, "Video");
        try {
          await evalApp(`return ac.webviews.get("${tab.id}").setMuted(true)`);
          const t = await startVideo(tab.id, true);
          await until("live.playingAudio", async () => (await live(tab.id))?.playingAudio === true, 8000);
          await until("onNowPlaying playing", async () => lastEvent(tab.id, "nowPlaying", (p) => p.state?.hasVideo && p.state?.playbackState === "playing"), 5000);
          await sleep(300);
          const seen = new Set((await pipEvents(tab.id)).map((x) => x.t));
          const settled = (what, test) => until(what, async () => {
            const w = await fsWindow(tab.id);
            return !w.pageFullScreen?.transitioning && test(w) ? w : null;
          }, 6000);
          for (let i = 0; i < 20; i++) {
            const gap = gaps[i % gaps.length];
            await win(`fakeFullScreenOcclusionMs:${gap}`);
            await pressF(t);
            await settled(`round ${i}: in full screen`, (w) => w.fullScreen && w.pageFullScreen?.page != null);
            await sleep(Math.max(0, gap) + 150);
            await pressF(t);
            await settled(`round ${i}: out of full screen`, (w) => !w.fullScreen && w.pageFullScreen?.page == null);
            // The occlusion's return, and anything it sets off.
            await sleep(Math.max(0, gap) + 600);
            const fresh = (await pipEvents(tab.id)).filter((x) => !seen.has(x.t));
            const page = (await cdp(t, "Runtime.evaluate", { expression: "({ pip: !!document.pictureInPictureElement, paused: v.paused, fs: !!document.fullscreenElement })", returnByValue: true })).result.value;
            if (fresh.length || page.pip || page.fs || page.paused) {
              const timeline = (await eventsOf(tab.id)).filter((x) => x.name === "fullscreen" || x.name === "pictureInPicture").slice(-6)
                .map((x) => `${x.t} ${x.name} ${JSON.stringify(x.payload)}`);
              throw new Error(`${name}, round ${i} (visible again ${gap} ms after the transition): ${JSON.stringify({ pip: fresh.map((x) => x.payload), page, timeline })}`);
            }
          }
          out[name] = { rounds: 20, pipWindows: (await pipWindows())?.length ?? null };
          if (name !== "plain") continue;
          // The user leaves the window: the video pops out, and comes back with the window.
          await win("fakeOcclusion:occluded");
          const popped = await until("auto PiP on leaving the window", async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === "video" && p.active), 5000);
          await win("fakeOcclusion:visible");
          await until("auto PiP ended with the window back", async () => {
            const e = await lastEvent(tab.id, "pictureInPicture");
            return e && e.t > popped.t && !e.payload.active ? e : null;
          }, 5000);
          out.leftWindow = "popped out and back";
          // With the setting off nothing pops out, and a window the user opened by hand still closes when they come
          // back to the page (another tab and back, the window covered and back).
          await evalApp(`ac.store.getState().updateSettings({ autoPictureInPicture: false }); return true`);
          try {
            out.manual = {};
            for (const [what, leave, back] of [
              ["tab", () => evalApp(`ac.actions.switchToTab("${first.id}"); return true`), () => evalApp(`ac.actions.switchToTab("${tab.id}"); return true`)],
              ["window", () => win("fakeOcclusion:occluded"), () => win("fakeOcclusion:visible")],
            ]) {
              if ((await evalApp(`return ac.webviews.get("${tab.id}").requestPictureInPicture()`)) !== true) throw new Error("requestPictureInPicture failed");
              const opened = await until("PiP opened by hand", async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === "video" && p.active), 5000);
              await leave();
              await sleep(800);
              await back();
              out.manual[what] = (await until(`the hand-opened PiP closed coming back (${what})`, async () => {
                const e = await lastEvent(tab.id, "pictureInPicture");
                return e && e.t > opened.t && !e.payload.active ? e : null;
              }, 5000)).payload;
            }
          } finally {
            await evalApp(`ac.store.getState().updateSettings({ autoPictureInPicture: true }); return true`);
          }
        } finally {
          await closeTab(tab.id);
        }
      }
      return out;
    } finally {
      for (const action of ["fakeFullScreenOcclusionMs:-1", "fakeFullScreenMs:0", "fakeOcclusion:off"]) await win(action).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  // MARK: Pages, profiles and windows

  await check("autofill-suggestions", async () => {
    // Chrome's autofill dropdown in a page: an entry this profile submitted, offered on a click into the field and
    // picked with ↓ and Return (the release smoke test's steps); the same dropdown from the app's Autofill command
    // (ArcadiaChromeUI.showAutofillSuggestions, reported by the engine's tab:didShowAutofillSuggestions:); and the
    // saved passwords from the command's "passwords".
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    const go = async (path, title) => {
      await evalApp(`ac.store.getState().navigate("${first.id}", "${base}${path}", { userInitiated: true }); return true`);
      await until(title, async () => (await state()).tabs.find((t) => t.id === first.id && t.title === title && t.url?.endsWith(path) && !t.loading), 10000);
      await sleep(500);
      return pageFor(first.id, `${base}${path}`);
    };
    const shownSince = async (count, needle) => {
      const all = (await eventsOf(first.id)).filter((x) => x.name === "autofillSuggestions");
      return all.length > count && JSON.stringify(all.at(-1).payload.items).includes(needle) ? all.at(-1) : null;
    };
    const shownCount = async () => (await eventsOf(first.id)).filter((x) => x.name === "autofillSuggestions").length;
    const key = async (t, k) => {
      const code = { ArrowDown: 40, Enter: 13, Escape: 27 }[k];
      const at = { key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      await cdp(t, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...at, ...(k === "Enter" ? { text: "\r" } : {}) });
      if (k === "Enter") await cdp(t, "Input.dispatchKeyEvent", { type: "char", ...at, text: "\r" });
      await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", ...at });
    };
    const value = async (t) => (await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('c').value", returnByValue: true })).result.value;
    try {
      let t = await go("/form", "Form");
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('c').value = 'Springfield'; document.getElementById('b').click(); 1" });
      t = await until("the form submitted", async () => (await state()).tabs.find((x) => x.id === first.id && x.url?.includes("/form?city=") && !x.loading) && pageFor(first.id, "/form?city="), 10000);
      await sleep(1500);
      // As the smoke test: a DevTools navigation, no focus() from the app, the click alone (the page took focus when
      // the app loaded it, as on CEF).
      await cdp(t, "Page.navigate", { url: `${base}/form` });
      await until("the form again", async () => (await state()).tabs.find((x) => x.id === first.id && x.url === `${base}/form` && !x.loading), 10000);
      await sleep(800);
      t = await pageFor(first.id, `${base}/form`);
      let count = await shownCount();
      const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('c').getBoundingClientRect())", returnByValue: true })).result.value);
      const at = { x: box.x + 20, y: box.y + box.height / 2, button: "left", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at, buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at, buttons: 0 });
      const clicked = await until("the dropdown on a click", async () => shownSince(count, "Springfield"), 6000);
      await sleep(300);
      await key(t, "ArrowDown");
      await sleep(300);
      await key(t, "Enter");
      const picked = await until("the picked entry in the field", async () => ((await value(t)) === "Springfield" ? true : null), 4000)
        .catch(async (e) => { throw new Error(`${e.message}; field "${await value(t)}"`); });
      // The app's Autofill command on the focused field.
      await cdp(t, "Runtime.evaluate", { expression: "const c = document.getElementById('c'); c.value = ''; c.blur(); c.focus(); 1", userGesture: true });
      await sleep(400);
      count = await shownCount();
      const browser = await browserOf(first.id);
      const shown = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.showAutofillSuggestions(${browser}, false)`);
      const command = await until("the dropdown from showAutofillSuggestions", async () => shownSince(count, "Springfield"), 6000)
        .catch((e) => { throw new Error(`${e.message}; showAutofillSuggestions answered ${shown}`); });
      // Saved passwords (the command's "passwords"), on a sign-in form.
      await cef(`savePassword("", ${JSON.stringify(base)}, "nnfill", "fill-s3cret")`);
      t = await go("/login?fill", "Login");
      await evalApp(`return ac.webviews.get("${first.id}").focus()`);
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('u').focus(); 1", userGesture: true });
      // Chrome offers the saved sign-in as the field takes focus: that dropdown goes (Esc) before the command's.
      await sleep(1000);
      await key(t, "Escape");
      await sleep(400);
      count = await shownCount();
      await evalApp(`ac.runCommand({ command: "autofill", arg: "passwords", windowId: ${JSON.stringify(mainWindow)} }); return true`);
      const passwords = await until("the saved passwords", async () => shownSince(count, "nnfill"), 6000)
        .catch(async (e) => {
          const direct = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.showAutofillSuggestions(${browser}, true)`);
          await sleep(1500);
          throw new Error(`${e.message}; direct ${direct}; saved ${JSON.stringify(await cef(`listPasswords("")`)).slice(0, 300)}; shown ${JSON.stringify((await eventsOf(first.id)).filter((x) => x.name === "autofillSuggestions").map((x) => x.payload))}`);
        });
      const labels = (e) => e.payload.items.map((i) => `${i.label} (${i.type})`);
      return { click: labels(clicked), picked, command: labels(command), shown, passwords: labels(passwords) };
    } finally {
      await cef(`deletePassword("", ${JSON.stringify(base)}, "nnfill")`).catch(() => null);
      await backToA();
    }
  });

  await check("images", async () => {
    // The page's images and favicons as data: PNGs (downloadImage, downloadFavicon, fetchFavicon).
    const image = await evalApp(`return ac.webviews.get("${first.id}").downloadImage("${base}/icon.png", 64)`);
    const favicon = await evalApp(`return ac.webviews.get("${first.id}").downloadFavicon("${base}/icon.png")`);
    const fetched = await cef(`fetchFavicon("${base}/icon.png", "")`);
    const isData = (r) => JSON.stringify(r ?? null).includes("data:image/png");
    if (!isData(image) || !isData(favicon) || !isData(fetched)) throw new Error(`not data URLs: ${JSON.stringify({ image, favicon, fetched }).slice(0, 300)}`);
    return { image: true, favicon: true, fetched: true };
  });

  await check("favicon-fetch", async () => {
    // fetchFavicon with no tab (restored and unloaded tabs, bookmarks, history) goes through Chrome's network stack
    // with the profile's own loader, as Chrome fetches icons: plain http to any host (App Transport Security exempts
    // only 127.0.0.1, so NSURLSession failed *.localhost and the web), no cookies or credentials, redirects followed,
    // 200 only, at most 2 MB, Chrome's favicon types only, and a time-out. A private window fetches through its own
    // profile and never one it would have to make.
    const png = (side, rgb) => {
      const chunk = (type, body) => {
        const out = Buffer.alloc(12 + body.length);
        out.writeUInt32BE(body.length, 0);
        out.write(type, 4, "ascii");
        body.copy(out, 8);
        out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
        return out;
      };
      const header = Buffer.alloc(13);
      header.writeUInt32BE(side, 0);
      header.writeUInt32BE(side, 4);
      header.set([8, 2, 0, 0, 0], 8);
      const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: side }, () => Buffer.from(rgb)))]);
      return Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: side }, () => row)))),
        chunk("IEND", Buffer.alloc(0)),
      ]);
    };
    const icon = png(16, [0, 160, 0]);
    // An .ico holding that PNG, served as text/plain: Chrome decodes favicons by their bytes.
    const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(8), icon]);
    ico.writeUInt32LE(icon.length, 14);
    ico.writeUInt32LE(22, 18);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0a0"/></svg>`;
    // A TIFF: AppKit decodes it, Chrome never takes one as a favicon.
    const pngPath = join(scratch, "favicon-fetch.png"), tiffPath = join(scratch, "favicon-fetch.tiff");
    writeFileSync(pngPath, icon);
    execFileSync("sips", ["-s", "format", "tiff", pngPath, "--out", tiffPath], { stdio: "ignore" });
    const tiff = readFileSync(tiffPath);
    const seen = [];
    const hung = new Set();
    const icons = createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      seen.push({ path: url.pathname + url.search, host: req.headers.host, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null });
      const send = (status, type, body, headers = {}) => {
        res.writeHead(status, { "content-type": type, ...headers });
        res.end(body);
      };
      if (url.pathname === "/set-cookie") return send(200, "text/html", "<!doctype html><title>Favicon Cookie</title>", { "set-cookie": "nnfav=1; path=/" });
      if (url.pathname === "/icon.png") return send(200, "image/png", icon);
      if (url.pathname === "/icon.ico") return send(200, "text/plain", ico);
      if (url.pathname === "/icon.svg") return send(200, "image/svg+xml", svg);
      if (url.pathname === "/svg-as-text") return send(200, "text/plain", svg);
      if (url.pathname === "/icon.tiff") return send(200, "image/png", tiff);
      if (url.pathname === "/redirect") return send(302, "text/plain", "", { location: "/icon.png?redirected" });
      if (url.pathname === "/missing") return send(404, "image/png", icon);
      if (url.pathname === "/auth") return send(401, "image/png", icon, { "www-authenticate": 'Basic realm="nnfav"' });
      if (url.pathname === "/oversized") return send(200, "image/png", Buffer.concat([icon, Buffer.alloc(3 * 1024 * 1024)]));
      if (url.pathname === "/hang") return hung.add(res);
      send(404, "text/plain", "no");
    });
    await new Promise((r) => icons.listen(0, "127.0.0.1", r));
    // *.localhost is loopback to Chrome, but not ATS-exempt as 127.0.0.1 is.
    const favBase = `http://nnfav.localhost:${icons.address().port}`;
    const fetchIcon = async (url, profile = "") => {
      const started = Date.now();
      const r = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.fetchFavicon(${JSON.stringify(url)}, ${JSON.stringify(profile)})`, 60000);
      return { uri: typeof r?.uri === "string" ? r.uri.slice(0, 22) : null, width: r?.width ?? null, ms: Date.now() - started };
    };
    const ok = (r) => r.uri === "data:image/png;base64,";
    let privateWindow = null;
    try {
      // The time-out runs alongside everything else (in the app: the dev harness answers one script at a time).
      await evalApp(`const h = (globalThis.acFaviconHang = { started: Date.now() });
        globalThis.expo.modules.ArcadiaCEF.fetchFavicon(${JSON.stringify(`${favBase}/hang`)}, "").then((r) => { h.uri = r?.uri ?? null; h.ms = Date.now() - h.started; }, () => { h.uri = null; h.ms = Date.now() - h.started; });
        return true`);
      // A cookie the profile holds for the host: the icon request never carries it.
      const cookieTab = await openTab(`${favBase}/set-cookie`, "Favicon Cookie");
      const cookie = (await cdp(await pageFor(cookieTab.id, "/set-cookie"), "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
      await closeTab(cookieTab.id);
      if (!cookie.includes("nnfav=1")) throw new Error(`the profile has no cookie for the host: "${cookie}"`);
      const accepted = {
        png: await fetchIcon(`${favBase}/icon.png?cookie`),
        ico: await fetchIcon(`${favBase}/icon.ico`),
        svg: await fetchIcon(`${favBase}/icon.svg`),
        redirect: await fetchIcon(`${favBase}/redirect`),
        https: await fetchIcon("https://github.githubassets.com/favicons/favicon.svg"),
      };
      const refused = {
        missing: await fetchIcon(`${favBase}/missing`),
        auth: await fetchIcon(`${favBase}/auth`),
        oversized: await fetchIcon(`${favBase}/oversized`),
        tiff: await fetchIcon(`${favBase}/icon.tiff`),
        svgAsText: await fetchIcon(`${favBase}/svg-as-text`),
        noHost: await fetchIcon("http://nnfav-nowhere.invalid/favicon.ico"),
        notHttp: await fetchIcon("file:///System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns"),
      };
      const bad = [
        ...Object.entries(accepted).filter(([, r]) => !ok(r)).map(([k, r]) => `${k} not loaded (${JSON.stringify(r)})`),
        ...Object.entries(refused).filter(([, r]) => r.uri !== null).map(([k]) => `${k} loaded`),
      ];
      if (bad.length) throw new Error(bad.join("; "));
      const iconRequest = seen.find((s) => s.path === "/icon.png?cookie");
      if (!iconRequest || iconRequest.cookie) throw new Error(`the icon request carried cookies: ${JSON.stringify(iconRequest)}`);
      if (!seen.some((s) => s.path === "/icon.png?redirected")) throw new Error("the redirect wasn't followed");
      if (seen.some((s) => s.authorization)) throw new Error("credentials were sent");
      // A remote plain-http icon (the dogfood repro's): required when this script reaches it too, else only reported.
      const remoteUrl = "http://neverssl.com/favicon.ico";
      const reachable = await fetch(remoteUrl, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok, () => false);
      const remoteFetch = await fetchIcon(remoteUrl);
      if (reachable && !ok(remoteFetch)) throw new Error(`${remoteUrl} not loaded (${JSON.stringify(remoteFetch)})`);
      const remote = `${ok(remoteFetch) ? "ok" : "null"}${reachable ? "" : " (not reachable from this script)"}`;
      // A private window's profile: fetched through it, handed back as data (Chrome's favicon store refuses it). A
      // private profile no window shows is never made for a fetch. Native calls take the engine's profile name
      // (incognito:<window>@<engine profile>, the app's engineProfile), not the store's id (…@default).
      const noWindow = await fetchIcon(`${favBase}/icon.png?no-private-window`, "incognito:nnfav@");
      if (noWindow.uri !== null) throw new Error("a fetch made a private profile");
      privateWindow = await evalApp(`return ac.actions.openWindow({ incognito: true, url: "${favBase}/icon.png?private-page" })`);
      const privateProfile = await until("the private window's engine profile", async () =>
        (await evalApp(`return globalThis.expo.modules.ArcadiaCEF.tabStrips()`)).strips.find((st) => st.appWindow === privateWindow)?.profile ?? null, 10000);
      if (!privateProfile.startsWith("incognito:")) throw new Error(`the private window's engine profile: ${JSON.stringify(privateProfile)}`);
      await until("the private page", () => (seen.some((s) => s.path === "/icon.png?private-page") ? true : null), 10000);
      const privately = await fetchIcon(`${favBase}/icon.png?private`, privateProfile);
      if (!ok(privately)) throw new Error(`the private window's fetch failed: ${JSON.stringify(privately)}`);
      const stored = JSON.parse(await cef(`engineCall("ac_favicons_set", ${JSON.stringify(privateProfile)}, ${JSON.stringify(JSON.stringify({ page: `${favBase}/private-page`, icon: `${favBase}/icon.png?private`, png: "AA==" }))})`).catch((e) => JSON.stringify({ refused: String(e) })));
      if (!stored?.error) throw new Error(`a private profile wrote Chrome's favicon store: ${JSON.stringify(stored)}`);
      // The time-out: nil after Chrome's 30 s, never a hang.
      const timedOut = await until("the hung request's end", () => evalApp(`const h = globalThis.acFaviconHang; return h.ms ? { uri: h.uri ? h.uri.slice(0, 22) : null, ms: h.ms } : null`), 50000);
      if (timedOut.uri !== null || timedOut.ms < 25000 || timedOut.ms > 50000) throw new Error(`the hung request: ${JSON.stringify(timedOut)}`);
      const ms = (o) => Object.fromEntries(Object.entries(o).map(([k, r]) => [k, r.ms]));
      return { accepted: ms(accepted), refused: ms(refused), timedOutMs: timedOut.ms, remote, private: { noWindow: null, open: "data", storeSet: stored.error } };
    } finally {
      if (privateWindow) await evalApp(`ac.store.getState().closeWindow("${privateWindow}"); return true`).catch(() => null);
      for (const res of hung) res.destroy();
      icons.close();
    }
  });

  await check("extension-surfaces", async () => {
    // An installed extension's action state and side panel for a tab, reload, and its DNR blocks counted on the page
    // (onContentBlocked).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const browser = await browserOf(first.id);
    const states = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.actionStates(${browser}, ["${installed.id}"])`);
    if (!states?.[installed.id]) throw new Error(`no action state: ${JSON.stringify(states)}`);
    const panel = await evalApp(`return globalThis.expo.modules.ArcadiaChromeUI.sidePanelURL(${browser}, "${installed.id}")`);
    const reloaded = await exts(`reload("${installed.id}", "")`);
    if (reloaded?.error) throw new Error(`reload: ${reloaded.error}`);
    await sleep(1000);
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/blocking", { userInitiated: true }); return true`);
    const blocked = await until("onContentBlocked", async () =>
      (await eventsOf(first.id)).findLast((x) => x.name === "contentBlocked" && x.payload?.count >= 2), 10000).catch(() => null);
    await exts(`uninstall("${installed.id}", "")`);
    await evalApp(`ac.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    if (!blocked) throw new Error("no onContentBlocked count for the extension's blocked images");
    return { state: states[installed.id], panel, reloaded: true, blocked: blocked.payload };
  });

  await check("frozen", async () => {
    // The app freezes a background page (setFrozen) and wakes it; the page sees freeze and resume.
    const s = await state();
    const other = s.tabs.find((x) => x.id !== first.id && x.id !== s.active && x.url?.startsWith(`${base}/d`));
    if (!other) throw new Error("no background tab");
    const t = await pageTarget(`${base}/d`);
    await cdp(t, "Runtime.evaluate", { expression: "window.__life = []; document.addEventListener('freeze', () => __life.push('freeze')); document.addEventListener('resume', () => __life.push('resume')); true" });
    await evalApp(`return ac.webviews.get("${other.id}")?.setFrozen(true)`);
    await sleep(1500);
    await evalApp(`return ac.webviews.get("${other.id}")?.setFrozen(false)`);
    const life = await until("freeze and resume", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(window.__life)", returnByValue: true });
      const l = JSON.parse(r.result.value ?? "[]");
      return l.includes("freeze") && l.includes("resume") ? l : null;
    }, 8000);
    return { life };
  });

  await check("discard", async () => {
    // A tab in the background discarded by Chrome keeps its place; the app hears onDiscarded.
    const s = await state();
    let other = null;
    for (const x of s.tabs.filter((x) => x.id !== first.id && x.id !== s.active && x.url?.startsWith(base)))
      if (await evalApp(`return !!ac.webviews.get(${JSON.stringify(x.id)})`)) { other = x; break; }
    if (!other) throw new Error("no background tab to discard");
    const ok = await evalApp(`return ac.webviews.get("${other.id}").discard()`);
    const e = await until("onDiscarded", async () => (await eventsOf(other.id)).find((x) => x.name === "discarded"), 8000);
    return { ok, url: e.payload.url };
  });

  await check("permission-prompt", async () => {
    // A site asking for a permission reaches the app's prompt (onPermission → pageState.permission), and its answer
    // goes back to Chrome. Chrome holds a background tab's prompt until it shows, so the page is shown first.
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      // MIDI with sysex: a Chrome permission with no macOS prompt behind it (location and the camera would ask macOS).
      expression: "navigator.requestMIDIAccess({ sysex: true }).then(() => (window.__geo = 'ok'), (e) => (window.__geo = 'denied:' + e.name))",
      userGesture: true,
    });
    const request = await until("the prompt", async () => evalApp(`return ac.pageState.getState().pages["${first.id}"]?.permission ?? null`), 10000);
    await cef(`resolvePermission("${request.id}", "deny", false)`);
    const answer = await until("the page's answer", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "String(window.__geo)", returnByValue: true });
      return r.result.value !== "undefined" ? r.result.value : null;
    }, 10000);
    return { permissions: request.permissions, origin: request.origin, answer };
  });

  await check("popup-blocked", async () => {
    // A popup without a user gesture: Chrome's blocker keeps it, the app hears of it and can open it. The page is
    // loaded again first: the checks before gave it a user activation (CDP's userGesture), which would let it through.
    await evalApp(`return ac.webviews.get("${first.id}").reload()`);
    await sleep(1500);
    await until("A loaded", async () => (await state()).tabs.find((t) => t.id === first.id && !t.loading), 10000);
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: `window.open("${base}/c?blocked")` });
    const popups = await until("the blocked popup", async () => {
      const p = await evalApp(`return ac.pageState.getState().pages["${first.id}"]?.popups ?? []`);
      return p.length ? p : null;
    }, 10000);
    await evalApp(`return ac.webviews.get("${first.id}").openBlockedPopup("${popups[0].id}")`);
    const opened = await until("the popup as a tab", async () => (await state()).tabs.find((x) => x.url?.includes("c?blocked")), 10000);
    return { popup: popups[0].url, tab: opened.id };
  });

  await check("second-profile", async () => {
    const s = await state();
    const id = await evalApp(`return ac.store.getState().createProfile({ name: "Work" })`);
    if (!id) throw new Error("no profile made");
    await evalApp(`ac.actions.switchProfile("${s.windowId}", "${id}"); return true`);
    await until("profile shown", async () => (await state()).profileId === id);
    await evalApp(`ac.actions.openUrls(["${base}/cookie?B"], ${JSON.stringify(mainWindow)}); return true`);
    const tb = await until("cookie page in B", async () => (await state()).tabs.find((x) => x.profileId === id && x.url?.includes("/cookie")));
    const targetsNow = await targets();
    const b = targetsNow.find((t) => t.url.includes("/cookie?B"));
    const a = targetsNow.find((t) => t.url.startsWith(`${base}/a`));
    const cookieA = (await cdp(a, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    const cookieB = (await cdp(b, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    if (cookieA.includes("who=B")) throw new Error("profile A sees B's cookie");
    const windows = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`);
    await evalApp(`ac.actions.switchProfile("${s.windowId}", "${s.profileId}"); return true`);
    return { profile: id, tab: tb.id, cookieB, cookieA, chromeWindows: windows.chromeWindows };
  });

  await check("settings-window", async () => {
    const before = await evalApp(`return ac.shell.windowIds()`);
    await evalApp(`ac.openSettings(); return true`);
    const after = await until("a settings window", async () => {
      const ids = await evalApp(`return ac.shell.windowIds()`);
      return ids.length > before.length ? ids : null;
    });
    return { before, after };
  });
  await check("incognito-window", async () => {
    const id = await evalApp(`return ac.actions.openWindow({ incognito: true, url: "${base}/b?private" })`);
    const t = await until("a private tab", async () => {
      const tabs = await evalApp(`const s = ac.store.getState(); return (s.windows["${id}"]?.tabIds ?? []).map((i) => ({ url: s.tabs[i]?.url, title: s.tabs[i]?.title, profile: s.tabs[i]?.profileId }))`);
      return tabs.find((x) => x.title === "Page B") ?? null;
    });
    return { window: id, tab: t };
  });

  // A window whose content mounts late (a window opened under load: devMountDelay in main.tsx holds it back 5 s).
  const slowMount = async (body) => {
    await evalApp(`globalThis.acDevMountDelayMs = 5000; return true`);
    try {
      return await body();
    } finally {
      await evalApp(`globalThis.acDevMountDelayMs = 0; return true`);
    }
  };
  const closeWindowOf = (tabId) =>
    evalApp(`const s = ac.store.getState(); const w = s.tabs[${JSON.stringify(tabId)}]?.windowId; if (w && w !== ${JSON.stringify(mainWindow)}) s.closeWindow(w); return true`);

  // MARK: Moving tabs

  await check("move-tab-slow-mount", async () => {
    // A tab moved to a window that mounts its view late keeps its page (the same WebContents: its history, its state):
    // the page waits for the tab's next view however long that takes.
    const tab = await openTab(`${base}/a?slow`, "Page A");
    try {
      await evalApp(`ac.store.getState().navigate("${tab.id}", "${base}/b?slow", { userInitiated: true }); return true`);
      await until("B", async () => (await state()).tabs.find((t) => t.id === tab.id && t.title === "Page B" && !t.loading));
      await cdp(await pageFor(tab.id, "/b?slow"), "Runtime.evaluate", { expression: "window.__kept = 42" });
      const browser = await browserOf(tab.id);
      const windowId = await slowMount(async () => {
        const id = await evalApp(`return ac.store.getState().moveTabsToWindow(["${tab.id}"], null)`);
        // Past the mount delay.
        await sleep(6000);
        return id;
      });
      await until("the tab's view in the new window", () => evalApp(`return !!ac.webviews.get("${tab.id}") && ac.store.getState().tabs["${tab.id}"]?.windowId === "${windowId}"`), 10000);
      await sleep(500);
      const t = await pageFor(tab.id, "/b?slow");
      const page = t && (await cdp(t, "Runtime.evaluate", { expression: "({ kept: String(window.__kept), entries: history.length })", returnByValue: true })).result.value;
      const after = await browserOf(tab.id);
      if (page?.kept !== "42" || page?.entries !== 2 || String(after) !== String(browser))
        throw new Error(`the page reloaded or went: ${JSON.stringify({ page, browser, after })}`);
      return { windowId, page, browser };
    } finally {
      await closeWindowOf(tab.id);
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("move-last-tab-slow-mount", async () => {
    // A window's last tab moved to a new window that mounts late: the old window closes at once, its Browser with it,
    // and the tab's page still waits for its new view.
    const tab = await openTab(`${base}/a?last`, "Page A");
    try {
      const own = await evalApp(`return ac.store.getState().moveTabsToWindow(["${tab.id}"], null)`);
      await until("the tab's view in a window of its own", () => evalApp(`return !!ac.webviews.get("${tab.id}") && ac.store.getState().tabs["${tab.id}"]?.windowId === "${own}"`), 10000);
      await sleep(500);
      await cdp(await pageFor(tab.id, "/a?last"), "Runtime.evaluate", { expression: "window.__kept = 42" });
      const browser = await browserOf(tab.id);
      const windowId = await slowMount(async () => {
        const id = await evalApp(`return ac.store.getState().moveTabsToWindow(["${tab.id}"], null)`);
        await until("its first window gone", () => evalApp(`return !ac.store.getState().windows["${own}"]`), 5000);
        await sleep(6000);
        return id;
      });
      await until("the tab's view in the new window", () => evalApp(`return !!ac.webviews.get("${tab.id}") && ac.store.getState().tabs["${tab.id}"]?.windowId === "${windowId}"`), 10000);
      await sleep(500);
      const t = await pageFor(tab.id, "/a?last");
      const page = t && (await cdp(t, "Runtime.evaluate", { expression: "String(window.__kept)", returnByValue: true })).result.value;
      const after = await browserOf(tab.id);
      if (page !== "42" || String(after) !== String(browser)) throw new Error(`the page reloaded or went: ${JSON.stringify({ page, browser, after })}`);
      return { windowId, page, browser };
    } finally {
      await closeWindowOf(tab.id);
      await closeTab(tab.id);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("move-tab-closed-while-parked", async () => {
    // A moved tab closed before its new view took its page: the page (and its renderer) goes with the tab.
    const tab = await openTab(`${base}/c?parked`, "Page C");
    const target = await pageFor(tab.id, "/c?parked");
    try {
      return await slowMount(async () => {
        await evalApp(`ac.store.getState().moveTabsToWindow(["${tab.id}"], null); return true`);
        // Its view gone (the new window's is 5 s away): the page lives on, parked.
        await until("the old view gone", () => evalApp(`return !ac.webviews.get("${tab.id}")`), 3000);
        await sleep(300);
        if (!(await targets()).some((x) => x.id === target.id)) throw new Error("the page went before its tab closed");
        await closeTab(tab.id);
        const closed = Date.now();
        await until("the parked page gone", async () => !(await targets()).some((x) => x.id === target.id), 1500);
        return { goneAfterMs: Date.now() - closed };
      });
    } finally {
      await closeWindowOf(tab.id).catch(() => null);
      await closeTab(tab.id).catch(() => null);
      await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("move-tab-to-window", async () => {
    // The tab keeps its page (same WebContents: no reload) in the new window.
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: "window.__kept = 42" });
    const windowId = await evalApp(`const id = ac.store.getState().moveTabsToWindow(["${first.id}"], null); return id`);
    await until("the tab in the new window", async () => evalApp(`return ac.store.getState().tabs["${first.id}"]?.windowId === "${windowId}" && ac.store.getState().windows["${windowId}"]?.tabIds.includes("${first.id}")`));
    await sleep(1500);
    const t2 = await pageTarget(`${base}/a`);
    const kept = (await cdp(t2, "Runtime.evaluate", { expression: "String(window.__kept)", returnByValue: true })).result.value;
    if (kept !== "42") throw new Error(`the page reloaded or went: ${kept}`);
    const tx = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.tabStrips()`);
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindowNumber(${browser})`);
    const holding = tx.strips.find((x) => x.tabs.some((tab) => tab.browser === Number(browser)));
    if (!holding || holding.window !== windowNumber) throw new Error(`the tab's strip is window ${holding?.window}, its view is in ${windowNumber}`);
    return { windowId, kept, strip: holding.strip, window: holding.window };
  });

  // MARK: Startup and engine

  await check("title-bar-close", async () => {
    // The title bar's close button on the second window: ArcadiaCore asks the app (windowShouldClose:), which closes it.
    const ids = await evalApp(`return ac.shell.windowIds()`);
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindowNumber(${browser})`);
    const clicked = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.devWindow(${windowNumber}, "close-button")`);
    const after = await until("one window fewer", async () => {
      const now = await evalApp(`return ac.shell.windowIds()`);
      return now.length < ids.length ? now : null;
    }, 10000);
    return { clicked, before: ids.length, after: after.length };
  });

  await check("little-arcadia", async () => {
    const before = await evalApp(`return Object.keys(ac.store.getState().windows)`);
    await evalApp(`ac.runCommand({ command: "newLittleArcadia" }); return true`);
    const id = await until("a Little Arcadia window", async () => {
      const w = await evalApp(`return Object.values(ac.store.getState().windows).find((w) => w.kind === "small")?.id ?? null`);
      return w;
    });
    const tabId = await until("its tab", async () => evalApp(`return ac.store.getState().windows["${id}"]?.tabIds[0] ?? null`));
    await evalApp(`ac.store.getState().navigate("${tabId}", "${base}/b?small", { userInitiated: true }); return true`);
    await until("Page B in Little Arcadia", async () => evalApp(`return ac.store.getState().tabs["${tabId}"]?.title === "Page B"`));
    return { window: id, tab: tabId };
  });

  await check("startup-native-messaging", async () => {
    // As packages/cef's ACCef at startup (ArcadiaCoreStartup.mm): the password managers installed on this Mac get their
    // native messaging manifests in the user data dir (only those whose host exists, listed as ours), and Chrome
    // runs a host from that dir for an extension it names (an echo host here: no real app is started).
    const dir = join(data, "Chromium", "NativeMessagingHosts");
    const known = {
      "com.1password.1password": "/Applications/1Password.app/Contents/Library/LoginItems/1Password Browser Helper.app/Contents/MacOS/1Password-BrowserSupport",
      "com.8bit.bitwarden": "/Applications/Bitwarden.app/Contents/MacOS/desktop_proxy",
      "org.keepassxc.keepassxc_browser": "/Applications/KeePassXC.app/Contents/MacOS/keepassxc-proxy",
      "me.proton.pass.nm": "/Applications/Proton Pass.app/Contents/Resources/assets/proton_pass_nm_host",
    };
    const expected = Object.keys(known).filter((name) => existsSync(known[name])).sort();
    const managed = JSON.parse(existsSync(join(dir, ".arcadia-managed.json")) ? readFileSync(join(dir, ".arcadia-managed.json"), "utf8") : "[]");
    for (const name of expected) {
      const manifest = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
      if (manifest.name !== name || manifest.type !== "stdio" || !existsSync(manifest.path)) throw new Error(`${name}: ${JSON.stringify(manifest)}`);
    }
    if (JSON.stringify(managed.slice().sort()) !== JSON.stringify(expected)) throw new Error(`managed ${JSON.stringify(managed)}, expected ${JSON.stringify(expected)}`);

    const ext = join(scratch, "fixture-ext-nm");
    cpSync(extPath, ext, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
    manifest.permissions = [...manifest.permissions, "nativeMessaging"];
    writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest, null, 2));
    const installed = await exts(`install(${JSON.stringify(ext)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const host = join(scratch, "echo-host.sh");
    writeFileSync(host, "#!/bin/sh\nexec cat\n", { mode: 0o755 });
    const hostManifest = join(dir, "com.arcadia.acceptance.echo.json");
    writeFileSync(hostManifest, JSON.stringify({ name: "com.arcadia.acceptance.echo", description: "echo", path: host, type: "stdio", allowed_origins: [`chrome-extension://${installed.id}/`] }));
    try {
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.runtime?.sendNativeMessage", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      const reply = await cdp(worker, "Runtime.evaluate", {
        expression: `chrome.runtime.sendNativeMessage("com.arcadia.acceptance.echo", { ping: 42 }).then((r) => JSON.stringify(r), (e) => "error: " + e.message)`,
        awaitPromise: true,
        returnByValue: true,
      });
      const echoed = reply.result?.value;
      if (echoed !== JSON.stringify({ ping: 42 })) throw new Error(`echo host: ${echoed}`);
      return { hosts: expected, echoed };
    } finally {
      rmSync(hostManifest, { force: true });
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
    }
  });

  await check("startup-accept-language", async () => {
    // As CEF's accept_language_list (ArcadiaCoreStartup.mm, --accept-lang): pages see the system's preferred languages,
    // "<language>-<region>" then "<language>", in navigator.languages and the Accept-Language header. (Chrome's own
    // default follows the app bundle's English UI locale: "en-US,en" whatever the system's languages.)
    const system = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e",
      `ObjC.import("Foundation"); const out = []; const all = $.NSLocale.preferredLanguages;
       for (let i = 0; i < all.count; i++) { const l = $.NSLocale.localeWithLocaleIdentifier(all.objectAtIndex(i));
         out.push([ObjC.unwrap(l.languageCode), ObjC.unwrap(l.regionCode) ?? null, ObjC.unwrap(l.scriptCode) ?? null]); }
       JSON.stringify(out)`]).toString());
    const expected = [];
    for (let [language, region, script] of system) {
      if (!language) continue;
      if (language === "zh" && !region) region = script === "Hant" ? "TW" : "CN";
      for (const tag of region ? [`${language}-${region}`, language] : [language]) if (!expected.includes(tag)) expected.push(tag);
    }
    let header = null;
    const echo = createServer((req, res) => {
      header = req.headers["accept-language"] ?? "";
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>Languages</title>");
    });
    await new Promise((r) => echo.listen(0, "127.0.0.1", r));
    const tab = await openTab(`http://127.0.0.1:${echo.address().port}/languages`, "Languages");
    try {
      const t = await pageFor(tab.id, "/languages");
      const languages = (await cdp(t, "Runtime.evaluate", { expression: "navigator.languages", returnByValue: true })).result.value;
      const sent = (header ?? "").split(",").map((s) => s.split(";")[0].trim()).filter(Boolean);
      if (JSON.stringify(languages) !== JSON.stringify(expected)) throw new Error(`navigator.languages ${JSON.stringify(languages)}, expected ${JSON.stringify(expected)}`);
      if (JSON.stringify(sent) !== JSON.stringify(expected)) throw new Error(`Accept-Language "${header}", expected ${JSON.stringify(expected)}`);
      return { languages, header };
    } finally {
      await closeTab(tab.id);
      echo.close();
    }
  });

  await check("engine-call-guard", async () => {
    // As CEF's ACEngineBridge: the JS reaches only the stores it reads (history, favicons, closed tabs, bookmarks), and
    // never for a private window (the engine would answer with Personal's data).
    const parse = async (call) => JSON.parse(await cef(call));
    const privateHistory = await parse(`engineCall("ac_history_query", "incognito-check", null)`);
    const notAllowed = await parse(`engineCall("ac_passwords_list", "", null)`);
    const history = await parse(`engineCall("ac_history_query", "", ${JSON.stringify(JSON.stringify({ maxUrls: 5, maxVisits: 1 }))})`);
    if (!privateHistory.error || !notAllowed.error || history.error) throw new Error(JSON.stringify({ privateHistory, notAllowed, history }));
    return { privateHistory: privateHistory.error, notAllowed: notAllowed.error, historyEntries: history.entries?.length };
  });

  await check("devtools-toggle", async () => {
    // ⌥⌘I twice opens then closes DevTools (Chrome's IDC_DEV_TOOLS_TOGGLE, as CEF ran it); ⌥⌘J opens the console.
    const tab = await freshTab(`${base}/b?devtools`);
    const devtools = async () => (await targets()).filter((t) => t.url.startsWith("devtools://")).length;
    const handle = (panel) => evalApp(`return ac.webviews.get("${tab}").showDevTools(${JSON.stringify(panel)})`);
    await handle("toggle");
    const opened = await until("DevTools open", async () => ((await devtools()) > 0 ? await devtools() : null), 10000);
    await handle("toggle");
    await until("DevTools closed", async () => ((await devtools()) === 0 ? true : null), 10000);
    await handle("console");
    await until("DevTools on the console", async () => ((await devtools()) > 0 ? true : null), 10000);
    await handle("toggle");
    await until("DevTools closed again", async () => ((await devtools()) === 0 ? true : null), 10000);
    await evalApp(`ac.store.getState().closeTab("${tab}"); return true`);
    return { opened };
  });

  await check("navigation-download-memory", async () => {
    // A page that turned out to be a download is remembered (NavigationDownloads.json, as CEF's): a tab that opens on
    // it without the user asking (a restored tab) stays empty instead of downloading it again.
    const files = () => readdirSync(downloadsDir).filter((f) => f.startsWith("arcadiacore-test")).length;
    const before = files();
    const tab = await freshTab(`${base}/b?memory`);
    await evalApp(`ac.store.getState().navigate("${tab}", "${base}/file.bin?memory", { userInitiated: true }); return true`);
    await until("the download", async () => (files() > before ? true : null), 15000);
    const saved = JSON.parse(readFileSync(join(data, "Chromium", "NavigationDownloads.json"), "utf8"));
    if (!saved[`${base}/file.bin?memory`]) throw new Error(`not remembered: ${JSON.stringify(saved)}`);
    // A tab the app restores on it (its saved tab, as a relaunch or a reopened window brings back: not the user asking,
    // which downloads it again, as on CEF).
    await evalApp(`ac.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${base}/file.bin?memory", snapshot: { url: "${base}/file.bin?memory", title: "file.bin" } }); return true`);
    const skipped = await until("downloadNavigation skipped", async () => {
      for (const t of (await state()).tabs) {
        const e = (await eventsOf(t.id)).find((x) => x.name === "downloadNavigation" && x.payload?.skipped);
        if (e) return { tab: t.id, payload: e.payload };
      }
      return null;
    }, 10000);
    await sleep(1500);
    const after = files();
    if (after !== before + 1) throw new Error(`downloaded ${after - before} times`);
    return { skipped, downloads: after - before };
  });

  await check("delete-original-profile-data", async () => {
    // Deleting the original profile's data (Chrome's Default profile, whose folder stays): each store is emptied and
    // checked, as packages/cef's ProfileData.deleteDefault.
    const origin = "https://original.test";
    await cef(`savePassword("", "${origin}", "nnoriginal", "s3cret")`);
    await cef(`saveAddress("", { fullName: "Original Mascot", city: "Haifa", country: "IL" })`);
    await cef(`setZoom("", "original.test", 1.5)`);
    await cef(`setSiteSetting("", "${origin}", "popups", "allow")`);
    await until("the data saved", async () => {
      const p = await cef(`listPasswords("")`), a = await cef(`listAddresses("")`), z = await cef(`getZoomLevels("")`), o = await cef(`getSiteSettingsOrigins("")`);
      return p.passwords?.length && a.addresses?.length && z["original.test"] && o.length ? true : null;
    });
    const result = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.deleteProfileData("")`, 60000);
    const p = await cef(`listPasswords("")`), a = await cef(`listAddresses("")`), z = await cef(`getZoomLevels("")`), o = await cef(`getSiteSettingsOrigins("")`);
    const left = { passwords: p.passwords?.length, addresses: a.addresses?.length, zoom: Object.keys(z).length, origins: o.length };
    if (result?.remaining?.length || Object.values(left).some(Boolean)) throw new Error(JSON.stringify({ result, left }));
    return { remaining: result.remaining, left };
  });

  // MARK: Quitting and relaunching

  await check("last-used-profile", async () => {
    // Before the quit: Personal sets a cookie, then the window shows another profile, so that profile is Chrome's
    // last used when the app quits (the relaunch check after the quit).
    const s = await state();
    personal = s.profileId;
    await evalApp(`ac.actions.switchToTab("${first.id}"); return true`);
    const before = new Set(s.tabs.map((x) => x.id));
    await evalApp(`ac.actions.openUrls(["${base}/cookie?personal"], ${JSON.stringify(mainWindow)}); return true`);
    await until("Personal's cookie page", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.title === "Cookie" && !x.loading), 10000);
    const play = await evalApp(`return ac.store.getState().createProfile({ name: "Play" })`);
    await evalApp(`ac.actions.switchProfile("${s.windowId}", "${play}"); return true`);
    await until("Play shown", async () => (await state()).profileId === play);
    await evalApp(`ac.actions.openUrls(["${base}/cookie?play"], ${JSON.stringify(mainWindow)}); return true`);
    await until("Play's cookie page", async () => (await state()).tabs.find((x) => x.profileId === play && x.url?.includes("cookie?play") && !x.loading), 10000);
    await sleep(1000);
    return { personal, play };
  });

  await check("quit", async () => {
    const s = await state();
    // A tab opened just before quitting must be in the saved session: the app saved it on the way out
    // (willQuit → flushPersistence, the documents flushed on willTerminate).
    await evalApp(`ac.actions.openUrls(["${base}/quit-marker"], "${s.windowId}"); return true`);
    await until("the marker tab", async () => (await state()).tabs.some((x) => x.url?.includes("quit-marker")));
    const started = Date.now();
    // ⌘Q → the app's Quit item → NSApp terminate: → applicationShouldTerminate (the app saves its session) →
    // ArcadiaCore's quit. The app may exit before the harness answers.
    await evalApp(`return ac.shell.devKeyEquivalent("${s.windowId}", { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" })`, 5000).catch(() => null);
    await until("the app to exit", async () => exited, 20000);
    await sleep(4000);  // a crash in teardown writes its report a moment after the process is gone
    const saved = readFileSync(join(data, "session.json"), "utf8").includes("quit-marker");
    if (!saved) throw new Error("the session wasn't saved on quit");
    // This instance's reports only (another run may be going alongside). ExcUserFault reports are os_fault logs
    // the process survives; they're listed, crashes fail the check.
    const dir = join(process.env.HOME, "Library/Logs/DiagnosticReports");
    const ours = readdirSync(dir).filter((f) => {
      if (!f.includes(basename(exe)) || statSync(join(dir, f)).mtimeMs < launchedAt) return false;
      try {
        return new RegExp(`"pid"\\s*:\\s*${child.pid}\\b`).test(readFileSync(join(dir, f), "utf8").slice(0, 8000));
      } catch {
        return false;
      }
    });
    const crashes = ours.filter((f) => !f.startsWith("ExcUserFault_"));
    if (crashes.length) throw new Error(`crash report: ${crashes}`);
    return { exitedAfterMs: Date.now() - started, sessionSaved: saved, faults: ours.filter((f) => f.startsWith("ExcUserFault_")) };
  });

  await check("relaunch-profile", async () => {
    // Relaunched with another profile last used: Personal is still Chrome's Default profile (its cookie, not Play's).
    if (!personal) throw new Error("last-used-profile didn't run");
    await launch("app2.out.log");
    await until("the relaunched app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    const windowId = await until("a window", async () => (await state()).windowId, 30000);
    mainWindow = windowId;
    await evalApp(`ac.actions.switchProfile("${windowId}", "${personal}"); return true`);
    await until("Personal shown", async () => (await state()).profileId === personal, 10000);
    const before = new Set((await state()).tabs.map((x) => x.id));
    await evalApp(`ac.actions.openUrls(["${base}/b?personal-again"], ${JSON.stringify(windowId)}); return true`);
    await until("a Personal page", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.title === "Page B" && !x.loading), 15000);
    const t = await pageTarget(`${base}/b?personal-again`);
    const cookie = (await cdp(t, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    const info = await evalApp(`return globalThis.expo.modules.ArcadiaCEF.chromeWindows()`);
    // The next check launches the app again only once this one has gone.
    await stopApp();
    if (!cookie.includes("who=personal") || cookie.includes("who=play")) throw new Error(`Personal's page sees "${cookie}"`);
    return { cookie, windows: info.map((w) => w.profile) };
  });

  const pressQuit = (windowId) =>
    evalApp(`return ac.shell.devKeyEquivalent("${windowId}", { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" })`, 5000).catch(() => null);
  const savedSession = () => (existsSync(join(data, "session.json")) ? readFileSync(join(data, "session.json"), "utf8") : "");
  const restored = async (urlPart) => {
    await appUp("app-restored.out.log");
    return until(`${urlPart} restored`, async () => (await state()).tabs.find((t) => t.url?.includes(urlPart)) ?? null, 15000);
  };

  await check("quit-cancelled", async () => {
    // ⌘Q, a page's beforeunload answered Stay: the app keeps running and keeps saving (it stopped saving for the
    // quit). Then a new tab, ⌘Q answered Leave: the relaunch restores that tab.
    const windowId = await appUp("app-quit-cancelled.out.log");
    await evalApp(`ac.actions.openUrls(["${base}/b?stay"], "${windowId}"); return true`);
    await until("the page loaded", async () => (await state()).tabs.find((t) => t.url?.includes("b?stay") && t.title === "Page B" && !t.loading), 15000);
    const target = await until("the page", () => pageTarget(`${base}/b?stay`), 15000);
    await cdp(target, "Runtime.evaluate", { expression: `addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; }); true`, userGesture: true });
    // Chrome's beforeunload prompt, answered through DevTools (Page.handleJavaScriptDialog) with `leave`.
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = () => j(new Error("DevTools connection failed")))));
    let leave = false;
    const prompts = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.method !== "Page.javascriptDialogOpening") return;
      prompts.push({ type: msg.params.type, leave });
      ws.send(JSON.stringify({ id: 100 + prompts.length, method: "Page.handleJavaScriptDialog", params: { accept: leave } }));
    };
    ws.send(JSON.stringify({ id: 1, method: "Page.enable" }));
    try {
      await sleep(300);
      await pressQuit(windowId);
      await until("the beforeunload prompt", async () => prompts.length === 1, 10000);
      await sleep(1500);
      if (exited) throw new Error("the app quit though the page said Stay");
      await evalApp(`ac.actions.openUrls(["${base}/c?after-stay"], "${windowId}"); return true`);
      await until("the tab after Stay saved", async () => savedSession().includes("after-stay"), 10000);
      leave = true;
      const started = Date.now();
      await pressQuit(windowId);
      await until("the app to exit", async () => exited, 20000);
      const exitMs = Date.now() - started;
      if (!savedSession().includes("after-stay")) throw new Error("the second quit didn't save the session");
      const tab = await restored("after-stay");
      return { prompts, exitMs, restored: tab.url };
    } finally {
      try { ws.close(); } catch {}
    }
  });

  await check("content-blocker-restored", async () => {
    // A tab the app restores at launch asks for ads as it loads: the content blocker loads into Personal as the app
    // starts, after Chrome has loaded the profile, and ArcadiaCore holds Personal's navigations until its rulesets are in
    // force, so none of the restored page's ads goes out.
    const windowId = await appUp("app-blocker-restored.out.log");
    const tag = `restored-${Date.now()}`;
    const url = `http://adpage.test:${server.address().port}/adfirst?${tag}`;
    const loaded = (id) => evalApp(`const s = ac.store.getState(); const t = s.tabs[${JSON.stringify(id)}];
      return t?.title === "Ad first" && !s.live[${JSON.stringify(id)}]?.isLoading ? true : null`);
    const id = await evalApp(`const s = ac.store.getState(); const id = s.newTab(${JSON.stringify(windowId)}, { url: ${JSON.stringify(url)} });
      ac.store.getState().activate(id); return id`);
    await until("the ad page", () => loaded(id), 15000);
    const beforeQuit = adsServedFor(tag);
    await until("the ad page saved", async () => savedSession().includes(tag), 10000);
    await pressQuit(windowId);
    await until("the app to exit", async () => exited, 20000);
    const relaunched = Date.now();
    const tab = await restored(tag);
    await until("the restored page loaded", () => loaded(tab.id), 20000);
    await sleep(500);
    const afterLaunch = adsServedFor(tag).slice(beforeQuit.length);
    if (beforeQuit.length || afterLaunch.length) throw new Error(`ads went out: ${JSON.stringify({ beforeQuit, afterLaunch })}`);
    return { restored: tab.url, loadedAfterMs: Date.now() - relaunched - 500 };
  });

  await check("closed-tabs-own-lists", async () => {
    // Two tabs on the same page closed a moment apart: ⇧⌘T gives each its own back/forward list (Chrome's
    // TabRestoreService entry carries the closed tab's id, ac_tab_restore_tag), and after a quit too, from Chrome's file.
    let windowId = await appUp("app-closed-tabs.out.log");
    const s = (expr) => evalApp(`const s = ac.store.getState(); return ${expr}`);
    const entries = (id) => evalApp(`return ac.webviews.get(${JSON.stringify(id)})?.navigationEntries().then((e) => e.map((x) => { const u = new URL(x.url); return u.pathname + u.search; })) ?? null`);
    const onSamePage = async (tag) => {
      const id = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(windowId)}, { url: "${base}/a?${tag}" })`);
      await until(`A?${tag}`, async () => (await s(`s.tabs["${id}"]?.title === "Page A" && !s.live["${id}"]?.isLoading && !!ac.webviews.get("${id}")`)) || null, 15000);
      await evalApp(`ac.store.getState().navigate("${id}", "${base}/b?same", { userInitiated: true }); return true`);
      await until(`B from A?${tag}`, async () => (await s(`s.tabs["${id}"]?.title === "Page B" && s.live["${id}"]?.canGoBack && !s.live["${id}"]?.isLoading`)) || null, 15000);
      return id;
    };
    const a = await onSamePage("first-closed"), b = await onSamePage("second-closed");
    await sleep(1000);
    const closed = Object.fromEntries(await evalApp(`const s = ac.store.getState(); s.closeTab("${a}"); s.closeTab("${b}");
      return ac.store.getState().closedTabs.filter((c) => c.tabId === "${a}" || c.tabId === "${b}").map((c) => [c.tabId, c.id])`));
    if (!closed[a] || !closed[b]) throw new Error(`closed entries: ${JSON.stringify(closed)}`);
    await sleep(1500);
    const reopen = async (entryId, expected) => {
      const id = await evalApp(`const s = ac.store.getState(); const before = new Set(Object.keys(s.tabs));
        s.restoreClosed(${JSON.stringify(entryId)}, ${JSON.stringify(windowId)});
        const id = Object.keys(ac.store.getState().tabs).find((t) => !before.has(t)); ac.store.getState().activate(id); return id`);
      const list = await until(`the reopened tab's list`, async () => {
        const e = await entries(id);
        return e?.includes("/b?same") ? e : null;
      }, 15000);
      if (JSON.stringify(list) !== JSON.stringify(expected)) throw new Error(`reopened ${entryId}: ${JSON.stringify(list)}, not ${JSON.stringify(expected)}`);
      await evalApp(`ac.store.getState().closeTab("${id}"); return true`);
      return list;
    };
    const first = await reopen(closed[a], ["/a?first-closed", "/b?same"]);
    await sleep(1500);
    // ⌘Q, as the owner quits, then the other one.
    await pressQuit(windowId);
    await until("the quit", async () => exited, 30000);
    windowId = await appUp("app-closed-tabs-2.out.log");
    const second = await reopen(closed[b], ["/a?second-closed", "/b?same"]);
    return { first, afterQuit: second };
  });

  await check("js-reload-keeps-pages", async () => {
    // A JS reload (development: Metro) parks each tab's page for its next view: the page isn't loaded again, nor
    // visited again in Chrome's history, and the tab keeps it.
    const windowId = await appUp("app-js-reload.out.log");
    const path = `/b?kept-${Date.now()}`;
    const visits = async () => JSON.parse(await cef(`engineCall("ac_history_query", "", "{}")`)).entries.filter((e) => e.u === `${base}${path}`).map((e) => e.v.length);
    const id = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(windowId)}, { url: "${base}${path}" })`);
    await until("the page", async () => (await state()).tabs.find((t) => t.id === id && t.title === "Page B" && !t.loading), 15000);
    await until("its visit", async () => (await visits()).length || null);
    // The session is saved a moment after a change; a reload before that wouldn't have the tab at all.
    await sleep(2000);
    await evalApp(`setTimeout(() => { try { globalThis.nativeModuleProxy.DevSettings.reload(); } catch {} }, 50); return true`);
    await sleep(1500);
    // A reloaded harness skips the script it finds waiting: asked again until the new bundle answers.
    await until("the reloaded app", async () => {
      try {
        return await evalApp(`const s = ac.store.getState(); return Object.keys(s.windows).length > 0 && !!s.historyReady.default && !!ac.webviews.get(${JSON.stringify(id)})`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 60000);
    await sleep(2000);
    const out = { loads: served.get(path), visits: await visits(), url: (await state()).tabs.find((t) => t.id === id)?.url };
    if (out.loads !== 1 || JSON.stringify(out.visits) !== "[1]" || out.url !== `${base}${path}`) throw new Error(`after the reload: ${JSON.stringify(out)}`);
    return out;
  });

  await check("quit-js-stall", async () => {
    // ⌘Q while the JS thread is busy for 2 s: the quit waits for the app's answer, and the tab opened at the end of
    // the stall (after the quit began) is in the saved session and restored.
    const windowId = await appUp("app-quit-stall.out.log");
    const started = Date.now();
    await evalApp(`ac.shell.devKeyEquivalent("${windowId}", { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" });
      const t = Date.now(); while (Date.now() - t < 2000) {}
      ac.actions.openUrls(["${base}/d?stalled"], "${windowId}"); return true`, 5000).catch(() => null);
    await until("the app to exit", async () => exited, 20000);
    const exitMs = Date.now() - started;
    if (!savedSession().includes("d?stalled")) throw new Error(`the quit didn't wait for the app's save (exited after ${exitMs} ms)`);
    const tab = await restored("d?stalled");
    return { exitMs, restored: tab.url };
  });

  await check("quit-js-hung", async () => {
    // ⌘Q while the JS thread never comes back: after 5 s the quit asks the user (Wait / Quit Without Saving); a test
    // instance logs it and waits. The instance is killed afterwards.
    const windowId = await appUp("app-quit-hung.out.log");
    const started = Date.now();
    await evalApp(`ac.shell.devKeyEquivalent("${windowId}", { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" });
      for (;;) {}`, 1000).catch(() => null);
    try {
      const line = await until("the quit alert's log", async () => appLog.join().split("\n").find((l) => l.includes("[shell] quit alert:")) ?? null, Math.max(0, 6000 - (Date.now() - started)));
      const ms = Date.now() - started;
      if (ms > 6000) throw new Error(`the alert came after ${ms} ms`);
      if (exited) throw new Error("the app quit without the answer");
      return { ms, line: line.slice(line.indexOf("[shell]")) };
    } finally {
      child.kill("SIGKILL");
      await until("the hung app gone", async () => exited, 10000).catch(() => null);
    }
  });

  await check("extension-tab-empty-window", async () => {
    // An extension's tabs.create while the app's window shows no page (its tabs closed: a New Tab placeholder only):
    // Chrome puts its tab in that window's Browser and the app adopts that very tab, once, in front, in that window
    // under its profile. It arrives through the placeholder's view (openWindow, adoptId tab:<browser>; the
    // extensions module's onTabs only when no view of the profile is shown anywhere: recorded, not asserted). The
    // extension's tab id stays that tab's: chrome.tabs sees it active, in the app window's Chrome window, loaded
    // once. With every app window closed, Chrome 154 itself refuses ("No current window"); recorded, not asserted.
    if (exited) await launch("app3.out.log");
    await until("the app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    const windowId = await until("a window", async () => (await state()).windowId, 30000);
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    await evalApp(`globalThis.__nnTabs = []; globalThis.__nnTabsSub?.remove();
      globalThis.__nnTabsSub = globalThis.expo.modules.ArcadiaExtensions.addListener("onTabs", (e) => globalThis.__nnTabs.push(e)); return true`);
    try {
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.tabs?.create", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      const create = async (url) => {
        const made = await cdp(worker, "Runtime.evaluate", {
          expression: `chrome.tabs.create({ url: "${url}" }).then((t) => JSON.stringify({ id: t.id, windowId: t.windowId }), (e) => "error: " + e.message)`,
          awaitPromise: true,
          returnByValue: true,
        });
        return made.result?.value ?? made.exceptionDetails?.exception?.description;
      };
      // The app's only window (earlier checks' windows closed: Chrome would pick its last active one), every tab of it
      // closed: the app keeps the window with a new-tab placeholder (no page).
      await evalApp(`const s = ac.store.getState(); Object.keys(s.windows).filter((id) => id !== "${windowId}").forEach((id) => s.closeWindow(id));
        s.closeTabs([...s.windows["${windowId}"].tabIds]); return true`);
      await until("one app window", async () => ((await evalApp(`return Object.keys(ac.store.getState().windows).length`)) === 1 ? true : null), 10000);
      const empty = await until("the window without pages", async () => {
        const s = await state();
        return s.windowId === windowId && s.tabs.every((t) => !t.url) ? s : null;
      }, 10000);
      await sleep(1000);
      const created = await create(`${base}/e?empty-window`);
      const made = JSON.parse(created.startsWith("{") ? created : "null");
      if (!made) throw new Error(`tabs.create: ${created}`);
      const shownTab = async () => {
        const s = await state();
        const tabs = s.tabs.filter((t) => t.url?.includes("e?empty-window"));
        return s.active === tabs[0]?.id && tabs[0].title === "Page E" && !tabs[0].loading ? { s, tabs } : null;
      };
      const { s: after, tabs: appTabs } = await until("the extension's tab shown as an app tab", shownTab, 10000)
        .catch(async (e) => { throw new Error(`${e.message}; tabs.create: ${created}; strips ${JSON.stringify(await cef(`tabStrips()`))}`); });
      await sleep(1500);
      const opened = appTabs[0];
      const chromeTab = JSON.parse((await cdp(worker, "Runtime.evaluate", {
        expression: `Promise.all([chrome.tabs.get(${made.id}).then((t) => ({ id: t.id, windowId: t.windowId, active: t.active, url: t.url }), (e) => ({ error: e.message })),
          chrome.tabs.query({}).then((ts) => ts.filter((t) => (t.url || t.pendingUrl || "").includes("e?empty-window")).map((t) => t.id))]).then(JSON.stringify)`,
        awaitPromise: true,
        returnByValue: true,
      })).result.value);
      const strips = (await cef(`tabStrips()`)).strips.filter((st) => st.appWindow === windowId);
      const strip = strips.find((st) => st.tabs.some((t) => t.key === opened.id));
      const out = {
        appTabs: (await state()).tabs.filter((t) => t.url?.includes("e?empty-window")).length,
        window: after.windowId === windowId,
        profile: opened.profileId === after.profileId ? opened.profileId : `${opened.profileId} in a ${after.profileId} window`,
        adoptId: opened.adoptId ?? null,
        chromeTab: chromeTab[0],
        chromeTabs: chromeTab[1],
        strip: strip ? { strip: strip.strip, active: strip.tabs.find((t) => t.active)?.key === opened.id, keyless: strip.tabs.filter((t) => !t.key).length } : null,
        loads: served.get("/e?empty-window") ?? 0,
      };
      const wrong = [
        out.appTabs !== 1 && "not exactly one app tab",
        !out.window && "another window",
        out.profile !== after.profileId && "another profile",
        !out.adoptId?.startsWith("tab:") && "a fresh tab, not Chrome's",
        (out.chromeTab.error || out.chromeTab.windowId !== made.windowId || !out.chromeTab.active) && "chrome.tabs doesn't see the extension's tab active in its window",
        JSON.stringify(out.chromeTabs) !== JSON.stringify([made.id]) && "chrome.tabs has another tab for the URL",
        (!out.strip || out.strip.strip !== made.windowId || !out.strip.active || out.strip.keyless) && "Chrome's strip for the app window disagrees",
        out.loads !== 1 && "the page loaded more than once",
      ].filter(Boolean);
      if (wrong.length) throw new Error(`${wrong.join("; ")}: ${JSON.stringify(out)}`);
      const event = (await evalApp(`return globalThis.__nnTabs`)).some((e) => e.url?.includes("e?empty-window"));
      // Every window closed.
      await evalApp(`const s = ac.store.getState(); Object.keys(s.windows).forEach((id) => s.closeWindow(id)); return true`);
      await until("no app windows", async () => ((await evalApp(`return Object.keys(ac.store.getState().windows).length`)) === 0 ? true : null), 10000);
      await sleep(1000);
      const noWindow = await create(`${base}/e?no-window`);
      await sleep(1500);
      const noWindowEvent = (await evalApp(`return globalThis.__nnTabs`)).some((e) => e.url?.includes("e?no-window"));
      return { placeholderTabs: empty.tabs.length, tabsCreate: created, appTab: opened.id, ...out, route: event ? "onTabs" : "openWindow",
        noWindow: { tabsCreate: noWindow, onTabs: noWindowEvent } };
    } finally {
      await evalApp(`globalThis.__nnTabsSub?.remove(); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
    }
  });

  await check("traffic-lights-steady", async () => {
    // Tab work makes AppKit lay the title bar out again (the app renames the window to its active tab): the buttons
    // must stay at (18, 20) from the window's top-left, visible and opaque, through every pass. The log samples them
    // synchronously at each pass and at each change to them or the title bar views holding them; on 0.2.22's first
    // ArcadiaCore build they went to AppKit's (9, 9) at each switch or close and came back 10–430 ms later.
    // Hiding the sidebar takes them out of the window with it (Dia): while it's hidden they hold one spot past the
    // window's left edge, through tab work too. The slides themselves (out and back) aren't sampled.
    // A window to work in: the checks before may have closed every one (extension-tab-empty-window does).
    const w = (await state()).windowId ?? (await evalApp(`return ac.actions.openWindow()`));
    if (!w) throw new Error("no window to work in");
    await sleep(1000);
    const W = JSON.stringify(w);
    const logLength = () => (existsSync(lightsLog) ? readFileSync(lightsLog, "utf8").length : 0);
    const from = logLength();
    const run = async (body, settle = 500) => {
      const result = await evalApp(body);
      await sleep(settle);
      return result;
    };
    const tabs = [];
    for (let i = 0; i < 4; i++) tabs.push(await run(`return ac.store.getState().newTab(${W}, { url: "${base}/a?lights${i}" })`));
    for (const id of [tabs[0], tabs[2], tabs[1], tabs[3]]) await run(`ac.actions.switchToTab("${id}"); return true`);
    await run(`return ac.store.getState().createSplit(["${tabs[2]}", "${tabs[3]}"])`);
    await run(`ac.store.getState().closeTab("${tabs[3]}"); return true`);
    const hiding = logLength();
    await run(`ac.store.getState().toggleSidebar(${W}); return true`, 1500);
    const hidden = logLength();
    await run(`ac.actions.switchToTab("${tabs[0]}"); return true`);
    const showing = logLength();
    await run(`ac.store.getState().toggleSidebar(${W}); return true`, 1500);
    const shown = logLength();
    for (const id of [tabs[0], tabs[1], tabs[2]]) await run(`ac.store.getState().closeTab("${id}"); return true`);
    const other = await run(`return ac.actions.openWindow()`);
    await run(`ac.store.getState().closeWindow(${JSON.stringify(other)}); return true`);
    const log = readFileSync(lightsLog, "utf8");
    const linesOf = (a, b) => log.slice(a, b).split("\n").filter(Boolean);
    const sample = (line) => line.match(/ -> (.*?) \| /)?.[1] ?? line;
    // Each slide's last sample is where it came to rest: out of the window, then back at (18, 20).
    const rest = (a, b) => linesOf(a, b).filter((line) => line.includes(" layout -> ")).slice(-1);
    const docked = [...linesOf(from, hiding), ...rest(showing, shown), ...linesOf(shown)];
    const away = [...rest(hiding, hidden), ...linesOf(hidden, showing)];
    if (!away.length || !rest(showing, shown).length) throw new Error(`no settled layout logged for the sidebar's slides`);
    const lines = [...docked, ...away];
    const healthy = (line) => sample(line).endsWith(" hidden=0 alpha=1.00") && !/ _NSTheme\w*Widget set/.test(line);
    const bad = docked.filter((line) => !sample(line).startsWith("close=(18.0,20.0) ") || !healthy(line));
    // Hidden: all three past the left edge (the zoom button, rightmost, ends 14 pt right of its x), level with their place.
    const out = (line) => {
      const xs = [...sample(line).matchAll(/=\((-?[\d.]+),(-?[\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      return xs.length === 3 && xs.every(([x, y]) => x + 14 <= 0 && y === 20);
    };
    const window = (line) => line.match(/window=(\d+)/)?.[1];
    const badAway = away.filter((line) => window(line) === window(docked[0] ?? "") && (!out(line) || !healthy(line)));
    // Each window's buttons are in one place throughout each phase (minimise and zoom too).
    const moved = [];
    for (const [phase, set] of [["docked", docked], ["hidden", away]]) {
      const places = new Map();
      for (const line of set) places.set(window(line), (places.get(window(line)) ?? new Set()).add(sample(line)));
      for (const [win, at] of places) if (at.size > 1) moved.push({ phase, window: win, places: [...at] });
    }
    if (!lines.some((line) => line.includes(" layout -> "))) throw new Error("no layout pass logged (is ARCADIA_TRAFFIC_LIGHTS_LOG set?)");
    if (bad.length || badAway.length || moved.length)
      throw new Error(`traffic lights left their spot: ${JSON.stringify({ moved, bad: bad.slice(0, 6), badAway: badAway.slice(0, 6) })}`);
    return { samples: lines.length, hiddenSamples: away.length, layoutPasses: lines.filter((line) => line.includes(" layout -> ")).length };
  });

  await check("launch-cocoa-args", async () => {
    // Cocoa's argument-domain defaults on the command line ("-NSAppSleepDisabled YES", as the perf bench passes them)
    // are AppKit's: the app starts as usual, Chrome never takes "YES" for a page to open, and AppKit still reads them.
    await stopApp();
    await launch("app-args.out.log", {}, ["-NSAppSleepDisabled", "YES", "-ApplePersistenceIgnoreState", "YES"]);
    await until("the relaunched app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    await sleep(2000);
    const pages = (await targets()).filter((t) => t.type === "page").map((t) => t.url);
    if (pages.some((u) => /yes/i.test(u))) throw new Error(`a page for the defaults' value: ${JSON.stringify(pages)}`);
    const argv = execFileSync("ps", ["-o", "args=", "-p", String(pid)]).toString().trim();
    if (!argv.includes("-NSAppSleepDisabled YES")) throw new Error(`the process arguments lost the defaults: ${argv}`);
    return { pages: pages.length, argv: argv.slice(argv.indexOf("-NS")) };
  });

  await check("context-menu-log", async () => {
    // ARCADIA_CONTEXT_MENU_LOG, as CEF's Client::RunContextMenu (release builds too): the page menu is dumped to
    // that file instead of shown ({ url, link, items: [{ id, label, type, enabled, visible, submenu? }] }, CEF's
    // menu item types), and the item its ".pick" file names ("<label>\t<flags>") runs. Relaunched with it set.
    const menuLog = join(scratch, "context-menu.json");
    rmSync(menuLog, { force: true });
    await stopApp();
    await launch("app4.out.log", { ARCADIA_CONTEXT_MENU_LOG: menuLog });
    await until("the relaunched app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    mainWindow = await until("a window", async () => (await state()).windowId, 30000);
    await evalApp(`ac.actions.openUrls(["${base}/a?menu"], ${JSON.stringify(mainWindow)}); return true`);
    const tab = await until("A", async () => (await state()).tabs.find((t) => t.url?.endsWith("/a?menu") && !t.loading));
    await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
    await sleep(500);
    const t = await pageFor(tab.id, "/a?menu");
    const rightClick = async () => {
      const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('next').getBoundingClientRect())", returnByValue: true })).result.value);
      const at = { x: box.x + 3, y: box.y + box.height / 2, button: "right", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
    };
    await rightClick();
    const menu = await until("the menu dumped", async () => (existsSync(menuLog) ? JSON.parse(readFileSync(menuLog, "utf8")) : null), 8000);
    const open = menu.items.find((i) => i.label === "Open Link in New Tab");
    if (!menu.url?.endsWith("/a?menu") || !menu.link?.endsWith("/b") || !open || open.type !== 1 || !menu.items.some((i) => i.type === 4))
      throw new Error(`menu ${JSON.stringify(menu).slice(0, 600)}`);
    const before = new Set((await state()).tabs.map((x) => x.id));
    writeFileSync(`${menuLog}.pick`, "Open Link in New Tab\t0\n");
    await rightClick();
    const opened = await until("the picked item's tab", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.url?.endsWith("/b")), 8000);
    if (existsSync(`${menuLog}.pick`)) throw new Error("the pick file wasn't taken");
    return { items: menu.items.length, link: menu.link, picked: opened.url };
  });

  await check("context-menu-incognito", async () => {
    // The page menu's Open Link in Incognito Window (picked through ARCADIA_CONTEXT_MENU_LOG, as context-menu-log):
    // the link opens in a private window of the app, never as a tab of the Personal window.
    const menuLog = join(scratch, "context-menu.json");
    const tab = await until("A", async () => (await state()).tabs.find((t) => t.url?.endsWith("/a?menu") && !t.loading));
    await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
    const t = await pageFor(tab.id, "/a?menu");
    const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('next').getBoundingClientRect())", returnByValue: true })).result.value);
    const at = { x: box.x + 3, y: box.y + box.height / 2, button: "right", clickCount: 1 };
    const windowsBefore = await evalApp(`return Object.keys(ac.store.getState().windows)`);
    const tabsBefore = await evalApp(`return Object.keys(ac.store.getState().tabs)`);
    writeFileSync(`${menuLog}.pick`, "Open Link in Incognito Window\t0\n");
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
    const newTabs = () => evalApp(`const s = ac.store.getState(), before = new Set(${JSON.stringify(tabsBefore)});
      return Object.values(s.tabs).filter((t) => !before.has(t.id)).map((t) => ({ id: t.id, url: t.url, title: t.title, windowId: t.windowId,
        incognito: !!s.windows[t.windowId]?.incognito, newWindow: !${JSON.stringify(windowsBefore)}.includes(t.windowId) }))`);
    const landed = await until("the link's page in the app", async () => (await newTabs()).find((t) => t.url?.endsWith("/b") && t.title === "Page B") ?? null, 15000)
      .catch(async (e) => { throw new Error(`${e.message}; new tabs ${JSON.stringify(await newTabs())}`); });
    await sleep(500);
    const all = await newTabs();
    if (!landed.incognito || !landed.newWindow || all.some((x) => !x.incognito)) throw new Error(`Open Link in Incognito Window: ${JSON.stringify(all)}`);
    await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(landed.windowId)}); return true`);
    return landed;
  });
  // MARK: Camera and microphone (the 0.2.21 crash: Allow on a camera + microphone prompt aborted the app)
  //
  // Run on a copy of the app without the camera and microphone entitlements (ad hoc, hardened runtime): macOS then
  // refuses the devices without ever asking, so nothing here can raise its consent dialog on the owner's screen, even
  // if a path reached a real device. Capture comes from Chrome's fake devices (ArcadiaCoreHost gives every hidden instance
  // --use-fake-device-for-media-stream, and the engine keeps the microphone on a fake input, ac_fake_media.mm); the
  // engine's stand-in for macOS's own permission (--arcadia-test-system-media-permission=ask) says "not asked yet",
  // so the permission element's flow takes its "ask macOS" step, the one 0.2.21 answered with a second Accept.
  // Each check asks from an origin of its own (*.localhost: secure, and a grant doesn't carry to the next check).
  const mediaChecks = ["camera-mic-allow", "permission-answer-once", "permission-element-allow"];
  if (!only.length || mediaChecks.some((c) => only.includes(c))) {
    const mediaApp = join(scratch, "media-app", basename(app));
    let media = null;
    try {
      rmSync(join(scratch, "media-app"), { recursive: true, force: true });
      mkdirSync(join(scratch, "media-app"), { recursive: true });
      execFileSync("cp", ["-cR", app, mediaApp]);
      const entitlements = join(scratch, "media-app", "entitlements.plist");
      writeFileSync(entitlements, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>`);
      execFileSync("codesign", ["-f", "-s", "-", "--options", "runtime", "--entitlements", entitlements, mediaApp], { stdio: "ignore" });
      const signed = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", mediaApp], { stdio: ["ignore", "pipe", "ignore"] }).toString();
      if (/device\.(camera|audio-input)/.test(signed)) throw new Error("the media copy kept a device entitlement");
      await stopApp();
      await launch("app-media.out.log", {}, [], { app: mediaApp, switches: "--arcadia-test-system-media-permission=ask" });
      await until("the media copy", async () => {
        try {
          return await evalApp(`return globalThis.expo.modules.ArcadiaCEF.engineInfo()`, 3000);
        } catch (e) {
          if (exited) throw e;
          return null;
        }
      }, 90000);
      mainWindow = await until("a window", async () => (await state()).windowId, 30000);
      const port = server.address().port;
      let site = 0;
      media = {
        // A tab at a fresh origin, shown (Chrome holds a hidden tab's prompt), and its DevTools target.
        async open(path, title) {
          const url = `http://media${++site}.localhost:${port}${path}`;
          const before = new Set((await state()).tabs.map((t) => t.id));
          await evalApp(`ac.actions.openUrls([${JSON.stringify(url)}], ${JSON.stringify(mainWindow)}); return true`);
          const tab = await until(`a tab for ${url}`, async () => (await state()).tabs.find((t) => !before.has(t.id) && t.title === title && !t.loading), 15000);
          await evalApp(`ac.actions.switchToTab("${tab.id}"); return true`);
          await until("it shown", async () => (await state()).active === tab.id);
          return { ...tab, target: await until("its page", () => pageTarget(url), 10000) };
        },
        js: async (t, expression) => (await cdp(t, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true })).result.value,
        prompt: (tabId) => evalApp(`return ac.pageState.getState().pages["${tabId}"]?.permission ?? null`),
        // The app's own answer path (Prompts.tsx's buttons call it with the prompt they show).
        answer: (tabId, id, result) => evalApp(`ac.permissions.answerPermission("${tabId}", "${id}", "${result}"); return true`),
        async answered(t, i = 0) {
          return until("the page's getUserMedia answer", async () => {
            const a = JSON.parse(await this.js(t, "JSON.stringify(window.__asks)"))[i];
            return a && a.state !== "pending" ? a : null;
          }, 15000);
        },
      };
    } catch (e) {
      media = { error: String(e?.message ?? e) };
    }
    const mediaCheck = (name, fn) => check(name, async () => {
      if (media?.error) throw new Error(`media copy: ${media.error}`);
      return fn();
    });

    await mediaCheck("camera-mic-allow", async () => {
      // The owner's case: one prompt for a camera + microphone request, Allow, and the stream starts with both tracks.
      const tab = await media.open("/cam", "Cam");
      try {
        await media.js(tab.target, `ask({ audio: true, video: true })`);
        const request = await until("the prompt", () => media.prompt(tab.id), 10000);
        if (request.permissions.length !== 2 || !request.permissions.includes("camera") || !request.permissions.includes("microphone"))
          throw new Error(`one prompt for both, got ${JSON.stringify(request.permissions)}`);
        await media.answer(tab.id, request.id, "accept");
        const answer = await media.answered(tab.target);
        if (answer.state !== "ok" || answer.audio?.[0] !== "live" || answer.video?.[0] !== "live") throw new Error(`getUserMedia: ${JSON.stringify(answer)}`);
        await sleep(1000);
        const again = await media.prompt(tab.id);
        if (again) throw new Error(`a second prompt: ${JSON.stringify(again)}`);
        if (exited) throw new Error("the app exited");
        return { permissions: request.permissions, audio: answer.audio, video: answer.video };
      } finally {
        await media.js(tab.target, "stopAll()").catch(() => null);
        await closeTab(tab.id);
      }
    });

    await mediaCheck("permission-answer-once", async () => {
      // A prompt is answered once: a double click on Allow, then the same answer and a contrary one straight to the
      // engine, decide nothing twice (0.2.21 aborted deciding a request twice). A late click meant for that prompt
      // doesn't answer the tab's next one either.
      const tab = await media.open("/cam", "Cam");
      try {
        await media.js(tab.target, `ask({ audio: true, video: true })`);
        const request = await until("the prompt", () => media.prompt(tab.id), 10000);
        await evalApp(`ac.permissions.answerPermission("${tab.id}", "${request.id}", "accept"); ac.permissions.answerPermission("${tab.id}", "${request.id}", "accept"); return true`);
        await cef(`resolvePermission("${request.id}", "accept", true)`);
        await cef(`resolvePermission("${request.id}", "deny", true)`);
        const answer = await media.answered(tab.target);
        if (answer.state !== "ok" || answer.audio?.[0] !== "live" || answer.video?.[0] !== "live") throw new Error(`getUserMedia: ${JSON.stringify(answer)}`);
        await media.js(tab.target, `navigator.requestMIDIAccess({ sysex: true }).then(() => (window.__midi = "granted"), (e) => (window.__midi = e.name)); true`);
        const next = await until("the next prompt", async () => {
          const p = await media.prompt(tab.id);
          return p && p.id !== request.id ? p : null;
        }, 10000);
        await media.answer(tab.id, request.id, "accept");
        await sleep(800);
        const still = await media.prompt(tab.id);
        if (still?.id !== next.id) throw new Error(`a late answer to ${request.id} answered ${next.id}`);
        await media.answer(tab.id, next.id, "dismiss");
        if (exited) throw new Error("the app exited");
        return { first: request.permissions, next: next.permissions, alive: true };
      } finally {
        await media.js(tab.target, "stopAll()").catch(() => null);
        await closeTab(tab.id);
      }
    });

    await mediaCheck("permission-element-allow", async () => {
      // The <usermedia> element (0.2.21's crash path): Chrome's embedded flow asks for the site, then, with macOS not
      // asked yet, shows its "ask macOS" step for the same requests. One app prompt, one Allow, no second prompt, and
      // the element's stream starts with both tracks.
      const tab = await media.open("/element", "Element");
      try {
        await sleep(1200);  // the element only takes a click once it's been visible a moment
        const at = await media.js(tab.target, "box()");
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
          await cdp(tab.target, "Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
        const request = await until("the prompt", () => media.prompt(tab.id), 10000);
        await media.answer(tab.id, request.id, "accept");
        const events = await until("the element's stream", async () => {
          const ev = JSON.parse(await media.js(tab.target, "JSON.stringify(__ev)"));
          return ev.length ? ev : null;
        }, 10000);
        const again = await media.prompt(tab.id);
        if (again) throw new Error(`a second prompt: ${JSON.stringify(again)}`);
        if (events[0]?.audio?.[0] !== "live" || events[0]?.video?.[0] !== "live") throw new Error(`the element: ${JSON.stringify(events)}`);
        if (exited) throw new Error("the app exited");
        return { permissions: request.permissions, stream: events[0] };
      } finally {
        await media.js(tab.target, "stopAll()").catch(() => null);
        await closeTab(tab.id);
      }
    });
  }

  // MARK: Crash guard (ends the run)

  await check("crash-guard", async () => {
    // A hidden test instance that crashes (here Chrome's own Browser.crash, an abort on the main thread) leaves its
    // record in <data dir>/crashes and exits: no crash report for macOS's reporter, so no "quit unexpectedly" dialog
    // and no focus change on the owner's screen.
    const reports = () => readdirSync(join(process.env.HOME, "Library/Logs/DiagnosticReports")).filter((f) => f.startsWith("Arcadia-"));
    const before = new Set(reports());
    const front = execFileSync("lsappinfo", ["front"]).toString().trim();
    const crashed = pid;
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    ws.send(JSON.stringify({ id: 1, method: "Browser.crash" }));
    await until("the instance gone", async () => exited, 15000);
    try { ws.close(); } catch {}
    const record = join(data, "crashes", `crash-${crashed}.txt`);
    await until("its crash record", async () => existsSync(record), 5000);
    await sleep(3000);
    const fresh = reports().filter((f) => !before.has(f));
    const frontAfter = execFileSync("lsappinfo", ["front"]).toString().trim();
    if (fresh.length) throw new Error(`macOS made a crash report: ${fresh}`);
    if (frontAfter !== front) throw new Error(`the frontmost app changed: ${front} → ${frontAfter}`);
    return { record: readFileSync(record, "utf8").split("\n")[0], front: "unchanged" };
  });
} finally {
  visibilityWatch?.stop();
  writeFileSync(join(scratch, "results.json"), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  report.summary();
  if (keep && !exited) {
    instance.save({ http: server.address().port, https: tlsServer.address().port });
    report.say(`kept pid ${pid}: --attach ${scratch} [check…] runs more; scripts/agent/ac quit ${data} ends it`);
  } else {
    if (keep) report.say("not kept: the app had exited");
    await instance.quit();  // also stops its Metro proxy when the app is already gone (crash-guard ends the run)
    rmSync(join(scratch, "media-app"), { recursive: true, force: true });
  }
  server.closeAllConnections?.();
  server.close();
  tlsServer.closeAllConnections?.();
  tlsServer.close();
  // A DevTools socket or a page's keep-alive connection can hold the loop open: the run ends here.
  process.exit(passed === results.length ? 0 : 1);
}
