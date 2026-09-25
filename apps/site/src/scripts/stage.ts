// Wires Big Yahu to the page: loads the 3D model after the page is idle (the poster image holds his
// place, same box, so nothing shifts), follows the pointer, dances on download, and walks down to the
// closing poster when you get there.
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

async function boot() {
  if (!hero || yahu || saveData || !webgl()) return;
  const { createYahu } = await import("./yahu");
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

// He watches the pointer, and the download button when you're about to press it.
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
