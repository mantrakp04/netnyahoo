/**
 * The page side of Translate (components/site/translate.ts), run through `WebViewHandle.evaluate`
 * in the page's main frame. It installs itself once per document and keeps:
 * - passages: a block's text (a paragraph, a list item, a cell…) goes to the translator as one
 *   piece of text, so sentences split by links and inline styles translate as sentences, and each
 *   text node gets back its own part of the translation (markup stays as it is);
 * - every text node it translated, with its original text, so Show Original puts back exactly
 *   what was there (a node the page changed since is left alone);
 * - a MutationObserver that queues text the page adds (or rewrites) while translation is on;
 * - what's on screen first: text near the viewport is queued at once, the rest when it scrolls
 *   into view (an IntersectionObserver), so a long page costs what you read of it. `next` hands
 *   out bounded batches, so the page never blocks.
 * Only text nodes change. Skipped: scripts, styles, code and preformatted text, form fields,
 * editable content, `translate="no"` and `.notranslate` (Chrome's opt-outs).
 */

/** A passage to translate: its id and its text nodes' [id, text], in reading order. */
export type Passage = [number, [number, string][]];

const INSTALL = String.raw`
const KEY = Symbol.for("netnyahoo.translator");
if (!window[KEY]) {
  const SKIP = "script,style,noscript,template,code,pre,kbd,samp,var,textarea,input,select,option,svg,math,iframe,[contenteditable]:not([contenteditable=false]),[translate=no],.notranslate";
  // What makes a passage: the text of one of these, minus the ones nested in it.
  const BLOCK = "p,li,dd,dt,td,th,caption,figcaption,blockquote,h1,h2,h3,h4,h5,h6,summary,legend,label,button,div,section,article,aside,header,footer,main,nav,form,fieldset,details,dialog,body";
  const LETTER = /\p{L}/u;
  const MAX_WATCHED = 20000;
  const MAX_TEXT = 2000;
  const MAX_PIECES = 40;
  // Text within this distance of the viewport counts as on screen.
  const MARGIN = 300;
  const skipCache = new WeakMap();
  const skipped = (el) => {
    if (!el) return true;
    let v = skipCache.get(el);
    if (v === undefined) skipCache.set(el, (v = !!el.closest(SKIP)));
    return v;
  };
  const blockCache = new WeakMap();
  const blockOf = (el) => {
    let b = blockCache.get(el);
    if (b === undefined) blockCache.set(el, (b = el.closest(BLOCK) || document.documentElement));
    return b;
  };
  const eligible = (n) => n.nodeType === 3 && n.nodeValue.length <= MAX_TEXT && LETTER.test(n.nodeValue) && !skipped(n.parentElement);
  const root = () => document.body || document.documentElement;
  const t = (window[KEY] = {
    active: false,
    token: null,
    seq: 0,
    done: 0,
    records: new Map(),
    byId: new Map(),
    queue: [],
    queued: new Set(),
    // Passages waiting to come near the viewport, and those that have.
    watched: new WeakSet(),
    shown: new WeakSet(),
    watchedCount: 0,
    observer: null,
    visibility: null,
    sample() {
      const w = document.createTreeWalker(root(), NodeFilter.SHOW_TEXT);
      let text = "";
      for (let n = w.nextNode(), i = 0; n && text.length < 2500 && i < 20000; n = w.nextNode(), i++) if (eligible(n)) text += n.nodeValue.trim() + " ";
      return { lang: document.documentElement.lang || "", text, active: this.active };
    },
    enqueue(block) {
      if (this.queued.has(block)) return;
      this.queued.add(block);
      this.queue.push(block);
    },
    // Passages with text under 'node': queued now if on screen, else when they get there.
    track(node) {
      const blocks = new Set();
      if (node.nodeType === 3) {
        if (eligible(node)) blocks.add(blockOf(node.parentElement));
      } else if (node.nodeType === 1 && !skipped(node)) {
        const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (eligible(n)) blocks.add(blockOf(n.parentElement));
      }
      const top = -MARGIN, bottom = innerHeight + MARGIN;
      for (const b of blocks) {
        if (this.shown.has(b)) this.enqueue(b);
        else if (this.watched.has(b) || this.watchedCount >= MAX_WATCHED) continue;
        else {
          const r = b.getBoundingClientRect();
          if (r.bottom >= top && r.top <= bottom && (r.width || r.height)) {
            this.shown.add(b);
            this.enqueue(b);
          } else {
            this.watched.add(b);
            this.watchedCount++;
            this.visibility.observe(b);
          }
        }
      }
    },
    // A passage's text nodes that aren't translated yet (nested passages are their own).
    pieces(block) {
      const out = [];
      const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (eligible(n) && !this.records.has(n) && blockOf(n.parentElement) === block) out.push(n);
      return out;
    },
    start(token) {
      if (this.active) return this.token === token;
      this.active = true;
      this.token = token;
      this.visibility = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          this.visibility.unobserve(e.target);
          this.watched.delete(e.target);
          this.shown.add(e.target);
          this.enqueue(e.target);
        }
      }, { rootMargin: MARGIN + "px 0px" });
      this.track(root());
      this.observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "characterData") {
            const rec = this.records.get(m.target);
            if (rec && m.target.nodeValue === rec.applied) continue; // our own write
            if (rec) this.records.delete(m.target);
            this.track(m.target);
          } else for (const n of m.addedNodes) this.track(n);
        }
      });
      this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      return true;
    },
    // Only for the translation that started here: a new document isn't translated behind your back.
    next(token, max, maxChars) {
      if (!this.active || this.token !== token) return { passages: [], more: false, gone: true, done: 0, total: 0 };
      const passages = [];
      let chars = 0;
      while (this.queue.length && passages.length < max && chars < maxChars) {
        const block = this.queue.shift();
        this.queued.delete(block);
        if (!block.isConnected) continue;
        const nodes = this.pieces(block);
        for (let i = 0; i < nodes.length; i += MAX_PIECES) {
          const pieces = [];
          for (const node of nodes.slice(i, i + MAX_PIECES)) {
            const id = ++this.seq;
            this.byId.set(id, node);
            this.records.set(node, { orig: node.nodeValue, applied: null });
            pieces.push([id, node.nodeValue]);
            chars += node.nodeValue.length;
          }
          passages.push([++this.seq, pieces]);
        }
      }
      this.done += passages.length;
      return { passages, more: this.queue.length > 0, gone: false, done: this.done, total: this.done + this.queue.length };
    },
    apply(results) {
      for (const [id, text] of results) {
        const node = this.byId.get(id);
        this.byId.delete(id);
        const rec = node && this.records.get(node);
        if (!rec || !node.isConnected || node.nodeValue !== rec.orig || typeof text !== "string") continue;
        // The original's spacing at either end, else the translation's (which spaces pieces apart
        // where the source language had no spaces).
        const [, textLead, body, textTrail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const origLead = rec.orig.match(/^\s*/)[0];
        const origTrail = rec.orig.match(/\s*$/)[0];
        rec.applied = (origLead || textLead) + body + (origTrail || textTrail);
        node.nodeValue = rec.applied;
      }
      return true;
    },
    revert() {
      this.active = false;
      this.token = null;
      if (this.observer) this.observer.disconnect();
      if (this.visibility) this.visibility.disconnect();
      this.observer = this.visibility = null;
      this.queue = [];
      this.queued = new Set();
      this.watched = new WeakSet();
      this.shown = new WeakSet();
      this.watchedCount = this.done = 0;
      for (const [node, rec] of this.records) if (rec.applied !== null && node.nodeValue === rec.applied) node.nodeValue = rec.orig;
      this.records.clear();
      this.byId.clear();
      return true;
    },
  });
}
`;

/** Code for `evaluate` that runs `op(...args)` on the page's translator and posts its result. */
export function translatorCall(op: "sample" | "start" | "next" | "apply" | "revert", ...args: unknown[]): string {
  return `${INSTALL}\npost("result", JSON.stringify(window[Symbol.for("netnyahoo.translator")].${op}(...${JSON.stringify(args)})));`;
}
