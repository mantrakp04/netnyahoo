import type { ImageMetadata } from "astro";
import type { Focus, Loop } from "../components/Shot.astro";
import addressToolbar from "../assets/shots/address-toolbar.webp";
import addressSidebar from "../assets/shots/address-sidebar.webp";
import split from "../assets/shots/split.webp";
import personal from "../assets/shots/profile-personal.webp";
import work from "../assets/shots/profile-work.webp";
import campaign from "../assets/shots/profile-campaign.webp";
import extensions from "../assets/shots/extensions.webp";
import privacy from "../assets/shots/privacy.webp";
import pip from "../assets/shots/pip.webp";
import pipPoster from "../assets/shots/pip-loop-poster.webp";
import pipMp4 from "../assets/shots/pip-loop.mp4";
import pipWebm from "../assets/shots/pip-loop.webm";

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
  /** The part worth showing on a phone. */
  focus?: Focus;
  /** A clip of the part that moves, over the one shot. */
  loop?: Loop;
}

export const pledges: Pledge[] = [
  {
    id: "address-bar",
    title: "Dissolves the toolbar.",
    body: "Put the address bar in the sidebar. The page gets the whole window.",
    shots: [addressToolbar, addressSidebar],
    alt: "Two Netnyahoo windows on the same Wikipedia page: behind, the address bar in a toolbar above the page; in front, the address bar in the sidebar under the traffic lights and the page running to the top of the window.",
    caption: "Before and after",
    focus: { x: 0, y: 0, zoom: 2.1, ratio: 0.8 },
  },
  {
    id: "split",
    title: "Two pages. No coalition talks.",
    body: "Drag a tab onto the page. Up to three panes.",
    shots: [split],
    alt: "Netnyahoo in split view: MDN on the left, Wikipedia on the right, both in one window.",
    caption: "Split view",
    focus: { x: 0.5, y: 0, zoom: 1.3, ratio: 0.8 },
  },
  {
    id: "mini-player",
    title: "Refuses to leave the picture.",
    body: "Switch tabs mid-video and it floats along in the corner. Go back, and it steps down quietly.",
    shots: [pip],
    alt: "Netnyahoo on Wikipedia’s article about Big Buck Bunny, while the film keeps playing in a small floating window at the bottom right. Its tab, muted, is in the sidebar, with a player at the foot of the sidebar.",
    caption: "Picture in Picture, still playing",
    focus: { x: 1, y: 1, zoom: 2.4, ratio: 0.8 },
    // The capture's floating window, 336 × 189 pt at 2×, where it opened over the 1440 × 900 window.
    loop: { mp4: pipMp4, webm: pipWebm, poster: pipPoster, rect: { x: 2170, y: 1384, w: 672, h: 378 } },
  },
  {
    id: "profiles",
    title: "Separate profiles for separate lives.",
    body: "Each its own window. Swipe between them. Plausible deniability comes standard.",
    shots: [campaign, work, personal],
    alt: "Three Netnyahoo windows, one per profile, each tinted in its colour with its name next to the window buttons: Campaign in orange, Work in blue, Personal in plum.",
    caption: "Three profiles",
    focus: { x: 0, y: 0, zoom: 2.4, ratio: 0.8 },
  },
  {
    id: "extensions",
    title: "Forms a coalition with any extension.",
    body: "The Chrome Web Store, with a button that says Add to Netnyahoo.",
    shots: [extensions],
    alt: "Dark Reader’s page on the Chrome Web Store, open in Netnyahoo, with an Add to Netnyahoo button.",
    caption: "The Chrome Web Store, working",
    focus: { x: 1, y: 0.1, zoom: 1.19, ratio: 0.8 },
  },
  {
    id: "privacy",
    title: "Tracks nothing you didn’t sign for. Unusual, for a man in his position.",
    body: "uBlock Origin Lite is built in. Google’s pings are compiled out. Crash reports are opt-in: no sites, no searches.",
    shots: [privacy],
    panel: true,
    alt: "Netnyahoo’s Privacy & Security settings: switches to block ads, trackers and cookie banners, and the number of filter rules loaded.",
    caption: "Settings › Privacy & Security",
    focus: { x: 0.96, y: 0, zoom: 1.4, ratio: 0.75 },
  },
];

/** Passed without a screenshot. */
export const alsoPassed: { title: string; body: string }[] = [
  { title: "Annexation, but consensual", body: "Imports from Chrome, Brave, Helium, Safari, Dia and Arc." },
  { title: "Keeps secrets", body: "Passwords, passkeys and strong new ones, per profile. Better than his cabinet." },
  { title: "Records travel under diplomatic seal", body: "Sync, end to end encrypted, through your own iCloud Drive. No account." },
  { title: "Now in bulletproof glass", body: "Pinned tabs and the address bar in Liquid Glass, on macOS 26." },
  { title: "A broad coalition of shortcuts", body: "Chrome’s and Dia’s. Where they disagree, Dia’s wins." },
  { title: "Updates itself", body: "Quietly, in the background. No press conference." },
  { title: "Austerity budget", body: "Idles under half a percent of CPU with a tab open." },
];
