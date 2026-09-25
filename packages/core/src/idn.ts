/**
 * Internationalized host names for display, after Chrome's IDN policy
 * (components/url_formatter/spoof_checks/idn_spoof_checker.cc): an `xn--` label
 * is shown in Unicode only when it passes the spoof checks, otherwise it stays
 * punycode. Everything that navigates or matches keeps the ASCII form; this is
 * display only.
 *
 * The checks, in Chrome's order:
 * 1. ICU's spoof checks: every character is allowed in identifiers (UTS 39),
 *    no invisible repeats of a combining mark, one decimal digit system, and
 *    at most "moderately restrictive" script mixing (Latin plus one other
 *    script, but never Latin with Cyrillic or Greek).
 * 2. Deviation characters (ß, ς, ZWJ, ZWNJ) stay punycode.
 * 3. TLD-specific letters: þ/ð only under .is, ə only under .az, the middle
 *    dot only between two l's under .cat.
 * 4. Labels made of digits and digit lookalikes (з, ৪…).
 * 5. Single-script labels are safe unless they're whole-script confusable with
 *    Latin (аррӏе in Cyrillic) under a TLD that doesn't use that script.
 * 6. Non-ASCII Latin mixed with another script, and Chrome's dangerous
 *    patterns (kana that look like slashes or dashes, dot-above after i/j/l…).
 * 7. For the whole host: a skeleton that matches a top domain's (gõõgle.com vs
 *    google.com) keeps the host in punycode.
 */

// MARK: Punycode (RFC 3492)

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;

function adapt(delta: number, points: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - T_MIN));
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

const digitValue = (c: number) => (c >= 0x30 && c <= 0x39 ? c - 22 : c >= 0x41 && c <= 0x5a ? c - 0x41 : c >= 0x61 && c <= 0x7a ? c - 0x61 : BASE);
const digitChar = (d: number) => String.fromCharCode(d < 26 ? d + 0x61 : d + 22);

/** The Unicode form of a punycode string (without the `xn--` prefix); null when it's malformed. */
export function punycodeDecode(input: string): string | null {
  const output: number[] = [];
  const delimiter = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(delimiter, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    output.push(c);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length; ) {
    const oldI = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((MAX_CODE_POINT - i) / w)) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const points = output.length + 1;
    bias = adapt(i - oldI, points, oldI === 0);
    n += Math.floor(i / points);
    i %= points;
    if (n > MAX_CODE_POINT || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** The punycode form of a string (without the `xn--` prefix). */
export function punycodeEncode(input: string): string {
  const points = Array.from(input, (c) => c.codePointAt(0)!);
  let output = points.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join("");
  const basic = output.length;
  let handled = basic;
  if (basic) output += "-";
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < points.length) {
    const m = Math.min(...points.filter((c) => c >= n));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of points) {
      if (c < n) delta++;
      if (c !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
        if (q < t) break;
        output += digitChar(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digitChar(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
}

// MARK: Characters and scripts

/** UTS 39's Recommended scripts (Table 5), the ones allowed in identifiers. */
const SCRIPTS = [
  "Latin", "Greek", "Cyrillic", "Armenian", "Hebrew", "Arabic", "Thaana", "Devanagari", "Bengali", "Gurmukhi",
  "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai", "Lao", "Tibetan", "Myanmar",
  "Georgian", "Hangul", "Ethiopic", "Khmer", "Hiragana", "Katakana", "Bopomofo", "Han",
] as const;
type Script = (typeof SCRIPTS)[number];
/**
 * `\p{Script_Extensions=…}` for a regex source, or `\p{Script=…}` where the engine has
 * no extensions data for the script (Hermes lacks it for Armenian, Hebrew, Thai…).
 */
function scx(name: string): string {
  try {
    new RegExp(`\\p{Script_Extensions=${name}}`, "u");
    return `\\p{Script_Extensions=${name}}`;
  } catch {
    return `\\p{Script=${name}}`;
  }
}
const SCRIPT_TESTS = SCRIPTS.map((name) => [name, new RegExp(scx(name), "u")] as const);
const COMMON = /[\p{Script=Common}\p{Script=Inherited}]/u;

/**
 * Letters, marks and digits of the Recommended scripts, minus what UTS 39 marks as
 * technical, obsolete or uncommon (IPA, modifier letters, most of Latin
 * Extended-B, archaic Greek…), what IDNA maps away (upper case, compatibility
 * forms) and combining marks outside the few Chrome allows.
 */
const IDENTIFIER = /^[\p{Ll}\p{Lo}\p{Lm}\p{Mn}\p{Mc}\p{Nd}-]$/u;
const EXCLUDED = new RegExp(
  "[" +
    "\\u0138\\u0149\\u017f\\u01c4-\\u01cc\\u01dd\\u0180-\\u019f\\u01a2-\\u01ae\\u01b1-\\u01cc\\u01f1-\\u01f3\\u01f6\\u01f7" +
    "\\u021c\\u021d\\u0220-\\u0225\\u0234-\\u024f" + // Latin Extended-B outside Recommended
    "\\u0250-\\u0258\\u025a-\\u02ff" + // IPA and modifier letters (ə U+0259 stays: Azerbaijani)
    "\\u0305\\u030d\\u030e\\u0310\\u0312\\u0315-\\u031a\\u031c-\\u0322\\u0329-\\u032c\\u032f\\u0332-\\u0334\\u0336\\u0337\\u033a-\\u036f" +
    "\\u0370-\\u038f\\u03cf-\\u03ff\\u1f00-\\u1fff" + // archaic / polytonic Greek
    "\\u0482-\\u0489" + // Cyrillic signs
    "\\u1d00-\\u1dbf\\u1dc0-\\u1dff\\u2c60-\\u2c7f\\ua720-\\ua7ff\\uab30-\\uab6f" + // phonetic and Latin extensions
    "\\u10a0-\\u10cf\\u1c90-\\u1cbf" + // Georgian capitals
    "\\u0964\\u0965\\u0970\\u0e2f\\u0e46\\u0eaf\\u0ec6\\u0f01-\\u0f1f\\u0f2a-\\u0f3f\\u104a-\\u104f\\u17d4-\\u17d6\\u17d8-\\u17db" +
    "\\u3031-\\u3035\\u303b\\u303c\\u3099\\u309a\\u309b\\u309c\\u309f\\u30a0\\u30ff\\u3131-\\u318e" +
    "]",
  "u",
);
/** Common characters Chrome allows anyway. */
const ALLOWED_COMMON = /^[-\u00b7\u30fb\u30fc\u3005-\u3007\u0300-\u0304\u0306-\u030c\u030f\u0311\u0313\u0314\u031b\u0323-\u0328\u032d\u032e\u0330\u0331\u0335\u0338\u0339]$/u;

function isAllowed(c: string): boolean {
  if (ALLOWED_COMMON.test(c)) return true;
  if (!IDENTIFIER.test(c) || EXCLUDED.test(c)) return false;
  if (c.normalize("NFKC") !== c || c.toLowerCase() !== c) return false;
  return scriptsOf(c) !== null;
}

/** A character's Recommended scripts; empty for Common/Inherited ones; null when it has none. */
function scriptsOf(c: string): Script[] | null {
  const scripts = SCRIPT_TESTS.filter(([, re]) => re.test(c)).map(([name]) => name);
  if (scripts.length) return scripts;
  return COMMON.test(c) ? [] : null;
}

/** UTS 39's augmented script sets: CJK scripts also count as their writing systems. */
function augmented(scripts: Script[]): Set<string> {
  const set = new Set<string>(scripts);
  if (set.has("Han")) ["Hanb", "Jpan", "Kore"].forEach((s) => set.add(s));
  if (set.has("Hiragana") || set.has("Katakana")) set.add("Jpan");
  if (set.has("Hangul")) set.add("Kore");
  if (set.has("Bopomofo")) set.add("Hanb");
  return set;
}

type Restriction = "ascii" | "single" | "highly" | "moderately" | "minimal";

/** UTS 39 §5.2 restriction level. */
function restrictionLevel(chars: string[]): Restriction {
  if (chars.every((c) => c.charCodeAt(0) < 0x80)) return "ascii";
  const sets = chars.map((c) => augmented(scriptsOf(c) ?? [])).filter((s) => s.size);
  const intersect = (list: Set<string>[]) => list.reduce<Set<string> | null>((acc, s) => (acc ? new Set([...acc].filter((x) => s.has(x))) : new Set(s)), null);
  const all = intersect(sets);
  if (!all || all.size) return "single";
  const nonLatin = intersect(sets.filter((s) => !s.has("Latin")));
  if (!nonLatin || !nonLatin.size) return "minimal";
  if (["Hanb", "Jpan", "Kore"].some((s) => nonLatin.has(s))) return "highly";
  if (!nonLatin.has("Cyrillic") && !nonLatin.has("Greek")) return "moderately";
  return "minimal";
}

/** Decimal digit systems used (U+0030, U+0660, U+06F0…: each block's zero). */
function digitSystems(chars: string[]): Set<number> {
  const zeros = new Set<number>();
  for (const c of chars) {
    if (!/\p{Nd}/u.test(c)) continue;
    const cp = c.codePointAt(0)!;
    // Decimal digits come in runs of ten starting at a code point ending in 0 or 6.
    let zero = cp;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1)) && cp - zero < 9) zero--;
    zeros.add(zero);
  }
  return zeros;
}

// MARK: Chrome's extra checks

const DEVIATIONS = /[\u00df\u03c2\u200c\u200d]/u;
const DIGIT_LOOKALIKES = /[θ२২੨૨೩೭Շзҙӡउওਤ੩૩౩ဒვპ੫丩ㄐճ৪੪୫૭୨౨]/u;
const KANA_EXCEPTIONS = /[\u3078-\u307a\u30d8-\u30da\u30fb-\u30fe]/u;
const COMBINING_DIACRITICS = /[\u0300-\u0339]/u;
const NON_ASCII_LATIN = /(?![a-z])\p{Script=Latin}/u;
const LGC_OR_ASCII = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}0-9._\u0300-\u0339-]*$/u;

/**
 * Letters of a script that look like Latin ones: a label written only with
 * those is a whole-script confusable, allowed only under these TLDs or a TLD
 * written in the script itself (.рф).
 */
const WHOLE_SCRIPT_CONFUSABLES: { script: RegExp; lookalikes: RegExp; tlds: string[] }[] = [
  { script: /\p{Script=Armenian}/u, lookalikes: /[ագզէլհյնոսւօՙ]/u, tlds: ["am"] },
  { script: /\p{Script=Cyrillic}/u, lookalikes: /[асԁеһіјӏорԗԛѕԝхуъЬҽпгѵѡ]/u, tlds: ["bg", "by", "kz", "pyc", "ru", "su", "ua", "uz"] },
  { script: /\p{Script=Ethiopic}/u, lookalikes: /[ሀሁሃሠሡሰሱሲቀቁበቡነኑኒከኮዐዑዕዖፀፁፐ]/u, tlds: ["er", "et"] },
  { script: /\p{Script=Georgian}/u, lookalikes: /[იოყჽ]/u, tlds: ["ge"] },
  { script: /\p{Script=Greek}/u, lookalikes: /[αικνρυωϲοτχ]/u, tlds: ["gr"] },
  { script: /\p{Script=Hebrew}/u, lookalikes: /[דוחיןסם]/u, tlds: ["il"] },
  { script: /\p{Script=Khmer}/u, lookalikes: /[ឧ]/u, tlds: ["kh"] },
  { script: /\p{Script=Lao}/u, lookalikes: /[ບປຍຮຣຨຫອພຟຝ໐]/u, tlds: ["la"] },
  { script: /\p{Script=Sinhala}/u, lookalikes: /[ථ]/u, tlds: ["lk"] },
  { script: /\p{Script=Thai}/u, lookalikes: /[ทนบพรหเแ๐ดลปฟม]/u, tlds: ["th"] },
];

/**
 * Chrome's "dangerous patterns": kana that pass for slashes or dashes next to
 * other scripts, look-alike kana inside the other kana script, marks after a
 * non-LGC letter or on a dotless i, dot above on i/j/l, Armenian o/co next to
 * Latin and Latin o/g next to Armenian, and a few more. (Its Canadian
 * Syllabics and Tifinagh rules are covered by those scripts not being allowed
 * at all; Hermes doesn't know their property names either.)
 */
const DANGEROUS = new RegExp(
  [
    `[^${scx("Katakana")}${scx("Hiragana")}${scx("Han")}][\\u30ce\\u30f3\\u30bd\\u30be\\u4e36\\u4e40\\u4e41\\u4e3f]`,
    `[\\u30ce\\u30f3\\u30bd\\u30be\\u4e36\\u4e40\\u4e41\\u4e3f][^${scx("Katakana")}${scx("Hiragana")}${scx("Han")}]`,
    `^[${scx("Katakana")}]+[\\u3078-\\u307a][${scx("Katakana")}]+$`,
    `^[${scx("Hiragana")}]+[\\u30d8-\\u30da][${scx("Hiragana")}]+$`,
    `[^${scx("Katakana")}${scx("Hiragana")}]\\u30fc|^\\u30fc`,
    `[^${scx("Katakana")}][\\u30fd\\u30fe]|^[\\u30fd\\u30fe]`,
    "[a-z]\\u30fb|\\u30fb[a-z]",
    `[^${scx("Han")}]\\u4e00|\\u4e00[^${scx("Han")}]`,
    `[^${scx("Bopomofo")}]\\u3127|\\u3127[^${scx("Bopomofo")}]`,
    `[^${scx("Latin")}${scx("Greek")}${scx("Cyrillic")}][\\u0300-\\u0339]`,
    "\\u0131[\\u0300-\\u0339]",
    "[ijl\\u0131]\\u0307",
    "[a-z][\\u0585\\u0581]|[\\u0585\\u0581][a-z]",
    `[${scx("Armenian")}][og]|[og][${scx("Armenian")}]`,
    `[^${scx("Arabic")}][\\u064b-\\u0652\\u0670]`,
    `[^${scx("Hebrew")}]\\u05b4`,
  ].join("|"),
  "u",
);

export type SpoofReason =
  | "invalid"
  | "disallowedCharacter"
  | "invisible"
  | "mixedNumbers"
  | "mixedScripts"
  | "deviationCharacter"
  | "tldSpecificCharacter"
  | "unsafeMiddleDot"
  | "digitLookalikes"
  | "wholeScriptConfusable"
  | "nonAsciiLatinMixed"
  | "dangerousPattern"
  | "topDomainLookalike";

/**
 * Why a decoded label mustn't be shown in Unicode, or null when it's safe.
 * `tld` is the host's last label as it appears in the URL (ASCII, lower case).
 */
export function labelSpoofReason(label: string, tld: string): SpoofReason | null {
  const chars = Array.from(label);
  if (!chars.length) return "invalid";
  if (!chars.every(isAllowed)) return "disallowedCharacter";
  for (let i = 1; i < chars.length; i++) if (chars[i] === chars[i - 1] && /\p{M}/u.test(chars[i]!)) return "invisible";
  if (digitSystems(chars).size > 1) return "mixedNumbers";
  const level = restrictionLevel(chars);
  if (level === "minimal") return "mixedScripts";
  if (DEVIATIONS.test(label)) return "deviationCharacter";
  if (chars.length > 1 && tld !== "is" && /[þð]/u.test(label)) return "tldSpecificCharacter";
  if (chars.length > 1 && tld !== "az" && label.includes("ə")) return "tldSpecificCharacter";
  if (label.includes("·") && (tld !== "cat" || /[^l]·|·[^l]|^·|·$/u.test(label))) return "unsafeMiddleDot";
  if (level === "ascii") return null;
  if (DIGIT_LOOKALIKES.test(label) && chars.every((c) => /[0-9]/.test(c) || DIGIT_LOOKALIKES.test(c))) return "digitLookalikes";
  if (level === "single" && !KANA_EXCEPTIONS.test(label) && !COMBINING_DIACRITICS.test(label)) {
    const unicodeTld = decodeLabel(tld) ?? tld;
    for (const { script, lookalikes, tlds } of WHOLE_SCRIPT_CONFUSABLES) {
      const letters = chars.filter((c) => script.test(c));
      if (!letters.length || !letters.every((c) => lookalikes.test(c))) continue;
      const tldUsesScript = Array.from(unicodeTld).every((c) => script.test(c));
      if (!tlds.includes(tld) && !tldUsesScript) return "wholeScriptConfusable";
    }
    return null;
  }
  if (NON_ASCII_LATIN.test(label) && !LGC_OR_ASCII.test(label)) return "nonAsciiLatinMixed";
  if (DANGEROUS.test(label)) return "dangerousPattern";
  return null;
}

/** An `xn--` label's canonical Unicode form, or null (not punycode, malformed, or not what IDNA would produce). */
function decodeLabel(label: string): string | null {
  if (!/^xn--/i.test(label)) return null;
  const ascii = label.slice(4).toLowerCase();
  const unicode = punycodeDecode(ascii);
  if (!unicode || /^[\x00-\x7f]*$/.test(unicode)) return null;
  // Non-canonical encodings (upper case, unnormalized, or a different encoder's output) stay punycode.
  if (unicode.normalize("NFC") !== unicode || unicode.toLowerCase() !== unicode || punycodeEncode(unicode) !== ascii) return null;
  return unicode;
}

// MARK: Top domains

/**
 * Popular domains whose look-alikes stay punycode (Chrome ships a much longer
 * list; this covers the usual phishing targets).
 */
const TOP_DOMAINS = (
  "google.com youtube.com facebook.com instagram.com twitter.com x.com whatsapp.com wikipedia.org amazon.com " +
  "apple.com icloud.com microsoft.com live.com outlook.com office.com bing.com linkedin.com netflix.com yahoo.com " +
  "reddit.com tiktok.com github.com gitlab.com paypal.com ebay.com dropbox.com adobe.com spotify.com twitch.tv " +
  "discord.com slack.com zoom.us notion.so figma.com openai.com chatgpt.com anthropic.com claude.ai stripe.com " +
  "shopify.com coinbase.com binance.com kraken.com blockchain.com metamask.io chase.com bankofamerica.com " +
  "wellsfargo.com citi.com americanexpress.com capitalone.com hsbc.com barclays.co.uk santander.com revolut.com " +
  "wise.com venmo.com cash.app booking.com airbnb.com expedia.com uber.com lyft.com doordash.com walmart.com " +
  "target.com bestbuy.com costco.com etsy.com aliexpress.com alibaba.com temu.com shein.com baidu.com qq.com " +
  "weibo.com yandex.ru vk.com mail.ru ok.ru naver.com kakao.com line.me rakuten.co.jp yahoo.co.jp amazon.co.jp " +
  "amazon.co.uk amazon.de amazon.fr amazon.in bbc.co.uk bbc.com cnn.com nytimes.com theguardian.com " +
  "washingtonpost.com wsj.com bloomberg.com reuters.com forbes.com medium.com substack.com wordpress.com " +
  "blogger.com tumblr.com pinterest.com quora.com stackoverflow.com imdb.com steampowered.com steamcommunity.com " +
  "epicgames.com roblox.com playstation.com xbox.com nintendo.com ea.com battle.net salesforce.com atlassian.com " +
  "trello.com asana.com canva.com docusign.com okta.com cloudflare.com godaddy.com squarespace.com wix.com " +
  "mozilla.org duckduckgo.com proton.me protonmail.com gmail.com googledrive.com fedex.com ups.com usps.com dhl.com " +
  "irs.gov gov.uk"
).split(" ");

/** Skeleton for look-alike comparison: marks stripped, confusable letters folded to Latin. */
const CONFUSABLES: Record<string, string> = {
  ø: "o", đ: "d", ħ: "h", ı: "i", ł: "l", ŧ: "t", ð: "d", þ: "p", ə: "e", ß: "ss", œ: "oe", æ: "ae",
  а: "a", в: "b", е: "e", з: "3", и: "u", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y",
  х: "x", ь: "b", ѕ: "s", і: "i", ј: "j", ԁ: "d", һ: "h", ӏ: "l", ԛ: "q", ԝ: "w", ҽ: "e", ѵ: "v", ѡ: "w", г: "r",
  α: "a", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w", ϲ: "c",
  օ: "o", ս: "u", հ: "h", ց: "g", ք: "p", զ: "q", ո: "n",
  "0": "o", "1": "l", m: "rn", w: "vv",
};

function skeleton(text: string): string {
  return Array.from(text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), (c) => CONFUSABLES[c] ?? c).join("");
}

let topSkeletons: Map<string, string> | null = null;

/** The top domain `host` imitates (not counting the domain itself), or null. */
export function similarTopDomain(host: string): string | null {
  topSkeletons ??= new Map(TOP_DOMAINS.map((d) => [skeleton(d), d]));
  const bare = host.replace(/^www\./, "").replace(/\.$/, "");
  const labels = bare.split(".");
  // The whole host and its registrable part (sub.gõõgle.com imitates google.com too).
  for (const candidate of [bare, labels.slice(-2).join("."), labels.slice(-3).join(".")]) {
    const match = topSkeletons.get(skeleton(candidate));
    if (match && match !== candidate) return match;
  }
  return null;
}

// MARK: Display

const cache = new Map<string, string>();

/**
 * `host` as a user should see it: `xn--` labels in Unicode when they pass the
 * spoof checks (each label on its own, like Chrome), the whole host in
 * punycode when the result looks like a top domain. Everything else as is.
 */
export function displayHost(host: string): string {
  if (!/(^|\.)xn--/i.test(host)) return host;
  const cached = cache.get(host);
  if (cached !== undefined) return cached;
  const labels = host.toLowerCase().split(".");
  const tld = labels[labels.length - 1] || labels[labels.length - 2] || "";
  let changed = false;
  const shown = labels.map((label) => {
    const unicode = decodeLabel(label);
    if (!unicode || labelSpoofReason(unicode, tld)) return label;
    changed = true;
    return unicode;
  });
  let result = changed ? shown.join(".") : host;
  if (changed && similarTopDomain(result)) result = host;
  if (cache.size > 500) cache.clear();
  cache.set(host, result);
  return result;
}

/** Why `host` stays punycode (for tests and diagnostics): the first unsafe label's reason. */
export function hostSpoofReason(host: string): SpoofReason | null {
  const labels = host.toLowerCase().split(".");
  const tld = labels[labels.length - 1] || "";
  for (const label of labels) {
    if (!/^xn--/.test(label)) continue;
    const unicode = decodeLabel(label);
    if (!unicode) return "invalid";
    const reason = labelSpoofReason(unicode, tld);
    if (reason) return reason;
  }
  return displayHost(host) === host && /(^|\.)xn--/.test(host.toLowerCase()) ? "topDomainLookalike" : null;
}
