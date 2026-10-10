// Named events (beyond the automatic ones in scripts/telemetry: $pageview, $pageleave, $autocapture, $rageclick,
// $dead_click, $dead_swipe, $exception, $web_vitals, $replay_chunk, $feature_flag_called):
//   download_clicked { location, version }       a Download button (data-track)
//   github_clicked { link, location }            a GitHub link (data-track)
//   send_to_mac_clicked { location, method: email|share|copy|panel, outcome?, inapp? }
//                                                phones: scripts/send-to-mac.ts. outcome: share → shared|cancelled|error,
//                                                copy → copied|blocked; none for email (mailto) or panel (the header
//                                                or menu button scrolled to the panel). inapp: "x" in X's iOS browser.
//   mac_link_visit { ref: mac|share|email, device }   a visit from a link sent from a phone (/mac redirects to ?ref=mac),
//                                                once per session
//   notify_clicked { os, location }              Windows/Linux: "Tell me when it's on …" (GitHub Watch › Releases)
//   non_mac_visit { os }                         Windows/Linux desktops, once per session
//   section_viewed { section }                   a [data-shot] section scrolled into view
//   support_opened { location }                  the footer's support chat (scripts/support.ts)
//   release_notes_viewed { version, latest, trigger }   pages/release-notes.astro
//   game_solved { seconds, misses }              the lamb found in the game's screenshot (components/Game.astro)
// Experiment: flag "download-band", Macs only (components/InOffice.astro, docs/growth.md).
import { track, type Props } from "./track";
import "./support";

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

// Links sent from a phone come back with ?ref=: typed netnyahoo.com/mac (pages/mac.astro), the share sheet or
// copy (share), or the email to self (email).
const sentRef = new URLSearchParams(location.search).get("ref");
if (sentRef === "mac" || sentRef === "share" || sentRef === "email") {
  let seen = false;
  try {
    seen = sessionStorage.getItem("ac:mac_link_visit") === "1";
    sessionStorage.setItem("ac:mac_link_visit", "1");
  } catch {}
  if (!seen) track("mac_link_visit", { ref: sentRef, device: document.documentElement.dataset.device ?? null });
}

// Windows and Linux can't run it yet (components/Visitor.astro sorts visitors); count them once per session.
const { device, os } = document.documentElement.dataset;
if (device === "other") {
  let seen = false;
  try {
    seen = sessionStorage.getItem("ac:non_mac_visit") === "1";
    sessionStorage.setItem("ac:non_mac_visit", "1");
  } catch {}
  if (!seen) track("non_mac_visit", { os: os ?? null });
}
