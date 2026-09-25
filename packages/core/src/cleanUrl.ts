/**
 * "Copy clean link": drops tracking parameters from a URL, like Dia's Copy URL
 * ("without any trackers"). Only the query is touched; the rest of the URL,
 * the order of the remaining parameters and their encoding stay as they were.
 */

/** Parameters that only ever carry click/campaign tracking, on any site. */
const GLOBAL_PARAMS = new Set([
  // Google Ads / Analytics
  "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "_ga", "_gl", "srsltid",
  // Meta, Microsoft, Twitter, TikTok, LinkedIn, Yandex, Reddit, Pinterest
  "fbclid", "igshid", "msclkid", "twclid", "ttclid", "li_fat_id", "yclid", "ysclid", "rdt_cid", "epik",
  // Mailchimp, HubSpot, Marketo, Oracle Eloqua, Vero, Klaviyo, Drip
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking", "mkt_tok", "elqtrackid",
  "elqtrack", "vero_id", "vero_conv", "_kx", "__s",
  // Assorted ad networks and newsletters
  "oly_anon_id", "oly_enc_id", "_openstat", "wickedid", "rb_clickid", "s_cid", "irclickid", "cjevent", "sscid",
  "zanpid", "ranmid", "raneaid", "ransiteid", "trk_contact", "trk_msg", "trk_module", "trk_sid",
]);

/** Parameter-name prefixes that are always tracking (utm_source, utm_medium…). */
const GLOBAL_PREFIXES = ["utm_", "pk_", "mtm_", "piwik_", "matomo_", "hsa_", "stm_"];

/** Tracking parameters that are only safe to drop on specific sites. */
const SITE_PARAMS: { hosts: string[]; params: string[]; prefixes?: string[] }[] = [
  { hosts: ["youtube.com", "youtu.be", "music.youtube.com"], params: ["si", "pp", "feature"] },
  { hosts: ["open.spotify.com"], params: ["si", "nd", "context"] },
  { hosts: ["instagram.com"], params: ["igsh", "img_index"] },
  { hosts: ["x.com", "twitter.com"], params: ["s", "t", "ref_src", "ref_url"] },
  { hosts: ["threads.net", "threads.com"], params: ["xmt", "slof"] },
  { hosts: ["tiktok.com"], params: ["is_from_webapp", "sender_device", "sender_web_id", "_r", "_t"] },
  { hosts: ["linkedin.com"], params: ["trk", "trackingid", "lipi", "midtoken", "midsig", "trkemail", "eid"] },
  { hosts: ["reddit.com"], params: ["share_id", "ref_source", "ref_campaign"] },
  { hosts: ["medium.com"], params: ["source"] },
  { hosts: ["facebook.com"], params: ["mibextid", "sfnsn", "rdid", "share_url"] },
  {
    hosts: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.it", "amazon.es", "amazon.ca", "amazon.co.jp", "amazon.in", "amazon.com.au"],
    params: ["_encoding", "psc", "ref", "ref_", "tag", "linkcode", "linkid", "camp", "creative", "creativeasin", "content-id", "crid", "sprefix", "qid", "sr", "dib", "dib_tag"],
    prefixes: ["pd_rd_", "pf_rd_"],
  },
];

function siteRules(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return SITE_PARAMS.filter((r) => r.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** Whether a query parameter name is tracking on this host. */
export function isTrackingParam(name: string, hostname = ""): boolean {
  const key = name.toLowerCase();
  if (GLOBAL_PARAMS.has(key) || GLOBAL_PREFIXES.some((p) => key.startsWith(p))) return true;
  return siteRules(hostname).some((r) => r.params.includes(key) || r.prefixes?.some((p) => key.startsWith(p)));
}

/** `url` without its tracking parameters (unchanged if it has none or doesn't parse). */
export function cleanUrl(url: string): string {
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match?.[2]) return url;
  let hostname = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    hostname = parsed.hostname;
  } catch {
    return url;
  }
  const [, base = "", query = "", hash = ""] = match;
  const pairs = query.slice(1).split("&");
  const kept = pairs.filter((pair) => pair && !isTrackingParam(decodeName(pair.split("=")[0]!), hostname));
  if (kept.length === pairs.length) return url;
  return `${base}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

/** True when `cleanUrl` would change the URL. */
export const hasTrackingParams = (url: string) => cleanUrl(url) !== url;

/**
 * `[title](url)` for Copy Link as Markdown, with the URL cleaned like every Copy URL
 * (brackets in the title escaped).
 */
export function markdownLink(title: string, url: string): string {
  return `[${(title || url).replace(/([[\]])/g, "\\$1")}](${cleanUrl(url)})`;
}
