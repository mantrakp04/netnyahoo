// Clicks, as posthog-js reported them:
//   $autocapture  a click on a link, a button or anything tagged [data-track]
//   $rageclick    3 clicks within 1 s of each other and 30 px of the last (any element)
//   $dead_click   a click after which nothing happens: no scroll or text selection within 100 ms, no DOM change
//                 within 2.5 s, no navigation (checked for up to 3 s)
//   $dead_swipe   the same for a swipe on a touch screen (30 px or more) that scrolled nothing
// Each carries $elements_chain (PostHog's format: the clicked element up to <body>, with its classes and
// attributes), $el_text and, for links off the site, $external_click_url. Never an input's value or typing.
import { capture, type Props } from "./core";

const AUTOCAPTURE = 'a, button, [role="button"], [role="link"], summary, label, select, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [data-track]';
/** Nothing about these is reported (no events). */
const NO_CAPTURE = ".ph-no-capture, [data-nn-no-capture]";
/** These are reported without their text. */
const PRIVATE = ".nn-private, [data-private], .ph-sensitive";
const FIELD = /^(input|textarea|select|option)$/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
// Anything that looks like a card or social security number stays out.
const sensitive = (s: string) => /\b(?:\d[ -]?){13,16}\b/.test(s) || /\b\d{3}-\d{2}-\d{4}\b/.test(s);

/** The element's own text (its text nodes, not its children's), as posthog-js takes it. */
function ownText(el: Element): string {
  if (FIELD.test(el.tagName.toLowerCase()) || (el as HTMLElement).isContentEditable || el.closest(PRIVATE)) return "";
  let text = "";
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += ` ${node.textContent ?? ""}`;
  text = clean(text).slice(0, 255);
  return sensitive(text) ? "" : text;
}

function elementText(el: Element): string {
  const own = ownText(el);
  if (own || el.closest(PRIVATE)) return own;
  const all = clean(el.textContent ?? "").slice(0, 255);
  return sensitive(all) ? "" : all;
}

const quote = (s: string) => s.replace(/"|\\"/g, '\\"');

/** PostHog's elements_chain: `tag.class1.class2:attr="v"…;parent…`, attributes sorted, up to <body>. */
export function elementsChain(target: Element): string {
  const parts: string[] = [];
  for (let el: Element | null = target; el && el !== document.documentElement; el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    const field = FIELD.test(tag) || (el as HTMLElement).isContentEditable;
    const hidden = !!el.closest(PRIVATE);
    const attrs: Record<string, string> = {};
    const text = ownText(el);
    if (text) attrs.text = text;
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [el];
    attrs["nth-child"] = String(siblings.indexOf(el) + 1);
    attrs["nth-of-type"] = String(siblings.filter((s) => s.tagName === el!.tagName).indexOf(el) + 1);
    if (tag === "a" && el.hasAttribute("href")) attrs.href = el.getAttribute("href")!.slice(0, 2048);
    if (el.id) attrs.attr_id = el.id;
    for (const a of Array.from(el.attributes)) {
      if (a.name === "value") continue;
      if (field && !/^(type|name|id|class|role|placeholder|aria-label)$/.test(a.name)) continue;
      if (hidden && /^(title|alt|aria-label|aria-description)$/.test(a.name)) continue;
      if (sensitive(a.value)) continue;
      attrs[`attr__${a.name}`] = a.value.slice(0, 2048);
    }
    const classes = Array.from(el.classList)
      .filter(Boolean)
      .sort()
      .map((c) => `.${c.replace(/"/g, "")}`)
      .join("");
    const sorted = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
    parts.push(`${tag}${classes}:${sorted.map(([k, v]) => `${quote(k)}="${quote(v)}"`).join("")}`);
  }
  return parts.join(";");
}

function externalUrl(el: Element): string | null {
  const a = el.closest("a[href]") as HTMLAnchorElement | null;
  if (!a) return null;
  try {
    const url = new URL(a.href, location.href);
    return /^https?:$/.test(url.protocol) && url.host !== location.host ? url.href : null;
  } catch {
    return null;
  }
}

function elementProps(target: Element, text: string): Props {
  return {
    $event_type: "click",
    $ce_version: 1,
    $el_text: text || null,
    $elements_chain: elementsChain(target),
    $external_click_url: externalUrl(target),
  };
}

const targetOf = (e: Event): Element | null => {
  const t = e.target as Node | null;
  if (!t) return null;
  return t.nodeType === Node.ELEMENT_NODE ? (t as Element) : t.parentElement;
};

// ---------------------------------------------------------------- rage clicks (posthog-js: 30 px, 1 s, 3)

let series: { x: number; y: number; t: number }[] = [];
function rage(e: MouseEvent): boolean {
  const last = series[series.length - 1];
  if (last && Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) < 30 && e.timeStamp - last.t < 1000) {
    series.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    return series.length === 3;
  }
  series = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
  return false;
}

// ---------------------------------------------------------------- dead clicks and swipes

const SCROLL_MS = 100;
const SELECTION_MS = 100;
const MUTATION_MS = 2500;
const ABSOLUTE_MS = 3000;

interface Pending {
  kind: "click" | "swipe";
  el: Element;
  t0: number;
  at: number;
  scroll?: number;
  selection?: number;
  mutation?: number;
  visibility?: number;
  extra: Props;
}

let pending: Pending[] = [];
let checkTimer = 0;
let lastMutationAt: number | null = null;
let lastClicked: { el: Element; t: number } | null = null;

function saw(kind: "scroll" | "selection" | "mutation" | "visibility") {
  const now = performance.now();
  for (const p of pending) if (p[kind] === undefined) p[kind] = now - p.t0;
}

const mutations = new MutationObserver(() => {
  lastMutationAt = Date.now();
  saw("mutation");
});

function watch() {
  if (pending.length === 1) mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  if (!checkTimer) checkTimer = window.setTimeout(check, 1000);
}

function check() {
  checkTimer = 0;
  const now = performance.now();
  const still: Pending[] = [];
  for (const p of pending) {
    const absolute = now - p.t0;
    const alive =
      (p.scroll !== undefined && p.scroll < SCROLL_MS) ||
      (p.selection !== undefined && p.selection < SELECTION_MS) ||
      (p.mutation !== undefined && p.mutation < MUTATION_MS) ||
      p.visibility !== undefined;
    if (alive) continue;
    const timeouts = {
      scroll: p.scroll !== undefined && p.scroll >= SCROLL_MS,
      selection: p.selection !== undefined && p.selection >= SELECTION_MS,
      mutation: p.mutation !== undefined ? p.mutation >= MUTATION_MS : absolute >= MUTATION_MS,
      absolute: absolute >= ABSOLUTE_MS,
    };
    if (timeouts.scroll || timeouts.selection || timeouts.mutation || timeouts.absolute) report(p, absolute, timeouts);
    else still.push(p);
  }
  pending = still;
  if (pending.length) checkTimer = window.setTimeout(check, 1000);
  else mutations.disconnect();
}

function report(p: Pending, absolute: number, timeouts: Record<"scroll" | "selection" | "mutation" | "absolute", boolean>) {
  const k = `$dead_${p.kind}`;
  const ms = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  capture(
    k,
    {
      ...elementProps(p.el, elementText(p.el)),
      $event_type: p.kind === "click" ? "click" : "touchend",
      [`${k}_scroll_delay_ms`]: ms(p.scroll),
      [`${k}_selection_changed_delay_ms`]: ms(p.selection),
      [`${k}_mutation_delay_ms`]: ms(p.mutation),
      [`${k}_absolute_delay_ms`]: Math.round(absolute),
      [`${k}_scroll_timeout`]: timeouts.scroll,
      [`${k}_selection_changed_timeout`]: timeouts.selection,
      [`${k}_mutation_timeout`]: timeouts.mutation,
      [`${k}_absolute_timeout`]: timeouts.absolute,
      [`${k}_visibility_changed_timeout`]: false,
      [`${k}_event_timestamp`]: p.at,
      [`${k}_last_mutation_timestamp`]: lastMutationAt,
      ...p.extra,
    },
    { timestamp: p.at },
  );
}

function watchForNothing(kind: Pending["kind"], el: Element, extra: Props = {}, scrolledAlready = false) {
  if (el === document.documentElement) return;
  pending.push({ kind, el, t0: performance.now(), at: Date.now(), extra, ...(scrolledAlready ? { scroll: 0 } : {}) });
  watch();
}

// ---------------------------------------------------------------- listeners

function onClick(e: MouseEvent) {
  const target = targetOf(e);
  if (!target || target.closest(NO_CAPTURE)) return;

  const hit = target.closest(AUTOCAPTURE);
  if (hit) capture("$autocapture", elementProps(target, ownText(target) || elementText(hit)));

  // Keyboard "clicks" (Enter on a button) have no position.
  if (e.detail > 0 && rage(e)) capture("$rageclick", elementProps(target, ownText(target) || elementText(hit ?? target)));

  // A second click on the same element within a second is part of the first.
  const now = performance.now();
  const repeat = lastClicked && lastClicked.el === target && now - lastClicked.t < 1000;
  lastClicked = { el: target, t: now };
  if (!repeat) watchForNothing("click", target);
}

let touch: { x: number; y: number; el: Element; scrolled: boolean } | null = null;
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  const el = targetOf(e);
  touch = e.touches.length === 1 && t && el && !el.closest(NO_CAPTURE) ? { x: t.clientX, y: t.clientY, el, scrolled: false } : null;
}
function onTouchEnd(e: TouchEvent) {
  const start = touch;
  touch = null;
  const t = e.changedTouches[0];
  if (!start || !t) return;
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  const distance = Math.round(Math.max(Math.abs(dx), Math.abs(dy)));
  if (distance < 30 || start.scrolled) return;
  const direction = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "down" : "up") : dx > 0 ? "right" : "left";
  watchForNothing("swipe", start.el, { $dead_swipe_direction: direction, $dead_swipe_distance_px: distance });
}

export function startAutocapture() {
  addEventListener("click", onClick, { capture: true, passive: true });
  addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
  addEventListener(
    "scroll",
    () => {
      if (touch) touch.scrolled = true;
      saw("scroll");
    },
    { capture: true, passive: true },
  );
  document.addEventListener("selectionchange", () => {
    // A click on text sets a collapsed selection; only a real selection counts as something happening.
    if (!document.getSelection()?.isCollapsed) saw("selection");
  });
  addEventListener("visibilitychange", () => saw("visibility"));
  addEventListener("pagehide", () => saw("visibility"));
}
