// An icon's reads (lib/favicons.ts useFaviconView): wakes only for its page's entries, not for the hundreds of others.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useFavicons, iconWatch, themeWatch, pageKey } = await import("./favicons.ts");
const { engineProfile } = await import("../store/model.ts");

const key = engineProfile("default");
const set = (fn) =>
  useFavicons.setState((f) => {
    const icons = f.profiles[key] ?? { pages: {}, srcs: {}, appearances: {} };
    return { ...f, profiles: { ...f.profiles, [key]: fn(icons) } };
  });
const watchKey = (url, src = "", profileId = "default") => `${pageKey(url)}\n${src}\n${profileId}`;

test("an icon wakes for its page's answer, its light/dark pair and its icon URL's image, nothing else", () => {
  useFavicons.setState({ profiles: {}, themes: {} });
  const woke = { a: 0, b: 0, bySrc: 0 };
  const offs = [
    iconWatch.watch(watchKey("https://a.com/"), () => woke.a++),
    iconWatch.watch(watchKey("https://b.com/"), () => woke.b++),
    iconWatch.watch(watchKey("https://c.com/", "https://c.com/i.png"), () => woke.bySrc++),
  ];
  set((i) => ({ ...i, pages: { ...i.pages, "https://a.com/": "file:///a.png" } }));
  assert.deepEqual(woke, { a: 1, b: 0, bySrc: 0 }, "a page's answer wakes that page's icons");
  set((i) => ({ ...i, pages: { ...i.pages, "https://a.com/": "file:///a.png" } }));
  assert.deepEqual(woke, { a: 1, b: 0, bySrc: 0 }, "the same answer again wakes nobody");
  set((i) => ({ ...i, appearances: { ...i.appearances, "https://b.com/": ["l", "d"] } }));
  assert.deepEqual(woke, { a: 1, b: 1, bySrc: 0 }, "a light/dark pair");
  set((i) => ({ ...i, srcs: { ...i.srcs, "https://c.com/i.png": "file:///c.png" } }));
  assert.deepEqual(woke, { a: 1, b: 1, bySrc: 1 }, "the image of an icon URL");
  set((i) => ({ ...i, srcs: { ...i.srcs, "https://other.com/i.png": "file:///o.png" } }));
  assert.deepEqual(woke, { a: 1, b: 1, bySrc: 1 }, "another icon URL's image");
  useFavicons.setState({ themes: { "file:///a.png": null } });
  assert.deepEqual(woke, { a: 1, b: 1, bySrc: 1 }, "themes aren't the icon's image");
  for (const off of offs) off();
  assert.equal(iconWatch.size(), 0);
});

test("a fragment is the same page; another profile's icons don't wake a profile's icon", () => {
  useFavicons.setState({ profiles: {}, themes: {} });
  let woke = 0;
  const off = iconWatch.watch(watchKey("https://a.com/x#frag"), () => woke++);
  set((i) => ({ ...i, pages: { ...i.pages, "https://a.com/x": "file:///x.png" } }));
  assert.equal(woke, 1);
  useFavicons.setState((f) => ({ ...f, profiles: { ...f.profiles, "other-engine-profile": { pages: { "https://a.com/x": "z" }, srcs: {}, appearances: {} } } }));
  assert.equal(woke, 1, "an icon in a profile the lookup doesn't read");
  off();
});

test("a theme wakes the icons showing that image", () => {
  useFavicons.setState({ profiles: {}, themes: {} });
  const woke = { a: 0, b: 0 };
  const offs = [themeWatch.watch("file:///a.png", () => woke.a++), themeWatch.watch("file:///b.png", () => woke.b++)];
  useFavicons.setState((f) => ({ ...f, themes: { ...f.themes, "file:///a.png": { x: 1 } } }));
  assert.deepEqual(woke, { a: 1, b: 0 });
  useFavicons.setState((f) => ({ ...f, themes: { ...f.themes, "file:///c.png": null } }));
  assert.deepEqual(woke, { a: 1, b: 0 });
  for (const off of offs) off();
});
