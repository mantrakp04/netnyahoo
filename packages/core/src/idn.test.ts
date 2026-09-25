import assert from "node:assert/strict";
import { test } from "node:test";
import { domainToASCII } from "node:url";
import { displayHost, hostSpoofReason, punycodeDecode, punycodeEncode, similarTopDomain } from "./idn.ts";

/** The host as it arrives in a URL (Chromium canonicalises Unicode hosts to punycode). */
const ascii = (unicode: string) => {
  const host = domainToASCII(unicode);
  assert.ok(host, `${unicode} should be a valid IDN`);
  return host;
};
const shown = (unicode: string) => displayHost(ascii(unicode));

test("punycode decodes and encodes RFC 3492 samples", () => {
  assert.equal(punycodeDecode("ihqwcrb4cv8a8dqg056pqjye"), "他们为什么不说中文");
  assert.equal(punycodeDecode("mnchen-3ya"), "münchen");
  assert.equal(punycodeDecode("b1abfaaepdrnnbgefbadotcwatmq2g4l"), "почемужеонинеговорятпорусски");
  assert.equal(punycodeEncode("他们为什么不说中文"), "ihqwcrb4cv8a8dqg056pqjye");
  assert.equal(punycodeEncode("münchen"), "mnchen-3ya");
  for (const word of ["bücher", "日本語", "пример", "ελληνικά", "한국어", "مثال", "a-b-ñ"]) {
    assert.equal(punycodeDecode(punycodeEncode(word)), word);
    assert.equal(punycodeEncode(word), ascii(word).slice(4));
  }
});

test("malformed punycode is rejected", () => {
  assert.equal(punycodeDecode("99999999999"), null);
  assert.equal(punycodeDecode("mnchen-3y"), null);
  assert.equal(punycodeDecode("é-abc"), null);
  assert.equal(displayHost("xn--.com"), "xn--.com");
  assert.equal(displayHost("xn--zz.com"), "xn--zz.com");
});

test("ordinary IDNs are shown in Unicode", () => {
  assert.equal(shown("münchen.de"), "münchen.de");
  assert.equal(shown("bücher.example"), "bücher.example");
  assert.equal(shown("日本語.jp"), "日本語.jp");
  assert.equal(shown("中国"), "中国");
  assert.equal(shown("пример.рф"), "пример.рф");
  assert.equal(shown("пример.com"), "пример.com");
  assert.equal(shown("ελληνικά.gr"), "ελληνικά.gr");
  assert.equal(shown("한국어.kr"), "한국어.kr");
  assert.equal(shown("مثال.eg"), "مثال.eg");
  assert.equal(shown("उदाहरण.in"), "उदाहरण.in");
  assert.equal(shown("ตัวอย่าง.th"), "ตัวอย่าง.th");
  assert.equal(shown("tiếngviệt.vn"), "tiếngviệt.vn");
  // Latin + Han/Kana is fine (highly restrictive), as is Latin + one other non-LGC script.
  assert.equal(shown("abc日本.jp"), "abc日本.jp");
  assert.equal(shown("abcไทย.com"), "abcไทย.com");
  // Only the xn-- labels change; ASCII labels are kept as they are.
  assert.equal(shown("www.münchen.de"), "www.münchen.de");
  assert.equal(displayHost("example.com"), "example.com");
  assert.equal(displayHost("localhost"), "localhost");
});

test("mixing Latin with Cyrillic or Greek stays punycode", () => {
  assert.equal(shown("аpple.com"), "xn--pple-43d.com");
  assert.equal(hostSpoofReason(ascii("аpple.com")), "mixedScripts");
  assert.equal(hostSpoofReason(ascii("gοogle.net")), "mixedScripts");
  // Cyrillic + Greek, no Latin.
  assert.equal(hostSpoofReason(ascii("пα.com")), "mixedScripts");
});

test("whole-script confusables stay punycode outside their TLDs", () => {
  // аррӏе: Cyrillic letters that all look Latin.
  assert.equal(shown("аррӏе.com"), "xn--80ak6aa92e.com");
  assert.equal(hostSpoofReason("xn--80ak6aa92e.com"), "wholeScriptConfusable");
  assert.equal(shown("аррӏе.ru"), "аррӏе.ru");
  assert.equal(shown("аррӏе.рф"), "аррӏе.рф");
  assert.equal(hostSpoofReason(ascii("ικα.com")), "wholeScriptConfusable");
  assert.equal(shown("ικα.gr"), "ικα.gr");
  assert.equal(hostSpoofReason(ascii("ოყ.com")), "wholeScriptConfusable");
  assert.equal(hostSpoofReason(ascii("ทน.com")), "wholeScriptConfusable");
  assert.equal(hostSpoofReason(ascii("օս.com")), "wholeScriptConfusable");
});

test("deviation characters and TLD-specific letters", () => {
  assert.equal(hostSpoofReason("xn--fa-hia.de"), "deviationCharacter");
  assert.equal(displayHost("xn--fa-hia.de"), "xn--fa-hia.de");
  assert.equal(hostSpoofReason(ascii("þorn.com")), "tldSpecificCharacter");
  assert.equal(shown("þorn.is"), "þorn.is");
  assert.equal(hostSpoofReason(ascii("əli.com")), "tldSpecificCharacter");
  assert.equal(shown("əli.az"), "əli.az");
  assert.equal(shown("col·legi.cat"), "col·legi.cat");
  assert.equal(hostSpoofReason(ascii("col·legi.com")), "unsafeMiddleDot");
  assert.equal(hostSpoofReason(ascii("a·b.cat")), "unsafeMiddleDot");
});

test("disallowed characters, invisible marks and mixed digits", () => {
  // IPA ɡ (U+0261) instead of g.
  assert.equal(hostSpoofReason(ascii("ɡoogle.com")), "disallowedCharacter");
  // Tifinagh (a Limited Use script).
  assert.equal(hostSpoofReason(ascii("ⵜⴰⵎ.com")), "disallowedCharacter");
  // A symbol.
  assert.equal(hostSpoofReason(ascii("i❤.ws")), "disallowedCharacter");
  assert.equal(hostSpoofReason("xn--" + punycodeEncode("ax\u0301\u0301b") + ".com"), "invisible");
  assert.equal(hostSpoofReason(ascii("a३4.com")), "mixedNumbers");
});

test("digit lookalikes", () => {
  assert.equal(hostSpoofReason(ascii("з4.com")), "digitLookalikes");
  assert.equal(hostSpoofReason(ascii("১২৪.com")), null);
  assert.equal(hostSpoofReason(ascii("৪২.com")), "digitLookalikes");
});

test("non-ASCII Latin next to another script", () => {
  assert.equal(hostSpoofReason(ascii("é中.com")), "nonAsciiLatinMixed");
  assert.equal(hostSpoofReason(ascii("a中.com")), null);
});

test("dangerous patterns", () => {
  // Katakana that look like slashes next to Latin.
  assert.equal(hostSpoofReason(ascii("aノb.com")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("abcン.com")), "dangerousPattern");
  // Hiragana he among Katakana.
  assert.equal(hostSpoofReason(ascii("カヘカ.jp")), null);
  assert.equal(hostSpoofReason(ascii("カへカ.jp")), "dangerousPattern");
  // Prolonged sound mark at the start, iteration marks outside Katakana.
  assert.equal(hostSpoofReason(ascii("ーabc.jp")), "dangerousPattern");
  // Dot above on an i, and a combining mark on a non-LGC letter.
  assert.equal(hostSpoofReason("xn--" + punycodeEncode("ai\u0307b") + ".com"), "dangerousPattern");
  // Latin o/g next to Armenian.
  assert.equal(hostSpoofReason(ascii("oհ.com")), "dangerousPattern");
});

test("hosts that look like top domains stay punycode", () => {
  assert.equal(similarTopDomain("gõõgle.com"), "google.com");
  assert.equal(similarTopDomain("google.com"), null);
  assert.equal(shown("gõõgle.com"), ascii("gõõgle.com"));
  assert.equal(hostSpoofReason(ascii("gõõgle.com")), "topDomainLookalike");
  assert.equal(shown("pаypal.com"), ascii("pаypal.com"));
  assert.equal(shown("login.paypäl.com"), ascii("login.paypäl.com"));
  assert.equal(shown("аmazon.co.uk"), ascii("аmazon.co.uk"));
  // A subdomain of the real thing is fine.
  assert.equal(shown("bücher.google.com"), "bücher.google.com");
});

test("non-canonical encodings stay punycode", () => {
  // Upper-case Unicode and decomposed forms can't come out of IDNA.
  const upper = "xn--" + punycodeEncode("mÜnchen") + ".de";
  assert.equal(displayHost(upper), upper);
  assert.equal(hostSpoofReason(upper), "invalid");
  assert.equal(hostSpoofReason("xn--" + punycodeEncode("mu\u0308nchen") + ".de"), "invalid");
});
