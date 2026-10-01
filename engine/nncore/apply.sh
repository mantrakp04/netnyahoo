#!/usr/bin/env bash
# Puts NNCore into the Chromium tree: copies src/netnyahoo/ to //netnyahoo and adds its hooks:
# a dep of the macOS //chrome:chrome_dll on //netnyahoo/core (Chrome's framework then links
# our layer), ChromeMain making NNCore's main delegate, Browser asking NNCore for the window of a
# Browser Chrome makes itself, and three CHECKs made tolerant of
# Browsers without a BrowserView (CEF's and Chrome's behaviour unchanged). Idempotent. Never touches
# args.gn; the next autoninja re-runs gn by itself.
#
#   engine/nncore/apply.sh            copy + hook
#   engine/nncore/apply.sh --check    exit 1 if the tree differs from the repo
#
# Build (holding the chromium lock):
#   scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}

if [[ "${1:-}" == --check ]]; then
  diff -r "$here/src/netnyahoo" "$src/netnyahoo" >/dev/null &&
    grep -q '"//netnyahoo/core"' "$src/chrome/BUILD.gn" &&
    grep -q 'g_netnyahoo_browser_window_factory(this)' "$src/chrome/browser/ui/browser.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/sad_tab_controller.cc" &&
    grep -q 'g_netnyahoo_external_protocol_dialog(' "$src/chrome/browser/external_protocol/external_protocol_handler.cc" &&
    grep -q 'nncore::NNMainDelegate' "$src/chrome/app/chrome_main.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc"
  exit
fi

mkdir -p "$src/netnyahoo"
# No -t: a changed file gets a new mtime, so ninja always sees it (a restored older copy too).
rsync -r --delete --checksum "$here/src/netnyahoo/" "$src/netnyahoo/"

python3 - "$src/chrome/BUILD.gn" <<'PY'
import re, sys
path = sys.argv[1]
s = open(path).read()
if '"//netnyahoo/core"' in s:
    sys.exit(0)
# The macOS chrome_dll (the source_set the framework links): its deps end with cld_3.
mac = s.index('target(_dll_target_type, "chrome_dll")')
anchor = '      "//third_party/cld_3/src/src:cld_3",\n'
at = s.index(anchor, mac) + len(anchor)
hook = '      "//netnyahoo/core",  # Netnyahoo: NNCore (engine/nncore)\n'
open(path, "w").write(s[:at] + hook + s[at:])
print("hooked //chrome:chrome_dll")
PY

# ChromeMain (chrome/app/chrome_main.cc, compiled only into Chrome's framework, never by
# CEF) makes NNCore's delegate, a ChromeMainDelegate, for every process.
python3 - "$src/chrome/app/chrome_main.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "nncore::NNMainDelegate" in s:
    sys.exit(0)
old = """#else  // BUILDFLAG(IS_WIN)
  ChromeMainDelegate chrome_main_delegate(
      {.exe_entry_point_ticks = base::TimeTicks::Now()});"""
new = """#else  // BUILDFLAG(IS_WIN)
  // Netnyahoo: NNCore's delegate (engine/nncore), a ChromeMainDelegate.
  nncore::NNMainDelegate chrome_main_delegate(
      {.exe_entry_point_ticks = base::TimeTicks::Now()});"""
inc_old = '#if BUILDFLAG(IS_MAC)\n#include "chrome/app/chrome_main_mac.h"\n'
inc_new = inc_old + '#include "netnyahoo/core/nn_main_delegate.h"  // nogncheck\n'
assert old in s and inc_old in s
s = s.replace(old, new).replace(inc_old, inc_new)
open(path, "w").write(s)
print("hooked ChromeMain")
PY

# Two CEF-added functions in Chrome's BrowserWindowFeatures CHECK that every Browser has a
# BrowserView; ours don't. Without one they now do nothing (CEF's Browsers always have one,
# so CEF behaves as before).
python3 - "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "Netnyahoo: NNCore" in s:
    sys.exit(0)
old1 = """void BrowserWindowFeatures::InitPostTabModelConstruction(
    BrowserWindowInterface* interface) {
  auto* browser_view = BrowserView::GetBrowserViewForBrowser(interface);
  CHECK(browser_view);
"""
new1 = """void BrowserWindowFeatures::InitPostTabModelConstruction(
    BrowserWindowInterface* interface) {
  auto* browser_view = BrowserView::GetBrowserViewForBrowser(interface);
  // Netnyahoo: NNCore's Browsers have no BrowserView (engine/nncore).
  if (!browser_view) {
    return;
  }
"""
old2 = """  auto* browser_view = BrowserView::GetBrowserViewForBrowser(interface);
  CHECK(browser_view);

  if (auto cef_delegate = browser_view->browser()->cef_delegate()) {
    cef_delegate->OnWebContentsCreated(target_contents);
  }"""
new2 = """  // Netnyahoo: NNCore's Browsers have no BrowserView (engine/nncore).
  if (auto cef_delegate = interface->cef_delegate()) {
    cef_delegate->OnWebContentsCreated(target_contents);
  }"""
assert old1 in s and old2 in s
s = s.replace(old1, new1).replace(old2, new2)
open(path, "w").write(s)
print("hooked BrowserWindowFeatures")
PY

# Reading mode's side panel controller CHECKs that only tests have a Browser without a side
# panel UI. A viewless Browser has none (until NNCore implements SidePanelUI, as Dia does).
python3 - "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "Netnyahoo: NNCore" in s:
    sys.exit(0)
old = """    if (!webui_browser::IsWebUIBrowserEnabled()) {
      CHECK_IS_TEST();
    }"""
new = """    // Netnyahoo: NNCore's Browsers have no BrowserView, so no side panel UI.
    // (Every Browser has a delegate under NNCore; CEF's always have a side panel.)
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !browser_window_interface->cef_delegate()) {
      CHECK_IS_TEST();
    }"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked ReadAnythingSidePanelController")
PY

# A Browser Chrome makes itself (chrome.windows.create, an incognito window, undocked DevTools,
# document Picture in Picture) asks NNCore for its window before Chrome builds a BrowserView:
# NNCore may host it in one of the app's windows. The factory is only ever set by NNCore, so
# CEF (which compiles this file too) behaves as before.
python3 - "$src/chrome/browser/ui/browser.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_browser_window_factory" in s:
    sys.exit(0)
old_ctor = "Browser::Browser(BrowserWindowCreateParams params)\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) supplies the window of a Browser it hosts.\n"
        "BrowserWindow* (*g_netnyahoo_browser_window_factory)(Browser*) = nullptr;\n\n")
old = """  features_->Init(this);

  window_ =
      custom_window
          ? std::unique_ptr<BrowserWindow, BrowserWindowDeleter>(custom_window)
          : BrowserWindow::CreateBrowserWindow(this, user_gesture,
                                               in_tab_dragging);
"""
new = """  features_->Init(this);

  // Netnyahoo: NNCore may host a Browser Chrome makes itself.
  BrowserWindow* const hosted_window =
      !custom_window && g_netnyahoo_browser_window_factory
          ? g_netnyahoo_browser_window_factory(this)
          : nullptr;
  window_ =
      custom_window || hosted_window
          ? std::unique_ptr<BrowserWindow, BrowserWindowDeleter>(
                custom_window ? custom_window : hosted_window)
          : BrowserWindow::CreateBrowserWindow(this, user_gesture,
                                               in_tab_dragging);
"""
assert s.count(old_ctor) == 1 and s.count(old) == 1
s = s.replace(old_ctor, decl + old_ctor).replace(old, new)
open(path, "w").write(s)
print("hooked Browser window creation")
PY2

# A renderer crash shows Chrome's sad tab in the tab's ContentsWebView, found through the
# Browser's BrowserView; NNCore's Browsers have none (the host shows its own, from
# tab:rendererGone:code:). Without one the sad tab stays unattached, as in unit tests.
python3 - "$src/chrome/browser/ui/sad_tab_controller.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "Netnyahoo: NNCore" in s:
    sys.exit(0)
old = """  BrowserView* browser_view = BrowserView::GetBrowserViewForBrowser(browser);
  DCHECK(browser_view);
"""
new = """  BrowserView* browser_view = BrowserView::GetBrowserViewForBrowser(browser);
  // Netnyahoo: NNCore's Browsers have no BrowserView (engine/nncore).
  if (!browser_view) {
    return nullptr;
  }
"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked SadTabController")
PY2

# Chrome's "Open <app>?" dialog for a link to another app (mailto: aside, which Chrome opens
# unasked) asks NNCore first, before the Mac's "no app for this scheme" check: for the host's
# tabs the host shows its own (and launches through Chrome on "open"). Only NNCore sets the
# hook, so CEF behaves as before.
python3 - "$src/chrome/browser/external_protocol/external_protocol_handler.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_external_protocol_dialog" in s:
    sys.exit(0)
old_fn = "\nnamespace {\n"
decl = """
// Netnyahoo: NNCore (engine/nncore) shows this dialog itself for the tabs it hosts.
bool (*g_netnyahoo_external_protocol_dialog)(
    const GURL& url,
    content::WebContents* web_contents,
    const std::optional<url::Origin>& initiating_origin,
    content::WeakDocumentPtr initiator_document,
    const std::u16string& program_name) = nullptr;
"""
old = """  DCHECK(web_contents);
  if (delegate) {
    delegate->RunExternalProtocolDialog(url, web_contents, page_transition,"""
new = """  DCHECK(web_contents);
  // Netnyahoo: NNCore
  if (!delegate && g_netnyahoo_external_protocol_dialog &&
      g_netnyahoo_external_protocol_dialog(url, web_contents, initiating_origin,
                                           initiator_document, program_name)) {
    return;
  }
  if (delegate) {
    delegate->RunExternalProtocolDialog(url, web_contents, page_transition,"""
assert s.count(old) == 1
at = s.index(old_fn)  # the first anonymous namespace: the hook stays out of it
s = s[:at] + decl + s[at:]
s = s.replace(old, new)
open(path, "w").write(s)
print("hooked external protocol dialog")
PY2
