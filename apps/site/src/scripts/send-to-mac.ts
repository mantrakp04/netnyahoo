// Phones and tablets can't run a Mac app. components/SendToMac.astro shows them a short address to type on
// the Mac later (netnyahoo.com/mac), "Email it to me" (mailto to self) first, then Share and Copy link.
// The clipboard isn't the plan: X's iOS browser refused it for 56 of 56 people (docs/growth.md), so a copy
// that fails selects the address instead. The other download CTAs ([data-download]: header, menu) scroll to
// the page's panel, or go to the home page's when the page has none. The device class comes from
// components/Visitor.astro; data-inapp="x" marks X's iOS browser.
// Tracks send_to_mac_clicked { location, method: "email" | "share" | "copy" | "panel", outcome?, inapp? }.
import { track } from "./track";

const LINK = "https://netnyahoo.com/?ref=share";
const DATA: ShareData = { url: LINK, title: "Netnyahoo", text: "Netnyahoo: real Chromium for the Mac. Open this on your Mac." };

const root = document.documentElement;
const inapp = root.dataset.inapp ?? null;

function report(location: string | null, method: "email" | "share" | "copy" | "panel", outcome?: string) {
  track("send_to_mac_clicked", { location, method, ...(outcome ? { outcome } : {}), ...(inapp ? { inapp } : {}) });
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
  const addr = panel.querySelector<HTMLElement>("[data-send-addr]");
  const email = panel.querySelector<HTMLAnchorElement>('[data-send="email"]');
  const share = panel.querySelector<HTMLButtonElement>('[data-send="share"]');
  const copyBtn = panel.querySelector<HTMLButtonElement>('[data-send="copy"]');
  const copyLabel = copyBtn?.querySelector<HTMLElement>("[data-copy-label]");

  email?.addEventListener("click", () => report(location, "email"));

  const canShare = typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(DATA));
  if (share && canShare) {
    share.hidden = false;
    share.addEventListener("click", async () => {
      try {
        await navigator.share(DATA);
        report(location, "share", "shared");
      } catch (e) {
        // Dismissed: the address and Email are still right there; no clipboard retry (it's refused by now).
        report(location, "share", e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "error");
      }
    });
  }

  let timer = 0;
  copyBtn?.addEventListener("click", async () => {
    const ok = await copy();
    if (!ok && addr) getSelection()?.selectAllChildren(addr);
    report(location, "copy", ok ? "copied" : "blocked");
    if (!copyLabel) return;
    copyLabel.textContent = ok ? "Link copied" : "Selected: hold to copy";
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
