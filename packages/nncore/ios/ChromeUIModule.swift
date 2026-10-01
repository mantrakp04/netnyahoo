import ExpoModulesCore

// "NetnyahooChromeUI" on NNCore. Chrome's device choosers, Cast dialog, extension side panels and the
// autofill trigger keep Chrome's own UI for now (they attach to the window as child windows); these hand-offs
// to the app's UI come with NNCore's UI seams (docs/nncore-parity.md).
public class ChromeUIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooChromeUI")
    Events("onDeviceChooser", "onCastDialog", "onCastRoutes", "onSidePanel")

    OnCreate {
      NNCoreHost.chromeUIHandler = { [weak self] name, payload in
        if name == "sidePanel" { self?.sendEvent("onSidePanel", payload) }
      }
    }

    AsyncFunction("selectDevice") { (id: Int, index: Int) in }.runOnQueue(.main)
    AsyncFunction("cancelDeviceChooser") { (id: Int) in }.runOnQueue(.main)
    AsyncFunction("refreshDeviceChooser") { (id: Int) in }.runOnQueue(.main)
    AsyncFunction("openBluetoothSettings") { (id: Int) in }.runOnQueue(.main)

    AsyncFunction("showCastDialog") { (browserId: Int) in false }.runOnQueue(.main)
    AsyncFunction("startCasting") { (id: Int, sink: String, mode: Int) in }.runOnQueue(.main)
    AsyncFunction("stopCasting") { (id: Int, route: String) in }.runOnQueue(.main)
    AsyncFunction("closeCastDialog") { (id: Int) in }.runOnQueue(.main)
    AsyncFunction("watchCastRoutes") { (profile: String) in }.runOnQueue(.main)
    AsyncFunction("terminateCastRoute") { (route: String) in }.runOnQueue(.main)

    AsyncFunction("actionStates") { (browserId: Int, ids: [String]) in
      NNCoreHost.actionStates(browserId: Int32(browserId), extensions: ids)
    }.runOnQueue(.main)
    AsyncFunction("sidePanelURL") { (browserId: Int, extensionId: String) -> String? in
      NNCoreHost.sidePanelURL(browserId: Int32(browserId), extension: extensionId)
    }.runOnQueue(.main)

    AsyncFunction("changeCaptureSource") { (capturer: Int, target: Int) in }.runOnQueue(.main)
    AsyncFunction("stopCapture") { (capturer: Int) in }.runOnQueue(.main)
    AsyncFunction("showAutofillSuggestions") { (browserId: Int, passwords: Bool) in false }.runOnQueue(.main)
  }
}
