// Screenshots open full size on click or tap (components/Shot.astro's .zoom-hit): the whole window, not the
// phone crop. Tap, click or Escape closes. Opening is tracked by analytics.ts (screenshot_opened).
type Full = { src: string; w: number; h: number };

let dialog: HTMLDialogElement | null = null;

function build() {
  const d = document.createElement("dialog");
  d.className = "lightbox";
  d.setAttribute("aria-label", "Screenshot");
  d.style.cssText =
    "max-width:none;max-height:none;width:100vw;height:100dvh;margin:0;padding:0;border:0;background:rgb(22 19 15 / 0.88);overflow:auto;cursor:zoom-out";
  d.addEventListener("click", () => d.close());
  d.addEventListener("close", () => {
    d.replaceChildren();
    document.documentElement.style.overflow = "";
  });
  document.body.append(d);
  return d;
}

function open(button: HTMLElement) {
  let shots: Full[];
  try {
    shots = JSON.parse(button.dataset.lightbox ?? "[]");
  } catch {
    return;
  }
  if (!shots.length) return;
  dialog ??= build();
  const narrow = innerWidth < 640;
  const wrap = document.createElement("div");
  wrap.style.cssText =
    `min-height:100%;display:flex;flex-direction:column;align-items:${narrow ? "flex-start" : "center"};justify-content:center;gap:24px;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));${narrow ? "width:max-content" : ""}`;
  for (const s of shots) {
    const img = document.createElement("img");
    img.src = s.src;
    img.width = s.w;
    img.height = s.h;
    img.alt = shots.length > 1 ? "" : (button.dataset.lightboxAlt ?? "");
    img.decoding = "async";
    // Phones: the whole window at 343px is smaller than the page's own crop, so show it large and let people pan.
    img.style.cssText = narrow
      ? `display:block;width:${Math.min(900, Math.round(s.w / 2))}px;max-width:none;height:auto`
      : `display:block;width:auto;height:auto;max-width:min(100%,${Math.round(s.w / 2)}px);max-height:calc(100dvh - 32px);object-fit:contain`;
    wrap.append(img);
  }
  if (shots.length > 1) wrap.setAttribute("aria-label", button.dataset.lightboxAlt ?? "");
  dialog.replaceChildren(wrap);
  document.documentElement.style.overflow = "hidden";
  dialog.showModal();
  if (narrow) {
    const d = dialog;
    const center = () => d.scrollTo({ left: (d.scrollWidth - d.clientWidth) / 2 });
    setTimeout(center, 0);
    wrap.querySelector("img")?.addEventListener("load", center, { once: true });
  }
}

document.addEventListener("click", (e) => {
  const button = (e.target as Element | null)?.closest<HTMLElement>(".zoom-hit");
  if (button) open(button);
});
