import type { Yahu } from "./yahu";

const hero = document.querySelector<HTMLElement>('[data-stage="hero"]');
const closing = document.querySelector<HTMLElement>('[data-stage="closing"]');
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

let yahu: Yahu | null = null;
let at: HTMLElement | null = null;

function webgl() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

const phone = matchMedia("(max-width: 820px), (pointer: coarse)").matches;

// The 3D chunk can fail to load (a flaky connection, or a page cached from before a deploy asking for
// a chunk that's gone). The poster already shows him, so keep it and stay quiet.
async function loadYahu() {
  try {
    return (await import("./yahu")).createYahu;
  } catch {
    return null;
  }
}

async function bootClosing() {
  if (!closing || yahu || saveData || !webgl()) return;
  const createYahu = await loadYahu();
  if (!createYahu) return;
  const url = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/models/big-yahu.glb`;
  yahu = await createYahu(url, closing, "poster");
  at = closing;
  closing.addEventListener(
    "yahu:ready",
    () => {
      closing.setAttribute("data-live", "");
      if (!reduced.matches) yahu?.dance("default", true);
    },
    { once: true },
  );
}

function watchClosing() {
  if (!closing) return;
  new IntersectionObserver(
    ([e], io) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      void bootClosing();
    },
    { rootMargin: "600px 0px" },
  ).observe(closing);
}

async function boot() {
  if (phone) return watchClosing();
  if (!hero || yahu || saveData || !webgl()) return;
  const createYahu = await loadYahu();
  if (!createYahu) return;
  const url = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/models/big-yahu.glb`;
  yahu = await createYahu(url, hero, "hero");
  at = hero;
  hero.addEventListener("yahu:ready", () => hero.setAttribute("data-live", ""), { once: true });
  closing?.addEventListener("yahu:ready", () => closing.setAttribute("data-live", ""));
  watchStages();
}

function moveTo(stage: HTMLElement) {
  if (!yahu || at === stage) return;
  const from = at;
  at = stage;
  from?.removeAttribute("data-live");
  yahu.attach(stage, stage === hero ? "hero" : "poster");
  stage.setAttribute("data-live", "");
  if (stage === closing && !reduced.matches) yahu.dance("default", true);
  else yahu.stop();
}

function watchStages() {
  if (!hero || !closing) return;
  const seen = new Map<Element, boolean>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      if (seen.get(closing)) moveTo(closing);
      else if (seen.get(hero)) moveTo(hero);
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  io.observe(hero);
  io.observe(closing);
}

let pending = 0;
addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse" || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      yahu?.lookAt(e.clientX, e.clientY);
    });
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => yahu?.lookAt(null, null));

for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-download]")) {
  const glance = () => {
    const r = link.getBoundingClientRect();
    yahu?.lookAt(r.left + r.width / 2, r.top + r.height / 2);
  };
  link.addEventListener("focus", glance);
  link.addEventListener("click", () => {
    if (!reduced.matches) yahu?.dance("griddy");
    document.dispatchEvent(new CustomEvent("netnyahoo:download"));
  });
}

const start = () => ("requestIdleCallback" in window ? requestIdleCallback(() => boot(), { timeout: 2500 }) : setTimeout(boot, 600));
if (document.readyState === "complete") start();
else addEventListener("load", start, { once: true });
