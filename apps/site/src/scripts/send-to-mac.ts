// Phones and tablets can't run a Mac app. components/SendToMac.astro gives them "Send to my Mac" (the share
// sheet; a mailto to themselves where there's none), then Share, Copy link and Email it to me. X's iOS browser
// refuses the clipboard (docs/growth.md), so a failed copy points at Email instead. The other download CTAs ([data-download]: header, menu) scroll to
// the page's panel, or go to the home page's when the page has none. The device class comes from
// components/Visitor.astro; data-inapp="x" marks X's iOS browser.
// Tracks send_to_mac_clicked { location, method: "email" | "share" | "copy" | "panel", outcome?, via?: "main" | "link", inapp? }.
import { track } from "./track";

const LINK = "https://netnyahoo.com/?ref=share";
const DATA: ShareData = { url: LINK, title: "Arcadia", text: "Arcadia: real Chromium for the Mac. Open this on your Mac." };

const root = document.documentElement;
const inapp = root.dataset.inapp ?? null;

function report(location: string | null, method: "email" | "share" | "copy" | "panel", outcome?: string, via?: string) {
  track("send_to_mac_clicked", {
    location,
    method,
    ...(outcome ? { outcome } : {}),
    ...(via ? { via } : {}),
    ...(inapp ? { inapp } : {}),
  });
}

async function copy(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(LINK);
    return true;
  } catch {
    return false;
  }
}

function wire(panel: HTMLElement) {
  const location = panel.dataset.location ?? null;
  const main = panel.querySelector<HTMLAnchorElement>('[data-send="main"]');
  const email = panel.querySelector<HTMLAnchorElement>('[data-send="email"]');
  const share = panel.querySelector<HTMLButtonElement>('[data-send="share"]');
  const copyBtn = panel.querySelector<HTMLButtonElement>('[data-send="copy"]');
  const copyLabel = copyBtn?.querySelector<HTMLElement>("[data-copy-label]");

  email?.addEventListener("click", () => report(location, "email"));

  const canShare = typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(DATA));
  const openSheet = async (via: string) => {
    try {
      await navigator.share(DATA);
      report(location, "share", "shared", via);
    } catch (e) {
      // Dismissed: Copy link and Email are right below; no clipboard retry (it's refused by now).
      report(location, "share", e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "error", via);
    }
  };
  // The main button is the share sheet; without one it stays the mailto it's rendered as.
  main?.addEventListener("click", (e) => {
    if (!canShare) return report(location, "email", undefined, "main");
    e.preventDefault();
    void openSheet("main");
  });
  if (share && canShare) {
    share.hidden = false;
    share.addEventListener("click", () => void openSheet("link"));
  }

  let timer = 0;
  copyBtn?.addEventListener("click", async () => {
    const ok = await copy();
    report(location, "copy", ok ? "copied" : "blocked");
    if (!copyLabel) return;
    copyLabel.textContent = ok ? "Link copied" : "Blocked here: email it";
    clearTimeout(timer);
    timer = window.setTimeout(() => (copyLabel.textContent = "Copy link"), ok ? 2400 : 5000);
  });
}

if (root.dataset.device === "phone") {
  const panels = document.querySelectorAll<HTMLElement>("[data-send-panel]");
  for (const panel of panels) wire(panel);
  const main = document.querySelector<HTMLElement>('[data-send-panel="main"]') ?? panels[0];

  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-download]")) {
    // Not a download here: analytics.ts counts [data-track] clicks, and this one reports send_to_mac_clicked.
    delete link.dataset.track;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      report(link.dataset.trackLocation ?? null, "panel");
      if (!main) {
        location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/#send`;
        return;
      }
      main.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      main.removeAttribute("data-flash");
      void main.offsetWidth;
      main.setAttribute("data-flash", "");
    });
  }
}
