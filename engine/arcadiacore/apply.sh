#!/usr/bin/env bash
# Puts ArcadiaCore into the Chromium tree: copies src/arcadia/ to //arcadia and adds its hooks:
# a dep of the macOS //chrome:chrome_dll on //arcadia/core (Chrome's framework then links
# our layer), ChromeMain making ArcadiaCore's main delegate, Browser asking ArcadiaCore for the window of a
# Browser Chrome makes itself, HistoryTabHelper asking ArcadiaCore which tabs are history,
# declarativeNetRequest telling it which rules matched a tab's requests and when an extension's
# rulesets are in force, CHECKs made tolerant of Browsers without a BrowserView, and the hooks
# that took over from CEF's seams when CEF left the tree (docs/engine-build.md › hooks H1-H6:
# the custom window, the WebContentsDelegate, permission prompts, context menus, the ResourceBundle
# delegate, and g_arcadia_embedder for what Chrome leaves to its embedder). Chrome's behaviour is
# unchanged while ArcadiaCore sets none of them. Idempotent. Never touches
# args.gn; the next autoninja re-runs gn by itself.
#
#   engine/arcadiacore/apply.sh            copy + hook
#   engine/arcadiacore/apply.sh --check    exit 1 if the tree differs from the repo
#
# Build (holding the chromium lock):
#   scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}

if [[ "${1:-}" == --check ]]; then
  diff -r "$here/src/arcadia" "$src/arcadia" >/dev/null &&
    grep -q 'arcadia_alive' "$src/chrome/browser/ui/autofill/autofill_popup_controller_impl.cc" &&
    grep -q 'g_arcadia_opacity_from_default_color' "$src/content/browser/renderer_host/render_widget_host_view_base.cc" &&
    grep -q '"//arcadia/core"' "$src/chrome/BUILD.gn" &&
    grep -q 'g_arcadia_browser_window_factory(this)' "$src/chrome/browser/ui/browser.cc" &&
    grep -q 'Arcadia: ArcadiaCore' "$src/chrome/browser/ui/sad_tab_controller.cc" &&
    grep -q 'g_arcadia_external_protocol_dialog(' "$src/chrome/browser/external_protocol/external_protocol_handler.cc" &&
    grep -q 'arcadiacore::ACMainDelegate' "$src/chrome/app/chrome_main.cc" &&
    grep -q 'g_arcadia_create_web_contents_delegate(' "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" &&
    grep -q "Arcadia: ArcadiaCore's own window" "$src/chrome/browser/ui/browser.cc" &&
    grep -q 'g_arcadia_create_permission_prompt(' "$src/chrome/browser/ui/views/permissions/permission_prompt_factory.cc" &&
    grep -q 'g_arcadia_context_menu_show)(RenderViewContextMenu\* menu) = nullptr' "$src/chrome/browser/renderer_context_menu/render_view_context_menu.cc" &&
    grep -q 'g_arcadia_context_menu_show(this)' "$src/chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_cocoa.mm" &&
    grep -q 'g_arcadia_context_menu_show(this)' "$src/chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_remote_cocoa.mm" &&
    grep -q 'g_arcadia_context_menu_show(this)' "$src/chrome/browser/ui/views/renderer_context_menu/render_view_context_menu_views.cc" &&
    grep -q 'g_arcadia_resource_bundle_delegate,' "$src/chrome/app/chrome_main_delegate.cc" &&
    grep -q 'if (!g_arcadia_embedder)' "$src/chrome/app/chrome_main_delegate.cc" &&
    grep -q 'g_arcadia_embedder &&' "$src/chrome/browser/chrome_browser_main.cc" &&
    grep -q 'if (!g_arcadia_embedder)' "$src/chrome/browser/chrome_browser_main_mac.mm" &&
    grep -q 'if (!g_arcadia_embedder)' "$src/chrome/browser/chrome_content_browser_client.cc" &&
    grep -q 'Arcadia: ArcadiaCore reads no platform policy' "$src/chrome/browser/policy/chrome_browser_policy_connector.cc" &&
    grep -q 'Arcadia: ArcadiaCore' "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc" &&
    grep -q 'Arcadia: ArcadiaCore' "$src/chrome/browser/ui/toasts/toast_controller.cc" &&
    grep -q 'Arcadia: ArcadiaCore shows no toast' "$src/chrome/browser/ui/toasts/toast_controller.cc" &&
    grep -q 'BrowserView, so no pinned tab toast' "$src/chrome/browser/ui/browser_commands.cc" &&
    grep -q 'have no BrowserView element' "$src/chrome/browser/ui/webui/settings/settings_clear_browsing_data_handler.cc" &&
    grep -q 'g_arcadia_history_eligible(' "$src/chrome/browser/history/history_tab_helper.cc" &&
    grep -q 'g_arcadia_dnr_rule_matched(' "$src/extensions/browser/api/declarative_net_request/action_tracker.cc" &&
    grep -q 'g_arcadia_dnr_rulesets_in_force(' "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" &&
    grep -q 'Arcadia: ArcadiaCore. A component extension' "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" &&
    grep -q 'Arcadia: ArcadiaCore' "$src/chrome/browser/extensions/browser_window_util.cc" &&
    grep -q 'g_arcadia_extension_installed(' "$src/chrome/browser/ui/extensions/extension_install_ui_desktop.cc" &&
    grep -q 'g_arcadia_prompts_without_tab' "$src/chrome/browser/download/download_crx_util.cc" &&
    grep -q 'g_arcadia_tab_shown_by_host' "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.cc" &&
    grep -q 'g_arcadia_permission_tab_shown' "$src/components/permissions/permission_request_manager.cc" &&
    grep -q 'g_arcadia_file_system_restore_prompt' "$src/chrome/browser/ui/views/file_system_access/file_system_access_restore_permission_bubble_view.cc" &&
    grep -q 'g_arcadia_tab_shown_by_host' "$src/chrome/browser/ui/tabs/tab_dialog_manager.cc" &&
    grep -q 'g_arcadia_open_action_popup' "$src/chrome/browser/extensions/api/extension_action/extension_action_api.cc"
  exit
fi

mkdir -p "$src/arcadia"
# No -t: a changed file gets a new mtime, so ninja always sees it (a restored older copy too).
rsync -r --delete --checksum "$here/src/arcadia/" "$src/arcadia/"

python3 - "$src/chrome/BUILD.gn" <<'PY'
import re, sys
path = sys.argv[1]
s = open(path).read()
if '"//arcadia/core"' in s:
    sys.exit(0)
# The macOS chrome_dll (the source_set the framework links): its deps end with cld_3.
mac = s.index('target(_dll_target_type, "chrome_dll")')
anchor = '      "//third_party/cld_3/src/src:cld_3",\n'
at = s.index(anchor, mac) + len(anchor)
hook = '      "//arcadia/core",  # Arcadia: ArcadiaCore (engine/arcadiacore)\n'
open(path, "w").write(s[:at] + hook + s[at:])
print("hooked //chrome:chrome_dll")
PY

# ChromeMain (chrome/app/chrome_main.cc, compiled into Chrome's framework) makes ArcadiaCore's
# delegate, a ChromeMainDelegate, for every process.
python3 - "$src/chrome/app/chrome_main.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "arcadiacore::ACMainDelegate" in s:
    sys.exit(0)
old = """#else  // BUILDFLAG(IS_WIN)
  ChromeMainDelegate chrome_main_delegate(
      {.exe_entry_point_ticks = base::TimeTicks::Now()});"""
new = """#else  // BUILDFLAG(IS_WIN)
  // Arcadia: ArcadiaCore's delegate (engine/arcadiacore), a ChromeMainDelegate.
  arcadiacore::ACMainDelegate chrome_main_delegate(
      {.exe_entry_point_ticks = base::TimeTicks::Now()});"""
inc_old = '#if BUILDFLAG(IS_MAC)\n#include "chrome/app/chrome_main_mac.h"\n'
inc_new = inc_old + '#include "arcadia/core/ac_main_delegate.h"  // nogncheck\n'
assert old in s and inc_old in s
s = s.replace(old, new).replace(inc_old, inc_new)
open(path, "w").write(s)
print("hooked ChromeMain")
PY

# ArcadiaCore makes the WebContentsDelegate of its own Browsers (ACWebContentsDelegate: every new tab
# and window stays in the host's window); a Browser Chrome keeps gets Chrome's. ArcadiaCore answers
# from the Browser's window (one of its own, ac_browser_window.h), and only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/ui/browser_window/internal/browser_window_features.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_create_web_contents_delegate" in s:
    sys.exit(0)
at = "BrowserWindowFeatures::BrowserWindowFeatures() = default;\n"
decl = """// Arcadia: ArcadiaCore (engine/arcadiacore) makes the WebContentsDelegate of the Browsers it hosts.
std::unique_ptr<BrowserWebContentsDelegate> (
    *g_arcadia_create_web_contents_delegate)(
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
new = """  // Arcadia: ArcadiaCore
  if (g_arcadia_create_web_contents_delegate) {
    browser_web_contents_delegate_ = g_arcadia_create_web_contents_delegate(
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
# panel UI. A viewless Browser has none (until ArcadiaCore implements SidePanelUI, as Dia does).
# g_arcadia_viewless_browsers (defined with the toast hook below) says ArcadiaCore runs the process.
python3 - "$src/chrome/browser/ui/read_anything/read_anything_side_panel_controller.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "Arcadia: ArcadiaCore" in s:
    sys.exit(0)
old = """    if (!webui_browser::IsWebUIBrowserEnabled()) {
      CHECK_IS_TEST();
    }"""
new = """    // Arcadia: ArcadiaCore's Browsers have no BrowserView, so no side panel UI.
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !g_arcadia_viewless_browsers) {
      CHECK_IS_TEST();
    }"""
inc_old = '#include "ui/base/metadata/metadata_types.h"\n'
inc_new = inc_old + ("\n// Arcadia: ArcadiaCore (engine/arcadiacore); defined in toast_controller.cc.\n"
                     "extern bool g_arcadia_viewless_browsers;\n")
assert s.count(old) == 1 and s.count(inc_old) == 1
open(path, "w").write(s.replace(old, new).replace(inc_old, inc_new))
print("hooked ReadAnythingSidePanelController")
PY

# Chrome's toasts ("Image copied", "Link copied") anchor to a BrowserView, and without an anchor
# ToastController CHECKs that it's a test: right-click > Copy Image aborted the app. A viewless
# Browser shows none. ArcadiaCore sets g_arcadia_viewless_browsers at launch.
python3 - "$src/chrome/browser/ui/toasts/toast_controller.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "Arcadia: ArcadiaCore" in s:
    sys.exit(0)
old = """    if (!webui_browser::IsWebUIBrowserEnabled()) {
      CHECK_IS_TEST();
    }"""
new = """    // Arcadia: ArcadiaCore's Browsers have no BrowserView to anchor a toast to.
    if (!webui_browser::IsWebUIBrowserEnabled() &&
        !(browser_window_interface_ && g_arcadia_viewless_browsers)) {
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
if "Arcadia: ArcadiaCore shows no toast" in s:
    sys.exit(0)
old = """bool ToastController::MaybeShowToast(ToastParams params) {
  if (!CanShowToast(params.toast_id)) {"""
new = """// Arcadia: ArcadiaCore (engine/arcadiacore) runs this process: its Browsers may have no
// BrowserView (reading mode's side panel controller reads it too).
bool g_arcadia_viewless_browsers = false;

bool ToastController::MaybeShowToast(ToastParams params) {
  // Arcadia: ArcadiaCore shows no toast without an anchor, before any state is set.
  if (browser_window_interface_ && g_arcadia_viewless_browsers) {
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

# Closing a selection of pinned tabs (IDC_CLOSE_TAB, ⌘W as Chrome's command) asks for a confirmation
# toast with the command's accelerator, and CHECKs the Browser's BrowserView for it. A viewless
# Browser closes them as Chrome does without a ToastController.
python3 - "$src/chrome/browser/ui/browser_commands.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "so no pinned tab toast" in s:
    sys.exit(0)
old = """  ToastController* toast_controller = browser->GetFeatures().toast_controller();
  if (!toast_controller) {"""
new = """  ToastController* toast_controller = browser->GetFeatures().toast_controller();
  // Arcadia: ArcadiaCore's Browsers have no BrowserView, so no pinned tab toast.
  if (!toast_controller || (g_arcadia_viewless_browsers &&
                            !BrowserView::GetBrowserViewForBrowser(browser))) {"""
inc_old = '#include "chrome/browser/ui/views/contextual_tasks/contextual_tasks_close_button_controller.h"\n#endif\n'
inc_new = inc_old + ("\n// Arcadia: ArcadiaCore (engine/arcadiacore); defined in toast_controller.cc.\n"
                     "extern bool g_arcadia_viewless_browsers;\n")
assert s.count(old) == 1 and s.count(inc_old) == 1
open(path, "w").write(s.replace(old, new).replace(inc_old, inc_new))
print("hooked CloseTab's pinned tab toast")
PY

# Clearing history in chrome://settings tells the BrowserView's element (user education) and
# CHECKs it is there. A viewless Browser has no such element: nothing to tell.
python3 - "$src/chrome/browser/ui/webui/settings/settings_clear_browsing_data_handler.cc" <<'PY'
import sys
path = sys.argv[1]
s = open(path).read()
if "have no BrowserView element" in s:
    sys.exit(0)
old = """    CHECK(browser_element);
    ui::ElementTracker::GetFrameworkDelegate()->NotifyCustomEvent(
        browser_element,
        browsing_data_important_sites_util::kClearBrowsingDataHistoryEventId);
  }"""
new = """    // Arcadia: ArcadiaCore's Browsers have no BrowserView element.
    CHECK(browser_element || g_arcadia_viewless_browsers);
    if (browser_element) {
      ui::ElementTracker::GetFrameworkDelegate()->NotifyCustomEvent(
          browser_element,
          browsing_data_important_sites_util::kClearBrowsingDataHistoryEventId);
    }
  }"""
inc_old = '#include "ui/base/text/bytes_formatting.h"\n'
inc_new = inc_old + ("\n// Arcadia: ArcadiaCore (engine/arcadiacore); defined in toast_controller.cc.\n"
                     "extern bool g_arcadia_viewless_browsers;\n")
assert s.count(old) == 1 and s.count(inc_old) == 1
open(path, "w").write(s.replace(old, new).replace(inc_old, inc_new))
print("hooked ClearBrowsingDataHandler")
PY

# A Browser Chrome makes itself (chrome.windows.create, an incognito window, undocked DevTools,
# document Picture in Picture) asks ArcadiaCore for its window before Chrome builds a BrowserView:
# ArcadiaCore may host it in one of the app's windows. And a Browser ArcadiaCore makes takes the window ArcadiaCore
# made for it (BrowserWindowCreateParams::window), which Chrome otherwise allows only in tests. The
# factory is only ever set by ArcadiaCore, as it starts, before any Browser.
python3 - "$src/chrome/browser/ui/browser.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_browser_window_factory" in s:
    sys.exit(0)
old_ctor = "Browser::Browser(BrowserWindowCreateParams params)\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) supplies the window of a Browser it hosts.\n"
        "BrowserWindow* (*g_arcadia_browser_window_factory)(Browser*) = nullptr;\n\n")
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

  // Arcadia: ArcadiaCore's own window for a Browser it makes (tests only, otherwise).
  if (custom_window && !g_arcadia_browser_window_factory) {
    CHECK_IS_TEST() << "BrowserWindowCreateParams::window is a test-only param";
  }
  // Arcadia: ArcadiaCore may host a Browser Chrome makes itself.
  BrowserWindow* const hosted_window =
      !custom_window && g_arcadia_browser_window_factory
          ? g_arcadia_browser_window_factory(this)
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
# under ENABLE_CEF (CEF's chrome_runtime.patch), now at run time: g_arcadia_embedder, which
# ACMainDelegate sets in every process. ArcadiaCore does these itself (ac_main_delegate.cc) or wants
# them off: --user-data-dir and the component paths, the startup metrics' core system profile, the
# sampling profiler, Chrome's first run and initial prefs, --make-default-browser,
# StartupBrowserCreator and the main RunLoop it makes, AppController and Chrome's main menu, the
# about: -> chrome: URL handler, and the crash reporter (crash keys, ChromeCrashReporterClient,
# crashpad: crashes stay with macOS's own reports). And Chrome's strings load through ArcadiaCore's
# ResourceBundle delegate (g_arcadia_resource_bundle_delegate), in every process.
python3 - "$src/chrome/app/chrome_main_delegate.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_embedder" in s:
    sys.exit(0)
def gate(s, start, end, why):
    i = s.index(start)
    j = s.index(end, i) + len(end)
    body = "".join(("  " + l if l.strip() and not l.startswith("#") else l)
                   for l in s[i:j].splitlines(True))
    return s[:i] + "  // Arcadia: ArcadiaCore " + why + "\n  if (!g_arcadia_embedder) {\n" + body + "  }\n" + s[j:]
decl_at = """#if BUILDFLAG(IS_ANDROID)
ChromeMainDelegate::ChromeMainDelegate()
    : ChromeMainDelegate(StartupTimestamps{}) {}
#endif
"""
decl = """// Arcadia: ArcadiaCore (engine/arcadiacore) embeds Chrome: it does some of Chrome's startup itself.
bool g_arcadia_embedder = false;
// Arcadia: ArcadiaCore's ResourceBundle delegate (its product strings).
ui::ResourceBundle::Delegate* g_arcadia_resource_bundle_delegate = nullptr;

"""
assert s.count(decl_at) == 1
s = s.replace(decl_at, decl + decl_at)
old = """  std::string actual_locale = LoadLocalState(
      chrome_feature_list_creator, invoked_in_browser->is_running_test);
"""
new = """  std::string actual_locale = LoadLocalState(
      chrome_feature_list_creator,
      g_arcadia_resource_bundle_delegate,  // Arcadia: ArcadiaCore
      invoked_in_browser->is_running_test);
"""
assert s.count(old) == 1
s = s.replace(old, new)
old = """            locale, nullptr, ui::ResourceBundle::LOAD_COMMON_RESOURCES);
"""
new = """            locale, g_arcadia_resource_bundle_delegate,  // Arcadia: ArcadiaCore
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
new = """  // Arcadia: ArcadiaCore records no core system profile.
  bool record = !g_arcadia_embedder;
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
  // Arcadia: ArcadiaCore starts it itself.
  if (!g_arcadia_embedder) {
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
if "g_arcadia_embedder" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Arcadia: ArcadiaCore (engine/arcadiacore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_arcadia_embedder;\n")
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
s = s[:i] + "  // Arcadia: ArcadiaCore has no first run.\n  if (!g_arcadia_embedder) {\n" + body + "  }\n" + s[j:]
reps = [
("""  if (first_run::IsChromeFirstRun()) {
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(switches::kApp) &&""",
"""  // Arcadia: ArcadiaCore has no first run.
  if (!g_arcadia_embedder && first_run::IsChromeFirstRun()) {
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(switches::kApp) &&"""),
("""  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          switches::kMakeDefaultBrowser)) {""",
"""  // Arcadia: ArcadiaCore
  if (!g_arcadia_embedder &&
      base::CommandLine::ForCurrentProcess()->HasSwitch(
          switches::kMakeDefaultBrowser)) {"""),
("""  // on preferences.
  if (first_run::IsChromeFirstRun()) {""",
"""  // on preferences.
  // Arcadia: ArcadiaCore has no first run.
  if (!g_arcadia_embedder && first_run::IsChromeFirstRun()) {"""),
("""  // This step is costly.
  if (browser_creator_->Start(*base::CommandLine::ForCurrentProcess(),
                              base::FilePath(), profile_info,
                              last_opened_profiles)) {""",
"""  // This step is costly.
  // Arcadia: ArcadiaCore opens its own windows and runs the main loop itself.
  if (!g_arcadia_embedder &&
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
if "g_arcadia_embedder" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Arcadia: ArcadiaCore (engine/arcadiacore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_arcadia_embedder;\n")
i = s.index(ns)
s = s[:i] + decl + s[i:]
start = "  // Create the app delegate by requesting the shared AppController.\n"
end = "  [app_controller mainMenuCreated];\n"
assert s.count(start) == 1 and s.count(end) == 1
i = s.index(start); j = s.index(end, i) + len(end)
body = "".join(("  " + l if l.strip() else l) for l in s[i:j].splitlines(True))
s = s[:i] + ("  // Arcadia: ArcadiaCore's app has its own NSApp delegate and main menu.\n"
             "  if (!g_arcadia_embedder) {\n") + body + "  }\n" + s[j:]
old = "  [AppController.sharedController didEndMainMessageLoop];\n"
new = ("  // Arcadia: ArcadiaCore\n  if (!g_arcadia_embedder) {\n"
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
if "g_arcadia_embedder" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Arcadia: ArcadiaCore (engine/arcadiacore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_arcadia_embedder;\n")
i = s.index(ns)
s = s[:i] + decl + s[i:]
old = """  // chrome: & friends.
  handler->AddHandlerPair(&ChromeContentBrowserClient::HandleWebUI,
                          &ChromeContentBrowserClient::HandleWebUIReverse);
"""
new = """  // chrome: & friends.
  // Arcadia: ArcadiaCore maps its own URLs (as CEF's build did).
  if (!g_arcadia_embedder) {
    handler->AddHandlerPair(&ChromeContentBrowserClient::HandleWebUI,
                            &ChromeContentBrowserClient::HandleWebUIReverse);
  }
"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked ChromeContentBrowserClient's URL handlers (embedder)")
PY2

# No platform policy provider for an embedder's Chrome, as on CEF (whose chrome_browser_policy patch made
# CreatePlatformProvider return none unless the embedder named a policy id, which ArcadiaCore never did). The
# macOS one's first load runs on the main thread before BrowserMain and waits for /usr/bin/profiles
# (base::IsManagedDevice): 0.2.31 launched 10-20 ms later for it, and it read every Chrome policy key
# from the app's managed preferences, which no ArcadiaCore build had done.
python3 - "$src/chrome/browser/policy/chrome_browser_policy_connector.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "Arcadia: ArcadiaCore reads no platform policy" in s:
    sys.exit(0)
ns = "\nnamespace policy {\n"
decl = ("\n// Arcadia: ArcadiaCore (engine/arcadiacore) embeds Chrome; defined in chrome_main_delegate.cc.\n"
        "extern bool g_arcadia_embedder;\n")
assert s.count(ns) == 1
s = s.replace(ns, decl + ns)
old = """ChromeBrowserPolicyConnector::CreatePlatformProvider() {
#if BUILDFLAG(IS_WIN)
"""
new = """ChromeBrowserPolicyConnector::CreatePlatformProvider() {
  // Arcadia: ArcadiaCore reads no platform policy (as CEF's build, which made none without a policy id).
  if (g_arcadia_embedder) {
    return nullptr;
  }
#if BUILDFLAG(IS_WIN)
"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked ChromeBrowserPolicyConnector's platform provider (embedder)")
PY2

# Chrome's permission prompts ask ArcadiaCore first: the host's tabs show the host's own prompt
# (ac_permissions.mm). ArcadiaCore returns a prompt, or null with `default_handling` false for none, or
# null with it true for Chrome's bubble. Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/ui/views/permissions/permission_prompt_factory.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_create_permission_prompt" in s:
    sys.exit(0)
at = """}  // namespace

bool ShouldShowPermissionPromptEvenIfOmniboxEditedOrEmpty(
"""
decl = """}  // namespace

// Arcadia: ArcadiaCore (engine/arcadiacore) shows the prompts of the tabs it hosts.
std::unique_ptr<permissions::PermissionPrompt> (
    *g_arcadia_create_permission_prompt)(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling) = nullptr;

bool ShouldShowPermissionPromptEvenIfOmniboxEditedOrEmpty(
"""
old = """std::unique_ptr<permissions::PermissionPrompt> CreatePermissionPrompt(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate) {
"""
new = old + """  // Arcadia: ArcadiaCore
  if (g_arcadia_create_permission_prompt) {
    bool default_handling = true;
    auto prompt = g_arcadia_create_permission_prompt(web_contents, delegate,
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

# Chrome's context menus ask ArcadiaCore before showing: a background (test) instance's menu goes to
# the host instead of the screen (ac_context_menu.mm). Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/renderer_context_menu/render_view_context_menu.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_context_menu_show" in s:
    sys.exit(0)
ns = "\nnamespace {\n"
decl = ("\n// Arcadia: ArcadiaCore (engine/arcadiacore) may show a context menu itself: true if it did.\n"
        "bool (*g_arcadia_context_menu_show)(RenderViewContextMenu* menu) = nullptr;\n")
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
if "g_arcadia_context_menu_show" in s:
    sys.exit(0)
old = "void %s::Show() {\n" % cls
new = ("// Arcadia: ArcadiaCore (engine/arcadiacore); defined in render_view_context_menu.cc.\n"
       "extern bool (*g_arcadia_context_menu_show)(RenderViewContextMenu* menu);\n\n"
       + old + "  // Arcadia: ArcadiaCore\n"
       "  if (g_arcadia_context_menu_show && g_arcadia_context_menu_show(this)) {\n"
       "    return;\n  }\n\n")
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked " + cls + "::Show")
PY2
done

# A renderer crash shows Chrome's sad tab in the tab's ContentsWebView, found through the
# Browser's BrowserView; ArcadiaCore's Browsers have none (the host shows its own, from
# tab:rendererGone:code:). Without one the sad tab stays unattached, as in unit tests.
python3 - "$src/chrome/browser/ui/sad_tab_controller.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "Arcadia: ArcadiaCore" in s:
    sys.exit(0)
old = """  BrowserView* browser_view = BrowserView::GetBrowserViewForBrowser(browser);
  DCHECK(browser_view);
"""
new = """  BrowserView* browser_view = BrowserView::GetBrowserViewForBrowser(browser);
  // Arcadia: ArcadiaCore's Browsers have no BrowserView (engine/arcadiacore).
  if (!browser_view) {
    return nullptr;
  }
"""
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
print("hooked SadTabController")
PY2

# Chrome's autofill dropdown tells ArcadiaCore each time it shows, whoever filled it: addresses and
# entries (BrowserAutofillManager), saved passwords (PasswordAutofillManager, the manual
# fallback), so the host hears of all of them (tab:didShowAutofillSuggestions:); also when its
# search bar couldn't take focus in an app that isn't active (Chrome then doesn't count it
# shown, though it is on screen). Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/ui/autofill/autofill_popup_controller_impl.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "arcadia_alive" in s:
    sys.exit(0)
old_fn = "void AutofillPopupControllerImpl::Show(\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) hears of each dropdown shown.\n"
        "void (*g_arcadia_autofill_suggestions_shown)(\n"
        "    content::WebContents* web_contents,\n"
        "    base::span<const Suggestion> suggestions) = nullptr;\n\n")
old = """  delegate_->OnSuggestionsShown(
      non_filtered_suggestions_,
"""
new = """  // Arcadia: ArcadiaCore
  if (g_arcadia_autofill_suggestions_shown && IsRootPopup() && web_contents_) {
    g_arcadia_autofill_suggestions_shown(web_contents_.get(),
                                           non_filtered_suggestions_);
  }
""" + old
# A dropdown with a search bar (the saved passwords) counts as shown only once its window
# takes focus, which it can't in an app that isn't active: on screen all the same.
old2 = """    if (!view_->Show(autoselect_first_suggestion)) {
      return;
    }
"""
new2 = """    auto arcadia_alive = GetWeakPtr();
    if (!view_->Show(autoselect_first_suggestion)) {
      // Arcadia: ArcadiaCore hears of a dropdown on screen whose search bar couldn't
      // take focus (an app that isn't active), which Chrome doesn't count as shown.
      if (arcadia_alive && view_ && g_arcadia_autofill_suggestions_shown &&
          IsRootPopup() && web_contents_) {
        g_arcadia_autofill_suggestions_shown(web_contents_.get(),
                                               non_filtered_suggestions_);
      }
      return;
    }
"""
if "g_arcadia_autofill_suggestions_shown" not in s:
    assert s.count(old_fn) == 1 and s.count(old) == 1
    s = s.replace(old_fn, decl + old_fn).replace(old, new)
assert s.count(old2) == 1
s = s.replace(old2, new2)
open(path, "w").write(s)
print("hooked AutofillPopupControllerImpl")
PY2

# A new document's view takes over the last page's background (CopyBackgroundColorIfPresentFrom)
# and, when that background isn't opaque, tells the renderer to paint the page on a transparent
# base: with ArcadiaCore's translucent page background (the host's pageBackgroundColor), every
# navigation that swapped views after the last page reported its background lost it. With the
# hook set, the opacity follows the colours the embedder set, as SetBackgroundColor's does.
# Only ArcadiaCore sets the hook.
python3 - "$src/content/browser/renderer_host/render_widget_host_view_base.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_opacity_from_default_color" in s:
    sys.exit(0)
old_fn = "void RenderWidgetHostViewBase::CopyBackgroundColorIfPresentFrom(\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) has a translucent page background.\n"
        "bool g_arcadia_opacity_from_default_color = false;\n\n")
old = """  bool was_opaque = IsBackgroundColorOpaque();
  content_background_color_ = other_base.content_background_color_;
  default_background_color_ = other_base.default_background_color_;
  UpdateBackgroundColor();
  bool opaque = IsBackgroundColorOpaque();
"""
new = """  bool was_opaque = IsBackgroundColorOpaque();
  // Arcadia: ArcadiaCore
  const auto arcadia_opaque = [this] {
    return !default_background_color_ ||
           SkColorGetA(*default_background_color_) == SK_AlphaOPAQUE;
  };
  if (g_arcadia_opacity_from_default_color) {
    was_opaque = arcadia_opaque();
  }
  content_background_color_ = other_base.content_background_color_;
  default_background_color_ = other_base.default_background_color_;
  UpdateBackgroundColor();
  bool opaque = g_arcadia_opacity_from_default_color ? arcadia_opaque()
                                                       : IsBackgroundColorOpaque();
"""
assert s.count(old_fn) == 1 and s.count(old) == 1
s = s.replace(old_fn, decl + old_fn).replace(old, new)
open(path, "w").write(s)
print("hooked RenderWidgetHostViewBase")
PY2

# Chrome's "Open <app>?" dialog for a link to another app (mailto: aside, which Chrome opens
# unasked) asks ArcadiaCore first, before the Mac's "no app for this scheme" check: for the host's
# tabs the host shows its own (and launches through Chrome on "open"). Only ArcadiaCore sets the
# hook.
python3 - "$src/chrome/browser/external_protocol/external_protocol_handler.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_external_protocol_dialog" in s:
    sys.exit(0)
old_fn = "\nnamespace {\n"
decl = """
// Arcadia: ArcadiaCore (engine/arcadiacore) shows this dialog itself for the tabs it hosts.
bool (*g_arcadia_external_protocol_dialog)(
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
  // Arcadia: ArcadiaCore
  if (!delegate && g_arcadia_external_protocol_dialog &&
      g_arcadia_external_protocol_dialog(url, web_contents, initiating_origin,
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

# HistoryTabHelper asks ArcadiaCore whether a tab's navigations are history: the host's own pages
# (the content blocker's hidden extension page, extension popups and side panels) never are,
# as CEF's Alloy browsers never were. Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/history/history_tab_helper.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_history_eligible" in s:
    sys.exit(0)
old_fn = "bool HistoryTabHelper::IsEligibleTab(\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) keeps its own pages out of history.\n"
        "bool (*g_arcadia_history_eligible)(content::WebContents*) = nullptr;\n\n")
old = """  if (force_eligible_tab_for_testing_) {
    return true;
  }
"""
new = """  if (force_eligible_tab_for_testing_) {
    return true;
  }
  // Arcadia: ArcadiaCore
  if (g_arcadia_history_eligible && web_contents() &&
      !g_arcadia_history_eligible(web_contents())) {
    return false;
  }
"""
assert s.count(old_fn) == 1 and s.count(old) == 1
s = s.replace(old_fn, decl + old_fn).replace(old, new)
open(path, "w").write(s)
print("hooked HistoryTabHelper")
PY2

# declarativeNetRequest's ActionTracker tells ArcadiaCore of each rule an extension's ruleset applied
# to a tab's request (block, redirect…), as it counts them for the action's badge: the host's
# blocked count follows what was stopped, redirects to a stand-in included. Only ArcadiaCore sets
# the hook.
python3 - "$src/extensions/browser/api/declarative_net_request/action_tracker.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_dnr_rule_matched" in s:
    sys.exit(0)
old_ns = "namespace extensions::declarative_net_request {\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) counts what extensions' rules did to a tab's requests.\n"
        "void (*g_arcadia_dnr_rule_matched)(\n"
        "    content::BrowserContext* browser_context,\n"
        "    int tab_id,\n"
        "    const extensions::declarative_net_request::RequestAction& action,\n"
        "    const extensions::WebRequestInfo& request) = nullptr;\n\n")
old = """  const int tab_id =
      GetTabIdForMatchedRule(browser_context_, request_info.frame_data.tab_id);
"""
new = old + """  // Arcadia: ArcadiaCore
  if (g_arcadia_dnr_rule_matched) {
    g_arcadia_dnr_rule_matched(browser_context_, tab_id, request_action,
                                 request_info);
  }
"""
assert s.count(old_ns) == 1 and s.count(old) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new)
open(path, "w").write(s)
print("hooked declarativeNetRequest's ActionTracker")
PY2

# declarativeNetRequest's RulesMonitorService loads a component extension's enabled static
# rulesets with the extension, and tells ArcadiaCore when the rulesets an extension had as it loaded
# are in force (read from disk on another sequence, a moment after the load): ArcadiaCore holds a
# profile's navigations until its content blocker's are (ac_navigation_hold.mm). A component
# extension is never installed, so nothing indexed its rulesets and recorded their checksums:
# Chrome skipped them all as "checksum not found" and the content blocker had no rules in a new
# profile until its service worker turned its lists on again. Now they're indexed on that first
# load (as Chrome indexes a ruleset enabled after install) and their checksums kept. Only ArcadiaCore
# loads component extensions with rulesets and sets the hook.
python3 - "$src/extensions/browser/api/declarative_net_request/rules_monitor_service.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_dnr_rulesets_in_force" in s:
    sys.exit(0)
old_ns = "namespace extensions {\nnamespace declarative_net_request {\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) holds a profile's navigations until a content blocker's\n"
        "// rulesets are in force.\n"
        "void (*g_arcadia_dnr_rulesets_in_force)(\n"
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

  // Arcadia: ArcadiaCore
  if (g_arcadia_dnr_rulesets_in_force) {
    g_arcadia_dnr_rulesets_in_force(
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
      // Arcadia: ArcadiaCore. A component extension was never installed, so
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
if "Arcadia: ArcadiaCore" in s:
    sys.exit(0)
old_inc = '#include "components/tabs/public/tab_interface.h"\n'
new_inc = old_inc + ("\n// Arcadia: ArcadiaCore (engine/arcadiacore); defined in\n"
                     "// browser_extension_window_controller.cc.\n"
                     "extern bool (*g_arcadia_hidden_from_extensions)(\n"
                     "    const BrowserWindowInterface* browser);\n")
old = """  if (restrict_to_normal_browsers &&
      browser.GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return false;
  }
"""
new = old + """
  // Arcadia: ArcadiaCore. The host's own hidden pages are no extension's window.
  if (g_arcadia_hidden_from_extensions &&
      g_arcadia_hidden_from_extensions(&browser)) {
    return false;
  }
"""
assert s.count(old_inc) == 1 and s.count(old) == 1
s = s.replace(old_inc, new_inc).replace(old, new)
open(path, "w").write(s)
print("hooked extensions' browser_window_util")
PY2

# Chrome's post-install UI ("<name> has been added") asks ArcadiaCore first. Chrome's finds or makes
# a tabbed Browser for it (a hidden window of ours, given none of the app's), adds a tab when
# the Browser has none, and reads that Browser's active tab later through a raw pointer (the
# host had closed the tab, or the window: a crash), then reaches for its BrowserView's
# toolbar when the bubble closes (ours have none). ArcadiaCore shows the bubble over a window the
# app shows for the profile, later if there is none yet. Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/ui/extensions/extension_install_ui_desktop.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_extension_installed" in s:
    sys.exit(0)
old_ns = "using content::BrowserThread;\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) shows the post-install UI for the windows it hosts.\n"
        "bool (*g_arcadia_extension_installed)(\n"
        "    Profile* profile,\n"
        "    scoped_refptr<const extensions::Extension> extension,\n"
        "    const SkBitmap* icon) = nullptr;\n\n")
old = """  // Extensions aren't enabled by default in incognito so we confirm
  // the install in a normal window.
"""
new = """  // Arcadia: ArcadiaCore
  if (g_arcadia_extension_installed &&
      g_arcadia_extension_installed(profile(), extension, icon)) {
    return;
  }

""" + old
assert s.count(old_ns) == 1 and s.count(old) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new)
open(path, "w").write(s)
print("hooked the extension post-install UI")
PY2

# A downloaded .crx whose tab has gone asks without a tab under ArcadiaCore (its install prompt is
# the app's): Chrome would find a Browser, or make one (a hidden window of ours), and read its
# active tab, which a Browser of the app's need not have. Only ArcadiaCore sets the flag.
python3 - "$src/chrome/browser/download/download_crx_util.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_prompts_without_tab" in s:
    sys.exit(0)
old_ns = "namespace download_crx_util {\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) shows the install prompt itself, without a tab.\n"
        "bool g_arcadia_prompts_without_tab = false;\n\n")
old = """  if (!web_contents) {
    BrowserWindowInterface* browser =
"""
new = """  // Arcadia: ArcadiaCore
  if (!web_contents && g_arcadia_prompts_without_tab) {
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
# the hook set, the brand list is Chrome's. Only ArcadiaCore sets the hook.
python3 - "$src/components/embedder_support/user_agent_utils.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_user_agent_brand" in s:
    sys.exit(0)
old_ns = "namespace embedder_support {\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) reports Chrome's brand.\n"
        "const char* g_arcadia_user_agent_brand = nullptr;\n\n")
old = """#if !BUILDFLAG(CHROMIUM_BRANDING)
  brand = version_info::GetProductName();
#endif
"""
new = old + """  // Arcadia: ArcadiaCore
  if (g_arcadia_user_agent_brand) {
    brand = g_arcadia_user_agent_brand;
  }
"""
assert s.count(old_ns) >= 1 and s.count(old) == 1
s = s.replace(old_ns, decl + old_ns, 1).replace(old, new)
open(path, "w").write(s)
print("hooked the user agent brand")
PY2

# Chrome's automatic Picture in Picture (a call's own window) follows the tab strip's active tab.
# The host shows more and less than that (engine/arcadiacore ac_host_visibility.h): both panes of a split
# (focusing the other pane made Chrome take the call as left), and its own pages over the strip's
# active tab (New Tab, another Space: the strip doesn't change). With the hook set, a tab the host
# reported reads as activated exactly while the host shows it, and the host's changes reach the
# observer (ArcadiaAutoPictureInPictureHostVisibilityChanged) as the strip's do. Only ArcadiaCore sets
# the hook.
python3 - "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.h" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "ArcadiaHostVisibilityChanged" in s:
    sys.exit(0)
old = """ private:
  void UpdateIsTabActivated(const TabStripModel* tab_strip_model);
"""
new = """  // Arcadia: ArcadiaCore's host showed or hid `contents`: if it is this helper's tab, read it
  // again, as on a strip change (true).
  bool ArcadiaHostVisibilityChanged(content::WebContents* contents);

""" + old
assert s.count(old) == 1
open(path, "w").write(s.replace(old, new))
PY2
python3 - "$src/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_strip_observer_helper.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_tab_shown_by_host" in s:
    sys.exit(0)
old_fn = "// static\nstd::unique_ptr<AutoPictureInPictureTabObserverHelperBase>\n"
decl = """// Arcadia: ArcadiaCore (engine/arcadiacore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
int (*g_arcadia_tab_shown_by_host)(content::WebContents*) = nullptr;

namespace {
// Arcadia: ArcadiaCore: the helpers observing a strip, to tell of the host's changes.
std::set<AutoPictureInPictureTabStripObserverHelper*>& ArcadiaObserving() {
  static base::NoDestructor<std::set<AutoPictureInPictureTabStripObserverHelper*>> helpers;
  return *helpers;
}
}  // namespace

// Arcadia: ArcadiaCore
void ArcadiaAutoPictureInPictureHostVisibilityChanged(
    content::WebContents* contents) {
  for (AutoPictureInPictureTabStripObserverHelper* helper : ArcadiaObserving()) {
    if (helper->ArcadiaHostVisibilityChanged(contents)) {
      return;
    }
  }
}

bool AutoPictureInPictureTabStripObserverHelper::ArcadiaHostVisibilityChanged(
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
start_new = start_old + """  ArcadiaObserving().insert(this);  // Arcadia: ArcadiaCore
"""
stop_old = """  is_observing_ = false;
"""
stop_new = stop_old + """  ArcadiaObserving().erase(this);  // Arcadia: ArcadiaCore
"""
update_old = """  if (tab_strip_model) {
    // If there is not currently a selected tab, then the tabstrip is still
"""
update_new = """  if (tab_strip_model) {
    // Arcadia: ArcadiaCore (a split's other pane is shown, a tab under the host's own page isn't)
    const int shown = g_arcadia_tab_shown_by_host
                          ? g_arcadia_tab_shown_by_host(GetObservedWebContents())
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
  // Arcadia: ArcadiaCore (a tab the host hides isn't the one the user went to)
  if (active && g_arcadia_tab_shown_by_host &&
      g_arcadia_tab_shown_by_host(active) == 0) {
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
# Space) could. With the hook set, a tab the host reported (engine/arcadiacore ac_host_visibility.h) can
# prompt exactly while the host shows it; an open prompt stays with its page (ArcadiaCore's prompts keep
# alive across switches), and ArcadiaCore tells the manager of each change through OnVisibilityChanged.
# Only ArcadiaCore sets the hook.
python3 - "$src/components/permissions/permission_request_manager.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_permission_tab_shown" in s:
    sys.exit(0)
old_ns = "namespace permissions {\n"
decl = """// Arcadia: ArcadiaCore (engine/arcadiacore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
int (*g_arcadia_permission_tab_shown)(content::WebContents*) = nullptr;

"""
helper = """
namespace {
// Arcadia: ArcadiaCore: whether a tab can prompt, as the host shows it (or `chrome_says`).
bool ArcadiaTabActive(content::WebContents* contents, bool chrome_says) {
  const int shown = g_arcadia_permission_tab_shown && contents
                        ? g_arcadia_permission_tab_shown(contents)
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
  // Arcadia: ArcadiaCore (unless the host says)
  const bool host_says =
      g_arcadia_permission_tab_shown &&
      g_arcadia_permission_tab_shown(web_contents()) >= 0;
  if (!tab_subscriptions_.empty() && !host_says) {
    return;
  }
  bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = ArcadiaTabActive(
      web_contents(), visibility != content::Visibility::HIDDEN);
"""
adopt_old = """  tab_is_active_ = tab_interface->IsActivated();
"""
adopt_new = """  tab_is_active_ =
      ArcadiaTabActive(web_contents(), tab_interface->IsActivated());  // Arcadia: ArcadiaCore
"""
status_old = """  const bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = is_active;
"""
status_new = """  const bool prior_tab_is_active_ = tab_is_active_;
  tab_is_active_ = ArcadiaTabActive(web_contents(), is_active);  // Arcadia: ArcadiaCore
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
# (bubble_anchor_util::GetPageInfoAnchorConfiguration). With the hook set, ArcadiaCore asks its host
# instead, as for every other permission, and takes the callback; it declines the Browsers it doesn't
# host, which keep Chrome's bubble. Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/ui/views/file_system_access/file_system_access_restore_permission_bubble_view.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_file_system_restore_prompt" in s:
    sys.exit(0)
old = """void ShowFileSystemAccessRestorePermissionDialog(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)> callback,
    content::WebContents* web_contents) {
"""
decl = """// Arcadia: ArcadiaCore (engine/arcadiacore) asks its host; it takes `callback` when it does.
bool (*g_arcadia_file_system_restore_prompt)(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)>& callback,
    content::WebContents* web_contents) = nullptr;

"""
new = decl + old + """  // Arcadia: ArcadiaCore
  if (g_arcadia_file_system_restore_prompt &&
      g_arcadia_file_system_restore_prompt(request, callback, web_contents)) {
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
# hook set, a tab the host reported (engine/arcadiacore ac_host_visibility.h) shows its dialog exactly
# while the host shows the tab (a split's other pane too), and ArcadiaCore asks the manager again on each
# change. Only ArcadiaCore sets the hook (it is defined with auto Picture in Picture's, above).
python3 - "$src/chrome/browser/ui/tabs/tab_dialog_manager.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_tab_shown_by_host" in s:
    sys.exit(0)
old_ns = "namespace tabs {\n\nclass TabDialogWidgetObserver"
decl = """// Arcadia: ArcadiaCore (engine/arcadiacore) shows tabs itself: 1 shown, 0 hidden, -1 the strip decides.
extern int (*g_arcadia_tab_shown_by_host)(content::WebContents*);

"""
old = """  return GetWidgetVisibility(
      tab_interface_->IsVisible(),
      tab_interface_->GetBrowserWindowInterface()->GetWindow()->IsMinimized(),
      params_->should_show_callback);
"""
new = """  // Arcadia: ArcadiaCore (the host's reading, when it gave one)
  const int shown =
      g_arcadia_tab_shown_by_host
          ? g_arcadia_tab_shown_by_host(tab_interface_->GetContents())
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
  // Arcadia: ArcadiaCore
  if (widget_ && g_arcadia_tab_shown_by_host &&
      g_arcadia_tab_shown_by_host(tab_interface_->GetContents()) == 1) {
    return;
  }
  if (widget_) {
"""
assert s.count(old_ns) == 1 and s.count(old) == 1 and s.count(bg_old) == 1
s = s.replace(old_ns, decl + old_ns).replace(old, new).replace(bg_old, bg_new)
open(path, "w").write(s)
print("hooked TabDialogManager's visibility")
PY2

# chrome.action.openPopup() (and browserAction.openPopup) asks ArcadiaCore first: its Browsers have no
# toolbar, so Chrome refused every call ("Browser window has no toolbar"). The host shows the
# popup in its own panel and Chrome answers the extension once the page has loaded (1Password
# reopens its popup this way once its Mac app unlocks). Only ArcadiaCore sets the hook.
python3 - "$src/chrome/browser/extensions/api/extension_action/extension_action_api.cc" <<'PY2'
import sys
path = sys.argv[1]
s = open(path).read()
if "g_arcadia_open_action_popup" in s:
    sys.exit(0)
old_ns = "namespace extensions {\n"
decl = ("// Arcadia: ArcadiaCore (engine/arcadiacore) shows action popups in the host's own panel. Empty: not\n"
        "// its Browser; true: shown (it runs `callback`); false: refused, with `error`.\n"
        "std::optional<bool> (*g_arcadia_open_action_popup)(\n"
        "    BrowserWindowInterface& browser,\n"
        "    const extensions::Extension& extension,\n"
        "    ShowPopupCallback& callback,\n"
        "    std::string* error) = nullptr;\n\n")
old = """                        ShowPopupCallback callback) {
#if !BUILDFLAG(IS_ANDROID)
"""
new = """                        ShowPopupCallback callback) {
  // Arcadia: ArcadiaCore
  if (g_arcadia_open_action_popup) {
    if (std::optional<bool> shown = g_arcadia_open_action_popup(
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
