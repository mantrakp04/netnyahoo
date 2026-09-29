// Phones and tablets can't run a Mac app, so every download CTA ([data-download]) becomes "Send to my Mac":
// the share sheet (AirDrop, Messages, Notes, mail to self), or the clipboard when there's no share sheet or it
// was dismissed. The label lives in [data-send-label]; the device class comes from components/Visitor.astro.
// Tracks send_to_mac_clicked { location, method: "share" | "copy", outcome, share? }.
import { track } from "./track";

const LINK = "https://netnyahoo.com/?ref=share";
const DATA: ShareData = { url: LINK, title: "Netnyahoo", text: "Netnyahoo: real Chromium for the Mac. Open this on your Mac." };
const IDLE = "Send to my Mac";

type Outcome = "shared" | "copied" | "blocked" | "failed";

async function copy(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(LINK);
    return true;
  } catch {
    return false;
  }
}

// When neither the share sheet nor the clipboard got the link out (a dismissed sheet leaves no gesture for
// the clipboard), show it in place: select-all text, a Copy button with a fresh tap, and mail to self.
function fallback(from: HTMLAnchorElement, location: string | null) {
  // The header bar has no room for it: use the hero's button.
  const link = (from.closest("header") && document.querySelector<HTMLAnchorElement>(".hero [data-download]")) || from;
  let panel = link.nextElementSibling as HTMLElement | null;
  if (!panel?.hasAttribute("data-send-fallback")) {
    panel = document.createElement("div");
    panel.dataset.sendFallback = "";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Send the link to your Mac");
    panel.style.cssText =
      "margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font:inherit;font-size:var(--t-small,14px)";
    const field = document.createElement("input");
    field.readOnly = true;
    field.value = LINK;
    field.setAttribute("aria-label", "Link");
    field.style.cssText =
      "flex:1 1 180px;min-width:0;padding:10px 12px;border:1px solid var(--ink,#16130f);background:transparent;color:inherit;font:inherit;border-radius:0";
    field.addEventListener("focus", () => field.select());
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.style.cssText =
      "padding:10px 14px;border:1px solid var(--ink,#16130f);background:var(--ink,#16130f);color:var(--paper,#f1ece2);font:inherit;cursor:pointer";
    copyBtn.addEventListener("click", async () => {
      const ok = await copy();
      if (!ok) {
        field.focus();
        field.setSelectionRange(0, LINK.length);
      }
      copyBtn.textContent = ok ? "Copied" : "Selected";
      track("send_to_mac_fallback", { location, action: ok ? "copied" : "selected" });
    });
    const mail = document.createElement("a");
    mail.href = `mailto:?subject=${encodeURIComponent("Netnyahoo, for my Mac")}&body=${encodeURIComponent(LINK)}`;
    mail.textContent = "Email it to me";
    mail.style.cssText = "color:inherit;text-decoration:underline;text-underline-offset:3px;padding:10px 2px";
    mail.addEventListener("click", () => track("send_to_mac_fallback", { location, action: "email" }));
    panel.append(field, copyBtn, mail);
    link.after(panel);
  }
  panel.hidden = false;
  if (link !== from) panel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function say(link: HTMLElement, text: string, ms = 2400) {
  const label = link.querySelector<HTMLElement>("[data-send-label]");
  if (!label) return;
  label.textContent = text;
  clearTimeout(Number(link.dataset.sendTimer));
  if (ms) link.dataset.sendTimer = String(setTimeout(() => (label.textContent = IDLE), ms));
}

async function send(link: HTMLAnchorElement) {
  const location = link.dataset.trackLocation ?? null;
  const report = (method: "share" | "copy", outcome: Outcome, share?: string) =>
    track("send_to_mac_clicked", { location, method, outcome, ...(share ? { share } : {}) });

  // After a dismissed share sheet the tap is used up and browsers refuse the clipboard: fallback() shows the
  // link with its own Copy button (a fresh tap) and mail to self. 18 of 18 people left at "Copy link" before.
  const canShare = typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(DATA));
  if (canShare) {
    try {
      await navigator.share(DATA);
      report("share", "shared");
      say(link, "Sent");
      return;
    } catch (e) {
      const share = e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "error";
      if (await copy()) {
        report("copy", "copied", share);
        say(link, "Link copied");
      } else {
        report("copy", "blocked", share);
        fallback(link, location);
      }
      return;
    }
  }

  if (await copy()) {
    report("copy", "copied");
    say(link, "Link copied");
  } else {
    // No clipboard either: show the link in place.
    report("copy", "failed");
    fallback(link, location);
  }
}

if (document.documentElement.dataset.device === "phone") {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-download]")) {
    // Not a download here: analytics.ts counts [data-track] clicks, and this one reports send_to_mac_clicked.
    delete link.dataset.track;
    let busy = false;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (busy) return; // the share sheet is already up
      busy = true;
      void send(link).finally(() => (busy = false));
    });
  }
}
