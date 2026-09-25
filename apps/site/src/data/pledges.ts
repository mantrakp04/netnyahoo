import type { ImageMetadata } from "astro";
import browse from "../assets/shots/browse.webp";
import commandBar from "../assets/shots/command-bar.webp";
import split from "../assets/shots/split.webp";
import plum from "../assets/shots/profile-plum.webp";
import blue from "../assets/shots/profile-blue.webp";
import green from "../assets/shots/profile-green.webp";
import extensions from "../assets/shots/extensions.webp";
import privacy from "../assets/shots/privacy.webp";

// Every image here is a capture of Netnyahoo 0.1.0 (see apps/site/README.md). Window shots are
// ScreenCaptureKit captures of the window; `panel` shots are the app's own render of one view
// (no window frame), used where a window capture wasn't possible.
export interface Pledge {
  id: string;
  title: string;
  body: string;
  /** The checkable bits: shortcuts, names. */
  specs: string[];
  /** One window, or several fanned out (front last). */
  shots: ImageMetadata[];
  alt: string;
  caption: string;
  panel?: boolean;
}

export const pledges: Pledge[] = [
  {
    id: "sidebar",
    title: "Tabs belong in the sidebar.",
    body: "Vertical tabs, pinned tiles up top, splits and groups kept together, and one search for every tab in every window, recently closed ones included.",
    specs: ["Pinned tiles", "Tab groups", "Search Tabs ⇧⌘A"],
    shots: [browse],
    alt: "The Netnyahoo window in dark mode: three pinned tiles and seven tabs in the sidebar, the project’s GitHub page open.",
    caption: "The sidebar, and the source",
  },
  {
    id: "command-bar",
    title: "One bar. No filibuster.",
    body: "⌘L opens the command bar over the page. Type a word and it offers the tab you already have open before it offers a search.",
    specs: ["⌘L", "Switch to Tab", "Any search engine"],
    shots: [commandBar],
    alt: "The command bar open over a page, with “swiftui” typed: a Switch to Tab result above search suggestions.",
    caption: "The command bar",
  },
  {
    id: "split",
    title: "Two pages, one window, no coalition talks.",
    body: "Split view holds up to three pages, side by side or stacked. Drag a tab onto the page to split it. Each pane is a real Chrome tab at its own size.",
    specs: ["Up to 3 panes", "Side by side or stacked", "Drag to split"],
    shots: [split],
    alt: "Netnyahoo in split view: MDN on the left, Wikipedia on the right, both in one window.",
    caption: "Split view",
  },
  {
    id: "profiles",
    title: "Separate profiles for separate lives.",
    body: "Each profile is its own Chrome profile, with its own cookies, logins, passwords, extensions and colour, down to the painted mark on the new tab page. Switch with ⌃1–9 or swipe across the sidebar. Plausible deniability comes standard.",
    specs: ["Per-profile everything", "⌃1–9", "Two-finger swipe"],
    shots: [green, blue, plum],
    alt: "Three Netnyahoo windows, one per profile, tinted plum, blue and green, each on its new tab page.",
    caption: "Three profiles, three new tab pages",
  },
  {
    id: "extensions",
    title: "Forms a coalition with any extension.",
    body: "Install straight from the Chrome Web Store. Extensions run per profile and keep themselves up to date, because underneath it is Chrome. The store still asks you to switch to Chrome; the button next to it says Add to Netnyahoo.",
    specs: ["Chrome Web Store", "Manifest V3", "Auto-update"],
    shots: [extensions],
    alt: "Dark Reader’s page on the Chrome Web Store, open in Netnyahoo, with an Add to Netnyahoo button.",
    caption: "The Chrome Web Store, working",
  },
  {
    id: "privacy",
    title: "Tracks nothing. Unusual, for a man in his position.",
    body: "uBlock Origin Lite ships in every profile, incognito included, and blocks ads and trackers from the first page, on your Mac. Cookie banners too, with one switch. The engine is built with ungoogled-chromium’s patches, so Google sign-in, crash reporting and the background pings are compiled out.",
    specs: ["uBlock Origin Lite", "ungoogled-chromium", "No analytics"],
    shots: [privacy],
    panel: true,
    alt: "Netnyahoo’s Privacy & Security settings: switches to block ads, trackers and cookie banners, and the number of filter rules loaded.",
    caption: "Settings › Privacy & Security",
  },
];

/** Passed without a screenshot. */
export const alsoPassed: { title: string; body: string }[] = [
  {
    title: "Passwords and passkeys",
    body: "Chrome’s password manager and autofill, per profile. Passkeys with Touch ID or your phone. Keeps secrets better than his cabinet.",
  },
  {
    title: "Annexation, but consensual",
    body: "Import bookmarks, history, open tabs and passwords from Chrome, Arc, Safari, Firefox, Edge, Brave, Opera or Vivaldi; Arc’s spaces and pinned tabs too.",
  },
  {
    title: "Picture in Picture",
    body: "Chrome’s own, plus a stash: push the video off the edge of the screen and it waits there.",
  },
  {
    title: "Incognito",
    body: "⇧⌘N. Always dark, kept in memory, gone when the window closes. Ad blocking stays on.",
  },
];
