import ExpoModulesCore

// "NetnyahooExtensions" on NNCore, over //chrome/browser/netnyahoo's nn_extensions_* exports (the same calls as
// packages/cef/ios/NNExtensions.mm). Chrome's own install prompt still shows for now (resolveInstallPrompt waits on
// NNCore's install-prompt seam).
public class ExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooExtensions")
    Events("onChanged", "onTabs", "onInstallPrompt")

    OnCreate {
      NNCoreHost.extensionsEventHandler = { [weak self] name, payload in
        if name == "installPrompt" { self?.sendEvent("onInstallPrompt", payload) }
      }
      NNCoreServices.extensionsHandler = { [weak self] name, payload in
        switch name {
        case "changed": self?.sendEvent("onChanged", payload)
        case "tabs": self?.sendEvent("onTabs", payload)
        case "installPrompt": self?.sendEvent("onInstallPrompt", payload)
        default: break
        }
      }
    }

    AsyncFunction("resolveInstallPrompt") { (requestId: String, accepted: Bool) in
      NNCoreHost.resolveExtensionInstallPrompt(requestId, accepted: accepted)
    }.runOnQueue(.main)
    AsyncFunction("list") { (profile: String, promise: Promise) in
      NNCoreServices.listExtensions(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("inspectUnpacked") { (path: String) in NNCoreServices.inspectUnpacked(path) }.runOnQueue(.main)
    AsyncFunction("install") { (path: String, profile: String, promise: Promise) in
      NNCoreServices.installExtension(path: path, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("installCrx") { (path: String, profile: String, promise: Promise) in
      NNCoreServices.installCrx(path: path, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("setEnabled") { (id: String, profile: String, enabled: Bool, promise: Promise) in
      NNCoreServices.setExtension(id, enabled: enabled, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("uninstall") { (id: String, profile: String, promise: Promise) in
      NNCoreServices.uninstallExtension(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("reload") { (id: String, profile: String, promise: Promise) in
      NNCoreServices.reloadExtension(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("configure") { (id: String, profile: String, options: [String: Any], promise: Promise) in
      NNCoreServices.configureExtension(id, profile: profile, options: options) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("searchEngineList") { (profile: String, promise: Promise) in
      NNCoreServices.searchEngineList(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
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
