import type { Tab } from "./types";

// A name for a group nobody named, from its tabs' titles (Dia asks an AI; we read the titles). Sites put their
// name at one end of the title ("Home / X", "Rick Astley - YouTube", "GitHub - user/repo"): that's the site; the
// rest is the page. Tabs of one site on one page name the group "X Home", of one site "X". A tab still loading
// (no title) takes its site from a loaded tab of its host, else from the host itself.

type Member = Pick<Tab, "url" | "title">;

const SEPARATORS = [" / ", " | ", " - ", " — ", " – ", " · ", " • ", " :: "];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// "x.com" → "x", "news.ycombinator.com" → "ycombinator", "bbc.co.uk" → "bbc".
function hostLabel(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const second = parts.at(-2)!;
  return parts.length > 2 && second.length <= 3 && parts.at(-1)!.length <= 2 ? parts.at(-3)! : second;
}

const tidyHost = (host: string) => {
  const label = hostLabel(host);
  return label ? label[0]!.toUpperCase() + label.slice(1) : "";
};

// The title's two ends: [site candidate, page] pairs.
function ends(title: string): [string, string][] {
  const out: [string, string][] = [];
  for (const sep of SEPARATORS) {
    const last = title.lastIndexOf(sep);
    if (last > 0) out.push([title.slice(last + sep.length).trim(), title.slice(0, last).trim()]);
    const first = title.indexOf(sep);
    if (first > 0) out.push([title.slice(0, first).trim(), title.slice(first + sep.length).trim()]);
  }
  return out.filter(([site, page]) => site && page);
}

// The site name a host's titles agree on: the end that looks like the host, else one end all of them share.
function siteFromTitles(host: string, titles: string[]): string | undefined {
  const label = squash(hostLabel(host));
  const looksLikeHost = (site: string) => {
    const s = squash(site);
    return !!s && !!label && (s === label || (s.length >= 3 && (label.includes(s) || s.includes(label))));
  };
  for (const [site] of ends(titles[0]!)) if (site.split(" ").length <= 3 && looksLikeHost(site) && titles.every((t) => ends(t).some(([s]) => s === site))) return site;
  if (titles.length < 2) return undefined;
  for (const [site] of ends(titles[0]!)) if (titles.every((t) => ends(t).some(([s]) => s === site))) return site;
  return undefined;
}

function pageOf(title: string, site: string | undefined): string {
  if (!site) return title.trim();
  return ends(title).find(([s]) => s === site)?.[1] ?? title.trim();
}

export function autoGroupName(members: Member[]): string {
  if (!members.length) return "";
  const hosts = members.map((m) => hostOf(m.url));
  const titledByHost = new Map<string, string[]>();
  // The first tab with a title for each URL, for tabs of that URL still loading.
  const loadedByUrl = new Map<string, Member>();
  members.forEach((m, i) => {
    if (!m.title || m.title === m.url) return;
    const titles = titledByHost.get(hosts[i]!);
    if (titles) titles.push(m.title);
    else titledByHost.set(hosts[i]!, [m.title]);
    if (!loadedByUrl.has(m.url)) loadedByUrl.set(m.url, m);
  });
  const siteOfHost = new Map<string, string>();
  for (const host of new Set(hosts)) {
    const titles = titledByHost.get(host);
    const site = titles ? siteFromTitles(host, titles) : undefined;
    siteOfHost.set(host, site ?? tidyHost(host));
  }
  const sites = hosts.map((h) => siteOfHost.get(h) || "");
  const site = sites[0]!;
  if (!site || sites.some((s) => s !== site)) return site || (members[0]!.title ?? "");
  // One site: add the page when every tab is on the same one (a loading tab counts if a loaded one has its URL).
  const siteInTitles = members.some((m) => m.title && pageOf(m.title, site) !== m.title.trim()) ? site : undefined;
  const pages = members.map((m) => {
    const loaded = m.title && m.title !== m.url ? m : loadedByUrl.get(m.url);
    return loaded ? pageOf(loaded.title, siteInTitles) : undefined;
  });
  const page = pages[0];
  if (!siteInTitles || !page || pages.some((p) => p !== page) || squash(page) === squash(site)) return site;
  return `${site} ${page}`;
}
