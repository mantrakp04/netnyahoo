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

  // After a dismissed share sheet the tap is used up and some browsers refuse the clipboard, so the button
  // asks for one more tap ("Copy link"), which copies with a fresh gesture.
  const canShare = typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(DATA));
  if (canShare && link.dataset.sendNext !== "copy") {
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
        link.dataset.sendNext = "copy";
        say(link, "Copy link", 0);
      }
      return;
    }
  }

  delete link.dataset.sendNext;
  if (await copy()) {
    report("copy", "copied");
    say(link, "Link copied");
  } else {
    // No clipboard either: show the address, short enough to type on the Mac.
    report("copy", "failed");
    say(link, "netnyahoo.com", 6000);
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
