import ExpoModulesCore

/// Two-finger swipe navigation (NNSwipe): an invisible `SwipeArea` laid over a pane's
/// content or the sidebar receives the horizontal swipes that start over its parent.
public class SwipeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooSwipe")

    /// System Settings › Trackpad › Swipe between pages allows two-finger swipes.
    Function("isSwipeNavigationEnabled") { NNSwipe.systemSwipeEnabled }
    /// Haptic feedback: "levelChange" (threshold reached), "alignment" (detents), "generic".
    Function("haptic") { (pattern: String) in
      DispatchQueue.main.async { NNSwipe.performHaptic(pattern) }
    }

    /// DEV: a synthetic trackpad gesture over the area's window (see NNSwipe.h).
    AsyncFunction("devSimulate") { (x: Double, y: Double, windowNumber: Int, steps: [[String: Any]], ignorePreference: Bool, promise: Promise) in
      #if DEBUG
      guard let window = NSApp.window(withWindowNumber: windowNumber) else {
        promise.resolve(["error": "no window \(windowNumber)"])
        return
      }
      NNSwipe.simulate(in: window, point: NSPoint(x: x, y: y), steps: steps, ignoreSystemPreference: ignorePreference) {
        promise.resolve($0)
      }
      #else
      promise.resolve(["error": "DEV builds only"])
      #endif
    }.runOnQueue(.main)

    View(SwipeArea.self) {
      Events("onSwipe")
      Prop("canSwipeBack") { (view: SwipeArea, value: Bool?) in view.canSwipeBack = value ?? false }
      Prop("canSwipeForward") { (view: SwipeArea, value: Bool?) in view.canSwipeForward = value ?? false }
      Prop("tracksUnavailableDirections") { (view: SwipeArea, value: Bool?) in view.tracksUnavailableDirections = value ?? false }
      Prop("allowsVerticalMotion") { (view: SwipeArea, value: Bool?) in view.allowsVerticalMotion = value ?? false }
      /// DEV: where the area is, for devSimulate (window number + its frame, top-left origin).
      AsyncFunction("devLocate") { (view: SwipeArea) -> [String: Any]? in
        guard let window = view.window, let content = window.contentView else { return nil }
        let frame = view.convert(view.bounds, to: content)
        let top = content.isFlipped ? frame.minY : content.bounds.height - frame.maxY
        return ["windowNumber": window.windowNumber, "x": frame.minX, "y": top, "width": frame.width, "height": frame.height]
      }.runOnQueue(.main)
    }
  }
}

/// Invisible and never hit: the swipe tracker finds it by geometry and its parent.
final class SwipeArea: ExpoView, NNSwipeTarget {
  let onSwipe = EventDispatcher()
  var canSwipeBack = false
  var canSwipeForward = false
  var tracksUnavailableDirections = false
  var allowsVerticalMotion = false

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { NNSwipe.addTarget(self) } else { NNSwipe.removeTarget(self) }
  }

  func swipeEvent(_ event: [String: Any]) {
    onSwipe(event)
  }
}
