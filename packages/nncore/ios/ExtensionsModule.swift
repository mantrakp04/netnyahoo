import ExpoModulesCore

// "NetnyahooExtensions" on NNCore. Stage 1 lists no extensions; installing, the action popups and the
// install prompt come with NNCore's extensions API (docs/nncore-parity.md).
public class ExtensionsModule: Module {
  private static let notYet = ["error": "Extensions aren't on NNCore yet"]

  public func definition() -> ModuleDefinition {
    Name("NetnyahooExtensions")
    Events("onChanged", "onTabs", "onInstallPrompt")

    AsyncFunction("resolveInstallPrompt") { (requestId: String, accepted: Bool) in }.runOnQueue(.main)
    AsyncFunction("list") { (profile: String) in ["extensions": [[String: Any]]()] }.runOnQueue(.main)
    AsyncFunction("inspectUnpacked") { (path: String) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("install") { (path: String, profile: String) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("setEnabled") { (id: String, profile: String, enabled: Bool) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("uninstall") { (id: String, profile: String) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("reload") { (id: String, profile: String) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("configure") { (id: String, profile: String, options: [String: Any]) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("searchEngineList") { (profile: String) in Self.notYet }.runOnQueue(.main)
    AsyncFunction("evaluateInHost") { (expression: String, profile: String) -> String? in nil }.runOnQueue(.main)
    AsyncFunction("evaluateInPage") { (expression: String, profile: String, page: String) -> String? in nil }.runOnQueue(.main)
    AsyncFunction("chooseFolder") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.allowsMultipleSelection = false
      panel.prompt = "Select"
      panel.message = "Choose an extension folder (with a manifest.json)"
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)
  }
}
