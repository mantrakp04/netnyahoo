// The site's PostHog wiring that runs on every page (loaded once, from layouts/Base.astro): declarative
// click events, section views and the support link. Scripts that send their own events import
// track() from ./track.
//
// Events:
//   download_clicked      { version, location: header | hero | closing | release_notes }
//   github_clicked        { link: read_the_source | source | releases | issues, location: header | menu | hero | footer }
//   release_notes_viewed  { version (the #anchor, or null), latest, trigger: load | hashchange }
//   section_viewed        { section }  (once per section per page)
//   yahu_found            { seconds, misses }  (the Where's Big Yahu game)
//   yahu_danced           { stage, dance }  (tapping the 3D Big Yahu)
//   yahu_spun             { stage }  (dragging him around, once per page)
//   support_opened        { location }

import { ph, track, type Props } from "./track";

/** Declarative events: data-track="event" plus data-track-<prop>="value" on any clickable element. */
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
  // A link that leaves the page goes out right away rather than waiting for the next batch.
  const leaves = el instanceof HTMLAnchorElement && el.origin !== location.origin && !el.hasAttribute("download");
  track(el.dataset.track!, props, leaves ? { send_instantly: true } : undefined);
}
document.addEventListener("click", onTrackedClick, { capture: true });

// Which sections people get to, once each.
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

// Support: PostHog's widget, when it's switched on in the project. The footer's "write to the
// office" link stays hidden until then.
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
