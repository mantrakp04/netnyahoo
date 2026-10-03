// The edit as data, in beats. 128.57 BPM at 30 fps: a beat is exactly 14 frames, a bar 56.
// The score (scripts/music/score.py) is arranged from cuts.json with the same bars, so a beat here is a hit there.
// This file has no imports: scripts/studio-docs.mts reads it with Node's type stripping to write each video's
// studio.json (the Remocn Studio document with every editable text and window).

export const FPS = 30;
export const BEAT = 14;
export const f = (beat: number) => Math.round(beat * BEAT);

export type Aspect = "land" | "port";
export type Box = readonly [x: number, y: number, width: number, height: number];
export const FRAME: Record<Aspect, readonly [number, number]> = { land: [1920, 1080], port: [1080, 1920] };

export type TypeStyle = "slam" | "stamp" | "label" | "lede" | "words";
export interface TypeLayer {
  id: string;
  text: string;
  /** Beats from the shot's start; `out` is when it leaves (default: the shot's end). */
  at: number;
  out?: number;
  style: TypeStyle;
  color: string;
  /** A plate behind the text (a sticker on the poster); transparent by default. */
  fill?: string;
  size: number;
  /** Portrait size, when it differs. */
  portSize?: number;
  /** Portrait copy, when it breaks differently. */
  portText?: string;
  rotation?: number;
  box: Record<Aspect, Box>;
  align?: "left" | "center" | "right";
  /** `words`: beats between words. */
  step?: number;
}

export interface WindowLayer {
  id: string;
  box: Record<Aspect, Box>;
}

export type ShotKind =
  | "nags" | "title" | "tabs" | "swipe" | "split" | "block" | "chromium" | "poise" | "swipeBig" | "store" | "icons"
  | "nos" | "typing" | "end";

export interface Shot {
  id: string;
  kind: ShotKind;
  at: number;
  beats: number;
  type: TypeLayer[];
  window?: WindowLayer;
  /** More placed things in the shot (Big Yahu, the app icon), each a Studio object with a box. */
  extra?: WindowLayer[];
  /** Beats of the shot's own timeline skipped (a teaser reuses a later part of a hero shot). */
  skip?: number;
  /** Shot-specific beats (the end card's lockup and button). */
  marks?: Record<string, number>;
}

const ink = "#16130F";
const paper = "#F1ECE2";
/** A swipe's page lands one frame before its commit beat (its thud stays on the beat). */
export const LAND = 1 / BEAT;
const P = { red: "#C3371F", blue: "#2150D9", plum: "#C07A98", work: "#4691C3", orange: "#D87249", green: "#3EB489", yellow: "#E3AC38" };

// Landscape keeps 80 px side and 60 px top/bottom margins. Portrait keeps everything that matters inside y 220–1480
// and x 60–940 (Reels/TikTok/Shorts put captions and buttons over the bottom ~420 px and the right ~140 px).
// Text over a window gets a plate (fill); text on the paper has none. A slam's size is its largest: it shrinks to
// fit its box (kit.tsx fitSize), so an edited line never runs out of the frame.
const WIN: Record<Aspect, Box> = { land: [210, 96, 1500, 938], port: [40, 560, 1700, 1063] };
const win = (id: string, box: Partial<Record<Aspect, Box>> = {}): WindowLayer => ({ id, box: { ...WIN, ...box } });
const T = (
  id: string, text: string, at: number, style: TypeStyle, size: number, land: Box, port: Box,
  more: Partial<TypeLayer> = {},
): TypeLayer => ({ id, text, at, style, size, color: ink, box: { land, port }, ...more });
const TOP: Record<Aspect, Box> = { land: [80, 50, 1760, 150], port: [60, 230, 880, 300] };
const BIG: Box = [80, 250, 1760, 580];
const BIG_PORT: Box = [60, 420, 880, 820];
/** A line docked under the window (landscape) or above it (portrait), 64 px or more. */
const DOCK: Record<Aspect, Box> = { land: [80, 950, 1760, 72], port: [60, 470, 880, 90] };
/** A profile's name plate, docked top-left beside the window's own profile name. */
// Beside the sidebar column (which carries the swipe), never over it.
const PLATE: Record<Aspect, Box> = { land: [560, 40, 1100, 170], port: [60, 230, 880, 200] };
const BIG_PLATE_BOX: Record<Aspect, Box> = { land: [700, 40, 1140, 170], port: [60, 230, 880, 200] };
const YAHU = (id: string, land: Box, port: Box): WindowLayer => ({ id, box: { land, port } });

// ---------------------------------------------------------------------------------------------- the hero cut

const nags: Shot = {
  id: "nags", kind: "nags", at: 0, beats: 8, window: win("nags-window", { land: [300, 270, 1320, 825], port: [40, 700, 1500, 938] }),
  extra: [
    YAHU("nags-yahu", [1300, 280, 640, 780], [240, 900, 600, 580]),
    // He pops out from behind the window (right edge in 16:9, top edge in 9:16) to cheer the first NO.
    YAHU("nags-yahu-peek", [1600, 320, 360, 360], [70, 250, 260, 260]),
  ],
  type: [
    // Bar 1: four stabs, one ask each, over a site really asking it in a Netnyahoo window (scenes/asks.js).
    T("nag-sign-in", "SIGN IN.", 0, "slam", 230, [80, 24, 1760, 230], [60, 230, 880, 440], { out: 1, align: "center", fill: paper, portText: "SIGN\nIN." }),
    T("nag-try-ai", "TRY AI.", 1, "slam", 230, [80, 24, 1760, 230], [60, 230, 880, 440], { out: 2, align: "center", fill: paper, portText: "TRY\nAI." }),
    T("nag-cookies", "ACCEPT ALL.", 2, "slam", 230, [80, 24, 1760, 230], [60, 230, 880, 440], { out: 3, align: "center", fill: paper, portText: "ACCEPT\nALL." }),
    T("nag-upgrade", "UPGRADE.", 3, "slam", 230, [80, 24, 1760, 230], [60, 230, 880, 440], { out: 4, align: "center", fill: paper, portText: "UPGRADE.", portSize: 150 }),
    // Each of the first three asks gets its answer stamped on it, half a beat in.
    T("nag-no-1", "NO.", 0.5, "stamp", 150, [690, 470, 540, 240], [300, 960, 480, 220], { out: 1, rotation: -8, color: P.red, portSize: 130 }),
    T("nag-no-2", "NO.", 1.5, "stamp", 150, [700, 470, 540, 240], [300, 960, 480, 220], { out: 2, rotation: 6, color: P.red, portSize: 130 }),
    T("nag-no-3", "NO.", 2.5, "stamp", 150, [690, 480, 540, 240], [300, 960, 480, 220], { out: 3, rotation: -4, color: P.red, portSize: 130 }),
    // Bar 2: the snare roll. The asks stamp down on the browser, each still readable, until Big Yahu swats them off.
    T("nag-pile-1", "SIGN IN TO SYNC", 4, "stamp", 86, [180, 270, 760, 150], [60, 250, 820, 130], { out: 8, rotation: -6, portSize: 70 }),
    T("nag-pile-2", "MEET YOUR AI COPILOT", 5, "stamp", 86, [440, 380, 820, 150], [120, 420, 820, 130], { out: 8, rotation: 4, color: P.blue, portSize: 62 }),
    T("nag-pile-3", "ACCEPT ALL COOKIES", 6, "stamp", 86, [140, 590, 820, 150], [60, 590, 820, 130], { out: 8, rotation: -3, color: P.red, portSize: 64 }),
    T("nag-pile-4", "SET AS DEFAULT?", 6.5, "stamp", 86, [520, 780, 720, 150], [140, 760, 760, 130], { out: 8, rotation: 6, portSize: 66 }),
  ],
};

const title: Shot = {
  id: "title", kind: "title", at: 8, beats: 4, window: win("title-window", { land: [360, 340, 1200, 750], port: [40, 760, 1500, 938] }),
  extra: [YAHU("title-yahu", [1300, 280, 640, 780], [240, 900, 600, 580])],
  type: [
    T("title-name", "NETNYAHOO", 0, "slam", 230, [80, 20, 1760, 215], [60, 230, 880, 300], { align: "center", portSize: 240 }),
    T("title-what", "THE SIDEBAR BROWSER FOR MAC", 1, "slam", 64, [80, 250, 1760, 70], [60, 540, 880, 150], { align: "center", color: P.blue, portText: "THE SIDEBAR\nBROWSER FOR MAC" }),
    T("title-stamp", "ASKS FOR NOTHING.", 2, "stamp", 84, [420, 850, 760, 150], [60, 700, 520, 110], { rotation: -6, color: P.red, portSize: 56 }),
  ],
};

const tabs: Shot = {
  id: "tabs", kind: "tabs", at: 12, beats: 6, window: win("tabs-window"),
  type: [
    T("tabs-super", "TABS DOWN\nTHE SIDE.", 1, "slam", 170, [1180, 640, 680, 380], [60, 230, 880, 320], { color: paper, fill: ink, portSize: 150 }),
  ],
};

const swipe: Shot = {
  id: "swipe", kind: "swipe", at: 18, beats: 8, window: win("swipe-window"),
  type: [
    // Docked at the top-left, beside the profile's own name in the window, switching on the frame the page changes.
    T("swipe-name", "SWIPE BETWEEN LIVES.", 0, "slam", 72, DOCK.land, DOCK.port, { out: 5, color: paper, fill: ink, portSize: 64 }),
    T("swipe-work", "WORK.", 0.75 - LAND, "slam", 150, PLATE.land, PLATE.port, { out: 2.25 - LAND, color: paper, fill: P.work }),
    T("swipe-campaign", "CAMPAIGN.", 2.25 - LAND, "slam", 150, PLATE.land, PLATE.port, { out: 3.75 - LAND, color: paper, fill: P.orange }),
    T("swipe-side", "SIDE PROJECT.", 3.75 - LAND, "slam", 150, PLATE.land, PLATE.port, { out: 5, color: paper, fill: P.green }),
    T("swipe-deniability", "PLAUSIBLE DENIABILITY COMES STANDARD.", 5, "slam", 72, DOCK.land, [60, 230, 880, 220], { portText: "PLAUSIBLE\nDENIABILITY\nCOMES STANDARD.", portSize: 96 }),
  ],
};

const split: Shot = {
  id: "split", kind: "split", at: 26, beats: 8, window: win("split-window"),
  extra: [YAHU("split-yahu", [1380, 650, 520, 520], [500, 1010, 480, 500])],
  type: [
    T("split-two", "TWO PAGES.", 0, "slam", 140, TOP.land, TOP.port, { out: 5, color: paper, fill: ink }),
    T("split-coalition", "NO COALITION TALKS.", 5, "slam", 140, TOP.land, TOP.port, { color: paper, fill: P.red, portText: "NO COALITION\nTALKS." }),
  ],
};

const block: Shot = {
  id: "block", kind: "block", at: 34, beats: 6, window: win("block-window"),
  type: [
    T("block-immune", "IMMUNE TO ADS\nAND TRACKERS.", 0.5, "slam", 150, [80, 640, 860, 380], [60, 230, 880, 320], { color: paper, fill: P.red, portSize: 140 }),
  ],
};

const chromium: Shot = {
  id: "chromium", kind: "chromium", at: 40, beats: 4, window: win("chromium-window", { land: [860, 260, 980, 613], port: [40, 820, 1500, 938] }),
  type: [
    T("chromium-actually", "IT’S ACTUALLY\nCHROMIUM.", 0.5, "slam", 200, [80, 300, 760, 440], [60, 260, 880, 460], { color: "#EFE8DC" }),
  ],
};

const poise: Shot = { id: "poise", kind: "poise", at: 44, beats: 4, type: [] };

const BIG_PLATE = (id: string, text: string, at: number, out: number, fill: string, color = paper) =>
  T(id, text, at, "slam", 150, BIG_PLATE_BOX.land, BIG_PLATE_BOX.port, { out, color, fill });
const swipeBig: Shot = {
  id: "swipe-big", kind: "swipeBig", at: 48, beats: 10, window: win("swipe-big-window", { land: [120, 66, 1680, 1050], port: [40, 520, 1700, 1063] }),
  // Each name on the frame its page lands (the commits: 0, 1.5, 3, 4.5, 6).
  type: [
    BIG_PLATE("big-weekend", "WEEKEND.", 0, 1.5 - LAND, P.yellow, ink),
    BIG_PLATE("big-side", "SIDE PROJECT.", 1.5 - LAND, 3 - LAND, P.green),
    BIG_PLATE("big-campaign", "CAMPAIGN.", 3 - LAND, 4.5 - LAND, P.orange),
    BIG_PLATE("big-work", "WORK.", 4.5 - LAND, 6 - LAND, P.work),
    BIG_PLATE("big-personal", "PERSONAL.", 6 - LAND, 7.6, P.plum),
  ],
};

const store: Shot = {
  id: "store", kind: "store", at: 58, beats: 6, window: win("store-window"),
  type: [
    T("store-any", "ANY CHROME EXTENSION.", 0, "slam", 140, TOP.land, TOP.port, { out: 3, color: paper, fill: ink, portText: "ANY CHROME\nEXTENSION." }),
    T("store-no", "NO THANKS.", 3.5, "stamp", 150, [480, 660, 760, 230], [100, 1180, 820, 200], { rotation: -10, color: P.red, portSize: 116 }),
  ],
};

const icons: Shot = {
  id: "icons", kind: "icons", at: 64, beats: 4, window: win("icons-window", { land: [394, 120, 1132, 884], port: [40, 700, 1500, 1171] }),
  type: [
    T("icons-seven", "SEVEN APP ICONS.", 1, "slam", 140, [80, 860, 1760, 170], [60, 1190, 880, 280], { out: 2.5, color: paper, fill: ink, portText: "SEVEN\nAPP ICONS." }),
    T("icons-one", "ONE FACE.", 2.5, "slam", 140, [80, 860, 1760, 170], [60, 1190, 880, 280], { color: paper, fill: P.red }),
  ],
};

const nos: Shot = {
  id: "nos", kind: "nos", at: 68, beats: 4,
  type: [
    T("nos-account", "NO ACCOUNT.", 0, "slam", 420, BIG, BIG_PORT, { out: 1, color: paper, align: "center", portText: "NO\nACCOUNT." }),
    T("nos-ai", "NO AI.", 1, "slam", 520, BIG, BIG_PORT, { out: 2, color: paper, align: "center", portText: "NO\nAI." }),
    T("nos-tracking", "NO TRACKING.", 2, "slam", 420, BIG, BIG_PORT, { out: 3, color: paper, align: "center", portText: "NO\nTRACKING." }),
    T("nos-source", "OPEN SOURCE.", 3, "slam", 420, BIG, BIG_PORT, { color: paper, align: "center", portText: "OPEN\nSOURCE." }),
  ],
};

const typing: Shot = { id: "typing", kind: "typing", at: 72, beats: 8, window: win("typing-window"), type: [] };

/** The end: "FULL IMMUNITY." on the hit, then the lockup (icon, name, download, URL, source) with Big Yahu dancing. */
const endShot = (at: number, beats: number, lockup: number, button: number): Shot => ({
  id: "end", kind: "end", at, beats, marks: { lockup, button },
  extra: [
    YAHU("end-yahu", [1240, 200, 640, 820], [90, 822, 900, 700]),
    { id: "end-icon", box: { land: [80, 220, 180, 180], port: [60, 240, 150, 150] } },
  ],
  type: [
    T("end-immunity", "FULL\nIMMUNITY.", 0, "slam", 360, [80, 120, 1080, 800], [60, 230, 880, 640], { out: lockup }),
    T("end-name", "NETNYAHOO", lockup, "slam", 190, [290, 220, 870, 180], [230, 240, 710, 150], { portSize: 150 }),
    T("end-mac", "THE SIDEBAR BROWSER FOR MAC", lockup + 0.5, "slam", 60, [84, 420, 1076, 70], [60, 410, 880, 120], { color: P.blue, portText: "THE SIDEBAR\nBROWSER FOR MAC" }),
    T("end-download", "DOWNLOAD", lockup + 1, "slam", 96, [84, 520, 1076, 110], [60, 550, 880, 100]),
    T("end-url", "NETNYAHOO.COM", lockup + 1, "slam", 190, [80, 630, 1080, 210], [60, 650, 880, 160], { color: P.blue }),
    T("end-source", "GITHUB.COM/MANTRAKP04/NETNYAHOO", lockup + 1.5, "label", 48, [86, 870, 1076, 70], [64, 820, 880, 110], { portSize: 40, portText: "GITHUB.COM/MANTRAKP04/\nNETNYAHOO" }),
  ],
});

const hero: Shot[] = [nags, title, tabs, swipe, split, block, chromium, poise, swipeBig, store, icons, nos, typing, endShot(80, 16, 3, 11)];

// ---------------------------------------------------------------------------------------------- the teaser

const teaser: Shot[] = [
  nags,
  { ...title, beats: 2, type: title.type.filter((t) => t.id !== "title-stamp") },
  // The teaser has no poise: the first swipe drags in from its own start and commits a beat in.
  { ...swipeBig, at: 10, beats: 10, marks: { lead: 1 }, type: swipeBig.type.map((t) => ({ ...t, at: t.at + 1, out: (t.out ?? 10) + 1 })) },
  { ...nos, at: 20, beats: 4 },
  endShot(24, 8, 2, 4),
];

export type CutName = "launch" | "teaser";
export const CUTS: Record<CutName, { beats: number; shots: Shot[] }> = {
  launch: { beats: 96, shots: hero },
  teaser: { beats: 32, shots: teaser },
};
