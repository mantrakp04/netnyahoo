import { requireNativeModule, type EventSubscription } from "expo-modules-core";

export type ImportKind =
  | "bookmarks"
  | "history"
  | "tabs"
  | "passwords"
  | "cookies"
  | "spaces"
  | "pinnedTabs"
  | "favorites";

export type BrowserFamily = "chromium" | "firefox" | "safari" | "arc" | "automation";

export type SpaceSummary = {
  id: string;
  name: string;
  color?: string;
  emoji?: string;
  icon?: string;
  pinnedCount: number;
  tabCount: number;
};

export type BrowserProfile = {
  id: string;
  name: string;
  path: string;
  email?: string;
  avatarPath?: string;
  color?: string;
  isDefault: boolean;
  available: ImportKind[];
  spaces?: SpaceSummary[];
};

export type BrowserSource = {
  id: string;
  name: string;
  family: BrowserFamily;
  appPath?: string;
  iconPath?: string;
  requiresExport: boolean;
  needsKeychain: boolean;
  needsFullDiskAccess?: boolean;
  profiles: BrowserProfile[];
};

export type BookmarkRole = "toolbar" | "other" | "mobile" | "menu" | "readingList";

export type BookmarkNode = {
  type: "folder" | "url";
  title: string;
  url?: string;
  dateAdded?: number;
  children?: BookmarkNode[];
  role?: BookmarkRole;
  pageTitle?: string;
};

export type ImportedHistoryEntry = { url: string; title: string; visits: number; lastVisit: number; typedCount?: number };

export type ImportedTab = {
  url: string;
  title: string;
  pinned: boolean;
  customTitle?: string;
  groupId?: string;
  windowIndex: number;
  active: boolean;
  lastActive?: number;
};

export type TabGroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
export type ImportedTabGroup = { id: string; title: string; color: TabGroupColor | (string & {}); collapsed: boolean };

export type Credential = {
  url: string;
  username: string;
  password: string;
  realm?: string;
  title?: string;
  note?: string;
  otpAuth?: string;
  created?: number;
  lastUsed?: number;
  timesUsed?: number;
};

export type ImportedCookie = {
  domain: string;
  name: string;
  value: string;
  path: string;
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "unspecified" | "none" | "lax" | "strict";
  created?: number;
};

export type SpaceSuggestion = {
  id: string;
  name: string;
  color?: string;
  colors?: string[];
  emoji?: string;
  icon?: string;
  profileId: string;
  pinned: BookmarkNode[];
  tabs: ImportedTab[];
};

export type ProfileSuggestion = { name: string; color?: string; avatarPath?: string };

export type ImportWarning = {
  kind?: ImportKind;
  code: string;
  message: string;
};

export type ImportResult = {
  browserId: string;
  profileId: string;
  profile?: ProfileSuggestion;
  bookmarks?: BookmarkNode;
  history: ImportedHistoryEntry[];
  historyCount: number;
  tabs: ImportedTab[];
  tabGroups: ImportedTabGroup[];
  credentials: Credential[];
  cookies: ImportedCookie[];
  spaces: SpaceSuggestion[];
  favorites: ImportedTab[];
  failed: ImportKind[];
  warnings: ImportWarning[];
};

export type SafariExport = {
  bookmarks?: BookmarkNode;
  credentials: Credential[];
  profiles: { name?: string; history: ImportedHistoryEntry[]; extensions: string[] }[];
  tabs: ImportedTab[];
  warnings: ImportWarning[];
};

export type ImportProgress = {
  kind: ImportKind;
  phase: "start" | "progress" | "end";
  processed: number;
  total?: number;
};

export type ImportOptions = {
  historyLimit?: number;
  historySince?: number;
  spaceIds?: string[];
  onProgress?: (progress: ImportProgress) => void;
  onHistoryChunk?: (entries: ImportedHistoryEntry[]) => void;
  chunkSize?: number;
  signal?: AbortSignal;
};

export type DiaTabsProfile = {
  id: string;
  name: string;
  index: number;
  pinned: ImportedTab[];
  tabs: ImportedTab[];
};

export type DiaTabsResult = {
  profiles: DiaTabsProfile[];
  windowCount: number;
  skipped: number;
  duplicates: number;
};

export type DiaAutomationStatus = "granted" | "denied" | "notDetermined" | "notRunning" | "notInstalled";

export class ImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ImportError";
  }
}

type ImportEvent =
  | ({ jobId: string; type: "progress" } & ImportProgress)
  | { jobId: string; type: "history"; entries: string };

const Native = requireNativeModule<{
  addListener(name: "onImportEvent", listener: (e: ImportEvent) => void): EventSubscription;
  listBrowsers(): Promise<string>;
  importData(jobId: string, browserId: string, profileId: string, kinds: ImportKind[], options: object): Promise<string>;
  cancelImport(jobId: string): void;
  unlockBrowser(browserId: string, primaryPassword: string | null): Promise<null>;
  isBrowserUnlocked(browserId: string): boolean;
  forgetUnlockedKeys(): void;
  importSafariExport(jobId: string, path: string): Promise<string>;
  safariHasFullDiskAccess(): boolean;
  openFullDiskAccessSettings(): Promise<null>;
  importSafariDirect(jobId: string): Promise<string>;
  importBookmarksHTML(path: string): Promise<string>;
  importPasswordsCSV(path: string): Promise<string>;
  chooseImportFile(kind: "safariExport" | "bookmarksHTML" | "passwordsCSV"): Promise<string | null>;
  diaAutomationStatus(): Promise<string>;
  requestDiaAutomation(): Promise<string>;
  openAutomationSettings(): Promise<null>;
  openDia(): Promise<null>;
  readDiaTabs(): Promise<string>;
}>("NetnyahooImport");

let jobSeq = 0;

async function call<T>(promise: Promise<string | null>): Promise<T> {
  try {
    const json = await promise;
    return (json == null ? undefined : JSON.parse(json)) as T;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    throw new ImportError(err.code ?? "unreadable", err.message ?? String(e));
  }
}

async function job<T>(options: ImportOptions, start: (jobId: string) => Promise<string>): Promise<T> {
  const jobId = `import-${++jobSeq}`;
  if (options.signal?.aborted) throw new ImportError("cancelled", "Import cancelled");
  const sub = Native.addListener("onImportEvent", (e) => {
    if (e.jobId !== jobId) return;
    if (e.type === "history") options.onHistoryChunk?.(JSON.parse(e.entries) as ImportedHistoryEntry[]);
    else options.onProgress?.({ kind: e.kind, phase: e.phase, processed: e.processed, total: e.total });
  });
  const abort = () => Native.cancelImport(jobId);
  options.signal?.addEventListener("abort", abort);
  try {
    return await call<T>(start(jobId));
  } finally {
    options.signal?.removeEventListener("abort", abort);
    sub.remove();
  }
}

export const listBrowsers = () => call<BrowserSource[]>(Native.listBrowsers());

export function importData(browserId: string, profileId: string, kinds: ImportKind[], options: ImportOptions = {}) {
  const native = {
    historyLimit: options.historyLimit,
    historySince: options.historySince,
    spaceIds: options.spaceIds,
    chunkSize: options.chunkSize,
    streamHistory: options.onHistoryChunk != null,
  };
  return job<ImportResult>(options, (jobId) => Native.importData(jobId, browserId, profileId, kinds, native));
}

export const unlockBrowser = (browserId: string, options: { primaryPassword?: string } = {}) =>
  call<void>(Native.unlockBrowser(browserId, options.primaryPassword ?? null));

export const isBrowserUnlocked = (browserId: string) => Native.isBrowserUnlocked(browserId);

export const forgetUnlockedKeys = () => Native.forgetUnlockedKeys();

export const importSafariExport = (path: string, options: Pick<ImportOptions, "signal"> = {}) =>
  job<SafariExport>(options, (jobId) => Native.importSafariExport(jobId, path));

export const safariHasFullDiskAccess = () => Native.safariHasFullDiskAccess();

export const openFullDiskAccessSettings = () => call<void>(Native.openFullDiskAccessSettings());

export const importSafariDirect = (options: Pick<ImportOptions, "signal"> = {}) =>
  job<SafariExport>(options, (jobId) => Native.importSafariDirect(jobId));

export const importBookmarksHTML = (path: string) => call<BookmarkNode>(Native.importBookmarksHTML(path));

export const importPasswordsCSV = (path: string) => call<Credential[]>(Native.importPasswordsCSV(path));

export const chooseImportFile = (kind: "safariExport" | "bookmarksHTML" | "passwordsCSV") => Native.chooseImportFile(kind);

export const diaAutomationStatus = () => call<DiaAutomationStatus>(Native.diaAutomationStatus());

export const requestDiaAutomation = () => call<DiaAutomationStatus>(Native.requestDiaAutomation());

export const openAutomationSettings = () => call<void>(Native.openAutomationSettings());

export const openDia = () => call<void>(Native.openDia());

export const readDiaTabs = () => call<DiaTabsResult>(Native.readDiaTabs());
