#!/usr/bin/env bash
# Puts NNCore into the Chromium tree: copies src/netnyahoo/ to //netnyahoo and adds its hooks:
# a dep of the macOS //chrome:chrome_dll on //netnyahoo/core (Chrome's framework then links
# our layer), ChromeMain making NNCore's main delegate, Browser asking NNCore for the window of a
# Browser Chrome makes itself, HistoryTabHelper asking NNCore which tabs are history,
# declarativeNetRequest telling it which rules matched a tab's requests and when an extension's
# rulesets are in force, CHECKs made tolerant of Browsers without a BrowserView, and the hooks
# that took over from CEF's seams when CEF left the tree (docs/engine-build.md › hooks H1-H6:
# the custom window, the WebContentsDelegate, permission prompts, context menus, the ResourceBundle
# delegate, and g_netnyahoo_embedder for what Chrome leaves to its embedder). Chrome's behaviour is
# unchanged while NNCore sets none of them. Idempotent. Never touches
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
    grep -q 'g_netnyahoo_create_web_contents_delegate(' "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" &&
    grep -q "Netnyahoo: NNCore's own window" "$src/chrome/browser/ui/browser.cc" &&
    grep -q 'g_netnyahoo_create_permission_prompt(' "$src/chrome/browser/ui/views/permissions/permission_prompt_factory.cc" &&
    grep -q 'g_netnyahoo_context_menu_show)(RenderViewContextMenu\* menu) = nullptr' "$src/chrome/browser/renderer_context_menu/render_view_context_menu.cc" &&
    grep -q 'g_netnyahoo_context_menu_show(this)' "$src/chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_cocoa.mm" &&
    grep -q 'g_netnyahoo_context_menu_show(this)' "$src/chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_remote_cocoa.mm" &&
    grep -q 'g_netnyahoo_context_menu_show(this)' "$src/chrome/browser/ui/views/renderer_context_menu/render_view_context_menu_views.cc" &&
    grep -q 'g_netnyahoo_resource_bundle_delegate,' "$src/chrome/app/chrome_main_delegate.cc" &&
    grep -q 'if (!g_netnyahoo_embedder)' "$src/chrome/app/chrome_main_delegate.cc" &&
    grep -q 'g_netnyahoo_embedder &&' "$src/chrome/browser/chrome_browser_main.cc" &&
    grep -q 'if (!g_netnyahoo_embedder)' "$src/chrome/browser/chrome_browser_main_mac.mm" &&
    grep -q 'if (!g_netnyahoo_embedder)' "$src/chrome/browser/chrome_content_browser_client.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/ui/toasts/toast_controller.cc" &&
    grep -q 'Netnyahoo: NNCore shows no toast' "$src/chrome/browser/ui/toasts/toast_controller.cc" &&
    grep -q 'g_netnyahoo_history_eligible(' "$src/chrome/browser/history/history_tab_helper.cc" &&
    grep -q 'g_netnyahoo_dnr_rule_matched(' "$src/extensions/browser/api/declarative_net_request/action_tracker.cc" &&
    grep -q 'g_netnyahoo_dnr_rulesets_in_force(' "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" &&
    grep -q 'Netnyahoo: NNCore. A component extension' "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" &&
    grep -q 'Netnyahoo: NNCore' "$src/chrome/browser/extensions/browser_window_util.cc" &&
    grep -q 'g_netnyahoo_extension_installed(' "$src/chrome/browser/ui/extensions/extension_install_ui_desktop.cc" &&
    grep -q 'g_netnyahoo_prompts_without_tab' "$src/chrome/browser/download/download_crx_util.cc" &&
    grep -q 'g_netnyahoo_tab_shown_by_host' "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.cc" &&
    grep -q 'g_netnyahoo_permission_tab_shown' "$src/components/permissions/permission_request_manager.cc" &&
    grep -q 'g_netnyahoo_file_system_restore_prompt' "$src/chrome/browser/ui/views/file_system_access/file_system_access_restore_permission_bubble_view.cc" &&
    grep -q 'g_netnyahoo_tab_shown_by_host' "$src/chrome/browser/ui/tabs/tab_dialog_manager.cc" &&
    grep -q 'g_netnyahoo_open_action_popup' "$src/chrome/browser/extensions/api/extension_action/extension_action_api.cc"
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

# ChromeMain (chrome/app/chrome_main.cc, compiled into Chrome's framework) makes NNCore's
# delegate, a ChromeMainDelegate, for every process.
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

# NNCore makes the WebContentsDelegate of its own Browsers (NNWebContentsDelegate: every new tab
# and window stays in the host's window); a Browser Chrome keeps gets Chrome's. NNCore answers
# from the Browser's window (one of its own, nn_browser_window.h), and only NNCore sets the hook.
python3 - "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_create_web_contents_delegate" in s:
    sys.exit(0)
at = "BrowserWindowFeatures::BrowserWindowFeatures() = default;\n"
decl = """// Netnyahoo: NNCore (engine/nncore) makes the WebContentsDelegate of the Browsers it hosts.
std::unique_ptr<BrowserWebContentsDelegate> (
    *g_netnyahoo_create_web_contents_delegate)(
    BrowserWindowInterface* browser,
    ExclusiveAccessManager& exclusive_access_manager,
    chrome::BrowserCommandController& command_controller,
    UnloadController& unload_controller,
    web_app::AppBrowserController* app_browser_controller,
    BrowserWindow& window,
    DesktopBrowserWindowCapabilities& capabilities,
    BrowserUiController& browser_ui_controller) = nullptr;

"""
old = """  browser_web_contents_delegate_ = std::make_unique<BrowserWebContentsDelegate>(
      browser, *exclusive_access_manager_, *browser_command_controller_,
      *unload_controller_, app_browser_controller_.get(),
      *BrowserWindow::FromBrowser(browser),
      *desktop_browser_window_capabilities_, *browser_ui_controller_);
"""
new = """  // Netnyahoo: NNCore
  if (g_netnyahoo_create_web_contents_delegate) {
    browser_web_contents_delegate_ = g_netnyahoo_create_web_contents_delegate(
        browser, *exclusive_access_manager_, *browser_command_controller_,
        *unload_controller_, app_browser_controller_.get(),
        *BrowserWindow::FromBrowser(browser),
        *desktop_browser_window_capabilities_, *browser_ui_controller_);
  }
  if (!browser_web_contents_delegate_) {
    browser_web_contents_delegate_ = std::make_unique<BrowserWebContentsDelegate>(
        browser, *exclusive_access_manager_, *browser_command_controller_,
        *unload_controller_, app_browser_controller_.get(),
        *BrowserWindow::FromBrowser(browser),
        *desktop_browser_window_capabilities_, *browser_ui_controller_);
  }
"""
assert s.count(at) == 1 and s.count(old) == 1
open(path, "w").write(s.replace(at, decl + at).replace(old, new))
print("hooked BrowserWindowFeatures' WebContentsDelegate")
PY

# Reading mode's side panel controller CHECKs that only tests have a Browser without a side
# panel UI. A viewless Browser has none (until NNCore implements SidePanelUI, as Dia does).
# g_netnyahoo_viewless_browsers (defined with the toast hook below) says NNCore runs the process.
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
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !g_netnyahoo_viewless_browsers) {
      CHECK_IS_TEST();
    }"""
inc_old = '#include "ui/base/metadata/metadata_types.h"\n'
inc_new = inc_old + ("\n// Netnyahoo: NNCore (engine/nncore); defined in toast_controller.cc.\n"
                     "extern bool g_netnyahoo_viewless_browsers;\n")
assert s.count(old) == 1 and s.count(inc_old) == 1
open(path, "w").write(s.replace(old, new).replace(inc_old, inc_new))
print("hooked ReadAnythingSidePanelController")
PY

# Chrome's toasts ("Image copied", "Link copied") anchor to a BrowserView, and without an anchor
# ToastController CHECKs that it's a test: right-click > Copy Image aborted the app. A viewless
# Browser shows none. NNCore sets g_netnyahoo_viewless_browsers at launch.
python3 - "$src/chrome/browser/ui/toasts/toast_controller.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "Netnyahoo: NNCore" in s:
    sys.exit(0)
old = """    if (!webui_browser::IsWebUIBrowserEnabled()) {
      CHECK_IS_TEST();
    }"""
new = """    // Netnyahoo: NNCore's Browsers have no BrowserView to anchor a toast to.
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !(browser_window_interface_ && g_netnyahoo_viewless_browsers)) {
      CHECK_IS_TEST();
    }"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked ToastController")
PY

# And a viewless Browser turns every toast down up front: ShowToast marks the toast as showing
# and starts its timer before CreateToast finds no anchor, and with no widget to close nothing
# ever cleared it, so every later toast queued behind it forever.
python3 - "$src/chrome/browser/ui/toasts/toast_controller.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "Netnyahoo: NNCore shows no toast" in s:
    sys.exit(0)
old = """bool ToastController::MaybeShowToast(ToastParams params) {
  if (!CanShowToast(params.toast_id)) {"""
new = """// Netnyahoo: NNCore (engine/nncore) runs this process: its Browsers may have no
// BrowserView (reading mode's side panel controller reads it too).
bool g_netnyahoo_viewless_browsers = false;

bool ToastController::MaybeShowToast(ToastParams params) {
  // Netnyahoo: NNCore shows no toast without an anchor, before any state is set.
  if (browser_window_interface_ && g_netnyahoo_viewless_browsers) {
    const ToastSpecification* spec =
        toast_registry_->GetToastSpecification(params.toast_id);
    if (!spec || !GetAnchorView(spec->is_global_scope())) {
      RecordToastFailedToShow(params.toast_id);
      return false;
    }
  }
  if (!CanShowToast(params.toast_id)) {"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked ToastController::MaybeShowToast")
PY

# A Browser Chrome makes itself (chrome.windows.create, an incognito window, undocked DevTools,
# document Picture in Picture) asks NNCore for its window before Chrome builds a BrowserView:
# NNCore may host it in one of the app's windows. And a Browser NNCore makes takes the window NNCore
# made for it (BrowserWindowCreateParams::window), which Chrome otherwise allows only in tests. The
# factory is only ever set by NNCore, as it starts, before any Browser.
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

  if (custom_window) {
    CHECK_IS_TEST() << "BrowserWindowCreateParams::window is a test-only param";
  }
  window_ =
      custom_window
          ? std::unique_ptr<BrowserWindow, BrowserWindowDeleter>(custom_window)
          : BrowserWindow::CreateBrowserWindow(this, user_gesture,
                                               in_tab_dragging);
"""
new = """  features_->Init(this);

  // Netnyahoo: NNCore's own window for a Browser it makes (tests only, otherwise).
  if (custom_window && !g_netnyahoo_browser_window_factory) {
    CHECK_IS_TEST() << "BrowserWindowCreateParams::window is a test-only param";
  }
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

# Chrome's ChromeMainDelegate and main parts leave to an embedder what CEF's build compiled out
# under ENABLE_CEF (CEF's chrome_runtime.patch), now at run time: g_netnyahoo_embedder, which
# NNMainDelegate sets in every process. NNCore does these itself (nn_main_delegate.cc) or wants
# them off: --user-data-dir and the component paths, the startup metrics' core system profile, the
# sampling profiler, Chrome's first run and initial prefs, --make-default-browser,
# StartupBrowserCreator and the main RunLoop it makes, AppController and Chrome's main menu, the
# about: -> chrome: URL handler, and the crash reporter (crash keys, ChromeCrashReporterClient,
# crashpad: crashes stay with macOS's own reports). And Chrome's strings load through NNCore's
# ResourceBundle delegate (g_netnyahoo_resource_bundle_delegate), in every process.
python3 - "$src/chrome/app/chrome_main_delegate.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_embedder" in s:
    sys.exit(0)
def gate(s, start, end, why):
    i = s.index(start)
    j = s.index(end, i) + len(end)
    body = "".join(("  " + l if l.strip() and not l.startswith("#") else l)
                   for l in s[i:j].splitlines(True))
    return s[:i] + "  // Netnyahoo: NNCore " + why + "\n  if (!g_netnyahoo_embedder) {\n" + body + "  }\n" + s[j:]
decl_at = """#if BUILDFLAG(IS_ANDROID)
ChromeMainDelegate::ChromeMainDelegate()
    : ChromeMainDelegate(StartupTimestamps{}) {}
#endif
"""
decl = """// Netnyahoo: NNCore (engine/nncore) embeds Chrome: it does some of Chrome's startup itself.
bool g_netnyahoo_embedder = false;
// Netnyahoo: NNCore's ResourceBundle delegate (its product strings).
ui::ResourceBundle::Delegate* g_netnyahoo_resource_bundle_delegate = nullptr;

"""
assert s.count(decl_at) == 1
s = s.replace(decl_at, decl + decl_at)
old = """  std::string actual_locale = LoadLocalState(
      chrome_feature_list_creator, invoked_in_browser->is_running_test);
"""
new = """  std::string actual_locale = LoadLocalState(
      chrome_feature_list_creator,
      g_netnyahoo_resource_bundle_delegate,  // Netnyahoo: NNCore
      invoked_in_browser->is_running_test);
"""
assert s.count(old) == 1
s = s.replace(old, new)
old = """            locale, nullptr, ui::ResourceBundle::LOAD_COMMON_RESOURCES);
"""
new = """            locale, g_netnyahoo_resource_bundle_delegate,  // Netnyahoo: NNCore
            ui::ResourceBundle::LOAD_COMMON_RESOURCES);
"""
assert s.count(old) == 1
s = s.replace(old, new)
old = """  bool record = true;
#if BUILDFLAG(IS_ANDROID)
  record =
      base::FeatureList::IsEnabled(chrome::android::kUmaBackgroundSessions);
#endif
"""
new = """  // Netnyahoo: NNCore records no core system profile.
  bool record = !g_netnyahoo_embedder;
#if BUILDFLAG(IS_ANDROID)
  record =
      base::FeatureList::IsEnabled(chrome::android::kUmaBackgroundSessions);
#endif
"""
assert s.count(old) == 1
s = s.replace(old, new)
old = """  // Start the sampling profiler as early as possible - namely, once the thread
  // pool has been created.
  sampling_profiler_ = std::make_unique<MainThreadStackSamplingProfiler>();
"""
new = """  // Start the sampling profiler as early as possible - namely, once the thread
  // pool has been created.
  // Netnyahoo: NNCore starts it itself.
  if (!g_netnyahoo_embedder) {
    sampling_profiler_ = std::make_unique<MainThreadStackSamplingProfiler>();
  }
"""
assert s.count(old) == 1
s = s.replace(old, new)
start1 = "  crash_reporter::InitializeCrashKeys();\n"
end1 = "#endif  // !defined(BUILDING_CHROME_RENDERER)\n"
assert s.count(start1) == 1
s = gate(s, start1, end1, "has no crash reporter, and sets up its data dir itself.")
start2 = "#if BUILDFLAG(IS_POSIX) && !BUILDFLAG(IS_MAC)\n  // Zygote needs to call InitCrashReporter() in RunZygote().\n"
end2 = "  crash_keys::SetCrashKeysFromCommandLine(command_line);\n"
assert s.count(start2) == 1 and s.count(end2) == 1
s = gate(s, start2, end2, "has no crash reporter.")
open(path, "w").write(s)
print("hooked ChromeMainDelegate (embedder, ResourceBundle delegate)")
PY2

python3 - "$src/chrome/browser/chrome_browser_main.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_embedder" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Netnyahoo: NNCore (engine/nncore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_netnyahoo_embedder;\n")
i = s.index(ns)
s = s[:i] + decl + s[i:]
# Initial preferences: an embedder's Chrome makes an empty MasterPrefs and reads none.
start = """  std::unique_ptr<installer::InitialPreferences> installer_initial_prefs =
      startup_data_->chrome_feature_list_creator()->TakeInitialPrefs();
"""
end = """#if BUILDFLAG(IS_MAC)
  if (!master_prefs_->confirm_to_quit) {
    local_state->SetBoolean(prefs::kConfirmToQuitEnabled,
                            master_prefs_->confirm_to_quit);
  }
#endif
"""
assert s.count(start) == 1 and s.count(end) == 1
i = s.index(start); j = s.index(end, i) + len(end)
body = "".join(("  " + l if l.strip() and not l.startswith("#") else l)
               for l in s[i:j].splitlines(True))
s = s[:i] + "  // Netnyahoo: NNCore has no first run.\n  if (!g_netnyahoo_embedder) {\n" + body + "  }\n" + s[j:]
reps = [
("""  if (first_run::IsChromeFirstRun()) {
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(switches::kApp) &&""",
"""  // Netnyahoo: NNCore has no first run.
  if (!g_netnyahoo_embedder && first_run::IsChromeFirstRun()) {
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(switches::kApp) &&"""),
("""  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          switches::kMakeDefaultBrowser)) {""",
"""  // Netnyahoo: NNCore
  if (!g_netnyahoo_embedder &&
      base::CommandLine::ForCurrentProcess()->HasSwitch(
          switches::kMakeDefaultBrowser)) {"""),
("""  // on preferences.
  if (first_run::IsChromeFirstRun()) {""",
"""  // on preferences.
  // Netnyahoo: NNCore has no first run.
  if (!g_netnyahoo_embedder && first_run::IsChromeFirstRun()) {"""),
("""  // This step is costly.
  if (browser_creator_->Start(*base::CommandLine::ForCurrentProcess(),
                              base::FilePath(), profile_info,
                              last_opened_profiles)) {""",
"""  // This step is costly.
  // Netnyahoo: NNCore opens its own windows and runs the main loop itself.
  if (!g_netnyahoo_embedder &&
      browser_creator_->Start(*base::CommandLine::ForCurrentProcess(),
                              base::FilePath(), profile_info,
                              last_opened_profiles)) {"""),
]
for old, new in reps:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
open(path, "w").write(s)
print("hooked ChromeBrowserMainParts (embedder)")
PY2

python3 - "$src/chrome/browser/chrome_browser_main_mac.mm" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_embedder" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Netnyahoo: NNCore (engine/nncore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_netnyahoo_embedder;\n")
i = s.index(ns)
s = s[:i] + decl + s[i:]
start = "  // Create the app delegate by requesting the shared AppController.\n"
end = "  [app_controller mainMenuCreated];\n"
assert s.count(start) == 1 and s.count(end) == 1
i = s.index(start); j = s.index(end, i) + len(end)
body = "".join(("  " + l if l.strip() else l) for l in s[i:j].splitlines(True))
s = s[:i] + ("  // Netnyahoo: NNCore's app has its own NSApp delegate and main menu.\n"
             "  if (!g_netnyahoo_embedder) {\n") + body + "  }\n" + s[j:]
old = "  [AppController.sharedController didEndMainMessageLoop];\n"
new = ("  // Netnyahoo: NNCore\n  if (!g_netnyahoo_embedder) {\n"
       "    [AppController.sharedController didEndMainMessageLoop];\n  }\n")
assert s.count(old) == 1
s = s.replace(old, new)
open(path, "w").write(s)
print("hooked ChromeBrowserMainPartsMac (embedder)")
PY2

python3 - "$src/chrome/browser/chrome_content_browser_client.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_embedder" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Netnyahoo: NNCore (engine/nncore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_netnyahoo_embedder;\n")
i = s.index(ns)
s = s[:i] + decl + s[i:]
old = """  // chrome: & friends.
  handler->AddHandlerPair(&ChromeContentBrowserClient::HandleWebUI,
                          &ChromeContentBrowserClient::HandleWebUIReverse);
"""
new = """  // chrome: & friends.
  // Netnyahoo: NNCore maps its own URLs (as CEF's build did).
  if (!g_netnyahoo_embedder) {
    handler->AddHandlerPair(&ChromeContentBrowserClient::HandleWebUI,
                            &ChromeContentBrowserClient::HandleWebUIReverse);
  }
"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked ChromeContentBrowserClient's URL handlers (embedder)")
PY2

# Chrome's permission prompts ask NNCore first: the host's tabs show the host's own prompt
# (nn_permissions.mm). NNCore returns a prompt, or null with `default_handling` false for none, or
# null with it true for Chrome's bubble. Only NNCore sets the hook.
python3 - "$src/chrome/browser/ui/views/permissions/permission_prompt_factory.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_create_permission_prompt" in s:
    sys.exit(0)
at = """}  // namespace

bool ShouldShowPermissionPromptEvenIfOmniboxEditedOrEmpty(
"""
decl = """}  // namespace

// Netnyahoo: NNCore (engine/nncore) shows the prompts of the tabs it hosts.
std::unique_ptr<permissions::PermissionPrompt> (
    *g_netnyahoo_create_permission_prompt)(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling) = nullptr;

bool ShouldShowPermissionPromptEvenIfOmniboxEditedOrEmpty(
"""
old = """std::unique_ptr<permissions::PermissionPrompt> CreatePermissionPrompt(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate) {
"""
new = old + """  // Netnyahoo: NNCore
  if (g_netnyahoo_create_permission_prompt) {
    bool default_handling = true;
    auto prompt = g_netnyahoo_create_permission_prompt(web_contents, delegate,
                                                       &default_handling);
    if (prompt) {
      return prompt;
    }
    if (!default_handling) {
      return nullptr;
    }
  }
"""
assert s.count(at) == 1 and s.count(old) == 1
open(path, "w").write(s.replace(at, decl).replace(old, new))
print("hooked the permission prompt factory")
PY2

# Chrome's context menus ask NNCore before showing: a background (test) instance's menu goes to
# the host instead of the screen (nn_context_menu.mm). Only NNCore sets the hook.
python3 - "$src/chrome/browser/renderer_context_menu/render_view_context_menu.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_context_menu_show" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Netnyahoo: NNCore (engine/nncore) may show a context menu itself: true if it did.\n"
        "bool (*g_netnyahoo_context_menu_show)(RenderViewContextMenu* menu) = nullptr;\n")
i = s.index(ns)
open(path, "w").write(s[:i] + decl + s[i:])
print("hooked RenderViewContextMenu")
PY2
for f in cocoa/renderer_context_menu/render_view_context_menu_mac_cocoa.mm:RenderViewContextMenuMacCocoa \
         cocoa/renderer_context_menu/render_view_context_menu_mac_remote_cocoa.mm:RenderViewContextMenuMacRemoteCocoa \
         views/renderer_context_menu/render_view_context_menu_views.cc:RenderViewContextMenuViews; do
python3 - "$src/chrome/browser/ui/${f%%:*}" "${f##*:}" <<'PY2'
import sys
path, cls = sys.argv[1], sys.argv[2]
s = open(path).read()
if "g_netnyahoo_context_menu_show" in s:
    sys.exit(0)
old = "void %s::Show() {\n" % cls
new = ("// Netnyahoo: NNCore (engine/nncore); defined in render_view_context_menu.cc.\n"
       "extern bool (*g_netnyahoo_context_menu_show)(RenderViewContextMenu* menu);\n\n"
       + old + "  // Netnyahoo: NNCore\n"
       "  if (g_netnyahoo_context_menu_show && g_netnyahoo_context_menu_show(this)) {\n"
       "    return;\n  }\n\n")
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked " + cls + "::Show")
PY2
done

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
# shown, though it is on screen). Only NNCore sets the hook.
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
# Only NNCore sets the hook.
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
# hook.
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
# as CEF's Alloy browsers never were. Only NNCore sets the hook.
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
# the hook.
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

# declarativeNetRequest's RulesMonitorService loads a component extension's enabled static
# rulesets with the extension, and tells NNCore when the rulesets an extension had as it loaded
# are in force (read from disk on another sequence, a moment after the load): NNCore holds a
# profile's navigations until its content blocker's are (nn_navigation_hold.mm). A component
# extension is never installed, so nothing indexed its rulesets and recorded their checksums:
# Chrome skipped them all as "checksum not found" and the content blocker had no rules in a new
# profile until its service worker turned its lists on again. Now they're indexed on that first
# load (as Chrome indexes a ruleset enabled after install) and their checksums kept. Only NNCore
# loads component extensions with rulesets and sets the hook.
python3 - "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_dnr_rulesets_in_force" in s:
    sys.exit(0)
old_ns = "namespace extensions {\nnamespace declarative_net_request {\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) holds a profile's navigations until a content blocker's\n"
        "// rulesets are in force.\n"
        "void (*g_netnyahoo_dnr_rulesets_in_force)(\n"
        "    content::BrowserContext* browser_context,\n"
        "    const extensions::ExtensionId& extension_id,\n"
        "    bool all_loaded) = nullptr;\n\n")
old = """  update_dynamic_or_session_rules_queue_map_[load_data.extension_id]
      .SetReadyToExecuteApiCalls();
}

void RulesMonitorService::OnNewStaticRulesetsLoaded(
"""
new = """  update_dynamic_or_session_rules_queue_map_[load_data.extension_id]
      .SetReadyToExecuteApiCalls();

  // Netnyahoo: NNCore
  if (g_netnyahoo_dnr_rulesets_in_force) {
    g_netnyahoo_dnr_rulesets_in_force(
        context_, load_data.extension_id,
        !notify_ruleset_failed_to_load && !global_rule_limit_exceeded);
  }
}

void RulesMonitorService::OnNewStaticRulesetsLoaded(
"""
old_load = """      if (!helper.GetStaticRulesetChecksum(extension->id(), source.id(),
                                           expected_ruleset_checksum)) {
        // This might happen on prefs corruption.
        LogLoadRulesetResult(LoadRulesetResult::kErrorChecksumNotFound);
        ruleset_failed_to_load = true;
        continue;
      }

      RulesetInfo static_ruleset(std::move(source));
      static_ruleset.set_expected_checksum(expected_ruleset_checksum);
      load_data.rulesets.push_back(std::move(static_ruleset));
"""
new_load = """      const bool indexed = helper.GetStaticRulesetChecksum(
          extension->id(), source.id(), expected_ruleset_checksum);
      // Netnyahoo: NNCore. A component extension was never installed, so
      // nothing indexed its rulesets: index them now, as for a ruleset
      // enabled after install (no expected checksum), and keep the checksum.
      if (!indexed &&
          !Manifest::IsComponentLocation(extension->location())) {
        // This might happen on prefs corruption.
        LogLoadRulesetResult(LoadRulesetResult::kErrorChecksumNotFound);
        ruleset_failed_to_load = true;
        continue;
      }

      RulesetInfo static_ruleset(std::move(source));
      if (indexed) {
        static_ruleset.set_expected_checksum(expected_ruleset_checksum);
      }
      load_data.rulesets.push_back(std::move(static_ruleset));
"""
assert s.count(old_ns) == 1 and s.count(old) == 1 and s.count(old_load) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new).replace(old_load, new_load)
open(path, "w").write(s)
print("hooked declarativeNetRequest's RulesMonitorService")
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
new_inc = old_inc + ("\n// Netnyahoo: NNCore (engine/nncore); defined in\n"
                     "// browser_extension_window_controller.cc.\n"
                     "extern bool (*g_netnyahoo_hidden_from_extensions)(\n"
                     "    const BrowserWindowInterface* browser);\n")
old = """  if (restrict_to_normal_browsers &&
      browser.GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return false;
  }
"""
new = old + """
  // Netnyahoo: NNCore. The host's own hidden pages are no extension's window.
  if (g_netnyahoo_hidden_from_extensions &&
      g_netnyahoo_hidden_from_extensions(&browser)) {
    return false;
  }
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
# the hook set, the brand list is Chrome's. Only NNCore sets the hook.
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
# The host shows more and less than that (engine/nncore nn_host_visibility.h): both panes of a split
# (focusing the other pane made Chrome take the call as left), and its own pages over the strip's
# active tab (New Tab, another Space: the strip doesn't change). With the hook set, a tab the host
# reported reads as activated exactly while the host shows it, and the host's changes reach the
# observer (NetnyahooAutoPictureInPictureHostVisibilityChanged) as the strip's do. Only NNCore sets
# the hook.
python3 - "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.h" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "NetnyahooHostVisibilityChanged" in s:
    sys.exit(0)
old = """ private:
  void UpdateIsTabActivated(const TabStripModel* tab_strip_model);
"""
new = """  // Netnyahoo: NNCore's host showed or hid `contents`: if it is this helper's tab, read it
  // again, as on a strip change (true).
  bool NetnyahooHostVisibilityChanged(content::WebContents* contents);

""" + old
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY2
python3 - "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_tab_shown_by_host" in s:
    sys.exit(0)
old_fn = "// static\nstd::unique_ptr<AutoPictureInPictureTabObserverHelperBase>\n"
decl = """// Netnyahoo: NNCore (engine/nncore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
int (*g_netnyahoo_tab_shown_by_host)(content::WebContents*) = nullptr;

namespace {
// Netnyahoo: NNCore: the helpers observing a strip, to tell of the host's changes.
std::set<AutoPictureInPictureTabStripObserverHelper*>& NetnyahooObserving() {
  static base::NoDestructor<std::set<AutoPictureInPictureTabStripObserverHelper*>> helpers;
  return *helpers;
}
}  // namespace

// Netnyahoo: NNCore
void NetnyahooAutoPictureInPictureHostVisibilityChanged(
    content::WebContents* contents) {
  for (AutoPictureInPictureTabStripObserverHelper* helper : NetnyahooObserving()) {
    if (helper->NetnyahooHostVisibilityChanged(contents)) {
      return;
    }
  }
}

bool AutoPictureInPictureTabStripObserverHelper::NetnyahooHostVisibilityChanged(
    content::WebContents* contents) {
  if (!is_observing_ || GetObservedWebContents() != contents) {
    return false;
  }
  const bool old_is_tab_activated = is_tab_activated_;
  UpdateIsTabActivated(GetCurrentTabStripModel());
  if (is_tab_activated_ != old_is_tab_activated) {
    RunCallback(is_tab_activated_);
  }
  return true;
}

"""
include = '#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.h"\n'
includes = include + "\n#include <set>\n\n#include \"base/no_destructor.h\"\n"
start_old = """  is_observing_ = true;
"""
start_new = start_old + """  NetnyahooObserving().insert(this);  // Netnyahoo: NNCore
"""
stop_old = """  is_observing_ = false;
"""
stop_new = stop_old + """  NetnyahooObserving().erase(this);  // Netnyahoo: NNCore
"""
update_old = """  if (tab_strip_model) {
    // If there is not currently a selected tab, then the tabstrip is still
"""
update_new = """  if (tab_strip_model) {
    // Netnyahoo: NNCore (a split's other pane is shown, a tab under the host's own page isn't)
    const int shown = g_netnyahoo_tab_shown_by_host
                          ? g_netnyahoo_tab_shown_by_host(GetObservedWebContents())
                          : -1;
    if (shown >= 0) {
      is_tab_activated_ = shown == 1;
      return;
    }
    // If there is not currently a selected tab, then the tabstrip is still
"""
# The tab a switch went to, told it became active (and so to close its own window): never one the
# host hides (leaving a split hides both panes; the strip's active one isn't where the user went).
active_old = """  return observed_tab_strip_model_->GetActiveWebContents();
}
"""
active_new = """  content::WebContents* active = observed_tab_strip_model_->GetActiveWebContents();
  // Netnyahoo: NNCore (a tab the host hides isn't the one the user went to)
  if (active && g_netnyahoo_tab_shown_by_host &&
      g_netnyahoo_tab_shown_by_host(active) == 0) {
    return nullptr;
  }
  return active;
}
"""
for old in (old_fn, include, start_old, stop_old, update_old, active_old):
    assert s.count(old) == 1, old
s = (s.replace(include, includes).replace(old_fn, decl + old_fn).replace(start_old, start_new)
      .replace(stop_old, stop_new).replace(update_old, update_new).replace(active_old, active_new))
open(path, "w").write(s)
print("hooked auto picture-in-picture's tab strip observer")
PY2

# Permission prompts follow the tab strip's active tab: a split's other pane (shown, not the strip's
# active tab) couldn't prompt until focused, and a page under the host's own page (New Tab, another
# Space) could. With the hook set, a tab the host reported (engine/nncore nn_host_visibility.h) can
# prompt exactly while the host shows it; an open prompt stays with its page (NNCore's prompts keep
# alive across switches), and NNCore tells the manager of each change through OnVisibilityChanged.
# Only NNCore sets the hook.
python3 - "$src/components/permissions/permission_request_manager.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_permission_tab_shown" in s:
    sys.exit(0)
old_ns = "namespace permissions {\n"
decl = """// Netnyahoo: NNCore (engine/nncore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
int (*g_netnyahoo_permission_tab_shown)(content::WebContents*) = nullptr;

"""
helper = """
namespace {
// Netnyahoo: NNCore: whether a tab can prompt, as the host shows it (or `chrome_says`).
bool NetnyahooTabActive(content::WebContents* contents, bool chrome_says) {
  const int shown = g_netnyahoo_permission_tab_shown && contents
                        ? g_netnyahoo_permission_tab_shown(contents)
                        : -1;
  return shown < 0 ? chrome_says : shown == 1;
}
}  // namespace
"""
vis_old = """  // If `tab_subscriptions_` isn't empty, defer to those listeners instead.
  if (!tab_subscriptions_.empty()) {
    return;
  }
  bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = visibility != content::Visibility::HIDDEN;
"""
vis_new = """  // If `tab_subscriptions_` isn't empty, defer to those listeners instead.
  // Netnyahoo: NNCore (unless the host says)
  const bool host_says =
      g_netnyahoo_permission_tab_shown &&
      g_netnyahoo_permission_tab_shown(web_contents()) >= 0;
  if (!tab_subscriptions_.empty() && !host_says) {
    return;
  }
  bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = NetnyahooTabActive(
      web_contents(), visibility != content::Visibility::HIDDEN);
"""
adopt_old = """  tab_is_active_ = tab_interface->IsActivated();
"""
adopt_new = """  tab_is_active_ =
      NetnyahooTabActive(web_contents(), tab_interface->IsActivated());  // Netnyahoo: NNCore
"""
status_old = """  const bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = is_active;
"""
status_new = """  const bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = NetnyahooTabActive(web_contents(), is_active);  // Netnyahoo: NNCore
"""
for old in (old_ns, vis_old, adopt_old, status_old):
    assert s.count(old) == 1, old
s = (s.replace(old_ns, decl + old_ns + helper, 1).replace(vis_old, vis_new)
      .replace(adopt_old, adopt_new).replace(status_old, status_new))
open(path, "w").write(s)
print("hooked the permission request manager's tab activation")
PY2

# A site asking again for files it kept handles to (IndexedDB) gets Chrome's restore prompt, a bubble
# anchored to the toolbar's page info icon: with no BrowserView that segfaulted
# (bubble_anchor_util::GetPageInfoAnchorConfiguration). With the hook set, NNCore asks its host
# instead, as for every other permission, and takes the callback; it declines the Browsers it doesn't
# host, which keep Chrome's bubble. Only NNCore sets the hook.
python3 - "$src/chrome/browser/ui/views/file_system_access/file_system_access_restore_permission_bubble_view.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_file_system_restore_prompt" in s:
    sys.exit(0)
old = """void ShowFileSystemAccessRestorePermissionDialog(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)> callback,
    content::WebContents* web_contents) {
"""
decl = """// Netnyahoo: NNCore (engine/nncore) asks its host; it takes `callback` when it does.
bool (*g_netnyahoo_file_system_restore_prompt)(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)>& callback,
    content::WebContents* web_contents) = nullptr;

"""
new = decl + old + """  // Netnyahoo: NNCore
  if (g_netnyahoo_file_system_restore_prompt &&
      g_netnyahoo_file_system_restore_prompt(request, callback, web_contents)) {
    return;
  }
"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked the File System Access restore prompt")
PY2

# Chrome's tab-modal dialogs (TabDialogManager: FedCM's "Sign in with", Ask before HTTP) show while
# their tab is the strip's active one; the host's own pages (New Tab) cover that tab without the
# strip changing, so a dialog stayed up over them, and focusing a split's other pane hid it. With the
# hook set, a tab the host reported (engine/nncore nn_host_visibility.h) shows its dialog exactly
# while the host shows the tab (a split's other pane too), and NNCore asks the manager again on each
# change. Only NNCore sets the hook (it is defined with auto Picture in Picture's, above).
python3 - "$src/chrome/browser/ui/tabs/tab_dialog_manager.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_tab_shown_by_host" in s:
    sys.exit(0)
old_ns = "namespace tabs {\n\nclass TabDialogWidgetObserver"
decl = """// Netnyahoo: NNCore (engine/nncore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
extern int (*g_netnyahoo_tab_shown_by_host)(content::WebContents*);

"""
old = """  return GetWidgetVisibility(
      tab_interface_->IsVisible(),
      tab_interface_->GetBrowserWindowInterface()->GetWindow()->IsMinimized(),
      params_->should_show_callback);
"""
new = """  // Netnyahoo: NNCore (the host's reading, when it gave one)
  const int shown =
      g_netnyahoo_tab_shown_by_host
          ? g_netnyahoo_tab_shown_by_host(tab_interface_->GetContents())
          : -1;
  return GetWidgetVisibility(
      shown < 0 ? tab_interface_->IsVisible() : shown == 1,
      tab_interface_->GetBrowserWindowInterface()->GetWindow()->IsMinimized(),
      params_->should_show_callback);
"""
# And a page the host still shows keeps its dialog when the strip's active tab moves off it
# (focusing a split's other pane: the host's splits aren't Chrome's).
bg_old = """void TabDialogManager::TabWillEnterBackground(TabInterface* tab_interface) {
  if (widget_) {
"""
bg_new = """void TabDialogManager::TabWillEnterBackground(TabInterface* tab_interface) {
  // Netnyahoo: NNCore
  if (widget_ && g_netnyahoo_tab_shown_by_host &&
      g_netnyahoo_tab_shown_by_host(tab_interface_->GetContents()) == 1) {
    return;
  }
  if (widget_) {
"""
assert s.count(old_ns) == 1 and s.count(old) == 1 and s.count(bg_old) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new).replace(bg_old, bg_new)
open(path, "w").write(s)
print("hooked TabDialogManager's visibility")
PY2

# chrome.action.openPopup() (and browserAction.openPopup) asks NNCore first: its Browsers have no
# toolbar, so Chrome refused every call ("Browser window has no toolbar"). The host shows the
# popup in its own panel and Chrome answers the extension once the page has loaded (1Password
# reopens its popup this way once its Mac app unlocks). Only NNCore sets the hook.
python3 - "$src/chrome/browser/extensions/api/extension_action/extension_action_api.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_netnyahoo_open_action_popup" in s:
    sys.exit(0)
old_ns = "namespace extensions {\n"
decl = ("// Netnyahoo: NNCore (engine/nncore) shows action popups in the host's own panel. Empty: not\n"
        "// its Browser; true: shown (it runs `callback`); false: refused, with `error`.\n"
        "std::optional<bool> (*g_netnyahoo_open_action_popup)(\n"
        "    BrowserWindowInterface& browser,\n"
        "    const extensions::Extension& extension,\n"
        "    ShowPopupCallback& callback,\n"
        "    std::string* error) = nullptr;\n\n")
old = """                        ShowPopupCallback callback) {
#if !BUILDFLAG(IS_ANDROID)
"""
new = """                        ShowPopupCallback callback) {
  // Netnyahoo: NNCore
  if (g_netnyahoo_open_action_popup) {
    if (std::optional<bool> shown = g_netnyahoo_open_action_popup(
            browser, extension, callback, error)) {
      return *shown;
    }
  }
#if !BUILDFLAG(IS_ANDROID)
"""
inc_old = "#include <memory>\n"
assert s.count(old) == 1 and s.count(inc_old) == 1
i = s.index(old_ns)
s = s[:i] + decl + s[i:]
s = s.replace(old, new).replace(inc_old, inc_old + "#include <optional>\n", 1)
open(path, "w").write(s)
print("hooked chrome.action.openPopup")
PY2
