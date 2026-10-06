// Store transactions (store/transaction.ts): writes apply at once, listeners hear them once at the end; a write that
// would hide a tab's load starting or ending is heard apart (store/browser.ts loadFlipsBack).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "zustand/vanilla";

globalThis.__DEV__ = false;
const { transactional } = await import("./transaction.ts");
const { storeTransaction, useBrowser } = await import("./browser.ts");

const counter = (split) => {
  const t = transactional(split);
  const store = createStore(t.middleware((set) => ({ a: 0, b: 0, bump: (k) => set((s) => ({ [k]: s[k] + 1 })) })));
  const heard = [];
  store.subscribe((s, prev) => heard.push([`${prev.a}${prev.b}`, `${s.a}${s.b}`]));
  return { store, heard, transaction: t.transaction };
};

test("outside a transaction every write is heard, as before", () => {
  const { store, heard } = counter();
  store.getState().bump("a");
  store.getState().bump("b");
  assert.deepEqual(heard, [["00", "10"], ["10", "11"]]);
});

test("a transaction's writes apply at once and are heard once, at the end, from the state before them", () => {
  const { store, heard, transaction } = counter();
  transaction(() => {
    store.getState().bump("a");
    assert.equal(store.getState().a, 1, "reads see each write");
    store.getState().bump("b");
    store.getState().bump("a");
    assert.deepEqual(heard, []);
  });
  assert.deepEqual(heard, [["00", "21"]]);
});

test("nested transactions are heard when the outermost ends; one without writes is heard as nothing", () => {
  const { store, heard, transaction } = counter();
  transaction(() => {
    transaction(() => store.getState().bump("a"));
    assert.deepEqual(heard, []);
    store.getState().bump("b");
  });
  transaction(() => {});
  assert.deepEqual(heard, [["00", "11"]]);
});

test("a run that throws is still heard, and the next transaction starts clean", () => {
  const { store, heard, transaction } = counter();
  assert.throws(() =>
    transaction(() => {
      store.getState().bump("a");
      throw new Error("report");
    }),
  );
  assert.deepEqual(heard, [["00", "10"]]);
  store.getState().bump("b");
  assert.deepEqual(heard, [["00", "10"], ["10", "11"]]);
});

test("a write heardAlone names is heard as it lands, with what was pending; the rest wait for the end", () => {
  // Every write to `a` is heard at once.
  const { store, heard, transaction } = counter((s, prev) => s.a !== prev.a);
  transaction(() => {
    store.getState().bump("b");
    store.getState().bump("a");
    store.getState().bump("b");
    store.getState().bump("a");
    store.getState().bump("b");
  });
  assert.deepEqual(heard, [["00", "11"], ["11", "22"], ["22", "23"]]);
});

test("while a write is heard alone, a listener's own write is heard at once, nested, as zustand does", () => {
  const t = transactional((s, prev) => s.n !== prev.n);
  const store = createStore(t.middleware(() => ({ n: 0, echo: 0, other: 0 })));
  store.subscribe((s) => {
    if (s.n !== s.echo) store.setState({ echo: s.n });
  });
  const seen = [];
  store.subscribe((s, prev) => seen.push(`${prev.n}${prev.echo}${prev.other}>${s.n}${s.echo}${s.other}`));
  t.transaction(() => {
    store.setState({ n: 1 });
    store.setState({ other: 1 });
  });
  assert.deepEqual(seen, ["100>110", "000>110", "110>111"], "the echo is heard once, nested; the later write at the end");
});

test("a listener's own write while hearing is heard too, and unsubscribing works", () => {
  const t = transactional();
  const store = createStore(t.middleware(() => ({ n: 0, echo: 0 })));
  const seen = [];
  store.subscribe((s) => {
    if (s.n !== s.echo) store.setState({ echo: s.n });
  });
  const off = store.subscribe((s, prev) => seen.push(`${prev.n}${prev.echo}>${s.n}${s.echo}`));
  t.transaction(() => store.setState({ n: 1 }));
  assert.equal(store.getState().echo, 1);
  assert.deepEqual(seen, ["10>11", "00>11"], "the nested write is heard first, then the outer one with the newest state (zustand's order)");
  off();
  t.transaction(() => store.setState({ n: 2 }));
  assert.equal(seen.length, 2);
});

// The browser store's rule: a tab's isLoading flipping back within one transaction.
const S = () => useBrowser.getState();
const tabSetup = () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  return S().windows[w].tabIds[0];
};

test("browser: a flush's page reports are heard together, after its address", () => {
  const id = tabSetup();
  S().updateLive(id, { isLoading: true });
  let updates = 0;
  const off = useBrowser.subscribe(() => updates++);
  storeTransaction(() => {
    S().navigated(id, { url: "https://a.com/x", title: "X" }, { isLoading: true, canGoBack: true });
    S().updateLive(id, { canGoForward: true });
    S().updateLive(id, { themeColor: "#123456" });
    S().faviconChanged(id, "data:icon");
    S().updateTab(id, { title: "X!" });
  });
  off();
  assert.equal(updates, 2, "the new address as it lands, then the progress, icon and title together");
  assert.equal(S().tabs[id].title, "X!");
  assert.equal(S().live[id].themeColor, "#123456");
});

test("browser: a load that starts and ends in one flush is heard starting and ending", () => {
  const id = tabSetup();
  S().updateLive(id, { isLoading: false });
  const ends = [];
  const off = useBrowser.subscribe((s, prev) => {
    if (prev.live[id]?.isLoading !== s.live[id]?.isLoading) ends.push(`${prev.live[id]?.isLoading}>${s.live[id]?.isLoading}`);
  });
  storeTransaction(() => {
    S().navigated(id, { url: "https://a.com/y", title: "" }, { isLoading: true });
    S().updateLive(id, { canGoBack: true });
    S().updateLive(id, { isLoading: false });
    S().updateTab(id, { title: "Y" });
  });
  off();
  assert.deepEqual(ends, ["false>true", "true>false"]);
  assert.equal(S().tabs[id].title, "Y");
});

test("browser: a listener that closes a tab as its address lands isn't undone by the flush's later reports", () => {
  const id = tabSetup();
  const w = S().tabs[id].windowId;
  const auth = S().newTab(w, { url: "https://sign.in/start", background: true });
  const off = useBrowser.subscribe((s) => {
    if (s.tabs[auth]?.url.startsWith("https://app/redirect")) S().closeTab(auth);
  });
  storeTransaction(() => {
    S().navigated(auth, { url: "https://app/redirect?code=1", title: "" }, { isLoading: true });
    S().updateLive(auth, { isLoading: false, canGoBack: true });
    S().faviconChanged(auth, "data:icon");
    S().updateTab(auth, { title: "Done" });
  });
  off();
  assert.equal(S().tabs[auth], undefined);
  assert.equal(S().live[auth], undefined);
  assert.ok(!S().windows[w].tabIds.includes(auth));
});

test("browser: an address that goes A → B → A in one flush is heard going to B and back", () => {
  const id = tabSetup();
  S().navigated(id, { url: "https://a.com/A", title: "" }, { isLoading: false });
  const urls = [];
  const off = useBrowser.subscribe((s, prev) => {
    if (s.tabs[id]?.url !== prev.tabs[id]?.url) urls.push(s.tabs[id]?.url.slice(-1));
  });
  storeTransaction(() => {
    S().navigated(id, { url: "https://a.com/B", title: "" }, { isLoading: false });
    S().updateTab(id, { title: "B" });
    S().navigated(id, { url: "https://a.com/A", title: "" }, { isLoading: false });
  });
  off();
  assert.deepEqual(urls, ["B", "A"]);
});

test("browser: a load starting or ending is heard as it lands, the reports after it together", () => {
  const id = tabSetup();
  const w = S().tabs[id].windowId;
  const other = S().newTab(w, { url: "https://b.com", background: true });
  S().updateLive(id, { isLoading: false });
  S().updateLive(other, { isLoading: false });
  let updates = 0;
  const off = useBrowser.subscribe(() => updates++);
  storeTransaction(() => {
    S().updateLive(id, { isLoading: true, canGoBack: true });
    S().updateLive(id, { canGoForward: true });
    S().updateTab(id, { title: "t" });
  });
  assert.equal(updates, 2, "the load starting, then the rest");
  storeTransaction(() => {
    S().updateLive(id, { isLoading: false });
    S().updateLive(other, { isLoading: true });
    S().updateLive(id, { isLoading: true });
  });
  off();
  assert.equal(updates, 5, "each load starting or ending is heard");
});
