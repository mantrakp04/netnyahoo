// Run from apps/browser:  node --test src/telemetry/sanitize.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanProperties, errorCode, errorMessage, errorType, nativeException, nativeFrames, parseStack, scrubText } from "./sanitize.ts";

const leaks = (text, ...secrets) => secrets.filter((s) => text.includes(s));

test("web addresses, hosts and app URLs are stripped", () => {
  const out = scrubText(
    "Failed to load https://mail.example.com/inbox?q=secret#frag, then netnyahoo://settings/passwords and chrome://version from bank.co.uk:8443",
  );
  assert.deepEqual(leaks(out, "example", "inbox", "secret", "passwords", "settings", "version", "bank"), []);
  assert.match(out, /^Failed to load <url> then <url> and <url> from <host>$/);
  assert.equal(scrubText("blob:https://x.test/abc data:text/html,<h1>hi</h1> about:blank"), "<url> <url> <url>");
  assert.equal(scrubText("visit www.secret-site.io now"), "visit <host> now");
  assert.equal(scrubText("dev server at localhost:8081 and 192.168.1.20:3000"), "dev server at <host> and <ip>");
});

test("file paths and file names are stripped, with the user's name", () => {
  const out = scrubText("Couldn't read /Users/alice/Library/Application Support/Netnyahoo/history.json");
  assert.deepEqual(leaks(out, "alice", "Library", "Netnyahoo", "history"), []);
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

test("messages are one line and bounded", () => {
  assert.equal(scrubText("first line\nsecond line with https://x.test"), "first line");
  assert.equal(scrubText("x".repeat(500), 20).length, 20);
  assert.equal(scrubText(42), "");
});

test("errors keep their type, never a made-up one", () => {
  assert.equal(errorType(new TypeError("x")), "TypeError");
  assert.equal(errorType("thrown string"), "Error");
  assert.equal(errorType({ name: "https://evil.test/" }), "Object");
  assert.equal(errorMessage(new Error("fetch https://secret.test/a failed")), "fetch <url> failed");
});

test("failed native calls keep the function name and code, and drop the cause", () => {
  const coded = Object.assign(
    new Error(
      "Calling the 'loadUrl' function has failed\n→ Caused by: The 1st argument cannot be cast to type View<CefWebView>\n→ Caused by: Unable to find the 'CefWebView' view with tag '1234'",
    ),
    { code: "ERR_ARGUMENT_CAST" },
  );
  assert.equal(errorMessage(coded), "Calling the 'loadUrl' function has failed");
  assert.equal(errorCode(coded), "ERR_ARGUMENT_CAST");
  assert.equal(errorMessage(new Error("Calling the 'https://x.test/' function has failed")), "Calling the <text> function has failed");
  assert.equal(errorMessage(new Error("Calling the 'a' function has failed for /Users/bob")), "Calling the <text> function has failed for <path>");
  assert.equal(errorCode({ code: "ENOENT" }), "ENOENT");
  assert.equal(errorCode({ code: "bob@example.com" }), null);
  assert.equal(errorCode({ code: 42 }), null);
  assert.equal(errorCode(new Error("x")), null);
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

test("JSC-style stacks parse too, and odd function names become anonymous", () => {
  const frames = parseStack("run@http://example.test/app/main.js?token=abc:10:2\nhttps://evil.test/x@file.js:1:1");
  assert.equal(frames.at(-1).function, "run");
  assert.equal(frames.at(-1).filename, "main.js");
  assert.equal(frames[0].function, "<anonymous>");
  assert.deepEqual(leaks(JSON.stringify(frames), "example", "token", "evil"), []);
});

test("native crash frames keep image and symbol names only", () => {
  const frames = nativeFrames([
    { image: "Netnyahoo", symbol: "CrashReports.crashForTesting()", offset: 4096 },
    { image: "Chromium Embedded Framework", offset: 255 },
    { image: "/Users/alice/Library/Something.dylib", symbol: "load(/Users/alice/x)" },
  ]);
  assert.deepEqual(leaks(JSON.stringify(frames), "alice", "Users/"), []);
  assert.equal(frames.at(-1).function, "CrashReports.crashForTesting()");
  assert.equal(frames.at(-1).in_app, true);
  assert.equal(frames.at(-2).function, "Chromium Embedded Framework + 0xff");
  assert.equal(frames.at(-2).resolved, false);
  assert.equal(frames[0].filename, "Something.dylib");
});

test("an uncaught NSException reports its name and scrubbed reason", () => {
  const out = nativeException({
    exceptionType: "EXC_BREAKPOINT",
    signal: "SIGTRAP",
    exceptionName: "NSInvalidArgumentException",
    exceptionReason: "-[NSView liveFolder]: unrecognized selector sent to instance 0x600003a1c2d0 for /Users/alice/Desktop",
  });
  assert.equal(out.type, "NSInvalidArgumentException");
  assert.equal(out.kind, "EXC_BREAKPOINT");
  assert.equal(out.signal, "SIGTRAP");
  assert.match(out.value, /^-\[NSView liveFolder\]: unrecognized selector sent to instance <hex> for <path>$/);
  assert.deepEqual(leaks(out.value, "alice", "600003a1c2d0"), []);
});

test("a crash without an exception keeps the Mach type and signal", () => {
  assert.deepEqual(nativeException({ exceptionType: "EXC_BAD_ACCESS", signal: "SIGSEGV" }), {
    kind: "EXC_BAD_ACCESS",
    signal: "SIGSEGV",
    type: "EXC_BAD_ACCESS",
    value: "EXC_BAD_ACCESS (SIGSEGV)",
  });
  assert.equal(nativeException({ exceptionType: "bad type", exceptionName: "not a name!" }).type, "Crash");
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
