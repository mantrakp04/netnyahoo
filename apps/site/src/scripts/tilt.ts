// The painted logo (Hero, Closing) leans a few degrees toward the mouse: [data-tilt] gets --tx and --ty, from -1 to 1,
// for where the pointer is relative to its centre (global.css turns them into a transform). Mouse only, only while
// on screen, and never with reduced motion.
const motion = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
const shown = new Set<HTMLElement>();
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target as HTMLElement;
    if (e.isIntersecting) shown.add(el);
    else shown.delete(el);
  }
});
for (const el of document.querySelectorAll<HTMLElement>("[data-tilt]")) io.observe(el);

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
function lean(x: number | null, y: number | null) {
  for (const el of shown) {
    if (x === null || y === null) {
      el.style.removeProperty("--tx");
      el.style.removeProperty("--ty");
      continue;
    }
    const r = el.getBoundingClientRect();
    el.style.setProperty("--tx", clamp((x - (r.left + r.width / 2)) / (innerWidth / 2)).toFixed(3));
    el.style.setProperty("--ty", clamp((y - (r.top + r.height / 2)) / (innerHeight / 2)).toFixed(3));
  }
}

let pending = 0;
addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse" || !motion.matches || !shown.size || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      lean(e.clientX, e.clientY);
    });
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => lean(null, null));
