#!/usr/bin/env bash
# Puts NNCore into the Chromium tree: copies src/netnyahoo/ to //netnyahoo and adds its hooks:
# a dep of the macOS //chrome:chrome_dll on //netnyahoo/core (Chrome's framework then links
# our layer), ChromeMain making NNCore's main delegate, Browser asking NNCore for the window of a
# Browser Chrome makes itself, HistoryTabHelper asking NNCore which tabs are history,
# declarativeNetRequest telling it which rules matched a tab's requests, and three
# CHECKs made tolerant of Browsers without a BrowserView (CEF's and Chrome's behaviour unchanged).
# Idempotent. Never touches
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
    grep -q 'netnyahoo_alive' "$src/chrome/browser/ui/autofill/autofill_popup_controller_impl.cc" &&
    grep -q 'g_netnyahoo_opacity_from_default_color' "$src/content/browser/renderer_host/render_widget_host_view_base.cc" &&
    grep -q '"//netnyahoo/core"' "$src/chrome/BUILD.gn" &&
    grep -q 'g_netnyahoo_browser_window_factory(this)' "$src/chrome/browser/ui/browser.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/sad_tab_controller.cc" &&
    grep -q 'g_netnyahoo_external_protocol_dialog(' "$src/chrome/browser/external_protocol/external_protocol_handler.cc" &&
    grep -q 'nncore::NNMainDelegate' "$src/chrome/app/chrome_main.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc" &&
    grep -q 'g_netnyahoo_history_eligible(' "$src/chrome/browser/history/history_tab_helper.cc" &&
    grep -q 'g_netnyahoo_dnr_rule_matched(' "$src/extensions/browser/api/declarative_net_request/action_tracker.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/extensions/browser_window_util.cc" &&
    grep -q 'g_netnyahoo_extension_installed(' "$src/chrome/browser/ui/extensions/extension_install_ui_desktop.cc" &&
    grep -q 'g_netnyahoo_prompts_without_tab' "$src/chrome/browser/download/download_crx_util.cc"
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

# Chrome's autofill dropdown tells NNCore each time it shows, whoever filled it: addresses and
# entries (BrowserAutofillManager), saved passwords (PasswordAutofillManager, the manual
# fallback), so the host hears of all of them (tab:didShowAutofillSuggestions:); also when its
# search bar couldn't take focus in an app that isn't active (Chrome then doesn't count it
# shown, though it is on screen). Only NNCore sets the hook, so CEF behaves as before.
python3 - "$src/chrome/browser/ui/autofill/autofill_popup_controller_impl.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "netnyahoo_alive" in s:
    sys.exit(0)
old_fn = "void AutofillPopupControllerImpl::Show(\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) hears of each dropdown shown.\n"
        "void (*g_netnyahoo_autofill_suggestions_shown)(\n"
        "    content::WebContents* web_contents,\n"
        "    base::span<const Suggestion> suggestions) = nullptr;\n\n")
old = """  delegate_->OnSuggestionsShown(
      non_filtered_suggestions_,
"""
new = """  // Netnyahoo: NNCore
  if (g_netnyahoo_autofill_suggestions_shown && IsRootPopup() && web_contents_) {
    g_netnyahoo_autofill_suggestions_shown(web_contents_.get(),
                                           non_filtered_suggestions_);
  }
""" + old
# A dropdown with a search bar (the saved passwords) counts as shown only once its window
# takes focus, which it can't in an app that isn't active: on screen all the same.
old2 = """    if (!view_->Show(autoselect_first_suggestion)) {
      return;
    }
"""
new2 = """    auto netnyahoo_alive = GetWeakPtr();
    if (!view_->Show(autoselect_first_suggestion)) {
      // Netnyahoo: NNCore hears of a dropdown on screen whose search bar couldn't
      // take focus (an app that isn't active), which Chrome doesn't count as shown.
      if (netnyahoo_alive && view_ && g_netnyahoo_autofill_suggestions_shown &&
          IsRootPopup() && web_contents_) {
        g_netnyahoo_autofill_suggestions_shown(web_contents_.get(),
                                               non_filtered_suggestions_);
      }
      return;
    }
"""
if "g_netnyahoo_autofill_suggestions_shown" not in s:
    assert s.count(old_fn) == 1 and s.count(old) == 1
    s = s.replace(old_fn, decl + old_fn).replace(old, new)
assert s.count(old2) == 1
s = s.replace(old2, new2)
open(path, "w").write(s)
print("hooked AutofillPopupControllerImpl")
PY2

# A new document's view takes over the last page's background (CopyBackgroundColorIfPresentFrom)
# and, when that background isn't opaque, tells the renderer to paint the page on a transparent
# base: with NNCore's translucent page background (the host's pageBackgroundColor), every
# navigation that swapped views after the last page reported its background lost it. With the
# hook set, the opacity follows the colours the embedder set, as SetBackgroundColor's does.
# Only NNCore sets the hook, so CEF behaves as before.
python3 - "$src/content/browser/renderer_host/render_widget_host_view_base.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_opacity_from_default_color" in s:
    sys.exit(0)
old_fn = "void RenderWidgetHostViewBase::CopyBackgroundColorIfPresentFrom(\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) has a translucent page background.\n"
        "bool g_netnyahoo_opacity_from_default_color = false;\n\n")
old = """  bool was_opaque = IsBackgroundColorOpaque();
  content_background_color_ = other_base.content_background_color_;
  default_background_color_ = other_base.default_background_color_;
  UpdateBackgroundColor();
  bool opaque = IsBackgroundColorOpaque();
"""
new = """  bool was_opaque = IsBackgroundColorOpaque();
  // Netnyahoo: NNCore
  const auto netnyahoo_opaque = [this] {
    return !default_background_color_ ||
           SkColorGetA(*default_background_color_) == SK_AlphaOPAQUE;
  };
  if (g_netnyahoo_opacity_from_default_color) {
    was_opaque = netnyahoo_opaque();
  }
  content_background_color_ = other_base.content_background_color_;
  default_background_color_ = other_base.default_background_color_;
  UpdateBackgroundColor();
  bool opaque = g_netnyahoo_opacity_from_default_color ? netnyahoo_opaque()
                                                       : IsBackgroundColorOpaque();
"""
assert s.count(old_fn) == 1 and s.count(old) == 1
s = s.replace(old_fn, decl + old_fn).replace(old, new)
open(path, "w").write(s)
print("hooked RenderWidgetHostViewBase")
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

# HistoryTabHelper asks NNCore whether a tab's navigations are history: the host's own pages
# (the content blocker's hidden extension page, extension popups and side panels) never are,
# as CEF's Alloy browsers never were. Only NNCore sets the hook, so CEF behaves as before.
python3 - "$src/chrome/browser/history/history_tab_helper.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_history_eligible" in s:
    sys.exit(0)
old_fn = "bool HistoryTabHelper::IsEligibleTab(\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) keeps its own pages out of history.\n"
        "bool (*g_netnyahoo_history_eligible)(content::WebContents*) = nullptr;\n\n")
old = """  if (force_eligible_tab_for_testing_) {
    return true;
  }
"""
new = """  if (force_eligible_tab_for_testing_) {
    return true;
  }
  // Netnyahoo: NNCore
  if (g_netnyahoo_history_eligible && web_contents() &&
      !g_netnyahoo_history_eligible(web_contents())) {
    return false;
  }
"""
assert s.count(old_fn) == 1 and s.count(old) == 1
s = s.replace(old_fn, decl + old_fn).replace(old, new)
open(path, "w").write(s)
print("hooked HistoryTabHelper")
PY2

# declarativeNetRequest's ActionTracker tells NNCore of each rule an extension's ruleset applied
# to a tab's request (block, redirect…), as it counts them for the action's badge: the host's
# blocked count follows what was stopped, redirects to a stand-in included. Only NNCore sets
# the hook, so CEF behaves as before.
python3 - "$src/extensions/browser/api/declarative_net_request/action_tracker.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_dnr_rule_matched" in s:
    sys.exit(0)
old_ns = "namespace extensions::declarative_net_request {\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) counts what extensions' rules did to a tab's requests.\n"
        "void (*g_netnyahoo_dnr_rule_matched)(\n"
        "    content::BrowserContext* browser_context,\n"
        "    int tab_id,\n"
        "    const extensions::declarative_net_request::RequestAction& action,\n"
        "    const extensions::WebRequestInfo& request) = nullptr;\n\n")
old = """  const int tab_id =
      GetTabIdForMatchedRule(browser_context_, request_info.frame_data.tab_id);
"""
new = old + """  // Netnyahoo: NNCore
  if (g_netnyahoo_dnr_rule_matched) {
    g_netnyahoo_dnr_rule_matched(browser_context_, tab_id, request_action,
                                 request_info);
  }
"""
assert s.count(old_ns) == 1 and s.count(old) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new)
open(path, "w").write(s)
print("hooked declarativeNetRequest's ActionTracker")
PY2

# The Browser extensions get for their windows when nothing names one (a popup's window.open,
# a private tab.create's parent) skips the host's own hidden pages, as chrome.windows' current
# window does (chromium-hidden-window-current-window.patch): their windows are never shown.
python3 - "$src/chrome/browser/extensions/browser_window_util.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "Netnyahoo: NNCore" in s:
    sys.exit(0)
old_inc = '#include "components/tabs/public/tab_interface.h"\n'
new_inc = old_inc + ('\n#include "cef/libcef/features/features.h"\n'
                     '#if BUILDFLAG(ENABLE_CEF)\n'
                     '#include "cef/libcef/browser/chrome/hidden_from_extensions.h"  // nogncheck\n'
                     '#endif\n')
old = """  if (restrict_to_normal_browsers &&
      browser.GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return false;
  }
"""
new = old + """
#if BUILDFLAG(ENABLE_CEF)
  // Netnyahoo: NNCore. The host's own hidden pages are no extension's window.
  if (cef::IsHiddenFromExtensions(&browser)) {
    return false;
  }
#endif
"""
assert s.count(old_inc) == 1 and s.count(old) == 1
s = s.replace(old_inc, new_inc).replace(old, new)
open(path, "w").write(s)
print("hooked extensions' browser_window_util")
PY2

# Chrome's post-install UI ("<name> has been added") asks NNCore first. Chrome's finds or makes
# a tabbed Browser for it (a hidden window of ours, given none of the app's), adds a tab when
# the Browser has none, and reads that Browser's active tab later through a raw pointer (the
# host had closed the tab, or the window: a crash), then reaches for its BrowserView's
# toolbar when the bubble closes (ours have none). NNCore shows the bubble over a window the
# app shows for the profile, later if there is none yet. Only NNCore sets the hook.
python3 - "$src/chrome/browser/ui/extensions/extension_install_ui_desktop.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_extension_installed" in s:
    sys.exit(0)
old_ns = "using content::BrowserThread;\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) shows the post-install UI for the windows it hosts.\n"
        "bool (*g_netnyahoo_extension_installed)(\n"
        "    Profile* profile,\n"
        "    scoped_refptr<const extensions::Extension> extension,\n"
        "    const SkBitmap* icon) = nullptr;\n\n")
old = """  // Extensions aren't enabled by default in incognito so we confirm
  // the install in a normal window.
"""
new = """  // Netnyahoo: NNCore
  if (g_netnyahoo_extension_installed &&
      g_netnyahoo_extension_installed(profile(), extension, icon)) {
    return;
  }

""" + old
assert s.count(old_ns) == 1 and s.count(old) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new)
open(path, "w").write(s)
print("hooked the extension post-install UI")
PY2

# A downloaded .crx whose tab has gone asks without a tab under NNCore (its install prompt is
# the app's): Chrome would find a Browser, or make one (a hidden window of ours), and read its
# active tab, which a Browser of the app's need not have. Only NNCore sets the flag.
python3 - "$src/chrome/browser/download/download_crx_util.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_prompts_without_tab" in s:
    sys.exit(0)
old_ns = "namespace download_crx_util {\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) shows the install prompt itself, without a tab.\n"
        "bool g_netnyahoo_prompts_without_tab = false;\n\n")
old = """  if (!web_contents) {
    BrowserWindowInterface* browser =
"""
new = """  // Netnyahoo: NNCore
  if (!web_contents && g_netnyahoo_prompts_without_tab) {
    return std::make_unique<ExtensionInstallPrompt>(
        profile, gfx::NativeWindow(),
        std::make_unique<extensions::InstallPromptData>(
            extensions::InstallPromptData::UNSET_PROMPT_TYPE));
  }
""" + old
assert s.count(old_ns) == 1 and s.count(old) == 1
s = s.replace(old_ns, old_ns + "\n" + decl, 1).replace(old, new)
open(path, "w").write(s)
print("hooked download_crx_util's install prompt")
PY2

# Client hints and navigator.userAgentData name the browser by its product name, which a
# Chromium-branded build leaves out ("Chromium" and the GREASE brand only). Meet and other sites
# gate features on a "Google Chrome" brand, which Chrome-based browsers (Arc, Dia) report. With
# the hook set, the brand list is Chrome's. Only NNCore sets the hook, so CEF behaves as before.
python3 - "$src/components/embedder_support/user_agent_utils.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_user_agent_brand" in s:
    sys.exit(0)
old_ns = "namespace embedder_support {\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) reports Chrome's brand.\n"
        "const char* g_netnyahoo_user_agent_brand = nullptr;\n\n")
old = """#if !BUILDFLAG(CHROMIUM_BRANDING)
  brand = version_info::GetProductName();
#endif
"""
new = old + """  // Netnyahoo: NNCore
  if (g_netnyahoo_user_agent_brand) {
    brand = g_netnyahoo_user_agent_brand;
  }
"""
assert s.count(old_ns) >= 1 and s.count(old) == 1
s = s.replace(old_ns, decl + old_ns, 1).replace(old, new)
open(path, "w").write(s)
print("hooked the user agent brand")
PY2

# Chrome's automatic Picture in Picture (a call's own window) follows the tab strip's active tab.
# The host's own pages (its New Tab page) aren't tabs of the strip: a call left for one stayed the
# strip's active tab, so Chrome closed the window it had just opened ("activated and unoccluded").
# With the hook set, a tab the host hid reads as not activated (its cached state, which follows
# the strip, stays as it was). Only NNCore sets the hook.
python3 - "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_tab_hidden_by_host" in s:
    sys.exit(0)
old_fn = "// static\nstd::unique_ptr<AutoPictureInPictureTabObserverHelperBase>\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) hides tabs without changing the strip.\n"
        "bool (*g_netnyahoo_tab_hidden_by_host)(content::WebContents*) = nullptr;\n\n")
old = """bool AutoPictureInPictureTabStripObserverHelper::IsTabActivated() {
"""
new = old + """  // Netnyahoo: NNCore (not cached: the strip didn't change)
  if (g_netnyahoo_tab_hidden_by_host &&
      g_netnyahoo_tab_hidden_by_host(GetObservedWebContents())) {
    return false;
  }
"""
assert s.count(old_fn) == 1 and s.count(old) == 1
s = s.replace(old_fn, decl + old_fn).replace(old, new)
open(path, "w").write(s)
print("hooked auto picture-in-picture's tab strip observer")
PY2
