import ExpoModulesCore

/// Chrome extensions (NNExtensions) for JS: `requireNativeModule("NetnyahooExtensions")`.
public class ExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooExtensions")
    Events("onChanged", "onTabs", "onInstallPrompt")

    OnCreate {
      NNExtensions.eventHandler = { [weak self] name, payload in
        switch name {
        case "changed": self?.sendEvent("onChanged", payload)
        case "tabs": self?.sendEvent("onTabs", payload)
        case "installPrompt": self?.sendEvent("onInstallPrompt", payload)
        default: break
        }
      }
    }

    AsyncFunction("supportsInstallPrompt") { NNExtensions.supportsInstallPrompt }.runOnQueue(.main)
    AsyncFunction("resolveInstallPrompt") { (requestId: String, accepted: Bool) in
      NNExtensions.resolveInstallPrompt(requestId, accepted: accepted)
    }.runOnQueue(.main)
    AsyncFunction("list") { (profile: String, promise: Promise) in
      NNExtensions.list(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("prepareWebStore") { (id: String, profile: String, promise: Promise) in
      NNExtensions.prepareWebStore(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("inspectUnpacked") { (path: String) in NNExtensions.inspectUnpacked(path) }.runOnQueue(.main)
    AsyncFunction("install") { (path: String, profile: String, promise: Promise) in
      NNExtensions.install(path: path, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("discardPrepared") { (path: String) in NNExtensions.discardPrepared(path) }.runOnQueue(.main)
    AsyncFunction("setEnabled") { (id: String, profile: String, enabled: Bool, promise: Promise) in
      NNExtensions.setEnabled(enabled, extension: id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("uninstall") { (id: String, profile: String, promise: Promise) in
      NNExtensions.uninstall(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("reload") { (id: String, profile: String, promise: Promise) in
      NNExtensions.reload(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("configure") { (id: String, profile: String, options: [String: Any], promise: Promise) in
      NNExtensions.configure(id, profile: profile, options: options) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("actionState") { (profile: String, ids: [String], tabId: Int, promise: Promise) in
      NNExtensions.actionState(profile: profile, extensions: ids, tabId: tabId) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("setTabModel") { (model: [String: Any]) in NNExtensions.setTabModel(model) }.runOnQueue(.main)
    AsyncFunction("evaluateInHost") { (expression: String, profile: String, promise: Promise) in
      NNExtensions.evaluateInHost(expression, profile: profile, page: nil) { promise.resolve($0) }
    }.runOnQueue(.main)
    /// DEV: like evaluateInHost, in the profile's hidden `page` (chrome://settings/, chrome-extension://…).
    AsyncFunction("evaluateInPage") { (expression: String, profile: String, page: String, promise: Promise) in
      NNExtensions.evaluateInHost(expression, profile: profile, page: page) { promise.resolve($0) }
    }.runOnQueue(.main)
    /// Asks for a folder (developer "Load Unpacked").
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
