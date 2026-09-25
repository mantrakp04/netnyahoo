import type { ImageMetadata } from "astro";
import addressToolbar from "../assets/shots/address-toolbar.webp";
import addressSidebar from "../assets/shots/address-sidebar.webp";
import split from "../assets/shots/split.webp";
import plum from "../assets/shots/profile-plum.webp";
import blue from "../assets/shots/profile-blue.webp";
import green from "../assets/shots/profile-green.webp";
import extensions from "../assets/shots/extensions.webp";
import privacy from "../assets/shots/privacy.webp";

// Every image here is a real capture of Netnyahoo (see apps/site/README.md). Window shots are
// ScreenCaptureKit captures of the window; `panel` shots are the app's own render of one view
// (no window frame), used where a window capture wasn't possible.
export interface Pledge {
  id: string;
  title: string;
  /** One line. If it needs two, cut it. */
  body: string;
  /** One window, or several fanned out (front last). */
  shots: ImageMetadata[];
  alt: string;
  caption: string;
  panel?: boolean;
}

export const pledges: Pledge[] = [
  {
    id: "address-bar",
    title: "Dissolves the toolbar.",
    body: "Put the address bar in the sidebar. The page gets the whole window.",
    shots: [addressToolbar, addressSidebar],
    alt: "Two Netnyahoo windows on the same Wikipedia page: behind, the address bar in a toolbar above the page; in front, the address bar in the sidebar under the traffic lights and the page running to the top of the window.",
    caption: "Before and after",
  },
  {
    id: "split",
    title: "Two pages. No coalition talks.",
    body: "Drag a tab onto the page. Up to three panes.",
    shots: [split],
    alt: "Netnyahoo in split view: MDN on the left, Wikipedia on the right, both in one window.",
    caption: "Split view",
  },
  {
    id: "profiles",
    title: "Separate profiles for separate lives.",
    body: "Swipe between them. Plausible deniability comes standard.",
    shots: [green, blue, plum],
    alt: "Three Netnyahoo windows, one per profile, tinted plum, blue and green, each on its new tab page.",
    caption: "Three profiles",
  },
  {
    id: "extensions",
    title: "Forms a coalition with any extension.",
    body: "The Chrome Web Store, with a button that says Add to Netnyahoo.",
    shots: [extensions],
    alt: "Dark Reader’s page on the Chrome Web Store, open in Netnyahoo, with an Add to Netnyahoo button.",
    caption: "The Chrome Web Store, working",
  },
  {
    id: "privacy",
    title: "Tracks nothing. Unusual, for a man in his position.",
    body: "uBlock Origin Lite is built in. Google’s pings are compiled out.",
    shots: [privacy],
    panel: true,
    alt: "Netnyahoo’s Privacy & Security settings: switches to block ads, trackers and cookie banners, and the number of filter rules loaded.",
    caption: "Settings › Privacy & Security",
  },
];

/** Passed without a screenshot. */
export const alsoPassed: { title: string; body: string }[] = [
  { title: "Annexation, but consensual", body: "Imports from Chrome, Brave, Helium, Safari, Dia and Arc." },
  { title: "Keeps secrets", body: "Passwords and passkeys, per profile. Better than his cabinet." },
  { title: "Updates itself", body: "Quietly, in the background. No press conference." },
  { title: "No AI, on purpose", body: "Nothing in here wants to chat." },
];
