import { requireNativeModule, type EventSubscription } from "expo-modules-core";

// Import from another browser (Dia's "Import from Another Browser…"). Every timestamp is
// Unix milliseconds, like Date.now().

export type ImportKind =
  | "bookmarks"
  | "history"
  | "tabs"
  | "passwords"
  | "cookies"
  /** Arc: spaces → profile/space suggestions. */
  | "spaces"
  /** Arc: each space's pinned tree, with custom tab names. */
  | "pinnedTabs"
  /** Arc: the favourites row. */
  | "favorites";

export type BrowserFamily = "chromium" | "firefox" | "safari" | "arc";

export type SpaceSummary = {
  id: string;
  name: string;
  /** "#RRGGBB" */
  color?: string;
  emoji?: string;
  /** SF Symbol-style name Arc uses when the space has no emoji. */
  icon?: string;
  pinnedCount: number;
  tabCount: number;
};

export type BrowserProfile = {
  /** Pass back to importData(). */
  id: string;
  name: string;
  path: string;
  email?: string;
  /** Local PNG (Chrome's "Google Profile Picture.png"). */
  avatarPath?: string;
  color?: string;
  isDefault: boolean;
  /** Kinds this profile has data for; offer only these. */
  available: ImportKind[];
  /** Arc: spaces that browse with this profile ("Customize which spaces to bring over"). */
  spaces?: SpaceSummary[];
};

export type BrowserSource = {
  id: string;
  name: string;
  family: BrowserFamily;
  appPath?: string;
  /** 64pt @2x PNG of the app icon; show with <Image source={{ uri: `file://${iconPath}` }} />. */
  iconPath?: string;
  /** Safari: the user exports a .zip from Safari (File › Export Browsing Data) → importSafariExport(). */
  requiresExport: boolean;
  /** Passwords/cookies need unlockBrowser(), which shows the macOS Keychain prompt. */
  needsKeychain: boolean;
  /**
   * The browser's data exists but macOS blocks reading it (Chrome and Brave protect their data
   * from other apps). `profiles` is empty until the user grants Full Disk Access
   * (`openFullDiskAccessSettings()`); list again after that.
   */
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
  /** Top-level folders only: where it lived in the source browser. */
  role?: BookmarkRole;
  /** Arc pinned tabs: the page's own title when `title` is the user's rename. */
  pageTitle?: string;
};

export type ImportedHistoryEntry = { url: string; title: string; visits: number; lastVisit: number; typedCount?: number };

export type ImportedTab = {
  url: string;
  title: string;
  pinned: boolean;
  /** A name the user gave the tab (Arc). */
  customTitle?: string;
  groupId?: string;
  windowIndex: number;
  /** The selected tab of its window. */
  active: boolean;
  lastActive?: number;
};

export type TabGroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
export type ImportedTabGroup = { id: string; title: string; color: TabGroupColor | (string & {}); collapsed: boolean };

export type Credential = {
  url: string;
  username: string;
  password: string;
  /** What the login matches (Chromium signon_realm / HTTP auth realm). */
  realm?: string;
  title?: string;
  note?: string;
  /** otpauth:// URL (Safari exports). */
  otpAuth?: string;
  created?: number;
  lastUsed?: number;
  timesUsed?: number;
};

export type ImportedCookie = {
  /** A leading dot applies to subdomains. */
  domain: string;
  name: string;
  value: string;
  path: string;
  /** Absent for session cookies. */
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
  /** Gradient theme colours, when the space has more than one. */
  colors?: string[];
  emoji?: string;
  icon?: string;
  /** Source profile directory the space belongs to. */
  profileId: string;
  /** Filled when "pinnedTabs" was requested. */
  pinned: BookmarkNode[];
  /** Unpinned ("Today") tabs; filled when "tabs" was requested. */
  tabs: ImportedTab[];
};

export type ProfileSuggestion = { name: string; color?: string; avatarPath?: string };

export type ImportWarning = {
  kind?: ImportKind;
  /** "empty" (nothing of this kind), "locked", "undecryptable", "unreadable", "unsupported". */
  code: string;
  message: string;
};

export type ImportResult = {
  browserId: string;
  profileId: string;
  profile?: ProfileSuggestion;
  /** Root folder; its children are the source's top-level folders, tagged with `role`. */
  bookmarks?: BookmarkNode;
  /** Empty when history was streamed through `onHistoryChunk`. */
  history: ImportedHistoryEntry[];
  historyCount: number;
  tabs: ImportedTab[];
  tabGroups: ImportedTabGroup[];
  credentials: Credential[];
  cookies: ImportedCookie[];
  spaces: SpaceSuggestion[];
  favorites: ImportedTab[];
  /** Kinds that failed ("Some import steps failed:"). A kind with no data isn't a failure. */
  failed: ImportKind[];
  warnings: ImportWarning[];
};

export type SafariExport = {
  bookmarks?: BookmarkNode;
  credentials: Credential[];
  /** One per Safari profile; `name` is absent for the default profile. */
  profiles: { name?: string; history: ImportedHistoryEntry[]; extensions: string[] }[];
  /** Open tabs — only from a direct import; the export archive has none. */
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
  /** Newest-first cap on history. */
  historyLimit?: number;
  /** Only history visited at or after this time (ms). */
  historySince?: number;
  /** Arc: import only these spaces. */
  spaceIds?: string[];
  onProgress?: (progress: ImportProgress) => void;
  /** Receive history in chunks instead of in the result (large histories). */
  onHistoryChunk?: (entries: ImportedHistoryEntry[]) => void;
  /** History entries per progress event / chunk. Default 1000. */
  chunkSize?: number;
  signal?: AbortSignal;
};

/** Thrown by every call. `code` is "cancelled", "notFound", "locked", "unreadable" or "unsupported". */
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

/** Runs a native job with progress/chunk events routed to it and AbortSignal → cancelImport. */
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

/** Installed browsers with data to import, their profiles and (Arc) spaces. Reads no browsing data. */
export const listBrowsers = () => call<BrowserSource[]>(Native.listBrowsers());

/**
 * Imports the requested kinds from one profile. Each kind succeeds or fails on its own; see
 * `result.failed`/`warnings`. "passwords" and "cookies" fail with code "locked" until
 * `unlockBrowser()` has been called for this browser.
 */
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

/**
 * The consent step for secrets ("Bring your logins to Dia"). Call only after the user chose
 * to import passwords. Chromium family: macOS asks for the login password to release
 * "<Browser> Safe Storage" — the promise waits on that dialog and rejects with code "locked"
 * if the user denies it. Firefox: records consent (and a primary password, if one is set).
 * Keys are kept in memory until forgetUnlockedKeys().
 */
export const unlockBrowser = (browserId: string, options: { primaryPassword?: string } = {}) =>
  call<void>(Native.unlockBrowser(browserId, options.primaryPassword ?? null));

export const isBrowserUnlocked = (browserId: string) => Native.isBrowserUnlocked(browserId);

/** Drops every unlocked key (call when the import flow closes). */
export const forgetUnlockedKeys = () => Native.forgetUnlockedKeys();

/** Safari's File › Export Browsing Data archive (.zip) or its unzipped folder. */
export const importSafariExport = (path: string, options: Pick<ImportOptions, "signal"> = {}) =>
  job<SafariExport>(options, (jobId) => Native.importSafariExport(jobId, path));

/**
 * Whether Netnyahoo can read Safari's data straight from `~/Library/Safari` — i.e. it has
 * Full Disk Access. Poll this to decide between `importSafariDirect()` and the export `.zip`;
 * re-check it when the app regains focus after the user visits System Settings.
 */
export const safariHasFullDiskAccess = () => Native.safariHasFullDiskAccess();

/** Opens System Settings › Privacy & Security › Full Disk Access so the user can grant it. */
export const openFullDiskAccessSettings = () => call<void>(Native.openFullDiskAccessSettings());

/**
 * Reads Safari's live bookmarks, history, Reading List and open tabs directly (no export).
 * Requires Full Disk Access — rejects with code "locked" otherwise. Passwords and payment
 * cards can't be read this way; use the export `.zip` (`importSafariExport`) for those.
 */
export const importSafariDirect = (options: Pick<ImportOptions, "signal"> = {}) =>
  job<SafariExport>(options, (jobId) => Native.importSafariDirect(jobId));

/** Any browser's "Export bookmarks" HTML (Netscape format). */
export const importBookmarksHTML = (path: string) => call<BookmarkNode>(Native.importBookmarksHTML(path));

/** A passwords CSV from Chrome, Edge, Safari, Firefox, Bitwarden, 1Password… */
export const importPasswordsCSV = (path: string) => call<Credential[]>(Native.importPasswordsCSV(path));

/** Open panel for the file-based imports. Resolves with a path, or null when cancelled. */
export const chooseImportFile = (kind: "safariExport" | "bookmarksHTML" | "passwordsCSV") => Native.chooseImportFile(kind);

/** Every link in a bookmark tree, depth-first — for Netnyahoo's flat bookmarks list. */
export function flattenBookmarks(node: BookmarkNode | undefined): { url: string; title: string }[] {
  if (!node) return [];
  if (node.type === "url") return node.url ? [{ url: node.url, title: node.title }] : [];
  return (node.children ?? []).flatMap(flattenBookmarks);
}

/** The folder that belongs on the bookmarks bar, if the source had one. */
export const toolbarFolder = (root: BookmarkNode | undefined) => root?.children?.find((c) => c.role === "toolbar");
