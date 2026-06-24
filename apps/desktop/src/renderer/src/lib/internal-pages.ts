export const INTERNAL_PAGE_URLS = {
  history: "netnyahoo://history",
  bookmarks: "netnyahoo://bookmarks",
  extensions: "netnyahoo://extensions",
  keybinds: "netnyahoo://keybinds",
} as const;

export type InternalPage = keyof typeof INTERNAL_PAGE_URLS;

const inputAliases: Record<string, InternalPage> = {
  "/history": "history",
  history: "history",
  "netnyahoo:history": "history",
  "netnyahoo://history": "history",
  "/bookmarks": "bookmarks",
  bookmarks: "bookmarks",
  "netnyahoo:bookmarks": "bookmarks",
  "netnyahoo://bookmarks": "bookmarks",
  "/extensions": "extensions",
  extensions: "extensions",
  extension: "extensions",
  "netnyahoo:extensions": "extensions",
  "netnyahoo://extensions": "extensions",
  "/keybinds": "keybinds",
  keybinds: "keybinds",
  shortcuts: "keybinds",
  "/shortcuts": "keybinds",
  "keyboard shortcuts": "keybinds",
  "netnyahoo:keybinds": "keybinds",
  "netnyahoo://keybinds": "keybinds",
};

export function getInternalPage(url: string | null | undefined): InternalPage | null {
  const value = normalizeInternalValue(url);
  return inputAliases[value] ?? null;
}

export function getInternalPageUrlForInput(
  input: string | null | undefined,
): string | null {
  const page = getInternalPage(input);
  return page ? INTERNAL_PAGE_URLS[page] : null;
}

export function isInternalPageUrl(url: string | null | undefined): boolean {
  return getInternalPage(url) !== null;
}

export function getInternalPageTitle(page: InternalPage): string {
  return internalPageTitles[page];
}

function normalizeInternalValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

const internalPageTitles = {
  history: "History",
  bookmarks: "Bookmarks",
  extensions: "Extensions",
  keybinds: "Keybinds",
} satisfies Record<InternalPage, string>;
