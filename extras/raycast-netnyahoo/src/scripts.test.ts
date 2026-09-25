import assert from "node:assert/strict";
import { test } from "node:test";
import { closeTabScript, focusTabScript, hostOf, listTabsScript, parseTabs, quote } from "./scripts.ts";

// What listTabsScript returned from a running Netnyahoo (via the app's DEV AppleScript runner):
// a New Tab page, then pages, the Autofill fixture being the window's selected tab.
const OUTPUT =
  "w-mugmhxok-3\u001f1\u001ftab-mugmhxok-4\u001f\u001f\u001ffalse\u001ffalse\u001e" +
  "w-mugmhxok-3\u001f1\u001ftab-mugmhxok-5\u001fnetnyahoo parity at DuckDuckGo\u001fhttps://duckduckgo.com/?q=netnyahoo+parity&t=nnfixture&ia=web\u001ffalse\u001ffalse\u001e" +
  "w-mugmhxok-3\u001f1\u001ftab-mugmmt3p-4\u001fPiP fixture\u001fhttp://localhost:8765/pip.html\u001ftrue\u001ffalse\u001e" +
  "w-mugmhxok-3\u001f1\u001ftab-mugms9ui-3\u001fAutofill fixture\u001fhttp://localhost:8765/form.html\u001ffalse\u001ftrue\u001e";

test("parses the tab list", () => {
  const tabs = parseTabs(OUTPUT);
  assert.equal(tabs.length, 4);
  assert.deepEqual(tabs[0], { windowId: "w-mugmhxok-3", windowIndex: 1, tabId: "tab-mugmhxok-4", title: "", url: "", isPinned: false, isFocused: false });
  assert.equal(tabs[1]!.url, "https://duckduckgo.com/?q=netnyahoo+parity&t=nnfixture&ia=web");
  assert.equal(tabs[2]!.isPinned, true);
  assert.equal(tabs[3]!.isFocused, true);
  assert.deepEqual(parseTabs(""), []);
});

test("quotes ids and targets the app by bundle id", () => {
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(
    focusTabScript({ windowId: "w-1", tabId: "tab-2" }),
    'tell application id "com.netnyahoo.browser" to focus (tab id "tab-2" of window id "w-1")',
  );
  assert.equal(closeTabScript({ windowId: "w-1", tabId: "tab-2" }, "current application"), 'tell current application to close (tab id "tab-2" of window id "w-1")');
  assert.match(listTabsScript(), /tell application id "com\.netnyahoo\.browser"/);
});

test("rows show the host", () => {
  assert.equal(hostOf("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(hostOf("netnyahoo://settings"), "settings");
  assert.equal(hostOf("not a url"), "not a url");
});
