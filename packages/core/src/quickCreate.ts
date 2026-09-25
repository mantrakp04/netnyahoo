/**
 * Dia's "new …" commands: type "new doc", "new sheet", "new jira"… to create a document or
 * ticket. Each opens the service's `.new` shortcut URL (the list Dia's NewDocumentSuggestionProvider uses).
 */
export type QuickCreate = {
  id: string;
  title: string;
  url: string;
  /** Words that follow "new" / "create", best first. */
  aliases: readonly string[];
  /** The service's own site (the `.new` domains have no favicons). */
  site: string;
};

export const QUICK_CREATE: readonly QuickCreate[] = [
  { id: "doc", title: "New Google Doc", url: "https://docs.new", aliases: ["doc", "docs", "document", "google doc", "gdoc"], site: "docs.google.com" },
  { id: "sheet", title: "New Google Sheet", url: "https://sheets.new", aliases: ["sheet", "sheets", "spreadsheet", "google sheet"], site: "sheets.google.com" },
  { id: "slides", title: "New Google Slides", url: "https://slides.new", aliases: ["slides", "slide", "presentation", "deck", "google slides"], site: "slides.google.com" },
  { id: "form", title: "New Google Form", url: "https://forms.new", aliases: ["form", "forms", "survey", "google form"], site: "forms.google.com" },
  { id: "meeting", title: "New Google Calendar Event", url: "https://meeting.new", aliases: ["meeting", "event", "calendar", "invite"], site: "calendar.google.com" },
  { id: "meet", title: "New Google Meet", url: "https://meet.new", aliases: ["meet", "call", "video call", "google meet"], site: "meet.google.com" },
  { id: "notion", title: "New Notion Page", url: "https://notion.new", aliases: ["notion", "note", "page", "notion page"], site: "notion.so" },
  { id: "linear", title: "New Linear Issue", url: "https://linear.new", aliases: ["linear", "issue", "ticket", "linear issue"], site: "linear.app" },
  { id: "jira", title: "New Jira Issue", url: "https://jira.new", aliases: ["jira", "ticket", "issue", "jira issue"], site: "atlassian.com" },
  { id: "confluence", title: "New Confluence Page", url: "https://confluence.new", aliases: ["wiki", "confluence", "confluence page"], site: "atlassian.com" },
  { id: "gist", title: "New GitHub Gist", url: "https://gist.new", aliases: ["gist", "snippet", "github gist"], site: "github.com" },
  { id: "repo", title: "New GitHub Repository", url: "https://repo.new", aliases: ["repo", "repository", "github repo"], site: "github.com" },
  { id: "figma", title: "New Figma Design", url: "https://figma.new", aliases: ["figma", "design", "figma design"], site: "figma.com" },
  { id: "figjam", title: "New FigJam Board", url: "https://figjam.new", aliases: ["figjam", "whiteboard", "board"], site: "figma.com" },
  { id: "word", title: "New Word Document", url: "https://word.new", aliases: ["word", "word document"], site: "word.cloud.microsoft" },
  { id: "excel", title: "New Excel Workbook", url: "https://excel.new", aliases: ["excel", "workbook"], site: "excel.cloud.microsoft" },
  { id: "powerpoint", title: "New PowerPoint Presentation", url: "https://powerpoint.new", aliases: ["powerpoint", "ppt"], site: "powerpoint.cloud.microsoft" },
];

/**
 * Commands for "new …" / "create …" input. "new " alone lists the first few; otherwise every
 * command with an alias starting with what follows, exact aliases first.
 */
export function matchQuickCreate(query: string, limit = 3): QuickCreate[] {
  const m = /^(?:new|create)(\s+(.*))?$/i.exec(query.trimStart());
  if (!m || !m[1]) return [];
  const rest = (m[2] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!rest) return QUICK_CREATE.slice(0, limit);
  // Exact aliases first, then prefixes; ties keep the list order.
  const rank = (c: QuickCreate) => (c.aliases.includes(rest) ? 0 : c.aliases.some((a) => a.startsWith(rest)) ? 1 : Infinity);
  return QUICK_CREATE.map((c, order) => ({ c, r: rank(c), order }))
    .filter((x) => x.r !== Infinity)
    .sort((a, b) => a.r - b.r || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.c);
}
