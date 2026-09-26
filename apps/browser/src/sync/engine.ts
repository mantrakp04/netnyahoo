import { readDocument, writeDocument } from "@netnyahoo/shell";
import {
  Clock,
  emptyScope,
  folderTransport,
  syncScope,
  SyncNative,
  visible,
  type Adapter,
  type FolderInfo,
  type PhraseResult,
  type ScopeState,
} from "@netnyahoo/sync";
import { create } from "zustand";
import { useBrowser } from "../store/browser";
import { isIncognitoProfile } from "../store/model";
import { DEFAULT_PROFILE_ID } from "../store/settings";
import type { Profile } from "../store/types";
import {
  bookmarksAdapter,
  deviceAdapter,
  deviceTabsAdapter,
  historyAdapter,
  historyExpired,
  passwordsAdapter,
  pinnedAdapter,
  profilesAdapter,
  settingsAdapter,
  type DeviceRecord,
  type DeviceTabs,
  type ProfileRecord,
} from "./adapters";

/**
 * Sync, after Dia's (Settings › Sync), without a server: every Mac reads and writes sealed
 * files in a folder the user picks (iCloud Drive › Netnyahoo Sync unless they pick another),
 * and the key comes from a 24-word recovery phrase that never leaves their Macs. Design:
 * docs/sync.md. Here: the state this Mac keeps (sync.json), the setup flows, and the cycle
 * that runs every few seconds.
 */

export type DataType = "bookmarks" | "history" | "tabs" | "pinned" | "passwords" | "settings";

export const DATA_TYPES: { id: DataType; title: string; description: string }[] = [
  { id: "bookmarks", title: "Bookmarks", description: "Each synced profile’s bookmarks bar and other bookmarks." },
  { id: "history", title: "History", description: "The last 90 days." },
  { id: "tabs", title: "Open Tabs", description: "Your other devices’ tabs show in the tab overflow menu." },
  { id: "pinned", title: "Pinned Tabs and Groups", description: "Pinned tabs and pinned tab groups." },
  { id: "passwords", title: "Passwords", description: "Saved passwords. Turning sync off never removes them from this Mac." },
  { id: "settings", title: "Settings", description: "Search engine, appearance, tab and keyboard settings." },
];

type ProfileLink = {
  syncId: string;
  enabled: boolean;
  /** Turned off (or its profile deleted): its open tabs leave the other devices on the next cycle. */
  retire?: boolean;
};

type SyncDoc = {
  v: 1;
  enabled: boolean;
  folder: string | null;
  /** A new id every time sync is turned on here, so a device's file numbers never restart. */
  deviceId: string | null;
  clock: string | null;
  types: Record<DataType, boolean>;
  /** Local profile id → the profile's id in the sync data. */
  profiles: Record<string, ProfileLink>;
  scopes: Record<string, ScopeState>;
  lastSyncedAt: number | null;
  setupAt: number | null;
  /** Entered a phrase: match profiles to the synced ones (Personal to Personal) on the first cycle. */
  joining: boolean;
  /** Each scope's last written file number, kept outside the sealed state. */
  seqs?: Record<string, number>;
};

const DOC = "sync.json";
/** The replica, sealed (loadState). */
const STATE = "sync-state.nns";
const APP_SCOPE = "app";
const CYCLE_MS = 15_000;
const AFTER_EDIT_MS = 3_000;

const defaultTypes = (): Record<DataType, boolean> => ({ bookmarks: true, history: true, tabs: true, pinned: true, passwords: true, settings: true });

const emptyDoc = (): SyncDoc => ({
  v: 1,
  enabled: false,
  folder: null,
  deviceId: null,
  clock: null,
  types: defaultTypes(),
  profiles: {},
  scopes: {},
  lastSyncedAt: null,
  setupAt: null,
  joining: false,
});

/** Dia's status words: "starting up", "updating", "updated just now", "not syncing", "offline". */
export type SyncStatus = "off" | "starting" | "updating" | "updated" | "stalled" | "offline" | "locked" | "reset" | "unavailable";

export type SyncedDevice = { id: string; name: string; lastSeen: number | null; current: boolean };
export type RemoteTabs = { deviceId: string; name: string; tabs: { url: string; title: string }[] };
export type RemoteProfile = { syncId: string; name: string; color: Profile["color"]; icon: string | null };

type SyncUi = {
  status: SyncStatus;
  enabled: boolean;
  folder: string | null;
  types: Record<DataType, boolean>;
  profiles: Record<string, ProfileLink>;
  lastSyncedAt: number | null;
  /** Why the last cycle failed. */
  error: string | null;
  pending: number;
  devices: SyncedDevice[];
  /** Per local profile: the other devices' open tabs. */
  remoteTabs: Record<string, RemoteTabs[]>;
  /** Synced profiles this Mac doesn't have. */
  remoteProfiles: RemoteProfile[];
};

export const useSync = create<SyncUi>(() => ({
  status: SyncNative ? "off" : "unavailable",
  enabled: false,
  folder: null,
  types: defaultTypes(),
  profiles: {},
  lastSyncedAt: null,
  error: null,
  pending: 0,
  devices: [],
  remoteTabs: {},
  remoteProfiles: [],
}));

let doc: SyncDoc = emptyDoc();
let savedJson = "";
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let forcePasswords = false;
const passwordAdapters = new Map<string, Adapter>();

function load() {
  try {
    const json = readDocument(DOC);
    if (json) doc = { ...emptyDoc(), ...(JSON.parse(json) as SyncDoc), scopes: {} };
    savedJson = json ?? "";
  } catch (error) {
    console.warn("[sync] couldn't read sync.json", error);
  }
}

/**
 * The replica (saved passwords included) is written sealed with the sync key, so it's only
 * readable once the key is unlocked. If it can't be read, the folder is read again from the
 * start; the file numbers this Mac used carry on from `seqs`, so none is reused.
 */
async function loadState() {
  const sealed = readDocument(STATE);
  const json = sealed ? await SyncNative?.openLocal(sealed) : null;
  let scopes: SyncDoc["scopes"] = {};
  try {
    if (json) scopes = JSON.parse(json) as SyncDoc["scopes"];
  } catch {}
  for (const [scope, seq] of Object.entries(doc.seqs ?? {})) {
    scopes[scope] ??= emptyScope();
    scopes[scope]!.seq = Math.max(scopes[scope]!.seq, seq);
  }
  doc.scopes = scopes;
}

let savedState = "";
let sealing: Promise<void> | null = null;

function save() {
  const { scopes, ...meta } = doc;
  const json = JSON.stringify({ ...meta, seqs: Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, s.seq])) });
  if (json !== savedJson) {
    savedJson = json;
    writeDocument(DOC, json);
  }
  const state = doc.enabled ? JSON.stringify(scopes) : "";
  if (state === savedState || sealing) return;
  if (!state) {
    savedState = "";
    writeDocument(STATE, "");
    return;
  }
  sealing = (async () => {
    try {
      const sealed = await SyncNative?.sealLocal(state);
      if (sealed) {
        writeDocument(STATE, sealed);
        savedState = state;
      }
    } catch (error) {
      console.warn("[sync] couldn't save the sync state", error);
    } finally {
      sealing = null;
    }
    if (doc.enabled && JSON.stringify(doc.scopes) !== savedState) save();
  })();
}

function publishUi(patch: Partial<SyncUi> = {}) {
  useSync.setState({
    enabled: doc.enabled,
    folder: doc.folder,
    types: { ...doc.types },
    profiles: { ...doc.profiles },
    lastSyncedAt: doc.lastSyncedAt,
    ...(doc.enabled ? summarize() : { devices: [], remoteTabs: {}, remoteProfiles: [], pending: 0 }),
    ...patch,
  });
}

export const deviceName = () => SyncNative?.deviceName() ?? "This Mac";

// MARK: Adapters

function appAdapters(retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceAdapter(id, deviceName, true)];
  return [
    ...(doc.types.settings ? [settingsAdapter] : []),
    profilesAdapter(() => Object.fromEntries(Object.entries(doc.profiles).filter(([, l]) => l.enabled))),
    deviceAdapter(id, deviceName),
  ];
}

function profileAdapters(profileId: string, retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceTabsAdapter(profileId, id, deviceName, true)];
  const s = useBrowser.getState();
  // Profiles that share another's data sync their tabs; the data syncs with its owner.
  const ownsData = !s.profiles[profileId]?.dataId;
  const t = doc.types;
  let passwords = passwordAdapters.get(profileId);
  if (!passwords) passwordAdapters.set(profileId, (passwords = passwordsAdapter(profileId, () => forcePasswords)));
  return [
    ...(t.pinned ? [pinnedAdapter(profileId)] : []),
    ...(t.bookmarks && ownsData ? [bookmarksAdapter(profileId)] : []),
    ...(t.history && ownsData ? [historyAdapter(profileId)] : []),
    deviceTabsAdapter(profileId, id, deviceName, !t.tabs),
    // Last: it waits on Chrome, and nothing else should wait with it.
    ...(t.passwords && ownsData ? [passwords] : []),
  ];
}

// MARK: The cycle

/** Runs a cycle soon (after local edits settle), or now. */
export function scheduleSync(delay = AFTER_EDIT_MS) {
  if (!doc.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void runCycle(), delay);
}

/** Settings' "Sync Now" (and the dev harness): a cycle now, passwords included. */
export async function syncNow() {
  forcePasswords = true;
  await runCycle();
}

async function runCycle({ retiring = false } = {}) {
  const native = SyncNative;
  if (!native || !doc.enabled || !doc.folder || !doc.deviceId) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  clearTimeout(timer);
  const slow = setTimeout(() => useSync.getState().status === "updated" && publishUi({ status: "updating" }), 1000);
  try {
    const status = await native.chainStatus(doc.folder);
    if (status === "unavailable") return publishUi({ status: "offline", error: null });
    if (status === "missing") return await resetFromElsewhere();
    const transport = folderTransport(native, doc.folder);
    const clock = new Clock(doc.deviceId, doc.clock);
    const device = doc.deviceId;
    const app = (doc.scopes[APP_SCOPE] ??= { ...emptyScope(), awaitRemote: doc.joining });
    await syncScope({ scope: APP_SCOPE, state: app, transport, adapters: appAdapters(retiring), clock, device });
    if (app.joined) linkProfiles(app);
    let pending = app.pending;
    const s = useBrowser.getState();
    for (const [profileId, link] of Object.entries(doc.profiles)) {
      const exists = !!s.profiles[profileId];
      const retire = retiring || !!link.retire || !exists;
      if (!retire && !link.enabled) continue;
      const scope = `p:${link.syncId}`;
      const state = (doc.scopes[scope] ??= emptyScope());
      await syncScope({
        scope,
        state,
        transport,
        adapters: profileAdapters(profileId, retire),
        clock,
        device,
        options: { expired: historyExpired },
      });
      pending += state.pending;
      if (retire) {
        delete link.retire;
        // Kept while the profile exists: turning it back on picks up where it left off.
        if (!exists) {
          delete doc.scopes[scope];
          delete doc.profiles[profileId];
        }
      }
    }
    doc.clock = clock.last;
    doc.lastSyncedAt = Date.now();
    if (app.joined) doc.joining = false;
    forcePasswords = false;
    publishUi({ status: "updated", error: null, pending });
  } catch (error) {
    console.warn("[sync] cycle failed", error);
    publishUi({ status: "stalled", error: errorText(error) });
  } finally {
    clearTimeout(slow);
    running = false;
    save();
    if (doc.enabled) {
      if (again) {
        again = false;
        scheduleSync(0);
      } else {
        scheduleSync(CYCLE_MS);
      }
    }
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Matches local profiles to synced ones: on joining, Personal to the synced default and others by name; new ones get ids. */
function linkProfiles(app: ScopeState) {
  const s = useBrowser.getState();
  const remote = [...visible(app, "prof:")].map(([k, v]) => [k.slice(5), v as ProfileRecord] as const);
  const taken = new Set(Object.values(doc.profiles).map((l) => l.syncId));
  for (const id of s.profileOrder) {
    const profile = s.profiles[id];
    if (!profile || isIncognitoProfile(id) || doc.profiles[id]) continue;
    const match = doc.joining
      ? remote.find(([syncId, r]) => !taken.has(syncId) && (id === DEFAULT_PROFILE_ID ? r.d : r.n === profile.name))?.[0]
      : undefined;
    const syncId = match ?? SyncNative!.newDeviceId();
    doc.profiles[id] = { syncId, enabled: true };
    taken.add(syncId);
    // Its data is elsewhere already: don't let this Mac's copy count as newer until it's read.
    if (match) doc.scopes[`p:${syncId}`] = { ...emptyScope(), awaitRemote: true };
  }
  for (const [id, link] of Object.entries(doc.profiles)) if (!s.profiles[id] && !link.retire) link.retire = true;
}

/** The chain folder is gone: another device chose Delete My Sync Data. Stop here, keep everything local. */
async function resetFromElsewhere() {
  await SyncNative?.forget(doc.deviceId!);
  doc = { ...emptyDoc(), folder: doc.folder, types: doc.types };
  save();
  publishUi({ status: "reset", error: "This device is out of sync. Sync may have been reset from another device." });
}

function summarize(): Pick<SyncUi, "devices" | "remoteTabs" | "remoteProfiles"> {
  const app = doc.scopes[APP_SCOPE];
  if (!app) return { devices: [], remoteTabs: {}, remoteProfiles: [] };
  const lastSeen = new Map<string, number>();
  for (const scope of Object.values(doc.scopes)) {
    for (const [device, at] of Object.entries(scope.seen)) lastSeen.set(device, Math.max(at, lastSeen.get(device) ?? 0));
  }
  const names = new Map([...visible(app, "dev:")].map(([k, v]) => [k.slice(4), (v as DeviceRecord).n]));
  const devices: SyncedDevice[] = [...names].map(([id, name]) => ({ id, name, lastSeen: lastSeen.get(id) ?? null, current: id === doc.deviceId }));
  devices.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const remoteTabs: Record<string, RemoteTabs[]> = {};
  for (const [profileId, link] of Object.entries(doc.profiles)) {
    const scope = doc.scopes[`p:${link.syncId}`];
    if (!scope || !link.enabled) continue;
    remoteTabs[profileId] = [...visible(scope, "tabs:")]
      .map(([k, v]) => ({ deviceId: k.slice(5), value: v as DeviceTabs }))
      // A device that stopped syncing took its record away; one without a name record is on its way out.
      .filter(({ deviceId, value }) => deviceId !== doc.deviceId && names.has(deviceId) && value.tabs.length > 0)
      .map(({ deviceId, value }) => ({ deviceId, name: names.get(deviceId) || value.n || "Unknown Device", tabs: value.tabs.map((t) => ({ url: t.u, title: t.t })) }));
  }
  const linked = new Set(Object.values(doc.profiles).map((l) => l.syncId));
  const remoteProfiles = [...visible(app, "prof:")]
    .filter(([k]) => !linked.has(k.slice(5)))
    .map(([k, v]) => ({ syncId: k.slice(5), name: (v as ProfileRecord).n, color: (v as ProfileRecord).c, icon: (v as ProfileRecord).i }));
  return { devices, remoteTabs, remoteProfiles };
}

// MARK: Setup

export async function folderInfo(path?: string | null): Promise<FolderInfo | null> {
  return (await SyncNative?.folderInfo(path ?? doc.folder ?? null)) ?? null;
}

/** Picks the folder sync uses (only while sync is off). */
export function setSyncFolder(path: string) {
  if (doc.enabled) return;
  doc.folder = path;
  save();
  publishUi();
}

export async function chooseSyncFolder(): Promise<string | null> {
  const picked = (await SyncNative?.chooseFolder(doc.folder)) ?? null;
  if (picked) setSyncFolder(picked);
  return picked;
}

function begin(folder: string, deviceId: string, joining: boolean) {
  doc = { ...emptyDoc(), types: doc.types, enabled: true, folder, deviceId, setupAt: Date.now(), joining };
  save();
  publishUi({ status: "starting", error: null });
  scheduleSync(0);
}

/** Turn On Sync / Set Up Without Another Device: a new phrase and new sync data in the folder. */
export async function turnOnSync(folder: string): Promise<{ ok: true } | { error: string }> {
  const native = SyncNative;
  if (!native) return { error: "Sync isn’t available in this build." };
  const deviceId = native.newDeviceId();
  try {
    if (!(await native.createPhrase(deviceId))) return { error: "Couldn’t save the sync key in your Keychain." };
    await native.createChain(folder);
  } catch (error) {
    await native.forget(deviceId);
    return { error: `Couldn’t use that folder: ${errorText(error)}` };
  }
  begin(folder, deviceId, false);
  return { ok: true };
}

/** Enter Recovery Phrase: join the sync data another device made (or unlock this one again). */
export async function enterRecoveryPhrase(folder: string, text: string): Promise<PhraseResult | { error: "unavailable" }> {
  const native = SyncNative;
  if (!native) return { error: "unavailable" };
  // Locked (this Mac lost its key, e.g. a Keychain reset): the same device picks up where it was.
  if (doc.enabled && doc.deviceId && useSync.getState().status === "locked") {
    const result = await native.enterPhrase(doc.deviceId, text, doc.folder ?? folder);
    if ("ok" in result) {
      await loadState();
      publishUi({ status: "starting", error: null });
      scheduleSync(0);
    }
    return result;
  }
  const deviceId = native.newDeviceId();
  const result = await native.enterPhrase(deviceId, text, folder);
  if ("ok" in result) begin(folder, deviceId, true);
  return result;
}

/** Stop Syncing: this Mac leaves (its tabs and name leave the other devices); everything local stays. */
export async function stopSync({ deleteData = false } = {}) {
  const native = SyncNative;
  if (!native || !doc.enabled) return;
  clearTimeout(timer);
  while (running) await new Promise((r) => setTimeout(r, 100));
  try {
    if (useSync.getState().status !== "locked") await runCycle({ retiring: true });
  } catch {}
  clearTimeout(timer);
  const folder = doc.folder;
  if (deleteData && folder) {
    try {
      await native.deleteChain(folder);
    } catch (error) {
      console.warn("[sync] deleting sync data failed", error);
    }
  }
  if (doc.deviceId) await native.forget(doc.deviceId);
  doc = { ...emptyDoc(), folder, types: doc.types };
  passwordAdapters.clear();
  save();
  publishUi({ status: "off", error: null });
}

export function setTypeSynced(type: DataType, enabled: boolean) {
  doc.types = { ...doc.types, [type]: enabled };
  save();
  publishUi();
  scheduleSync(0);
}

export function setProfileSynced(profileId: string, enabled: boolean) {
  const link = doc.profiles[profileId];
  if (!link) return;
  doc.profiles[profileId] = enabled ? { syncId: link.syncId, enabled } : { ...link, enabled, retire: true };
  save();
  publishUi();
  scheduleSync(0);
}

/** Add to This Mac: a synced profile this Mac doesn't have becomes a local profile, synced. */
export function addRemoteProfile(syncId: string): string | null {
  const record = doc.scopes[APP_SCOPE]?.records[`prof:${syncId}`]?.v as ProfileRecord | undefined;
  if (!record) return null;
  const id = useBrowser.getState().createProfile({ name: record.n, color: record.c, icon: record.i });
  doc.profiles[id] = { syncId, enabled: true };
  doc.scopes[`p:${syncId}`] = { ...emptyScope(), awaitRemote: true };
  save();
  publishUi();
  scheduleSync(0);
  return id;
}

// MARK: Launch

export function startSync() {
  if (!SyncNative) return;
  load();
  publishUi({ status: doc.enabled ? "starting" : "off" });
  if (doc.enabled && doc.deviceId) {
    void SyncNative.unlock(doc.deviceId).then(async (ok) => {
      if (!ok) return publishUi({ status: "locked", error: "Enter your recovery phrase to keep syncing on this Mac." });
      await loadState();
      publishUi();
      scheduleSync(500);
    });
  }
  // Local edits sync a few seconds after they settle.
  // (Tabs and history change all the time and go with the regular cycle.)
  useBrowser.subscribe((s, prev) => {
    if (!doc.enabled || running) return;
    if (s.bookmarks !== prev.bookmarks || s.settings !== prev.settings || s.profiles !== prev.profiles || s.groups !== prev.groups) scheduleSync();
  });
  if (__DEV__) {
    // Test hooks: `nnSync.turnOnSync(folder)`, `nnSync.syncNow()`, `nnSync.menu.syncedDevicesMenuItem(profileId)`…
    (globalThis as { nnSync?: object }).nnSync = {
      useSync, syncNow, turnOnSync, enterRecoveryPhrase, stopSync, setTypeSynced, setProfileSynced, addRemoteProfile, setSyncFolder, folderInfo,
      doc: () => doc,
      native: SyncNative,
      get menu(): typeof import("./menu") {
        return require("./menu");
      },
      /** Settings › Sync's sheets: `nnSync.sheets.showRecoveryKit()`. */
      get sheets(): typeof import("../components/settings/panes/SyncSheets") {
        return require("../components/settings/panes/SyncSheets");
      },
    };
  }
}
