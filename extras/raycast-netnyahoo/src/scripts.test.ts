import assert from "node:assert/strict";
import { test } from "node:test";
import { closeTabScript, focusTabScript, listTabsScript, quote } from "./scripts.ts";

// Tab and window ids go into AppleScript source: they must be quoted, never spliced in.
test("quotes ids and targets the app by bundle id", () => {
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(
    focusTabScript({ windowId: "w-1", tabId: "tab-2" }),
    'tell application id "com.netnyahoo.browser" to focus (tab id "tab-2" of window id "w-1")',
  );
  assert.equal(closeTabScript({ windowId: "w-1", tabId: "tab-2" }, "current application"), 'tell current application to close (tab id "tab-2" of window id "w-1")');
  assert.match(listTabsScript(), /tell application id "com\.netnyahoo\.browser"/);
});
