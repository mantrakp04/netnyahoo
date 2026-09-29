import { appUrlOrigin, toAppUrl } from "./appUrls.ts";
import { cleanUrl } from "./cleanUrl.ts";
import { displayHost } from "./idn.ts";

export const SEARCH_URL = "https://www.google.com/search?q=";

// RN's URL polyfill never throws; keep parsing regex-based.
export type ParsedUrl = { scheme: string; host: string; port: string; path: string; query: string; hash: string };

const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i;

export function parseUrl(url: string): ParsedUrl | null {
  const m = URL_PARTS.exec(url.trim());
  if (!m) return null;
  return { scheme: m[1]!.toLowerCase(), host: m[2]!.toLowerCase(), port: m[3] ?? "", path: m[4] ?? "", query: m[5] ?? "", hash: m[6] ?? "" };
}

export function hostOf(url: string): string {
  return (parseUrl(url)?.host ?? "").replace(/^www\./, "");
}

const KNOWN_SCHEMES = new Set([
  "http", "https", "file", "about", "data", "blob", "mailto", "tel", "sms", "facetime", "ftp", "view-source",
  "netnyahoo", "chrome", "chrome-extension", "devtools", "x-apple.systempreferences", "itms-apps", "slack", "zoommtg", "vscode",
  "cursor", "notion", "figma", "spotify", "linear", "obsidian", "raycast",
]);

const KNOWN_TLDS = new Set(
  (
    "com net org edu gov mil int info biz name pro mobi app dev io ai co me tv cc gg sh fm ly so to xyz online site tech store " +
    "blog shop cloud page news live art design studio agency media digital network systems solutions services software " +
    "email chat social link click space website world today life fun games game zone wiki tools codes run build host " +
    "rocks ninja guru expert academy school university health care money finance bank capital fund law legal travel " +
    "photos photo pics gallery video music film movie radio audio events social group team community church city " +
    "london nyc paris berlin tokyo africa asia eu aero coop museum jobs cat post tel travel moe onl one top vip win " +
    "work works company business center global plus inc ltd llc gmbh srl cafe restaurant pizza bar pub coffee wine beer " +
    "fashion style shoes clothing jewelry watch camera computer phone mobile download security domains hosting " +
    "google youtube gmail android chrome amazon apple microsoft windows office azure aws netflix meta search " +
    "local localhost test internal lan arpa onion " +
    "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc " +
    "cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga " +
    "gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp " +
    "ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms " +
    "mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro " +
    "rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt " +
    "tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw"
  ).split(" "),
);

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.startsWith("[") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    /\.(local|localhost|test|internal|lan|home\.arpa)$/.test(host)
  );
}

const HOST = /^(localhost|\[[0-9a-f:.]+\]|(\d{1,3}\.){3}\d{1,3}|([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z][a-z0-9-]*[a-z0-9]|xn--[a-z0-9-]+))\.?(:\d{1,5})?(?=[/?#]|$)/i;

export function fixupUrl(raw: string): string | null {
  const url = fixup(raw);
  return url && toAppUrl(url);
}

function fixup(raw: string): string | null {
  const input = raw.trim();
  if (!input || (/\s/.test(input) && !/^([a-z][a-z0-9+.-]*:\/\/|\/[^\s/])/i.test(input))) return null;
  if (/^(about|data|mailto|tel|sms|facetime|view-source):/i.test(input)) return input;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase();
  if (scheme && KNOWN_SCHEMES.has(scheme) && (input.slice(scheme.length + 1).startsWith("//") || !/^\d/.test(input.slice(scheme.length + 1)))) {
    return scheme + input.slice(scheme.length).replace(/\s/g, "%20");
  }
  if (scheme && !KNOWN_SCHEMES.has(scheme) && input.slice(scheme.length + 1).startsWith("//")) return input;
  if (input.startsWith("/") && !input.startsWith("//")) return `file://${input.replace(/\s/g, "%20")}`;

  const host = HOST.exec(input);
  if (!host) return null;
  const name = host[1]!.toLowerCase().replace(/\.$/, "");
  const tld = name.includes(".") && !/^[\d.]+$/.test(name) && !name.startsWith("[") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const rest = input.slice(host[0].length);
  const explicit = !!host[5] || rest.length > 0;
  if (tld && !KNOWN_TLDS.has(tld) && !tld.startsWith("xn--") && !explicit) return null;
  return `${isLocalHost(name) ? "http" : "https"}://${input}`;
}

export function searchUrlFor(template: string, query: string): string {
  const q = encodeURIComponent(query.trim());
  return template.includes("%s") ? template.replace(/%s/g, q) : template + q;
}

export function resolveInput(raw: string, search = SEARCH_URL): string {
  const input = raw.trim();
  if (!input) return "";
  if (input.startsWith("?")) return input.length > 1 ? searchUrlFor(search, input.slice(1)) : "";
  return fixupUrl(input) ?? searchUrlFor(search, input);
}

export type PasteAction = { kind: "go"; url: string } | { kind: "search"; query: string };

export function classifyPaste(text: string): PasteAction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const url = /\s/.test(trimmed) ? null : fixupUrl(trimmed);
  if (url && !/^(about|data):/i.test(url)) return { kind: "go", url: cleanUrl(url) };
  return { kind: "search", query: trimmed.replace(/\s+/g, " ").slice(0, 2000) };
}

export function breadcrumb(url: string, title?: string): { host: string; trail: string[] } {
  const parsed = parseUrl(url);
  const app = appUrlOrigin(url);
  const host = app ?? (parsed ? displayHost(parsed.host).replace(/^www\./, "") : url);
  const seen = new Set([host.toLowerCase(), ...(app && parsed ? [parsed.host] : [])]);
  const trail = (title ?? "")
    .split(/\s[|/·–—-]\s/)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { host, trail };
}

export function urlForDisplay(url: string): string {
  if (appUrlOrigin(url)) return toAppUrl(url).replace(/^([^/]*\/\/[^/?#]*)\/(?=[?#]|$)/, "$1");
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = /^[^/?#:]*/.exec(rest)![0];
  return (displayHost(host) + rest.slice(host.length)).replace(/^www\./i, "");
}
