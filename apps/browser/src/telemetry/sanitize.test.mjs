import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanProperties, errorCode, errorMessage, errorType, nativeCrashExceptions, nativeFrames, parseStack, scrubText } from "./sanitize.ts";

const leaks = (text, ...secrets) => secrets.filter((s) => text.includes(s));

test("web addresses, hosts and app URLs are stripped", () => {
  const out = scrubText(
    "Failed to load https://mail.example.com/inbox?q=secret#frag, then arcadia://settings/passwords and chrome://version from bank.co.uk:8443",
  );
  assert.deepEqual(leaks(out, "example", "inbox", "secret", "passwords", "settings", "version", "bank"), []);
  assert.match(out, /^Failed to load <url> then <url> and <url> from <host>$/);
  assert.equal(scrubText("blob:https://x.test/abc data:text/html,<h1>hi</h1> about:blank"), "<url> <url> <url>");
  assert.equal(scrubText("visit www.secret-site.io now"), "visit <host> now");
  assert.equal(scrubText("dev server at localhost:8081 and 192.168.1.20:3000"), "dev server at <host> and <ip>");
});

test("file paths and file names are stripped, with the user's name", () => {
  const out = scrubText("Couldn't read /Users/alice/Library/Application Support/Arcadia/history.json");
  assert.deepEqual(leaks(out, "alice", "Library", "Arcadia", "history"), []);
  assert.ok(out.startsWith("Couldn't read <path>"));
  assert.equal(scrubText("Couldn't save live-folders-work.json"), "Couldn't save <file>");
  assert.equal(scrubText("open ~/Documents/Taxes 2025.pdf failed"), "open <path> <file> failed");
  assert.equal(scrubText("see ./relative/dir/file and C/D"), "see <path> and <path>");
  assert.deepEqual(leaks(scrubText("file:///Users/bob/Desktop/plan.docx"), "bob", "plan"), []);
});

test("quoted text, emails, ids and long numbers are stripped", () => {
  assert.equal(scrubText(`Profile "Bob's Work" not found`), "Profile <text> not found");
  assert.equal(scrubText("Cannot read property 'password' of undefined"), "Cannot read property <text> of undefined");
  assert.equal(scrubText("mail alice.smith+x@corp.example.org"), "mail <email>");
  assert.equal(scrubText("tab 3f2c1a9e-1b2c-4d5e-8f90-123456789abc gone"), "tab <id> gone");
  assert.equal(scrubText("card 4111111111111111 declined"), "card <n> declined");
  assert.equal(scrubText("Couldn't save the sync state; can't retry"), "Couldn't save the sync state; can't retry");
});

test("Hermes stacks keep function and bundle names, not the dev host, query or directories", () => {
  const stack = [
    "TypeError: boom",
    "    at choose (http://localhost:8081/index.bundle//&platform=macos&dev=true&minify=false:123:45)",
    "    at anonymous (address at /Users/alice/Library/Developer/Xcode/DerivedData/main.jsbundle:1:9876)",
    "    at apply (native)",
    "    at ?anon_0_ (index.bundle:1:2)",
  ].join("\n");
  const frames = parseStack(stack);
  const json = JSON.stringify(frames);
  assert.deepEqual(leaks(json, "localhost", "8081", "platform=macos", "alice", "DerivedData", "Users"), []);
  assert.equal(frames.at(-1).function, "choose");
  assert.equal(frames.at(-1).filename, "index.bundle");
  assert.equal(frames.at(-1).lineno, 123);
  assert.equal(frames.at(-1).colno, 45);
  assert.equal(frames.at(-2).filename, "main.jsbundle");
  assert.equal(frames.at(-3).filename, "native");
  assert.equal(frames.at(-3).in_app, false);
  for (const f of frames) assert.equal(f.platform, "custom");
});

test("event properties are flat, plain and scrubbed", () => {
  const out = cleanProperties({
    kind: "history",
    count: 3,
    ok: true,
    none: null,
    nan: NaN,
    url: "https://secret.test/path",
    nested: { url: "https://x.test" },
    list: ["a"],
    "bad key": 1,
  });
  assert.deepEqual(out, { kind: "history", count: 3, ok: true, none: null, url: "<url>" });
});

test("an uncaught NSException sends its name and throw site first, never its reason", () => {
  const { name, signal, exceptions } = nativeCrashExceptions({
    exceptionType: "EXC_BREAKPOINT",
    signal: "SIGTRAP",
    exceptionName: "NSRangeException",
    frames: [{ image: "AppKit", symbol: "+[NSApplication _crashOnException:]" }, { image: "Arcadia", symbol: "main" }],
    exceptionFrames: [
      { image: "CoreFoundation", symbol: "__exceptionPreprocess" },
      { image: "libobjc.A.dylib", symbol: "objc_exception_throw" },
      { image: "ArcadiaShell", symbol: "TabStrip.select(_:)" },
    ],
  });
  assert.equal(name, "NSRangeException");
  assert.equal(signal, "SIGTRAP");
  assert.deepEqual(exceptions.map((e) => [e.type, e.value]), [
    ["NSRangeException", "Uncaught NSRangeException"],
    ["EXC_BREAKPOINT", "EXC_BREAKPOINT (SIGTRAP)"],
  ]);
  assert.equal(exceptions[0].frames.at(-1).function, "__exceptionPreprocess");
  assert.equal(exceptions[0].frames[0].function, "TabStrip.select(_:)");
  assert.equal(exceptions[0].frames[0].in_app, true);
  assert.equal(exceptions[1].frames.at(-1).function, "+[NSApplication _crashOnException:]");
});
