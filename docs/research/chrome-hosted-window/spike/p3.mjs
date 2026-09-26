// Phase 3a checks: per-profile Chrome-hosted windows.
// usage: SPIKE_DIR=<scratch> [EXT_CMD_DIR=spike/ext-cmd] node p3.mjs <dataDirName> <cdpPort> <pid> <pagesOrigin> <step...>
// steps: group paging ctrl fullscreen ime extcmd features (run "features" last: its context menu blocks the app)
import { harness, sleep } from "./h.mjs";

const [dataName, port, pid, pages, ...steps] = process.argv.slice(2);
const h = harness(dataName, port, pid);
const { check, dev, win, ghosts, state, cdp } = h;
const CTRL = 1 << 18;
const firstWindowId = async () => (await state("Object.keys(s.windows)"))[0];
const current = async () => (await ghosts()).find((g) => g.hasRoot);
const summary = (gs) => gs.map((g) => [g.profile.slice(0, 10) || "default", g.hosting ? "H" : "ghost", g.window, g.hasRoot ? "root" : "", g.visible ? "vis" : "hid", g.anyTabBrowserId, g.group.slice(-4)]);
const ensureWork = async () => {
  const have = await state("Object.values(s.profiles).map((p) => p.id)");
  if (have.length < 2) await dev(`return nn.store.getState().createProfile({ name: "Work", color: "blue" })`);
  await sleep(1500);
  return (await state("s.profileOrder"))[1];
};
const engine = (id) => (id === "default" ? "" : id);

for (const step of steps) {
  console.log(`--- ${step}`);
  if (step === "group") {
    const w = await firstWindowId();
    await dev(`nn.actions.openUrls(["${pages}/page.html?home"]); return 1`);
    await sleep(2500);
    const work = await ensureWork();
    await sleep(1500);
    const g0 = await ghosts();
    check("the other profile's window is made ahead (a neighbour, off screen)", g0.some((g) => g.profile === engine(work) && g.hosting && !g.visible), JSON.stringify(summary(g0)));
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, ${JSON.stringify(work)}); return 1`);
    await sleep(2000);
    await dev(`nn.actions.openUrls(["${pages}/page.html?work"]); return 1`);
    await sleep(3000);
    const g1 = await ghosts();
    const cur = g1.find((g) => g.hasRoot);
    check("switching profile moves our views to that profile's own Chrome window", cur?.profile === engine(work) && cur.hosting, JSON.stringify(summary(g1)));
    check("no ghosts: every Browser of the window is a Chrome-hosted window of one group", g1.every((g) => g.hosting) && new Set(g1.map((g) => g.group)).size === 1, JSON.stringify(summary(g1)));
    check("the home profile's window is off screen, the current one on screen", g1.filter((g) => g.visible).length === 1 && cur?.visible, JSON.stringify(summary(g1)));
    check("the work tab lives in the work window's Browser", cur?.anyTabBrowserId > 0);
    const info = cur ? JSON.parse(await win(cur.window, "winfo")) : {};
    check("windows swap transparent by default (translucent Chrome windows)", g1.every((g) => g.translucent), `opaque ${info.opaque}; ${JSON.stringify(g1.map((g) => g.translucent))}`);
    const title = await state(`s.windows[${JSON.stringify(w)}].profileId`);
    check("the store and the window agree", title === work, title);
  }
  if (step === "paging") {
    const w = await firstWindowId();
    const work = await ensureWork();
    const swipe = (dx) =>
      dev(`const steps = [{ phase: "began", dx: 0 }, ...Array.from({ length: 12 }, () => ({ phase: "changed", dx: ${dx}, delayMs: 8 })), { phase: "ended", dx: 0 }];
        return globalThis.nnSwipe.sidebar(${JSON.stringify(w)}).devSimulate(steps, { ignorePreference: true }).then(() => 1)`, 20000);
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, "default"); return 1`);
    await sleep(2000);
    const before = await current();
    for (const [dx, want] of [[-30, work], [30, "default"], [-30, work], [30, "default"]]) {
      await swipe(dx);
      await sleep(1800);
      let p = await state(`s.windows[${JSON.stringify(w)}].profileId`);
      if (p !== want) { await swipe(-dx); await sleep(1800); p = await state(`s.windows[${JSON.stringify(w)}].profileId`); }
      const cur = await current();
      check(`swipe to ${want === "default" ? "home" : "Work"}: the store and the Chrome window on screen agree`, p === want && cur?.profile === engine(want) && cur.visible,
        `${p}; root in ${cur?.profile || "default"} window ${cur?.window}`);
    }
    const after = await current();
    check("…back where it started, same window", after?.window === before?.window, `${before?.window} → ${after?.window}`);
  }
  if (step === "fullscreen") {
    // Full screen with two profiles (fakeFullScreen: AppKit's state without its Space). Paging shows
    // the other profile's window over the full-screen one, as a child; its dialogs show there; back
    // home it goes; leaving full screen ends on the profile shown, as its own window.
    const w = await firstWindowId();
    const work = await ensureWork();
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, "default"); return 1`);
    await sleep(1500);
    const home = await current();
    await win(home.window, "fakeFullScreen:1");
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, ${JSON.stringify(work)}); return 1`);
    await sleep(2000);
    let gs = await ghosts();
    let cur = gs.find((g) => g.hasRoot);
    check("full screen, paging to Work: its window shows over the full-screen one (a child)", cur?.profile === engine(work) && cur.parentWindow === home.window && cur.visible && gs.find((g) => g.window === home.window)?.visible,
      JSON.stringify(gs.map((g) => [g.profile.slice(0, 6) || "default", g.window, g.hasRoot, g.visible, g.parentWindow])));
    const info = JSON.parse(await win(cur.window, "winfo"));
    const hostFrame = JSON.parse(await win(home.window, "winfo")).frame;
    check("…at the full-screen window's frame", hostFrame === info.frame, `${info.frame} vs ${hostFrame}`);
    await dev(`nn.actions.openUrls(["${pages}/passkey.html?fs"]); return 1`);
    await sleep(2500);
    const page = await cdp("passkey.html?fs");
    const before = h.windows().map((x) => x.id);
    await page.click("#b");
    await sleep(2500);
    const list = h.windows();
    const sheet = list.find((x) => /passkey/i.test(x.title));
    const order = (id) => list.findIndex((x) => x.id === id);
    check("…a passkey sheet in its tab shows in front of both", !!sheet && order(sheet.id) < order(cur.window) && order(cur.window) < order(home.window),
      sheet ? `${sheet.title.slice(0, 20)} order ${order(sheet.id)} < ${order(cur.window)} < ${order(home.window)}` : JSON.stringify(list.filter((x) => !before.includes(x.id))));
    await page.evaluate(`location.href = "${pages}/page.html?fs"`);
    page.close();
    await sleep(1000);
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, "default"); return 1`);
    await sleep(1500);
    gs = await ghosts();
    cur = gs.find((g) => g.hasRoot);
    const workWin = gs.find((g) => g.profile === engine(work));
    check("…back home: the full-screen window has our views again, Work's window gone from it", cur?.window === home.window && !workWin?.visible && !workWin?.parentWindow,
      JSON.stringify(gs.map((g) => [g.profile.slice(0, 6) || "default", g.window, g.hasRoot, g.visible, g.parentWindow])));
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, ${JSON.stringify(work)}); return 1`);
    await sleep(1500);
    await win(home.window, "fakeFullScreen:0");
    await sleep(1500);
    gs = await ghosts();
    cur = gs.find((g) => g.hasRoot);
    const p = await state(`s.windows[${JSON.stringify(w)}].profileId`);
    check("…leaving full screen on Work: Work's own window, alone and on screen", p === work && cur?.profile === engine(work) && !cur.parentWindow && gs.filter((g) => g.visible).length === 1,
      JSON.stringify(gs.map((g) => [g.profile.slice(0, 6) || "default", g.window, g.hasRoot, g.visible, g.parentWindow])));
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, "default"); return 1`);
    await sleep(1500);
  }
  if (step === "ctrl") {
    const w = await firstWindowId();
    const work = await ensureWork();
    for (const [n, want] of [[2, work], [1, "default"]]) {
      const cur = await current();
      await win(cur.window, `keys:${CTRL}:${n}:${n === 1 ? 18 : 19}`);
      await sleep(2000);
      const p = await state(`s.windows[${JSON.stringify(w)}].profileId`);
      const now = await current();
      check(`⌃${n} switches to ${want === "default" ? "home" : "Work"} and its window`, p === want && now?.profile === engine(want), `${p}; ${now?.profile || "default"} ${now?.window}`);
    }
  }
  if (step === "ime") {
    // A composition in the page's text field: the system's way (NSTextInputClient on the page's view,
    // in its own Chrome window) and CDP's.
    await dev(`nn.actions.openUrls(["${pages}/page.html?ime"]); return 1`);
    await sleep(2500);
    // The window with our views: a Chrome-hosted one, or (flag off) the app window over the ghost.
    const cur = await current() ?? { ...(await ghosts())[0], window: h.appWindows()[0].id };
    const W = cur.window;
    const page = await cdp("page.html?ime");
    const r = await page.rect("#t");
    await win(W, `click:${cur.pageInsets[1] + r.x + 20},${cur.pageInsets[0] + r.y + r.height / 2}`);
    await sleep(500);
    const res = await win(W, "ime:にほん|日本");
    await sleep(600);
    const v1 = await page.evaluate("t.value");
    check("IME through NSTextInputClient: marked text, then the committed word", v1 === "日本" && /marked=1/.test(res), `${v1}; ${res}`);
    await page.evaluate("t.value = ''; t.focus(); 1");
    await page.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
    await sleep(300);
    const composing = await page.evaluate("t.value");
    await page.send("Input.insertText", { text: "仮名" });
    await sleep(300);
    const v2 = await page.evaluate("t.value");
    check("IME through CDP (imeSetComposition, insertText)", composing === "かな" && v2 === "仮名", `${composing} → ${v2}`);
    page.close();
  }
  if (step === "extcmd") {
    // An extension's keyboard shortcut (chrome.commands) runs from the page.
    const dir = process.env.EXT_CMD_DIR ?? new URL("./ext-cmd", import.meta.url).pathname;
    await dev(`return globalThis.expo.modules.NetnyahooExtensions.install(${JSON.stringify(dir)}, "")`);
    await sleep(2500);
    await dev(`nn.actions.openUrls(["${pages}/page.html?cmd"]); return 1`);
    await sleep(2500);
    const cur = await current() ?? { ...(await ghosts())[0], window: h.appWindows()[0].id };
    const W = cur.window;
    await win(W, `click:${cur.pageInsets[1] + 300},${cur.pageInsets[0] + 300}`);
    await sleep(500);
    const sw = async () => (await (await fetch(`http://localhost:${port}/json`)).json()).find((t) => t.type === "service_worker" && /sw\.js/.test(t.url) && !/background\.js/.test(t.url));
    const hits = async () => {
      const t = await sw();
      if (!t) return "no worker";
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r) => (ws.onopen = r));
      const v = await new Promise((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m.result?.result?.value); }; ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "self.__hits + ':' + self.__last", returnByValue: true } })); });
      ws.close();
      return v;
    };
    const before = await hits();
    const handled = await win(W, `keys:${(1 << 20) | (1 << 17)}:Y:16`);
    await sleep(1500);
    const after = await hits();
    check("an extension's keyboard command (⇧⌘Y) runs", String(after).startsWith("1:"), `${before} → ${after}; ${handled}`);
  }
  if (step === "features") {
    // In the Work profile's own window: autofill, passkey (no lift: the window is the Browser's), context menu.
    const w = await firstWindowId();
    const work = await ensureWork();
    await dev(`nn.store.getState().switchProfile(${JSON.stringify(w)}, ${JSON.stringify(work)}); return 1`);
    await sleep(2000);
    await dev(`nn.actions.openUrls(["${pages}/form.html?f"]); return 1`);
    await sleep(3000);
    const W = (await current()).window;
    const form = await cdp("form.html?f");
    await form.evaluate(`document.getElementById("c").value="Springfield"; document.getElementById("b").click(); 1`);
    await sleep(2500);
    form.close();
    const again = await cdp("form.html");
    await again.click("#c");
    await sleep(1500);
    const popup = h.windows().find((x) => x.layer === 999);
    await again.key("ArrowDown");
    await sleep(300);
    await again.key("Enter");
    await sleep(800);
    check("Work window: autofill dropdown shows and takes a keyboard pick", (await again.evaluate(`document.getElementById("c").value`)) === "Springfield", popup ? `layer ${popup.layer}` : "no popup seen");
    await again.go(`${pages}/passkey.html`);
    const before = h.windows().map((x) => x.id);
    await again.click("#b");
    let dialog;
    for (let i = 0; i < 20 && !dialog; i++) { await sleep(250); dialog = h.windows().find((x) => !before.includes(x.id) && /passkey/i.test(x.title)); }
    const list = h.windows();
    const inFront = dialog && list.findIndex((x) => x.id === dialog.id) < list.findIndex((x) => x.id === W);
    const gs = await ghosts();
    check("Work window: passkey sheet in front, no ghost to lift", !!inFront && gs.every((g) => g.hosting && !g.lifted), dialog ? `${dialog.title} alpha ${dialog.alpha}` : "none");
    await again.go(`${pages}/form.html?menu`);
    again.close();
    const [g] = (await ghosts()).filter((x) => x.hasRoot);
    const page = await cdp("form.html?menu");
    const r = await page.rect("#c");
    page.close();
    await win(W, `click:${g.pageInsets[1] + r.x + 20},${g.pageInsets[0] + r.y + r.height / 2},right`);
    await sleep(1500);
    const menu = h.windows().find((x) => x.layer === 101);
    check("Work window: right-click shows Chrome's context menu", !!menu, menu ? `layer 101 @${menu.x},${menu.y}` : "none");
  }
}
process.exit(h.summary() ? 1 : 0);
