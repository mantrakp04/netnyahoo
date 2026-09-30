import { setSearchEngineName } from "@netnyahoo/cef";
import { chooseTextFragment, cleanUrl, searchUrl, withTextFragment, type SelectionContext } from "@netnyahoo/core";
import { copyText } from "@netnyahoo/shell";
import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { defaultSearchEngine } from "../../store/settings";
import { showToast } from "../layout/splitActions";
import { openModeFor } from "../bookmarks/actions";
import { openFromPage } from "../layout/openFromPage";

export type PageSelection = { text: string; rect: { x: number; y: number; width: number; height: number } };

export const usePageSelection = create<Record<string, PageSelection | null>>()(() => ({}));

export function setPageSelection(tabId: string, selection: PageSelection | null) {
  if (!selection && !usePageSelection.getState()[tabId]) return;
  usePageSelection.setState({ [tabId]: selection });
}

const store = () => useBrowser.getState();

export function startSelectionTools() {
  let name = "";
  const sync = () => {
    const next = defaultSearchEngine(store().settings).name;
    if (next !== name) void setSearchEngineName((name = next));
  };
  sync();
  return useBrowser.subscribe((s, prev) => s.settings !== prev.settings && sync());
}

export type ClickModifiers = { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean };

// A new tab next to the page, or where the keys held say (Chrome's): ⌘ behind, ⇧⌘ in front, ⇧ a new window.
export function searchSelection(tabId: string, text: string, modifiers: ClickModifiers = {}) {
  const tab = store().tabs[tabId];
  const query = text.replace(/\s+/g, " ").trim();
  if (!tab || !query) return;
  setPageSelection(tabId, null);
  const url = searchUrl(defaultSearchEngine(store().settings), query);
  const mode = openModeFor(modifiers);
  const disposition = mode === "current" || mode === "incognito" ? "foreground" : mode;
  openFromPage({ url, disposition }, { windowId: tab.windowId, profileId: tab.profileId, tabId });
}

const SELECTION_CONTEXT = `(() => {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return post("result", "null");
  const range = sel.getRangeAt(0);
  const block = (node) => {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && !/^(block|list-item|table|table-cell|flex|grid)$/.test(getComputedStyle(el).display)) el = el.parentElement;
    return el || document.body;
  };
  const text = (from, to) => {
    const r = document.createRange();
    try { r.setStart(...from); r.setEnd(...to); } catch (e) { return ""; }
    return r.toString();
  };
  const startBlock = block(range.startContainer), endBlock = block(range.endContainer);
  post("result", JSON.stringify({
    selected: sel.toString(),
    before: text([startBlock, 0], [range.startContainer, range.startOffset]),
    after: text([range.endContainer, range.endOffset], [endBlock, endBlock.childNodes.length]),
    pageText: (document.body.innerText || "").slice(0, 3000000),
  }));
})()`;

export async function linkToSelection(tabId: string): Promise<string | null> {
  const url = store().tabs[tabId]?.url;
  const web = webviews.get(tabId);
  if (!url || !/^https?:/.test(url) || !web) return null;
  const context = await web.evaluate<SelectionContext>(SELECTION_CONTEXT);
  const fragment = context && !("error" in context) ? chooseTextFragment(context) : null;
  return fragment ? withTextFragment(cleanUrl(url), fragment) : null;
}

export async function copyLinkToSelection(tabId: string) {
  const link = await linkToSelection(tabId);
  const windowId = store().tabs[tabId]?.windowId;
  if (!link || !windowId) return;
  copyText(link);
  showToast(windowId, "Copied Quote Link", "Links directly to the selected text.", { icon: "quote.bubble.fill" });
}

const HAS_SELECTION = `post("result", JSON.stringify(!!String(getSelection() || "").trim()))`;

export async function copyPageUrl(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab?.url) return;
  const clean = cleanUrl(tab.url);
  copyText(clean);
  const title = clean !== tab.url ? "Copied a clean link without trackers" : "Copied Current URL";
  const web = webviews.get(tabId);
  const selected = /^https?:/.test(tab.url) && web ? await web.evaluate<boolean>(HAS_SELECTION) : false;
  if (selected !== true) return showToast(tab.windowId, title, undefined, { icon: "link" });
  showToast(tab.windowId, title, "Share a link directly to this text instead?", {
    icon: "link",
    action: { title: "Copy Quote Link", run: () => void copyLinkToSelection(tabId) },
  });
}

const FOCUSED = `const focused = () => {
  let el = document.activeElement;
  for (;;) {
    if (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    else if (el && el.tagName === "IFRAME") {
      try { el = el.contentDocument.activeElement; } catch (e) { return el; }
    } else return el;
  }
};
const isTextField = (el) => !!el && !el.readOnly && !el.disabled &&
  (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|url|email|tel|)$/i.test(el.getAttribute("type") || "")));`;

const JUMP_TO_SELECTION = `(() => {
  ${FOCUSED}
  const el = focused();
  if (isTextField(el)) {
    const [start, end] = [el.selectionStart, el.selectionEnd];
    el.scrollIntoView({ block: "center", inline: "nearest" });
    // Re-applying the selection scrolls a focused field to it; a textarea gets there by its line.
    el.setSelectionRange(end, end);
    el.setSelectionRange(start, end);
    if (el.tagName === "TEXTAREA") {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const line = el.value.slice(0, start).split("\\n").length - 1;
      el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 2);
    }
    return post("result", "true");
  }
  const win = el ? el.ownerDocument.defaultView : window;
  const sel = win.getSelection();
  if (!sel || !sel.rangeCount || (sel.isCollapsed && !(el && el.isContentEditable))) return post("result", "false");
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  node.scrollIntoView({ block: "center", inline: "nearest" });
  const r = range.getBoundingClientRect();
  if (r.height && (r.top < 0 || r.bottom > win.innerHeight)) win.scrollBy(0, r.top + r.height / 2 - win.innerHeight / 2);
  post("result", "true");
})()`;

export function jumpToSelection(tabId: string): Promise<boolean | { error: string } | null> {
  return webviews.get(tabId)?.evaluate<boolean>(JUMP_TO_SELECTION) ?? Promise.resolve(null);
}

export type ReplaceResult = { field: boolean; count: number };

const REPLACE = `(query, replacement, all) => {
  ${FOCUSED}
  const el = focused();
  const done = (field, count) => post("result", JSON.stringify({ field, count }));
  const q = query.toLowerCase();
  if (!el || !q) return done(false, 0);
  const doc = el.ownerDocument, win = doc.defaultView;
  if (isTextField(el)) {
    // Through the editing commands, so the page sees input events and ⌘Z undoes it.
    const insert = (start, end, text) => {
      el.focus();
      el.setSelectionRange(start, end);
      if (!doc.execCommand("insertText", false, text)) {
        el.setRangeText(text, start, end, "end");
        el.dispatchEvent(new win.InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
      }
    };
    const value = el.value, lower = value.toLowerCase();
    if (all) {
      let out = "", last = 0, count = 0;
      for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length), count++) {
        out += value.slice(last, i) + replacement;
        last = i + q.length;
      }
      if (count) insert(0, value.length, out + value.slice(last));
      return done(true, count);
    }
    // The selected match, else the next one after the caret (wrapping).
    const selected = lower.slice(el.selectionStart, el.selectionEnd) === q;
    let at = selected ? el.selectionStart : lower.indexOf(q, el.selectionEnd);
    if (at === -1) at = lower.indexOf(q);
    if (at === -1) return done(true, 0);
    insert(at, at + q.length, replacement);
    const after = el.value.toLowerCase();
    let next = after.indexOf(q, at + replacement.length);
    if (next === -1) next = after.indexOf(q);
    if (next !== -1) el.setSelectionRange(next, next + q.length);
    return done(true, 1);
  }
  if (!el.isContentEditable) return done(false, 0);
  const matches = () => {
    const found = [];
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const t = n.data.toLowerCase();
      for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) {
        const r = doc.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        found.push(r);
      }
    }
    return found;
  };
  const sel = win.getSelection();
  const select = (r) => {
    sel.removeAllRanges();
    sel.addRange(r);
  };
  const replace = (r) => {
    select(r);
    if (!doc.execCommand("insertText", false, replacement)) {
      r.deleteContents();
      r.insertNode(doc.createTextNode(replacement));
    }
  };
  el.focus();
  const found = matches();
  if (all) {
    // Last to first keeps the earlier ranges valid.
    for (const r of found.reverse()) replace(r);
    return done(true, found.length);
  }
  const current = sel.rangeCount ? sel.getRangeAt(0) : null;
  const isCurrent = (r) => current && r.compareBoundaryPoints(Range.START_TO_START, current) === 0 && r.compareBoundaryPoints(Range.END_TO_END, current) === 0;
  const target = found.find(isCurrent) || (current && found.find((r) => r.compareBoundaryPoints(Range.START_TO_START, current) >= 0)) || found[0];
  if (!target) return done(true, 0);
  replace(target);
  const caret = sel.rangeCount ? sel.getRangeAt(0) : null;
  const rest = matches();
  const next = (caret && rest.find((r) => r.compareBoundaryPoints(Range.START_TO_END, caret) >= 0)) || rest[0];
  if (next) select(next);
  done(true, 1);
}`;

export async function replaceInField(tabId: string, query: string, replacement: string, all: boolean): Promise<ReplaceResult> {
  const web = webviews.get(tabId);
  const args = [query, replacement, all].map((v) => JSON.stringify(v)).join(", ");
  const result = web ? await web.evaluate<ReplaceResult | { error: string }>(`(${REPLACE})(${args})`) : null;
  return result && "field" in result ? result : { field: false, count: 0 };
}

if (__DEV__) {
  (globalThis as { nnSelection?: unknown }).nnSelection = { usePageSelection, searchSelection, linkToSelection, copyPageUrl, replaceInField, jumpToSelection };
}
