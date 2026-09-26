import { translation } from "@netnyahoo/shell";
import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import { hideKeyedToast, showToast } from "../layout/splitActions";
import { translatorCall, type Passage } from "./pageTranslator";

/**
 * Translate this page, on the Mac's own translation models (Apple's Translation framework,
 * macOS 26), so nothing leaves the Mac. Dia's UX, from its 1.50.1 binary: a translate button
 * ("Translate this page") by the address when the page isn't in one of your languages; "Translate
 * to <language>", "Choose Another Language" and "Never Translate This Site" in the site menu; the
 * toasts "Translated to %@", "Translated back to %@" and "Translation error (%@)".
 *
 * The page side (pageTranslator.ts) swaps text nodes' text and keeps the originals, so markup
 * stays as it is and reverting is exact, and it queues text the page adds later. The app pulls
 * bounded batches from the page, translates them natively and puts them back, so a huge page
 * never stalls; a long first pass shows its progress in the toast.
 */
export type TranslateState = {
  /** The page's language (BCP 47) when it isn't one of the user's; null: nothing to offer. */
  source: string | null;
  status: "idle" | "translating" | "translated";
  target: string | null;
  /** Names this translation in the page (a new document has none, so it's never translated unasked). */
  token: string | null;
};

const IDLE: TranslateState = { source: null, status: "idle", target: null, token: null };
export const useTranslate = create<Record<string, TranslateState | undefined>>()(() => ({}));
const stateOf = (tabId: string) => useTranslate.getState()[tabId] ?? IDLE;
export const translateStateOf = stateOf;
const patch = (tabId: string, p: Partial<TranslateState>) => useTranslate.setState((s) => ({ [tabId]: { ...(s[tabId] ?? IDLE), ...p } }));
export const useTranslateState = (tabId: string) => useTranslate((s) => s[tabId] ?? IDLE);

/** Passages per round trip, and characters: each round's translation shows on the page soon. */
const BATCH = 8;
const BATCH_CHARS = 2000;
/** How often a translated page is checked for text it added or scrolled into view since. */
const FOLLOW_MS = 600;
/** A first pass longer than this shows its progress. */
const PROGRESS_AFTER_MS = 1200;
const PROGRESS_TOAST = "translate-progress";

/** "de-DE" → "de"; Chinese keeps its script ("zh-Hans" and "zh-Hant" read differently). */
export function baseLanguage(language: string): string {
  const [lang = "", second] = language.split(/[-_]/);
  if (lang.toLowerCase() === "zh") return second && /^(hant|tw|hk|mo)$/i.test(second) ? "zh-Hant" : "zh-Hans";
  return lang.toLowerCase();
}

let userLanguages: string[] | null = null;
/** The user's languages (macOS's preferred languages), most preferred first. */
function languages(): string[] {
  userLanguages ??= translation?.userLanguages() ?? [];
  return userLanguages;
}
/** Pages are translated into the user's first language unless they choose another. */
export const defaultTarget = () => baseLanguage(languages()[0] ?? "en");
export const languageName = (language: string) => translation?.languageName(language) ?? language;

function hostOf(url: string): string {
  try {
    return /^https?:$/.test(new URL(url).protocol) ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

// MARK: Never Translate This Site (per profile; incognito windows follow their default profile's)

function listOwner(profileId: string): string {
  return isIncognitoProfile(profileId) ? useBrowser.getState().settings.defaultProfileId : profileId;
}
export function isNeverTranslated(profileId: string, url: string): boolean {
  const host = hostOf(url);
  return !!host && (useBrowser.getState().settings.neverTranslateSites[listOwner(profileId)] ?? []).includes(host);
}
export function setNeverTranslate(tabId: string, never: boolean) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const host = tab ? hostOf(tab.url) : "";
  if (!tab || !host || isIncognitoProfile(tab.profileId)) return;
  const all = s.settings.neverTranslateSites;
  const list = (all[tab.profileId] ?? []).filter((h) => h !== host);
  s.updateSettings({ neverTranslateSites: { ...all, [tab.profileId]: never ? [...list, host] : list } });
  if (!never) return void detect(tabId);
  if (stateOf(tabId).status !== "idle") void revertPage(tabId, { quiet: true });
  patch(tabId, { source: null });
}

// MARK: Detection

type Sample = { lang: string; text: string; active: boolean };

/** The page's language: from a sample of its text, else its `lang`. */
async function pageLanguage(tabId: string): Promise<{ language: string | null; active: boolean } | null> {
  const sample = await webviews.get(tabId)?.evaluate<Sample>(translatorCall("sample"));
  if (!sample || !translation) return null;
  const detected = sample.text.length >= 40 ? await translation.detect(sample.text.slice(0, 3000)) : null;
  return { language: detected ?? (sample.lang ? String(sample.lang).slice(0, 20) : null), active: !!sample.active };
}

/**
 * After a page loads: offer translation when its language isn't one of the user's, the site
 * isn't on the never list and this Mac can translate it.
 */
async function detect(tabId: string) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !hostOf(tab.url)) return patch(tabId, { source: null, status: "idle", target: null, token: null });
  const page = await pageLanguage(tabId);
  if (!page) return;
  // A new document took the translation with it.
  if (!page.active && stateOf(tabId).status === "translated") patch(tabId, { status: "idle", target: null, token: null });
  if (isNeverTranslated(tab.profileId, tab.url)) return patch(tabId, { source: null });
  const mine = new Set(languages().map(baseLanguage));
  const source = page.language && !mine.has(baseLanguage(page.language)) ? page.language : null;
  if (source && (await translation.status(source, defaultTarget())) === "unsupported") return patch(tabId, { source: null });
  // Keep a translated page's language even if the sample now reads as the target.
  if (stateOf(tabId).status === "idle") patch(tabId, { source });
}

// MARK: Translating

type Batch = { passages: Passage[]; more: boolean; gone: boolean; done: number; total: number };

/**
 * Each passage translated as one text, its pieces (text nodes) getting their part back (macOS
 * 26.4); a passage that can't be split back has its pieces translated one by one.
 */
async function translatePassages(source: string, target: string, passages: Passage[]): Promise<[number, string][]> {
  const texts = passages.map(([, pieces]) => pieces.map(([, text]) => text));
  const whole = await translation!.translateBlocks(source, target, texts);
  const out: [number, string][] = [];
  const loose: [number, string][] = [];
  passages.forEach(([, pieces], i) => {
    const parts = whole[i];
    if (parts && parts.length === pieces.length) pieces.forEach(([id], j) => out.push([id, parts[j] ?? ""]));
    else loose.push(...pieces);
  });
  if (loose.length) {
    const texts = await translation!.translate(source, target, loose.map(([, text]) => text));
    loose.forEach(([id], i) => out.push([id, texts[i] ?? ""]));
  }
  return out;
}

/** Pulls the page's untranslated text, translates it and puts it back, until none is left. */
async function drain(tabId: string, token: string, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  for (;;) {
    const current = stateOf(tabId);
    const web = webviews.get(tabId);
    const { source, target } = current;
    if (current.status === "idle" || current.token !== token || !web || !source || !target) return false;
    const batch = await web.evaluate<Batch>(translatorCall("next", token, BATCH, BATCH_CHARS));
    if (!batch || batch.gone || !Array.isArray(batch.passages)) return false;
    // The page's answer is data: at most one batch of well-formed strings goes to the translator.
    const passages = batch.passages
      .slice(0, BATCH * 4)
      .filter((p): p is Passage => Array.isArray(p) && Array.isArray(p[1]))
      .map(([id, pieces]): Passage => [id, pieces.filter((x) => Array.isArray(x) && typeof x[1] === "string").slice(0, 40)]);
    if (passages.length) {
      const results = await translatePassages(source, target, passages);
      if (stateOf(tabId).token !== token) return false;
      await web.evaluate(translatorCall("apply", results));
    }
    onProgress?.(batch.done, batch.total);
    if (!batch.more) return true;
  }
}

/** Keeps a translated page translated as it adds text (a feed, a chat, an app's next view). */
async function follow(tabId: string, token: string) {
  for (;;) {
    await new Promise((r) => setTimeout(r, FOLLOW_MS));
    const current = stateOf(tabId);
    if (current.status !== "translated" || current.token !== token) return;
    try {
      if (await drain(tabId, token)) continue;
    } catch {}
    // A round that didn't go through: carry on while the page is still translated. The document
    // went (navigation, crash): the new one is in its own language.
    if (stateOf(tabId).token !== token) return;
    if ((await pageLanguage(tabId).catch(() => null))?.active) continue;
    if (stateOf(tabId).token === token) patch(tabId, { status: "idle", target: null, token: null });
    return;
  }
}

function toast(tabId: string, title: string, message?: string, progress = false) {
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (!windowId) return;
  if (progress) showToast(windowId, title, message, { icon: "translate", key: PROGRESS_TOAST, sticky: true });
  else showToast(windowId, title, message, { icon: "translate" });
}

/** "Translate to <language>": the user's first language unless another is chosen. */
export async function translatePage(tabId: string, target = defaultTarget()) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !webviews.get(tabId)) return;
  // Also clears a translation the page still has but the app lost track of.
  await revertPage(tabId, { quiet: true });
  const source = stateOf(tabId).source ?? (await pageLanguage(tabId))?.language ?? null;
  if (!source) return toast(tabId, "Translation error (can't tell the page's language)");
  if (baseLanguage(source) === baseLanguage(target)) return toast(tabId, `Translation error (the page is already in ${languageName(target)})`);
  let shown = false;
  try {
    const status = await translation.status(source, target);
    if (status === "unsupported") return toast(tabId, `Translation error (${languageName(source)} to ${languageName(target)} isn't available)`);
    // macOS downloads the languages first, in its own sheet.
    if (status === "supported") await translation.prepare(source, target);
    const token = Math.random().toString(36).slice(2);
    patch(tabId, { status: "translating", source, target, token });
    if (!(await webviews.get(tabId)?.evaluate<boolean>(translatorCall("start", token)))) throw new Error("the page isn't ready");
    const started = Date.now();
    const done = await drain(tabId, token, (n, total) => {
      if (Date.now() - started < PROGRESS_AFTER_MS || total <= 0) return;
      shown = true;
      toast(tabId, `Translating to ${languageName(target)}…`, `${Math.min(99, Math.round((n / total) * 100))}%`, true);
    });
    if (!done) {
      if (stateOf(tabId).token === token) patch(tabId, { status: "idle", target: null, token: null });
      if (shown) hideKeyedToast(tab.windowId, PROGRESS_TOAST);
      return;
    }
    patch(tabId, { status: "translated" });
    toast(tabId, `Translated to ${languageName(target)}`);
    void follow(tabId, token);
  } catch (error) {
    await revertPage(tabId, { quiet: true });
    const reason = error instanceof Error ? error.message : String(error);
    toast(tabId, `Translation error (${reason.replace(/[.\s]+$/, "")})`);
  }
}

/** Puts the page's own text back: "Translated back to <language>". */
export async function revertPage(tabId: string, { quiet = false } = {}) {
  const { source, status } = stateOf(tabId);
  patch(tabId, { status: "idle", target: null, token: null });
  await webviews.get(tabId)?.evaluate(translatorCall("revert"));
  if (!quiet && source && status !== "idle") toast(tabId, `Translated back to ${languageName(source)}`);
}

/** The translate button: translate, or back to the original. */
export function toggleTranslation(tabId: string) {
  if (stateOf(tabId).status === "idle") void translatePage(tabId);
  else void revertPage(tabId);
}

/** The languages to offer under "Choose Another Language", by name. */
export async function otherLanguages(): Promise<{ id: string; name: string }[]> {
  if (!translation) return [];
  // One entry per language: its plainest variant ("en" over "en-IN").
  const best = new Map<string, string>();
  for (const id of await translation.supportedLanguages()) {
    const key = baseLanguage(id);
    const current = best.get(key);
    if (!current || id.length < current.length) best.set(key, id);
  }
  return [...best.values()].map((id) => ({ id, name: languageName(id) })).sort((a, b) => a.name.localeCompare(b.name));
}

// MARK: Wiring

/** Detects each page's language once it has loaded, and forgets closed tabs. */
export function startTranslate() {
  if (!translation) return () => {};
  return useBrowser.subscribe((s, prev) => {
    if (s.live === prev.live && s.tabs === prev.tabs) return;
    for (const id in s.live) {
      if (prev.live[id]?.isLoading && !s.live[id]!.isLoading) void detect(id).catch(() => {});
    }
    const gone = Object.keys(useTranslate.getState()).filter((id) => !s.tabs[id]);
    if (gone.length) useTranslate.setState(Object.fromEntries(gone.map((id) => [id, undefined])));
  });
}
