
import { ph, track, type Props } from "./track";

function onTrackedClick(e: MouseEvent) {
  const el = (e.target as Element | null)?.closest<HTMLElement>("[data-track]");
  if (!el) return;
  const props: Props = {};
  for (const [k, v] of Object.entries(el.dataset)) {
    if (k.startsWith("track") && k !== "track" && v !== undefined) {
      const name = k.slice(5).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "");
      props[name] = v;
    }
  }
  const leaves = el instanceof HTMLAnchorElement && el.origin !== location.origin && !el.hasAttribute("download");
  track(el.dataset.track!, props, leaves ? { send_instantly: true } : undefined);
}
document.addEventListener("click", onTrackedClick, { capture: true });

const sections = document.querySelectorAll<HTMLElement>("[data-shot]");
if (sections.length) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        track("section_viewed", { section: (e.target as HTMLElement).dataset.shot ?? null });
      }
    },
    { threshold: 0.35 },
  );
  for (const s of sections) seen.observe(s);
}

const support = document.querySelectorAll<HTMLButtonElement>("[data-support]");
if (support.length) {
  let tries = 0;
  const check = () => {
    if (ph()?.conversations?.isAvailable?.()) {
      for (const b of support) b.hidden = false;
      return;
    }
    if (++tries < 15) setTimeout(check, 1000);
  };
  addEventListener("load", () => setTimeout(check, 1000), { once: true });
  for (const b of support) {
    b.addEventListener("click", () => {
      ph()?.conversations?.show?.();
      track("support_opened", { location: b.dataset.support ?? null });
    });
  }
}
