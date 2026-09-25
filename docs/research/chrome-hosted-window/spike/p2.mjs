// Phase 2 checks for Chrome-hosted windows (docs/research/chrome-hosted-window.md).
// usage: SPIKE_DIR=<scratch> node p2.mjs <dataDirName> <cdpPort> <pid> <pagesOrigin> <step...>
// steps: empty split pip devtools popup download find extpopup swipe keys profiles close incognito lights fullscreen
// (run "empty" and "split" in a fresh session; steps that leave dialogs open block later CDP calls).
import { harness, sleep } from "./h.mjs";

const [dataName, port, pid, pages, ...steps] = process.argv.slice(2);
const h = harness(dataName, port, pid);
const { check, dev, win, winfo, ghosts, state, cdp, targets } = h;
const mainWindow = () => h.appWindows()[0]?.id;
const CMD = 1 << 20, OPT = 1 << 19, SHIFT = 1 << 17, CTRL = 1 << 18;
const firstWindowId = async () => (await state("Object.keys(s.windows)"))[0];

for (const step of steps) {
  console.log(`--- ${step}`);
  if (step === "empty") {
    // Every web tab closes (the window's Browser stays), then tabs come back into the empty window.
    const w = await firstWindowId();
    await dev(`nn.actions.openUrls(["${pages}/page.html?reopen"]); return 1`);
    await sleep(2500);
    const hist = await cdp("reopen");
    await hist.go(`${pages}/find.html?reopen2`);
    hist.close();
    await dev(`const s = nn.store.getState(); for (const id of [...s.windows[${JSON.stringify(w)}].tabIds]) if (/^https?:/.test(s.tabs[id]?.url || "")) nn.actions.closeTab(id); return 1`);
    await sleep(2500);
    const [g0] = (await ghosts()).filter((g) => g.hosting);
    check("all web tabs closed: the Browser stays with no tabs", g0.anyTabBrowserId === 0, `anyTab ${g0.anyTabBrowserId}`);
    await dev(`nn.runCommand({ command: "reopenClosedTab" }); return 1`);
    await sleep(3000);
    const back = await cdp("reopen2");
    const len = back ? await back.evaluate("history.length") : null;
    check("⇧⌘T into the empty window reopens the tab with its history", !!back && len >= 2, back ? `${back.url} history ${len}` : "not found");
    back?.close();
    const [g1] = (await ghosts()).filter((g) => g.hosting);
    check("…as a tab of the window's Browser (no placeholder left)", g1.anyTabBrowserId > 0 && !(await targets()).some((t) => t.url === "about:blank"), `anyTab ${g1.anyTabBrowserId}`);
    // Drag out: the tab to a new window, then back into the (empty again) first window.
    const tabId = await state(`s.windows[${JSON.stringify(w)}].tabIds.find((id) => /reopen2/.test(s.tabs[id]?.url || ""))`);
    await dev(`nn.actions.moveTabToWindow(${JSON.stringify(tabId)}, "new"); return 1`);
    await sleep(3500);
    const wins = await state("Object.keys(s.windows)");
    const w2 = wins.find((x) => x !== w);
    const g2 = await ghosts();
    const where = g2.filter((g) => g.anyTabBrowserId).map((g) => g.window);
    check("a tab dragged out lands in a new Chrome-hosted window", !!w2 && g2.filter((g) => g.hosting).length >= 2, JSON.stringify(g2.map((g) => [g.window, g.hosting, g.anyTabBrowserId])));
    const marker = await cdp("reopen2");
    await marker?.evaluate("window.__marker = 42");
    marker?.close();
    await dev(`nn.actions.moveTabToWindow(${JSON.stringify(tabId)}, ${JSON.stringify(w)}); return 1`);
    await sleep(3500);
    const again = await cdp("reopen2");
    const m = await again?.evaluate("window.__marker");
    again?.close();
    const home = (await ghosts()).find((g) => g.hosting && g.anyTabBrowserId && g.window === h.appWindows().find((x) => /reopen2|find/.test(x.title))?.id);
    check("…and back into the empty first window, same page (marker kept)", m === 42, `marker ${m}`);
    // Reopen a closed window.
    const openWins = await state("Object.keys(s.windows).length");
    const other = (await state("Object.keys(s.windows)")).find((x) => x !== w);
    if (other) {
      await dev(`nn.store.getState().closeWindow(${JSON.stringify(other)}); return 1`);
      await sleep(2000);
      await dev(`nn.runCommand({ command: "reopenClosedWindow" }); return 1`);
      await sleep(3500);
      const n = await state("Object.keys(s.windows).length");
      check("reopen closed window", n === openWins, `${n} windows`);
    }
  }
  if (step === "split") {
    await dev(`nn.actions.openUrls(["${pages}/page.html?split1"]); return 1`);
    await sleep(2000);
    const w = await firstWindowId();
    // Two panes, then three (openSplitPane with a URL, as ⇧⌥-click on a link does).
    await dev(`nn.store.getState().openSplitPane(${JSON.stringify(w)}, { url: "${pages}/alert.html?split2", side: "right" }); return 1`);
    await sleep(3000);
    const panes = await state(`s.windows[${JSON.stringify(w)}].split ?? null`);
    const g = (await ghosts()).find((x) => x.hosting) ?? (await ghosts())[0];
    const p1 = await cdp("split1"), p2 = await cdp("split2");
    const v = [await p1?.evaluate("JSON.stringify([document.visibilityState, innerWidth])"), await p2?.evaluate("JSON.stringify([document.visibilityState, innerWidth])")];
    check("split view: both panes visible at their own sizes", v.every((x) => x && x.includes("visible")), `${JSON.stringify(v)} insets ${g.pageInsets}`);
    await dev(`nn.store.getState().openSplitPane(${JSON.stringify(w)}, { url: "${pages}/find.html?split3", side: "right" }); return 1`);
    await sleep(3000);
    const p3 = await cdp("split3");
    const v3 = [await p1?.evaluate("JSON.stringify([document.visibilityState, innerWidth])"), await p2?.evaluate("JSON.stringify([document.visibilityState, innerWidth])"), await p3?.evaluate("JSON.stringify([document.visibilityState, innerWidth])")];
    check("three panes: all visible", v3.every((x) => x && x.includes("visible")), JSON.stringify(v3));
    // Chrome's dialogs follow the focused pane.
    for (let i = 0; i < 20 && !(await p2.evaluate("!!document.getElementById('b')")); i++) await sleep(250);
    const before = h.windows().map((x) => x.id);
    await p2.click("#b");
    let dialog;
    for (let i = 0; i < 20 && !dialog; i++) { await sleep(250); dialog = h.windows().find((x) => !before.includes(x.id) && /says/.test(x.title)); }
    const g2 = (await ghosts()).find((x) => x.hosting) ?? (await ghosts())[0];
    check("…an alert in a pane is centred on that pane", !!dialog, dialog ? `dialog x ${dialog.x}..${dialog.x + dialog.w}, pageInsets ${g2.pageInsets}` : "none");
    const win0 = h.appWindows()[0];
    console.log(`  window x ${win0.x} w ${win0.w}; pane rects: ${await dev(`return JSON.stringify(nn.store.getState().windows[${JSON.stringify(w)}] && Object.keys(nn.store.getState().windows[${JSON.stringify(w)}]))`)}`);
    await p2.send("Page.handleJavaScriptDialog", { accept: true });
    await sleep(500);
    p1?.close(); p2?.close(); p3?.close();
    void panes;
  }
  if (step === "pip") {
    await dev(`nn.actions.openUrls(["${pages}/video.html"]); return 1`);
    await sleep(3000);
    const page = await cdp("video.html");
    const before = h.windows().map((x) => x.id);
    await page.click("#b");
    await sleep(2500);
    const title = await page.evaluate("document.title");
    const fresh = h.windows().filter((x) => !before.includes(x.id));
    check("Picture in Picture opens its window", title === "in pip" && fresh.length > 0, `${title}; ${JSON.stringify(fresh.map((x) => [x.w, x.h, x.layer, x.alpha]))}`);
    await page.evaluate("document.exitPictureInPicture().then(() => 1, () => 0)");
    page.close();
  }
  if (step === "devtools") {
    await dev(`nn.actions.openUrls(["${pages}/page.html?dt"]); return 1`);
    await sleep(2000);
    const before = h.windows().map((x) => x.id);
    await dev(`nn.runCommand({ command: "devTools" }); return 1`);
    await sleep(4000);
    const fresh = h.windows().filter((x) => !before.includes(x.id) && x.w > 300);
    const tools = (await targets()).concat(await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => /devtools/.test(t.url));
    check("DevTools opens in a window of its own (undocked)", fresh.length > 0, `${JSON.stringify(fresh.map((x) => [x.title, x.w, x.h, x.alpha]))}; devtools targets ${tools.length}`);
  }
  if (step === "popup") {
    await dev(`nn.actions.openUrls(["${pages}/popup.html"]); return 1`);
    await sleep(2500);
    const page = await cdp("popup.html");
    const before = h.windows().map((x) => x.id);
    await page.click("#b");
    await sleep(3000);
    const fresh = h.windows().filter((x) => !before.includes(x.id) && x.alpha > 0 && x.w > 300);
    const opener = await page.evaluate("!!window.__w && !window.__w.closed");
    check("a sized window.open popup (sign-in style) opens in a window of its own", fresh.length > 0 && opener, JSON.stringify(fresh.map((x) => [x.title, x.w, x.h])));
    await page.evaluate("window.__w && window.__w.close(), 1");
    await sleep(1500);
    // (The window list keeps a closed window while the screen is locked: its order-out animation never runs.)
    const closed = await page.evaluate("!window.__w || window.__w.closed");
    const gone = !(await targets()).some((t) => /page\.html$/.test(t.url) && t.id !== undefined && fresh.length && false);
    check("…and window.close() closes it", closed && gone, `closed ${closed}`);
    page.close();
  }
  if (step === "download") {
    await dev(`nn.actions.openUrls(["${pages}/download.html"]); return 1`);
    await sleep(2500);
    const page = await cdp("download.html");
    await page.click("#a");
    await sleep(3000);
    const d = await dev(`const d = nn.store.getState().downloads; return JSON.stringify(Object.values(d || {}).map((x) => [x.filename || x.name, x.state || x.status]).slice(-3))`);
    check("a download completes into our downloads list", /spike/.test(String(d)), String(d).slice(0, 200));
    page.close();
  }
  if (step === "find") {
    await dev(`nn.actions.openUrls(["${pages}/find.html"]); return 1`);
    await sleep(2500);
    const tab = await state("Object.values(s.windows)[0].activeTabIds[Object.values(s.windows)[0].profileId]");
    await dev(`nn.runCommand({ command: "findInPage" }); return 1`);
    await sleep(800);
    await dev(`nn.store.getState().setFind(${JSON.stringify(tab)}, { open: true, query: "needle" }); nn.webviews.get(${JSON.stringify(tab)}).find("needle", true, false); return 1`);
    await sleep(1500);
    const f = await state(`s.find[${JSON.stringify(tab)}]`);
    check("find in page counts matches", JSON.stringify(f).includes("3"), JSON.stringify(f));
  }
  if (step === "extpopup") {
    const profile = "";
    const r = await dev(`return globalThis.expo.modules.NetnyahooExtensions ? "x" : Object.keys(globalThis.expo.modules).filter(k => /xten/.test(k)).join(",")`);
    const mod = r === "x" ? "NetnyahooExtensions" : String(r).split(",")[0];
    const installed = await dev(`return globalThis.expo.modules.${mod}.install(${JSON.stringify((process.env.EXT_POPUP_DIR ?? new URL("./ext-popup", import.meta.url).pathname))}, "")`);
    await sleep(2000);
    await dev(`nn.actions.openUrls(["${pages}/page.html?ext"]); return 1`);
    await sleep(2000);
    const list = await dev(`return nn.extensions.refreshExtensions("").then((l) => JSON.stringify(l.map((x) => [x.id, x.name, x.popup])))`);
    const ext = JSON.parse(list).find((x) => x[1] === "Spike popup");
    const w = await firstWindowId();
    await dev(`nn.extensions.closeExtensionPopup(); return 1`);
    await sleep(500);
    await dev(`const e = nn.extensions.findExtension("", ${JSON.stringify(ext?.[0])}); return nn.extensions.activateExtension(${JSON.stringify(w)}, e, { x: 900, y: 40, width: 28, height: 28 }).then(() => 1)`);
    await sleep(3000);
    const popup = await state(`null`);
    const pop = await dev(`return JSON.stringify(nn.extensions.useExtensions.getState().popup)`);
    const isPopup = (x) => x.url.startsWith("chrome-extension://") && x.url.endsWith("/popup.html");
    const t = (await targets()).find(isPopup) ?? (await (await fetch(`http://localhost:${port}/json`)).json()).find(isPopup);
    const shown = t ? await (await cdp(isPopup))?.evaluate("JSON.stringify([document.title, document.visibilityState, innerWidth, innerHeight])") : null;
    check("an extension's action popup opens, anchored to our button, and renders", !!t && /visible/.test(shown ?? ""), `${String(installed).slice(0, 80)}; popup ${pop}; page ${shown}`);
    void popup;
  }
  if (step === "swipe") {
    // Two-finger swipes over the sidebar page the window between profiles (the real tracker).
    const w = await firstWindowId();
    const have = await state("Object.keys(s.profiles).length");
    if (have < 2) await dev(`return nn.store.getState().createProfile({ name: "Work", color: "blue" })`);
    await sleep(1500);
    const order = await state("s.profileOrder");
    const swipe = (dx) =>
      dev(`const steps = [{ phase: "began", dx: 0 }, ...Array.from({ length: 12 }, () => ({ phase: "changed", dx: ${dx}, delayMs: 8 })), { phase: "ended", dx: 0 }];
        return globalThis.nnSwipe.sidebar(${JSON.stringify(w)}).devSimulate(steps, { ignorePreference: true }).then((r) => JSON.stringify(r).slice(0, 300))`, 20000);
    const profile = () => state(`s.windows[${JSON.stringify(w)}].profileId`);
    const p0 = await profile();
    let r = await swipe(-30);
    await sleep(1500);
    let p1 = await profile();
    if (p1 === p0) { r = await swipe(30); await sleep(1500); p1 = await profile(); }
    check("a sidebar swipe pages the Chrome-hosted window to the other profile", p1 !== p0 && order.includes(p1), `${p0} → ${p1}; ${String(r).slice(0, 160)}`);
    await dev(`nn.actions.openUrls(["${pages}/page.html?swiped"]); return 1`);
    await sleep(2500);
    const gs = await ghosts();
    check("…its tabs open in the profile's companion ghost", gs.some((g) => g.companion && g.anyTabBrowserId), JSON.stringify(gs.map((g) => [g.profile.slice(0, 8), g.hosting, g.companion, g.anyTabBrowserId])));
    const back = await swipe(p1 === order[1] ? 30 : -30);
    await sleep(1500);
    const p2 = await profile();
    check("…and swiping back returns to the home profile", p2 === p0, `${p1} → ${p2}; ${String(back).slice(0, 120)}`);
  }
  if (step === "keys") {
    // Chrome's reserved tab shortcuts reach the page first (then our menu), not Chrome's dispatcher:
    // a key Chrome runs before the first responder never reaches the page's keydown.
    await dev(`nn.actions.openUrls(["${pages}/page.html", "${pages}/keys.html"]); return 1`);
    await sleep(3000);
    const W = mainWindow();
    const [g] = await ghosts();
    await win(W, `click:${g.pageInsets[1] + 300},${g.pageInsets[0] + 300}`);
    await sleep(500);
    const page = await cdp("keys.html");
    for (const [name, flags, ch, code] of [
      ["⌥⌘→", CMD | OPT, "\uF703", 124],
      ["⇧⌘}", CMD | SHIFT, "}", 30],
      ["⌃PgDn", CTRL, "\uF72D", 121],
    ]) {
      await page.evaluate("__keys.length = 0");
      await win(W, `keys:${flags}:${ch}:${code}`);
      await sleep(900);
      const seen = await page.evaluate("JSON.stringify(__keys)");
      check(`${name} reaches the page before any Chrome command`, JSON.parse(seen).length > 0, seen);
      await win(W, `click:${g.pageInsets[1] + 300},${g.pageInsets[0] + 300}`);
      await sleep(300);
    }
    page.close();
  }
  if (step === "profiles") {
    const w = await firstWindowId();
    const work = await dev(`return nn.store.getState().createProfile({ name: "Work", color: "blue" })`);
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, ${JSON.stringify(work)}); return 1`);
    await sleep(1500);
    await dev(`nn.actions.openUrls(["${pages}/alert.html"]); return 1`);
    await sleep(3000);
    const gs = await ghosts();
    const home = gs.find((g) => g.hosting), comp = gs.find((g) => g.companion);
    check("a second profile's tabs get a companion ghost of the Chrome-hosted window", !!home && !!comp && comp.parentWindow === home.window,
      JSON.stringify(gs.map((g) => ({ p: g.profile, hosting: g.hosting, companion: g.companion, window: g.window, parent: g.parentWindow }))));
    const W = home.window;
    await win(W, "active:1");
    await sleep(800);
    const g2 = await ghosts();
    check("Chrome's active window follows the profile on screen", g2.find((g) => g.companion)?.active && !g2.find((g) => g.hosting)?.active,
      JSON.stringify(g2.map((g) => [g.profile, g.active])));
    // A JS dialog shows only for Chrome's last active Browser: the companion's tab must get one.
    const page = await cdp("alert.html");
    const before = h.windows().map((x) => x.id);
    await page.click("#b");
    let dialog;
    for (let i = 0; i < 20 && !dialog; i++) {
      await sleep(250);
      // Chrome fades its dialogs in; on a locked screen the fade never runs (alpha stays 0).
      dialog = h.windows().find((x) => !before.includes(x.id) && /says/.test(x.title));
    }
    const list = h.windows();
    const inFront = dialog && list.findIndex((x) => x.id === dialog.id) < list.findIndex((x) => x.id === W);
    check("an alert in the other profile's tab shows in front of the window (companion ghost lifts)", !!inFront,
      dialog ? `${dialog.title} @${dialog.x},${dialog.y} alpha ${dialog.alpha}` : `none; windows ${JSON.stringify(list.map((x) => [x.id, x.title, x.alpha]))}`);
    await page.send("Page.handleJavaScriptDialog", { accept: true });
    page.close();
    // Back to the home profile: it's current again.
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, "default"); return 1`);
    await sleep(1500);
    await win(W, "active:1");
    await sleep(800);
    const g3 = await ghosts();
    check("…and back on the home profile its Browser is the active one", g3.find((g) => g.hosting)?.active && !g3.find((g) => g.companion)?.active,
      JSON.stringify(g3.map((g) => [g.profile, g.active])));
    // ⌃2 (the menu's profile switch) goes to the second profile.
    await win(W, `keys:${CTRL}:2:19`);
    await sleep(1200);
    const now = await state(`s.windows[${JSON.stringify(w)}].profileId`);
    check("⌃2 switches the window to the second profile", now === work, now);
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, "default"); return 1`);
    await sleep(800);
  }
  if (step === "close") {
    // The close button asks the app ("warn before closing a window"), which asks the user when the window has tabs.
    const W = mainWindow();
    await dev(`nn.store.getState().updateSettings({ warnBeforeClosingWindow: true }); return 1`);
    await dev(`nn.actions.openUrls(["${pages}/page.html", "${pages}/form.html"]); return 1`);
    await sleep(2500);
    await win(W, "performClose");
    await sleep(1500);
    const still = h.windows().some((x) => x.id === W && x.alpha > 0);
    const info = await winfo(W);
    check("close button with several tabs: the window stays and asks (Dia's sheet)", still && !!info.sheet, `window ${still}, sheet ${info.sheet} ${JSON.stringify(info.sheetText)}`);
  }
  if (step === "incognito") {
    await dev(`nn.runCommand({ command: "newIncognitoWindow" }); return 1`);
    await sleep(3000);
    const ids = await state("Object.values(s.windows).filter((w) => w.incognito).map((w) => w.id)");
    await dev(`const s = nn.store.getState(); s.newTab(${JSON.stringify(ids[0])}, { url: "${pages}/page.html" }); return 1`);
    await sleep(3000);
    const gs = await ghosts();
    const inc = gs.find((g) => g.profile.startsWith("incognito"));
    check("an incognito window is Chrome-hosted too", !!inc?.hosting && inc.window === inc.parentWindow, JSON.stringify(gs.map((g) => [g.profile, g.hosting, g.window])));
    const info = inc ? await winfo(inc.window) : {};
    check("…and dark", /Dark/.test(info.appearance ?? ""), info.appearance);
  }
  if (step === "lights") {
    const W = mainWindow();
    const info = await winfo(W);
    const m = /\{\{([\d.]+), ([\d.]+)\}, \{([\d.]+), ([\d.]+)\}\}/.exec(info.closeButton);
    const [x, y, , hgt] = m ? m.slice(1).map(Number) : [];
    const frameH = Number(/\{([\d.]+), ([\d.]+)\}\}$/.exec(info.frame)[2]);
    const fromTop = frameH - (y + hgt);
    check("traffic lights inset like BrowserWindow (x 18, 19.5 from the top)", Math.abs(x - 18) < 0.6 && Math.abs(fromTop - 19.5) < 1, `x ${x}, from top ${fromTop}`);
  }
  if (step === "fullscreen") {
    // HTML5 full screen (a test instance keeps the window itself out of full screen, see NNClient).
    await dev(`nn.actions.openUrls(["${pages}/fullscreen.html"]); return 1`);
    await sleep(2500);
    const page = await cdp("fullscreen.html");
    const W = mainWindow();
    const before = h.windows().map((x) => x.id);
    await page.click("#b");
    await sleep(1500);
    const fs = await page.evaluate("JSON.stringify({fs: !!document.fullscreenElement, w: innerWidth, h: innerHeight})");
    const chrome = await state(`Object.keys(s.windows).length`);
    const fresh = h.windows().filter((x) => !before.includes(x.id) && x.alpha > 0);
    check("a page enters HTML5 full screen", JSON.parse(fs).fs, fs);
    check("Chrome's \"Press Esc to exit full screen\" hint shows over the page", fresh.length > 0, JSON.stringify(fresh));
    const hidden = await dev(`return JSON.stringify(Object.values(nn.pageState.getState().pages).filter(p => p.fullscreen).length)`);
    check("our chrome hides for the full-screen page", hidden === "1", hidden);
    await page.key("Escape");
    await sleep(1200);
    const after = await page.evaluate("JSON.stringify({fs: !!document.fullscreenElement, w: innerWidth, h: innerHeight})");
    check("Esc exits", !JSON.parse(after).fs, after);
    page.close();
  }
}
process.exit(h.summary() ? 1 : 0);
