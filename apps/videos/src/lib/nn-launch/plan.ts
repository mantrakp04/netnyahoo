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
  | "nags" | "title" | "tabs" | "swipe" | "split" | "layout" | "block" | "colors" | "chromium" | "store"
  | "privacy" | "icons" | "fast" | "swipe2" | "nos" | "burst" | "immunity" | "cta";

export interface Shot {
  id: string;
  kind: ShotKind;
  at: number;
  beats: number;
  type: TypeLayer[];
  window?: WindowLayer;
  /** More windows in the shot (the end card's fan of profiles). */
  extra?: WindowLayer[];
  /** Beats of the shot's own timeline skipped (a teaser reuses a later part of a hero shot). */
  skip?: number;
}

const ink = "#16130F";

// The window at rest: 1440 × 900 pt captured at 2x, shown 16:10.
const WIN: Record<Aspect, Box> = { land: [210, 96, 1500, 938], port: [40, 700, 1000, 625] };
const win = (id: string, box: Partial<Record<Aspect, Box>> = {}): WindowLayer => ({ id, box: { ...WIN, ...box } });

// A layer helper: full-width boxes unless given.
const T = (
  id: string, text: string, at: number, style: TypeStyle, size: number, land: Box, port: Box,
  more: Partial<TypeLayer> = {},
): TypeLayer => ({ id, text, at, style, size, color: ink, box: { land, port }, ...more });

// ---------------------------------------------------------------------------------------------- the hero cut

// Margins: 80 px at the sides and 60 px top and bottom in landscape, 60 px all round in portrait. Text that sits on a
// window gets a plate (fill) so it reads on any page; text on the paper has none. A slam's size is its largest: it
// shrinks to fit its box (kit.tsx fitSize), so an edited text never runs out of the frame.
const P = { ink: "#16130F", red: "#C3371F", blue: "#2150D9", plum: "#C07A98", work: "#4691C3", orange: "#D87249" };
const TOP: Record<Aspect, Box> = { land: [80, 60, 1760, 160], port: [60, 300, 960, 330] };
const BIG: Box = [80, 230, 1760, 620];
const BIG_PORT: Box = [60, 520, 960, 880];

const nags: Shot = {
  id: "nags", kind: "nags", at: 0, beats: 8,
  type: [
    // Bar 1: four stabs, one demand each.
    T("nag-sign-in", "SIGN IN.", 0, "slam", 460, BIG, BIG_PORT, { out: 1, align: "center", portSize: 330, portText: "SIGN\nIN." }),
    T("nag-try-ai", "TRY AI.", 1, "slam", 500, BIG, BIG_PORT, { out: 2, align: "center", portSize: 340, portText: "TRY\nAI." }),
    T("nag-cookies", "ACCEPT ALL.", 2, "slam", 460, BIG, BIG_PORT, { out: 3, align: "center", portSize: 300, portText: "ACCEPT\nALL." }),
    T("nag-upgrade", "UPGRADE.", 3, "slam", 460, BIG, BIG_PORT, { out: 4, align: "center", portSize: 300, portText: "UP\nGRADE." }),
    // Bar 2: the snare roll. Every browser's asks pile up, faster and faster.
    T("nag-pile-1", "SIGN IN TO SYNC", 4, "stamp", 82, [110, 120, 820, 150], [60, 240, 800, 130], { rotation: -7, portSize: 66 }),
    T("nag-pile-2", "MEET YOUR AI COPILOT", 4.5, "stamp", 82, [940, 210, 900, 150], [160, 470, 860, 130], { rotation: 5, color: P.blue, portSize: 60 }),
    T("nag-pile-3", "SET AS DEFAULT?", 5, "stamp", 82, [220, 450, 800, 150], [60, 700, 800, 130], { rotation: 3, portSize: 66 }),
    T("nag-pile-4", "ACCEPT ALL COOKIES", 5.5, "stamp", 82, [980, 600, 860, 150], [180, 930, 840, 130], { rotation: -5, color: P.red, portSize: 60 }),
    T("nag-pile-5", "TRY AI TABS", 6, "stamp", 82, [90, 780, 640, 150], [60, 1160, 620, 130], { rotation: 8, color: P.blue, portSize: 66 }),
    T("nag-pile-6", "CREATE AN ACCOUNT", 6.25, "stamp", 82, [640, 370, 900, 150], [200, 1380, 820, 130], { rotation: -3, portSize: 60 }),
    T("nag-pile-7", "RATE US ★★★★★", 6.5, "stamp", 82, [1160, 840, 680, 150], [60, 1580, 760, 130], { rotation: 6, color: P.red, portSize: 64 }),
    T("nag-pile-8", "SIGN IN AGAIN", 6.75, "stamp", 82, [560, 60, 700, 150], [320, 90, 700, 130], { rotation: -9, portSize: 64 }),
    T("nag-pile-9", "AI SUMMARY?", 7, "stamp", 82, [120, 600, 620, 150], [360, 1740, 660, 130], { rotation: 4, color: P.blue, portSize: 64 }),
    T("nag-pile-10", "UPGRADE TO PRO", 7.25, "stamp", 82, [760, 720, 760, 150], [100, 1020, 800, 130], { rotation: -6, color: P.red, portSize: 64 }),
  ],
};

const title: Shot = {
  id: "title", kind: "title", at: 8, beats: 4, window: win("title-window", { land: [210, 360, 1500, 938], port: [40, 1080, 1000, 625] }),
  type: [
    T("title-name", "NETNYAHOO", 0, "slam", 380, [80, 40, 1760, 330], [60, 140, 960, 880], { align: "center", portSize: 330, portText: "NET\nNYA\nHOO" }),
    T("title-stamp", "ASKS FOR NOTHING.", 2, "stamp", 78, [1100, 300, 760, 150], [200, 860, 820, 130], { rotation: -8, color: P.red, portSize: 64 }),
  ],
};

const tabs: Shot = {
  id: "tabs", kind: "tabs", at: 12, beats: 4, window: win("tabs-window"),
  type: [
    T("tabs-label", "FIG. 1 — EVERY TAB, DOWN THE SIDE", 0, "label", 24, [210, 40, 1500, 40], [60, 620, 960, 40], { out: 1 }),
    T("tabs-super", "TABS DOWN\nTHE SIDE.", 1, "slam", 170, [1100, 640, 760, 380], [60, 1400, 960, 400], { color: "#F1ECE2", fill: P.ink, align: "left", portSize: 160 }),
  ],
};

const swipe: Shot = {
  id: "swipe", kind: "swipe", at: 16, beats: 8, window: win("swipe-window"),
  type: [
    T("swipe-work", "WORK.", 1, "slam", 300, [900, 380, 940, 360], [60, 1420, 960, 400], { out: 3, color: "#F1ECE2", fill: P.work, align: "left" }),
    T("swipe-campaign", "CAMPAIGN.", 3, "slam", 300, [900, 380, 940, 360], [60, 1420, 960, 400], { out: 4.5, color: "#F1ECE2", fill: P.orange, align: "left" }),
    T("swipe-personal", "PERSONAL.", 5, "slam", 300, [900, 380, 940, 360], [60, 1420, 960, 400], { out: 6, color: "#F1ECE2", fill: P.plum, align: "left" }),
    T("swipe-lives", "SEPARATE LIVES. ONE SWIPE.", 6, "slam", 140, TOP.land, TOP.port, { portText: "SEPARATE LIVES.\nONE SWIPE.", portSize: 130 }),
    T("swipe-deniability", "PLAUSIBLE DENIABILITY COMES STANDARD", 6.5, "label", 24, [80, 1026, 1760, 36], [60, 1380, 960, 36]),
  ],
};

const split: Shot = {
  id: "split", kind: "split", at: 24, beats: 4, window: win("split-window"),
  type: [
    T("split-two", "TWO PAGES.", 1, "slam", 150, TOP.land, TOP.port, { portSize: 230, out: 2 }),
    T("split-three", "THREE.", 2, "slam", 150, TOP.land, TOP.port, { portSize: 230, out: 3 }),
    T("split-coalition", "NO COALITION TALKS.", 3, "slam", 150, TOP.land, TOP.port, { portSize: 230, color: P.red, portText: "NO COALITION\nTALKS." }),
  ],
};

const layout: Shot = {
  id: "layout", kind: "layout", at: 28, beats: 4, window: win("layout-window"),
  type: [
    T("layout-dissolve", "DISSOLVES\nTHE TOOLBAR.", 1, "slam", 170, [1060, 600, 800, 420], [60, 1400, 960, 420], { out: 2.5, color: "#F1ECE2", fill: P.ink, portSize: 160 }),
    T("layout-whole", "THE PAGE GETS\nTHE WINDOW.", 2.5, "slam", 170, [1060, 600, 800, 420], [60, 1400, 960, 420], { color: "#F1ECE2", fill: P.red, portSize: 150 }),
  ],
};

const block: Shot = {
  id: "block", kind: "block", at: 32, beats: 4, window: win("block-window"),
  type: [
    T("block-ads", "IMMUNE TO ADS.", 1, "slam", 150, TOP.land, TOP.port, { portSize: 230, out: 2, color: "#F1ECE2", fill: P.ink, align: "left", portText: "IMMUNE\nTO ADS." }),
    T("block-trackers", "AND TRACKERS.", 2, "slam", 150, TOP.land, TOP.port, { portSize: 230, color: "#F1ECE2", fill: P.red, align: "left", portText: "AND\nTRACKERS." }),
    T("block-label", "UBLOCK ORIGIN LITE, BUILT IN", 2.5, "label", 24, [80, 1026, 1760, 36], [60, 1830, 960, 36], { color: "#F1ECE2", fill: P.ink }),
  ],
};

const colors: Shot = {
  id: "colors", kind: "colors", at: 36, beats: 4, window: win("colors-window", { land: [360, 230, 1200, 750], port: [90, 760, 900, 563] }),
  type: [
    T("colors-words", "PICK YOUR COLOURS.", 0, "words", 150, TOP.land, TOP.port, { portSize: 230, step: 1, align: "center", portText: "PICK YOUR\nCOLOURS." }),
  ],
};

const chromium: Shot = {
  id: "chromium", kind: "chromium", at: 40, beats: 8, window: win("chromium-window", { land: [860, 300, 980, 613], port: [60, 1160, 960, 600] }),
  type: [
    T("chromium-actually", "IT’S ACTUALLY", 0, "slam", 120, [80, 250, 760, 130], [60, 300, 960, 150], { color: "#EFE8DC", out: 4 }),
    T("chromium-name", "CHROMIUM.", 1, "slam", 260, [80, 390, 760, 300], [60, 470, 960, 330], { color: "#7FA6FF", out: 4 }),
    T("chromium-not-webkit", "NOT WEBKIT.", 4, "slam", 150, [80, 260, 760, 170], [60, 330, 960, 190], { color: "#EFE8DC" }),
    T("chromium-not-electron", "NOT ELECTRON.", 5, "slam", 150, [80, 440, 760, 170], [60, 530, 960, 190], { color: "#EFE8DC" }),
    T("chromium-own", "Every window is Chrome’s own.", 6, "lede", 52, [84, 650, 760, 80], [64, 760, 960, 80], { color: "#A79F93" }),
  ],
};

const store: Shot = {
  id: "store", kind: "store", at: 48, beats: 4, window: win("store-window"),
  type: [
    T("store-any", "ANY CHROME EXTENSION.", 0, "slam", 150, TOP.land, TOP.port, { portSize: 230, out: 1, portText: "ANY CHROME\nEXTENSION." }),
    T("store-add", "ADD TO NETNYAHOO.", 1, "slam", 150, TOP.land, TOP.port, { portSize: 230, out: 2, color: "#F1ECE2", fill: P.blue, portText: "ADD TO\nNETNYAHOO." }),
    T("store-no", "NO THANKS.", 2.75, "stamp", 130, [1020, 560, 760, 210], [180, 1280, 840, 190], { rotation: -10, color: P.red, portSize: 104 }),
  ],
};

const privacy: Shot = {
  id: "privacy", kind: "privacy", at: 52, beats: 4, window: win("privacy-window", { land: [394, 120, 1132, 884], port: [40, 700, 1000, 781] }),
  type: [
    T("privacy-tracks", "TRACKS NOTHING\nYOU DIDN’T SIGN FOR.", 1, "slam", 130, [880, 650, 980, 360], [60, 1420, 960, 380], { color: "#F1ECE2", fill: P.ink, portSize: 110 }),
    T("privacy-label", "UNUSUAL, FOR A MAN IN HIS POSITION", 2.5, "label", 24, [880, 1026, 980, 36], [60, 1830, 960, 36]),
  ],
};

const icons: Shot = {
  id: "icons", kind: "icons", at: 56, beats: 4, window: win("icons-window", { land: [394, 120, 1132, 884], port: [40, 700, 1000, 781] }),
  type: [
    T("icons-seven", "SEVEN APP ICONS.", 1, "slam", 150, TOP.land, TOP.port, { portSize: 230, out: 2.5, color: "#F1ECE2", fill: P.ink, portText: "SEVEN\nAPP ICONS." }),
    T("icons-one", "ONE FACE.", 2.5, "slam", 150, TOP.land, TOP.port, { portSize: 230, color: "#F1ECE2", fill: P.red }),
  ],
};

const fast: Shot = {
  id: "fast", kind: "fast", at: 60, beats: 4, window: win("fast-window"),
  type: [
    T("fast-label", "AUSTERITY BUDGET", 0, "label", 24, [210, 40, 1500, 40], [60, 620, 960, 40]),
    T("fast-cpu", "IDLES UNDER\nHALF A PERCENT CPU.", 1, "slam", 130, [960, 640, 900, 380], [60, 1420, 960, 380], { color: "#F1ECE2", fill: P.ink, portSize: 110 }),
  ],
};

const swipe2: Shot = {
  id: "swipe2", kind: "swipe2", at: 64, beats: 4, window: win("swipe2-window", { land: [300, 220, 1320, 825], port: [40, 760, 1000, 625] }),
  type: [
    T("swipe2-swipe", "SWIPE. SWIPE. SWIPE. SWIPE.", 0.5, "words", 140, TOP.land, TOP.port, { portSize: 230, step: 1, color: "#F1ECE2", align: "center", portText: "SWIPE. SWIPE.\nSWIPE. SWIPE." }),
  ],
};

const nos: Shot = {
  id: "nos", kind: "nos", at: 68, beats: 4,
  type: [
    T("nos-account", "NO ACCOUNT.", 0, "slam", 420, BIG, BIG_PORT, { out: 1, color: "#F1ECE2", align: "center", portText: "NO\nACCOUNT.", portSize: 300 }),
    T("nos-ai", "NO AI.", 1, "slam", 520, BIG, BIG_PORT, { out: 2, align: "center", portText: "NO\nAI.", portSize: 420 }),
    T("nos-tracking", "NO TRACKING.", 2, "slam", 420, BIG, BIG_PORT, { out: 3, color: "#F1ECE2", align: "center", portText: "NO\nTRACKING.", portSize: 300 }),
    T("nos-source", "OPEN SOURCE.", 3, "slam", 420, BIG, BIG_PORT, { color: "#F1ECE2", align: "center", portText: "OPEN\nSOURCE.", portSize: 300 }),
  ],
};

const burst: Shot = {
  id: "burst", kind: "burst", at: 72, beats: 8, window: win("burst-window"),
  type: [
    T("burst-label", "THE RECORD SO FAR", 0, "label", 24, [80, 40, 1760, 40], [60, 200, 960, 40], { out: 6, color: "#F1ECE2", fill: P.ink }),
  ],
};

const immunity: Shot = {
  id: "immunity", kind: "immunity", at: 80, beats: 8,
  extra: [
    { id: "immunity-personal", box: { land: [1290, 150, 560, 350], port: [60, 1590, 430, 269] } },
    { id: "immunity-work", box: { land: [1320, 400, 560, 350], port: [325, 1560, 430, 269] } },
    { id: "immunity-campaign", box: { land: [1280, 650, 560, 350], port: [590, 1600, 430, 269] } },
  ],
  type: [
    T("immunity-headline", "FULL\nIMMUNITY.", 0, "slam", 380, [80, 90, 1150, 680], [60, 360, 960, 820], { portSize: 330 }),
    T("immunity-lede", "Real Chromium for the Mac.\nImmune to ads, trackers and prosecution.", 1.5, "lede", 50, [84, 790, 1240, 140], [64, 1220, 960, 200], { portSize: 48 }),
    T("immunity-stamp", "INCUMBENT", 3, "stamp", 84, [880, 110, 480, 150], [520, 200, 500, 140], { rotation: -9, color: P.red, portSize: 66 }),
    T("immunity-label", "NETNYAHOO · THE SIDEBAR BROWSER FOR MAC", 4, "label", 24, [84, 980, 1180, 40], [64, 1450, 960, 80]),
  ],
};

const cta: Shot = {
  id: "cta", kind: "cta", at: 88, beats: 8, window: win("cta-yahu", { land: [1200, 120, 680, 960], port: [380, 1040, 660, 880] }),
  type: [
    T("cta-download", "DOWNLOAD FREE", 0, "slam", 120, [80, 210, 1100, 140], [60, 300, 960, 140], { portSize: 110 }),
    T("cta-url", "NETNYAHOO.COM", 0.5, "slam", 240, [80, 360, 1100, 280], [60, 450, 960, 260], { color: P.blue }),
    T("cta-fine", "OPEN SOURCE · APPLE SILICON · MACOS 14+", 1.5, "label", 26, [84, 680, 1100, 40], [64, 740, 960, 80]),
    T("cta-victory", "VICTORY DANCE", 3, "stamp", 70, [1280, 160, 560, 140], [80, 1010, 520, 120], { rotation: 8, color: P.red, portSize: 56 }),
  ],
};

const hero: Shot[] = [nags, title, tabs, swipe, split, layout, block, colors, chromium, store, privacy, icons, fast, swipe2, nos, burst, immunity, cta];

// ---------------------------------------------------------------------------------------------- the teaser

const teaser: Shot[] = [
  nags,
  title,
  { ...swipe, at: 12, beats: 8 },
  { ...nos, at: 20, beats: 4 },
  { ...immunity, at: 24, beats: 4 },
  { ...cta, at: 28, beats: 8 },
];

export type CutName = "launch" | "teaser";
export const CUTS: Record<CutName, { beats: number; shots: Shot[] }> = {
  launch: { beats: 96, shots: hero },
  teaser: { beats: 36, shots: teaser },
};

/** When the end hit, the march taps and the last brass button land (the end card times its gag to them). */
export const END: Record<CutName, { hit: number; button: number }> = {
  launch: { hit: 80, button: 91 },
  teaser: { hit: 24, button: 31 },
};
