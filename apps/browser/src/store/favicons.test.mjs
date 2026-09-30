import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const stub = await import("./test-native-stub.mjs");
const favicons = await import("../lib/favicons.ts");
const { iconName, noteFavicon, pageKey, resolveFavicon, useFavicons, flushFavicons } = favicons;

const S = () => useBrowser.getState();

test("recording a page's icon keeps the newest 5000 pages in order and skips repeats", () => {
  const src = "https://x.com/favicon.ico";
  const name = iconName(src);
  const pages = {};
  for (let i = 0; i < 5000; i++) pages[`https://x.com/${i}`] = name;
  stub.docs.set("favicons-default.json", JSON.stringify({ icons: { [name]: { uri: "file:///x.png", src, at: Date.now() } }, pages, hosts: {} }));
  S().hydrate({});
  const w = S().createWindow({ url: "https://x.com/new" });
  const tab = model.activeTabId(S(), w);
  let updates = 0;
  const stop = useFavicons.subscribe(() => updates++);
  noteFavicon(tab, src);
  assert.equal(updates, 1);
  let keys = Object.keys(useFavicons.getState().profiles.default.pages);
  assert.equal(keys.length, 5000, "the oldest page makes room");
  assert.equal(keys[0], "https://x.com/1");
  assert.equal(keys.at(-1), pageKey(S().tabs[tab].url));
  assert.equal(useFavicons.getState().profiles.default.hosts["x.com"], name);
  noteFavicon(tab, src);
  assert.equal(updates, 1, "the same page reporting the same icon again records nothing");
  S().updateTab(tab, { url: "https://x.com/0" });
  noteFavicon(tab, src);
  assert.equal(updates, 2);
  keys = Object.keys(useFavicons.getState().profiles.default.pages);
  assert.equal(keys.length, 5000);
  assert.equal(keys.at(-1), "https://x.com/0", "a page seen again moves to the newest end");
  assert.equal(resolveFavicon("https://x.com/0", null, "default")?.uri, "file:///x.png");
  flushFavicons();
  assert.equal(Object.keys(JSON.parse(stub.docs.get("favicons-default.json")).pages).length, 5000);
  stop();
});

test("the index drops hosts and icons no kept page uses, once per launch and every 500 changes", () => {
  const { flushFavicons: flush } = favicons;
  const icons = {};
  const pages = {};
  const hosts = {};
  for (let i = 0; i < 3000; i++) icons[`i${i}`] = { uri: `file:///${i}.png`, src: `https://h${i}.com/favicon.ico`, at: Date.now() };
  for (let i = 0; i < 100; i++) pages[`https://h${i}.com/p`] = `i${i}`;
  for (let i = 0; i < 2000; i++) hosts[`h${i}.com`] = `i${i}`;
  icons.dark = { uri: "file:///dark.png", src: "https://h0.com/dark.ico", at: Date.now() };
  // The page's icon, named as noteFavicon names it.
  const real = iconName("https://h1.com/favicon.ico");
  icons[real] = icons.i1;
  delete icons.i1;
  pages["https://h1.com/p"] = real;
  // An icon only a history entry names (its page left the capped page map): kept.
  const byHistory = iconName("https://kept.com/favicon.ico");
  icons[byHistory] = { uri: "file:///kept.png", src: "https://kept.com/favicon.ico", at: Date.now() };
  hosts["h1.com"] = real;
  stub.docs.set("favicons-work.json", JSON.stringify({ icons, pages, hosts, appearances: { i0: ["i0", "dark"], dark: ["i0", "dark"], i2999: ["i2999", "i2998"] } }));
  S().hydrate({});
  S().createProfile({ name: "Work" });
  const work = S().profileOrder[1];
  stub.docs.set(`favicons-${work}.json`, stub.docs.get("favicons-work.json"));
  const w = S().createWindow({ url: "https://h1.com/p", profileId: work });
  // Icons are named for their source; i1's source is h1's favicon.
  const src = "https://h1.com/favicon.ico";
  const index = favicons.useFavicons.getState().profiles[work] ?? null;
  void index;
  S().updateTab(model.activeTabId(S(), w), { url: "https://h5000.com/q" });
  favicons.noteFavicon(model.activeTabId(S(), w), src);
  S().recordVisit(work, "https://kept.com/old", "Old", "https://kept.com/favicon.ico", true);
  flush();
  const saved = JSON.parse(stub.docs.get(`favicons-${work}.json`));
  assert.equal(Object.keys(saved.pages).length, 101);
  assert.equal(Object.keys(saved.hosts).length, 101, "hosts of kept pages only");
  assert.deepEqual(Object.keys(saved.icons).sort(), [...Array.from({ length: 100 }, (_, i) => (i === 1 ? real : `i${i}`)), "dark", byHistory].sort(), "icons some page or host uses, and their other appearance");
  assert.equal(saved.pages["https://h5000.com/q"], real);
  assert.deepEqual(Object.keys(saved.appearances).sort(), ["dark", "i0"]);
  assert.equal(resolveFavicon("https://h1.com/p", null, work)?.uri, "file:///1.png");
});
