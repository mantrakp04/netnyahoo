import ExpoModulesCore

// One view per module: on the legacy architecture Expo's view-manager adapter
// instantiates a module's first view class for every view it declares.
public class AreaLightModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooAreaLight")

    Function("debugState") { AreaLightView.lastState }

    /// DEV: force every shader view's window to read as key/active (true), inactive (false),
    /// or its real state (nil), so key vs non-key renders can be compared without focus.
    AsyncFunction("debugSetWindowActive") { (value: Bool?) in WindowActivity.override = value }.runOnQueue(.main)
    /// DEV: force Reduce Motion for views mounted from now on (nil = the system setting).
    AsyncFunction("debugSetReduceMotion") { (value: Bool?) in WindowActivity.reduceMotionOverride = value }.runOnQueue(.main)
    /// DEV: renders every shader view offscreen into `<dir>/<n>-<Class>.png` (straight alpha, 2x)
    /// and describes each one: its frame in window points (top-left origin) and window state.
    AsyncFunction("debugSnapshot") { (dir: String) -> [[String: Any]] in
      try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
      return MetalSurface.instances.enumerated().compactMap { index, view in
        guard let window = view.window, let content = window.contentView else { return nil }
        let name = String(describing: type(of: view))
        let path = (dir as NSString).appendingPathComponent("\(index)-\(name).png")
        let r = view.convert(view.bounds, to: nil)
        let top = content.bounds.height - r.maxY
        return [
          "file": path, "class": name, "ok": view.writeSnapshot(to: path), "window": window.windowNumber,
          "frame": [r.minX, top, r.width, r.height], "key": window.isKeyWindow, "main": window.isMainWindow,
          "hidden": view.isHiddenOrHasHiddenAncestor, "alpha": view.alphaValue,
        ]
      }
    }.runOnQueue(.main)

    View(AreaLightView.self) {
      Prop("shapeFrame") { (view: AreaLightView, frame: [Double]) in
        guard frame.count == 4 else { return }
        view.params.shapeFrame = SIMD4(frame.map(Float.init))
      }
      Prop("cornerRadius") { (view: AreaLightView, v: Double) in view.params.cornerRadius = Float(v) }
      Prop("palette") { (view: AreaLightView, value: [String]) in view.setPalette(value) }
      Prop("lift") { (view: AreaLightView, v: Double) in view.params.lift = Float(v) }
      Prop("intensity") { (view: AreaLightView, v: Double) in view.params.intensity = Float(v) }
      Prop("falloff") { (view: AreaLightView, v: Double) in view.params.falloff = Float(v) }
      Prop("tilt") { (view: AreaLightView, deg: [Double]) in
        guard deg.count == 2 else { return }
        view.params.tilt = SIMD2(Float(deg[0]), Float(deg[1])) * .pi / 180
      }
      Prop("noiseSeed") { (view: AreaLightView, v: Double) in view.params.noiseSeed = Float(v) }
      Prop("introDelay") { (view: AreaLightView, v: Double) in view.params.introDelay = v }
      Prop("introDuration") { (view: AreaLightView, v: Double) in view.params.introDuration = v }
      Prop("replayKey") { (view: AreaLightView, _: Double) in view.replayIntro() }
      OnViewDidUpdateProps { (view: AreaLightView) in view.redraw() }
    }

  }
}

public class WindowBackdropModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooWindowBackdrop")

    View(WindowBackdropView.self) {
      Prop("colors") { (view: WindowBackdropView, colors: [String]) in view.setColors(colors) }
      Prop("vibrancy") { (view: WindowBackdropView, on: Bool) in view.setVibrancy(on) }
      Prop("tintColor") { (view: WindowBackdropView, hex: String) in
        if let c = SIMD4<Float>(hex: hex) {
          view.setTint { $0.color = NSColor(displayP3Red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: 1) }
        }
      }
      Prop("tintAlpha") { (view: WindowBackdropView, v: Double) in view.setTint { $0.alpha = v } }
      Prop("tintLightness") { (view: WindowBackdropView, v: Double) in view.setTint { $0.lightness = v } }
      Prop("angle") { (view: WindowBackdropView, deg: Double) in view.setAngle(deg) }
      Prop("grainOpacity") { (view: WindowBackdropView, v: Double) in view.set(\.grainOpacity, Float(v)) }
      Prop("grainScale") { (view: WindowBackdropView, v: Double) in view.set(\.grainScale, Float(v)) }
    }
  }
}

public class OrbModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooOrb")

    View(OrbView.self) {
      Prop("tint") { (view: OrbView, hex: String) in view.setTint(hex) }
      Prop("variant") { (view: OrbView, variant: String) in view.setVariant(variant) }
      Prop("paint") { (view: OrbView, name: String) in view.setPaint(name) }
    }
  }
}

public class EdgeLightModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooEdgeLight")

    View(EdgeLightView.self) {
      Prop("rectFrame") { (view: EdgeLightView, v: [Double]) in if v.count == 4 { view.rectFrame = SIMD4(v.map(Float.init)) } }
      Prop("cornerRadius") { (view: EdgeLightView, v: Double) in view.cornerRadius = Float(v) }
      Prop("lightStart") { (view: EdgeLightView, v: [Double]) in if v.count == 2 { view.lightStart = SIMD2(v.map(Float.init)) } }
      Prop("lightEnd") { (view: EdgeLightView, v: [Double]) in if v.count == 2 { view.lightEnd = SIMD2(v.map(Float.init)) } }
      Prop("lightColor") { (view: EdgeLightView, hex: String) in if let c = SIMD4<Float>(hex: hex) { view.lightColor = c } }
      Prop("logoFrame") { (view: EdgeLightView, v: [Double]) in if v.count == 4 { view.logoFrame = SIMD4(v.map(Float.init)) } }
      Prop("animationDuration") { (view: EdgeLightView, v: Double) in view.animationDuration = Float(v) }
      Prop("animationDelay") { (view: EdgeLightView, v: Double) in view.animationDelay = Float(v) }
      OnViewDidUpdateProps { (view: EdgeLightView) in view.redraw() }
    }
  }
}

public class PowerUpModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooPowerUp")

    View(PowerUpView.self) {
      Prop("palette") { (view: PowerUpView, v: [String]) in view.setPalette(v) }
      Prop("speed") { (view: PowerUpView, v: Double) in view.speed = Float(v) }
      Prop("origin") { (view: PowerUpView, v: Double) in view.origin = Float(v) }
      Prop("cornerRadius") { (view: PowerUpView, v: Double) in view.cornerRadius = Float(v) }
      Prop("haloFrame") { (view: PowerUpView, v: [Double]) in
        view.setHaloFrame(v.count == 4 && v[2] > 0 && v[3] > 0 ? CGRect(x: v[0], y: v[1], width: v[2], height: v[3]) : nil)
      }
    }
  }
}
