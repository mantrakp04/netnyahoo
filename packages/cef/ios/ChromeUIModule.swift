import ExpoModulesCore

/// Chrome UI surfaces the app draws (NNChromeSurfaces) for JS: `requireNativeModule("NetnyahooChromeUI")`.
public class ChromeUIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooChromeUI")
    Events("onDeviceChooser", "onCastDialog", "onCastRoutes", "onSidePanel")

    // Once JS listens; again after a reload, which also brings back choosers and Cast dialogs
    // still waiting for an answer (Chrome's own ones would sit in the hidden window).
    OnStartObserving {
      NNChromeSurfaces.eventHandler = { [weak self] name, payload in
        switch name {
        case "deviceChooser": self?.sendEvent("onDeviceChooser", payload)
        case "castDialog": self?.sendEvent("onCastDialog", payload)
        case "castRoutes": self?.sendEvent("onCastRoutes", payload)
        case "sidePanel": self?.sendEvent("onSidePanel", payload)
        default: break
        }
      }
    }

    AsyncFunction("available") { NNChromeSurfaces.available }.runOnQueue(.main)

    AsyncFunction("selectDevice") { (id: Int, index: Int) in NNChromeSurfaces.selectDevice(id, index: index) }.runOnQueue(.main)
    AsyncFunction("cancelDeviceChooser") { (id: Int) in NNChromeSurfaces.cancelDeviceChooser(id) }.runOnQueue(.main)
    AsyncFunction("refreshDeviceChooser") { (id: Int) in NNChromeSurfaces.refreshDeviceChooser(id) }.runOnQueue(.main)
    AsyncFunction("openBluetoothSettings") { (id: Int) in NNChromeSurfaces.openBluetoothSettings(id) }.runOnQueue(.main)

    AsyncFunction("showCastDialog") { (browserId: Int) in NNChromeSurfaces.showCastDialog(browserId) }.runOnQueue(.main)
    AsyncFunction("startCasting") { (id: Int, sink: String, mode: Int) in
      NNChromeSurfaces.startCasting(id, sink: sink, mode: mode)
    }.runOnQueue(.main)
    AsyncFunction("stopCasting") { (id: Int, route: String) in NNChromeSurfaces.stopCasting(id, route: route) }.runOnQueue(.main)
    AsyncFunction("closeCastDialog") { (id: Int) in NNChromeSurfaces.closeCastDialog(id) }.runOnQueue(.main)
    AsyncFunction("watchCastRoutes") { (profile: String) in NNChromeSurfaces.watchCastRoutes(profile) }.runOnQueue(.main)
    AsyncFunction("terminateCastRoute") { (route: String) in NNChromeSurfaces.terminateCastRoute(route) }.runOnQueue(.main)

    AsyncFunction("actionStates") { (browserId: Int, ids: [String]) in
      NNChromeSurfaces.actionStates(browserId: browserId, extensions: ids)
    }.runOnQueue(.main)
    AsyncFunction("sidePanelURL") { (browserId: Int, extensionId: String) in
      NNChromeSurfaces.sidePanelURL(browserId: browserId, extension: extensionId)
    }.runOnQueue(.main)

    AsyncFunction("changeCaptureSource") { (capturer: Int, target: Int) in
      NNChromeSurfaces.changeCaptureSource(capturer, toTab: target)
    }.runOnQueue(.main)
    AsyncFunction("stopCapture") { (capturer: Int) in NNChromeSurfaces.stopCapture(capturer) }.runOnQueue(.main)
    AsyncFunction("captureTarget") { (capturer: Int, candidates: [Int]) in
      NNChromeSurfaces.captureTarget(of: capturer, among: candidates.map { NSNumber(value: $0) })
    }.runOnQueue(.main)
  }
}
