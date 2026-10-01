import ExpoModulesCore

// "NetnyahooChromeUI" on NNCore: device choosers, the Cast dialog and routes, extension side panels, capture and
// the autofill trigger go to the app's UI, as on CEF (docs/nncore-parity.md).
public class ChromeUIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooChromeUI")
    Events("onDeviceChooser", "onCastDialog", "onCastRoutes", "onSidePanel")

    OnCreate {
      NNCoreHost.chromeUIHandler = { [weak self] name, payload in
        switch name {
        case "sidePanel": self?.sendEvent("onSidePanel", payload)
        case "deviceChooser": self?.sendEvent("onDeviceChooser", payload)
        case "castDialog": self?.sendEvent("onCastDialog", payload)
        case "castRoutes": self?.sendEvent("onCastRoutes", payload)
        default: break
        }
      }
    }

    AsyncFunction("selectDevice") { (id: Int, index: Int) in NNCoreHost.deviceChooser(Int32(id), select: Int32(index)) }.runOnQueue(.main)
    AsyncFunction("cancelDeviceChooser") { (id: Int) in NNCoreHost.deviceChooser(Int32(id), action: "cancel") }.runOnQueue(.main)
    AsyncFunction("refreshDeviceChooser") { (id: Int) in NNCoreHost.deviceChooser(Int32(id), action: "refresh") }.runOnQueue(.main)
    AsyncFunction("openBluetoothSettings") { (id: Int) in NNCoreHost.deviceChooser(Int32(id), action: "settings") }.runOnQueue(.main)
    // Tests (--netnyahoo-test-bluetooth-chooser): a Bluetooth chooser with no adapter, and what its choices answered.
    AsyncFunction("devShowBluetoothChooser") { (browserId: Int, unauthorized: Bool) -> Bool in
      NNCoreHost.devShowBluetoothChooser(browserId: Int32(browserId), unauthorized: unauthorized)
    }.runOnQueue(.main)
    AsyncFunction("devChooserEvents") { NNCoreHost.testChooserEvents() }.runOnQueue(.main)

    AsyncFunction("showCastDialog") { (browserId: Int) in NNCoreHost.showCastDialog(browserId: Int32(browserId)) }.runOnQueue(.main)
    AsyncFunction("startCasting") { (id: Int, sink: String, mode: Int) in
      NNCoreHost.castDialog(Int32(id), start: sink, mode: Int32(mode))
    }.runOnQueue(.main)
    AsyncFunction("stopCasting") { (id: Int, route: String) in NNCoreHost.castDialog(Int32(id), stop: route) }.runOnQueue(.main)
    AsyncFunction("closeCastDialog") { (id: Int) in NNCoreHost.closeCastDialog(Int32(id)) }.runOnQueue(.main)
    AsyncFunction("watchCastRoutes") { (profile: String) in NNCoreHost.watchCastRoutes(profile) }.runOnQueue(.main)
    AsyncFunction("terminateCastRoute") { (route: String) in NNCoreHost.terminateCastRoute(route) }.runOnQueue(.main)

    AsyncFunction("actionStates") { (browserId: Int, ids: [String]) in
      NNCoreHost.actionStates(browserId: Int32(browserId), extensions: ids)
    }.runOnQueue(.main)
    AsyncFunction("sidePanelURL") { (browserId: Int, extensionId: String) -> String? in
      NNCoreHost.sidePanelURL(browserId: Int32(browserId), extension: extensionId)
    }.runOnQueue(.main)

    AsyncFunction("changeCaptureSource") { (capturer: Int, target: Int) -> Bool in
      NNCoreHost.shareTabInstead(browserId: Int32(target))
    }.runOnQueue(.main)
    AsyncFunction("stopCapture") { (capturer: Int) in NNCoreHost.stopCapture(browserId: Int32(capturer)) }.runOnQueue(.main)
    AsyncFunction("showAutofillSuggestions") { (browserId: Int, passwords: Bool) in
      NNCoreHost.showAutofillSuggestions(browserId: Int32(browserId), passwords: passwords)
    }.runOnQueue(.main)
  }
}
