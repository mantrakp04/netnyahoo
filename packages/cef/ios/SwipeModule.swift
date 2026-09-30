import ExpoModulesCore
import QuartzCore

public class SwipeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooSwipe")

    Constant("nativePagerVersion") { () -> Int in 1 }

    Function("haptic") { (pattern: String) in
      DispatchQueue.main.async { NNSwipe.performHaptic(pattern) }
    }

    // Dots and keys: the same native controller a drag uses, interrupting whatever it is doing.
    // A trailing order is the caller's profile order; indexes and steps are read in it.
    AsyncFunction("switchPager") { (key: String, index: Int, order: String?) -> Bool in
      NNPager.existing(key)?.switchTo(index, order: order) ?? false
    }.runOnQueue(.main)

    // A profile chosen outside the pager (a link, a tab): lands at once and outranks stale props until JS acks.
    AsyncFunction("selectPager") { (key: String, profileId: String, order: String) -> Bool in
      NNPager.existing(key)?.select(profileId, order: order) ?? false
    }.runOnQueue(.main)

    // Relative steps resolve against the native selection when they run, so rapid repeats advance.
    AsyncFunction("stepPager") { (key: String, delta: Int, wrap: Bool, order: String?) -> Bool in
      NNPager.existing(key)?.step(delta, wrap: wrap, order: order) ?? false
    }.runOnQueue(.main)

    // The latest native state, readable from JS without a main-thread hop.
    Function("pagerState") { (key: String) -> [String: Any]? in NNPager.snapshot(key) }

    AsyncFunction("devPagerState") { (key: String) -> [String: Any]? in
      #if DEBUG
      return NNPager.existing(key)?.debug()
      #else
      return nil
      #endif
    }.runOnQueue(.main)

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
      Events("onSwipe", "onPagerPosition", "onPagerState")
      Prop("canSwipeBack") { (view: SwipeArea, value: Bool?) in view.canSwipeBack = value ?? false }
      Prop("canSwipeForward") { (view: SwipeArea, value: Bool?) in view.canSwipeForward = value ?? false }
      Prop("tracksUnavailableDirections") { (view: SwipeArea, value: Bool?) in view.tracksUnavailableDirections = value ?? false }
      Prop("allowsVerticalMotion") { (view: SwipeArea, value: Bool?) in view.allowsVerticalMotion = value ?? false }
      Prop("isPager") { (view: SwipeArea, value: Bool?) in view.isPager = value ?? false }
      Prop("nativePager") { (view: SwipeArea, value: [String: Any]?) in view.configurePager(value) }
      AsyncFunction("devLocate") { (view: SwipeArea) -> [String: Any]? in
        guard let window = view.window, let content = window.contentView else { return nil }
        let frame = view.convert(view.bounds, to: content)
        let top = content.isFlipped ? frame.minY : content.bounds.height - frame.maxY
        return ["windowNumber": window.windowNumber, "x": frame.minX, "y": top, "width": frame.width, "height": frame.height]
      }.runOnQueue(.main)
    }
  }
}

final class SwipeArea: ExpoView, NNSwipeTarget {
  let onSwipe = EventDispatcher()
  let onPagerPosition = EventDispatcher()
  let onPagerState = EventDispatcher()
  var canSwipeBack = false
  var canSwipeForward = false
  var tracksUnavailableDirections = false
  var allowsVerticalMotion = false
  @objc var isPager = false
  private(set) var pager: NNPager?
  private var pagerWidth: CGFloat = 0

  @objc var hasNativePager: Bool { pager != nil }

  // The strip pages narrower than the area; the sidebar pages its own width.
  var pageWidth: Double { Double(pagerWidth > 0 ? pagerWidth : bounds.width) }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  // Root moves pass through a nil window; the controller stays attached until this view goes away.
  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { NNSwipe.addTarget(self) } else { NNSwipe.removeTarget(self) }
  }

  deinit {
    if let pager { DispatchQueue.main.async { pager.prune() } }
  }

  func swipeEvent(_ event: [String: Any]) {
    onSwipe(event)
  }

  @objc(pagerInput:distance:direction:timestamp:)
  func pagerInput(_ phase: String, distance: CGFloat, direction: Int32, timestamp: TimeInterval) {
    pager?.input(from: self, phase: phase, distance: Double(distance), direction: Int(direction), timestamp: timestamp)
  }

  func configurePager(_ value: [String: Any]?) {
    guard let value, let key = value["key"] as? String else {
      let old = pager
      pager = nil
      old?.detach(self)
      return
    }
    if pager?.key != key {
      pager?.detach(self)
      pager = NNPager.named(key)
      pager!.attach(self)
    }
    pagerWidth = CGFloat(number(value["width"]) ?? 0)
    pager!.configure(
      selected: Int(number(value["selected"]) ?? 0),
      count: Int(number(value["count"]) ?? 1),
      ack: Int(number(value["ack"]) ?? 0),
      order: value["order"] as? String
    )
  }
}

private func number(_ value: Any?) -> Double? {
  switch value {
  case let v as Double: return v
  case let v as Int: return Double(v)
  case let v as NSNumber: return v.doubleValue
  default: return nil
  }
}

// MARK: Native profile pager

// Dia: 0.5× paging, 255pt rubber band, 5pt/s flick, 0.25s critically damped settle.
private let trackingScale = 0.5
private let rubberDimension = 255.0
private let rubberCoefficient = 0.15
private let flickVelocity = 5.0
private let omega = 2 * Double.pi / 0.25
private let restDisplacement = 0.003
private let restSpeed = 0.1
private let historyWindow = 0.1

private func rubberBand(_ value: Double, _ dimension: Double) -> Double {
  (1 - 1 / (value * rubberCoefficient / dimension + 1)) * dimension
}

// The display link's target, so the link retained by the pager never retains the pager back.
private final class NNPagerFrames: NSObject {
  weak var pager: NNPager?
  let generation: Int

  init(_ pager: NNPager, generation: Int) {
    self.pager = pager
    self.generation = generation
  }

  @objc func frame(_ link: CADisplayLink) {
    guard let pager, pager.frame(generation: generation) else { return link.invalidate() }
  }
}

// One per logical window, shared by its sidebar and strip areas. Position is in absolute profile
// indexes; every frame reaches Animated through the areas' onPagerPosition, never through JS.
final class NNPager {
  enum Phase: String { case idle, tracking, holding, settling }

  private struct Drag {
    var start = 0.0, lo = 0, hi = 0, home = 0, detent = 0
    weak var area: SwipeArea?
  }

  private struct Spring {
    let from: Double
    let target: Int
    let velocity: Double
    let start: CFTimeInterval
  }

  private static var pagers: [String: NNPager] = [:]
  private static let lock = NSLock()
  private static var snapshots: [String: [String: Any]] = [:]
  // Global so a controller recreated for the same key never reuses a sequence JS already acked.
  private static var counter = 0

  static func named(_ key: String) -> NNPager {
    if let pager = pagers[key] { return pager }
    let pager = NNPager(key: key)
    pagers[key] = pager
    return pager
  }

  static func existing(_ key: String) -> NNPager? { pagers[key] }

  static func snapshot(_ key: String) -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    return snapshots[key]
  }

  let key: String
  private let areas = NSHashTable<SwipeArea>.weakObjects()
  private var configured = false
  private var count = 1
  private var order: String?
  private var orderIds: [String]?
  private var selected = 0
  private var position = 0.0
  private var velocity = 0.0
  private var phase = Phase.idle
  private var sequence = 0
  // The sequence of the last selection made here; React's selected is stale until JS acks it.
  private var selectionSequence = 0
  private var propSelected = 0
  private var propAck = 0
  private var drag = Drag()
  private var history: [(time: TimeInterval, position: Double)] = []
  private var spring: Spring?
  // A screen link survives the root moving between Chrome windows; the timer is for no screen at all.
  private var link: CADisplayLink?
  private var timer: Timer?
  private var generation = 0
  #if DEBUG
  private var lastInput: [String: Any] = [:]
  #endif

  private init(key: String) { self.key = key }

  func attach(_ area: SwipeArea) {
    areas.add(area)
    if configured { area.onPagerPosition(["position": position]) }
  }

  func detach(_ area: SwipeArea) {
    areas.remove(area)
    prune()
  }

  func prune() {
    guard areas.allObjects.isEmpty, NNPager.pagers[key] === self else { return }
    stopSpring()
    NNPager.pagers[key] = nil
    NNPager.lock.lock()
    NNPager.snapshots[key] = nil
    NNPager.lock.unlock()
  }

  // MARK: React config

  func configure(selected newSelected: Int, count newCount: Int, ack: Int, order newOrder: String?) {
    let count = max(1, newCount)
    propSelected = min(max(newSelected, 0), count - 1)
    propAck = max(propAck, ack)
    if !configured {
      configured = true
      self.count = count
      setOrder(newOrder)
      selected = propSelected
      position = Double(selected)
      sequence = NNPager.next()
      publish()
      emitPosition()
      return
    }
    // Indexes mean other profiles now: stop, and take React's selection.
    if count != self.count || (newOrder != nil && newOrder != order) {
      // A selection JS hasn't committed yet keeps its profile at that profile's new index.
      var index = propSelected
      let old = orderIds
      self.count = count
      setOrder(newOrder)
      if propAck < selectionSequence, let old, selected < old.count, let moved = orderIds?.firstIndex(of: old[selected]) {
        index = moved
      }
      cancelMotion()
      jump(to: index)
      return
    }
    reconcile()
  }

  private func setOrder(_ newOrder: String?) {
    order = newOrder
    orderIds = newOrder?.components(separatedBy: "\n")
  }

  // Takes a selection React made itself, once idle and once JS has seen every native selection.
  private func reconcile() {
    guard phase == .idle, propAck >= selectionSequence, propSelected != selected else { return }
    jump(to: propSelected)
  }

  // As a selection, JS must ack it before React's props count again.
  private func jump(to index: Int, selection: Bool = false) {
    selected = index
    position = Double(index)
    velocity = 0
    sequence = NNPager.next()
    if selection { selectionSequence = sequence }
    publish()
    emitPosition()
  }

  // MARK: Input

  func input(from area: SwipeArea, phase input: String, distance: Double, direction: Int, timestamp: TimeInterval) {
    #if DEBUG
    lastInput = ["phase": input, "distance": distance, "direction": direction, "timestamp": timestamp]
    #endif
    switch input {
    case "prepare":
      // Fingers down: catch a settle where it is without claiming the gesture yet.
      if phase == .settling {
        stopSpring()
        phase = .holding
        publish()
      }
    case "abandon":
      if phase == .holding {
        settle(to: selected, velocity: 0)
      } else if phase == .tracking, drag.area === area {
        release(velocity: 0, cancelled: false)
      }
    case "began":
      begin(area)
      track(distance, direction, timestamp, sample: true)
    case "changed":
      guard phase == .tracking, drag.area === area else { return }
      track(distance, direction, timestamp, sample: true)
    case "ended", "cancelled":
      guard phase == .tracking, drag.area === area else { return }
      // The end event's zero delta is not a sample: it would read as a stop before release.
      track(distance, direction, timestamp, sample: false)
      release(velocity: releaseVelocity(at: timestamp), cancelled: input == "cancelled")
    default:
      break
    }
  }

  private func begin(_ area: SwipeArea) {
    stopSpring()
    let home = selected
    let x = position
    // A drag that catches a multi-page settle keeps its place instead of snapping into range.
    let lo = max(0, min(home - 1, Int(x.rounded(.down))))
    let hi = min(count - 1, max(home + 1, Int(x.rounded(.up))))
    drag = Drag(start: x, lo: lo, hi: hi, home: home, detent: min(max(Int(x.rounded()), lo), hi), area: area)
    history = []
    velocity = 0
    phase = .tracking
    sequence = NNPager.next()
    publish()
    emitState("began")
  }

  private func track(_ distance: Double, _ direction: Int, _ timestamp: TimeInterval, sample: Bool) {
    guard let area = drag.area else { return }
    let width = area.pageWidth
    guard width > 0 else { return }
    let raw = drag.start + Double(direction > 0 ? -1 : 1) * distance * trackingScale / width
    let lo = Double(drag.lo), hi = Double(drag.hi)
    let x = raw > hi ? hi + rubberBand((raw - hi) * width, rubberDimension) / width
      : raw < lo ? lo - rubberBand((lo - raw) * width, rubberDimension) / width
      : raw
    position = x
    if sample {
      let time = max(timestamp, history.last?.time ?? timestamp)
      history.append((time, x))
      history.removeAll { time - $0.time > historyWindow }
    }
    let nearest = min(max(Int(x.rounded()), drag.lo), drag.hi)
    if nearest != drag.detent {
      drag.detent = nearest
      NNSwipe.performHaptic("alignment")
    }
    publish()
    emitPosition()
  }

  // Pages per second over the last 100ms before release.
  private func releaseVelocity(at timestamp: TimeInterval) -> Double {
    let recent = history.filter { timestamp - $0.time <= historyWindow }
    guard recent.count >= 2, let first = recent.first, let last = recent.last, last.time > first.time else { return 0 }
    return (last.position - first.position) / (last.time - first.time)
  }

  private func release(velocity v: Double, cancelled: Bool) {
    let home = drag.home
    let area = drag.area
    let width = area?.pageWidth ?? 0
    drag.area = nil
    var target = home
    if !cancelled {
      let flick = abs(v * width) >= flickVelocity
      target = !flick ? Int(position.rounded()) : v > 0 ? Int(position.rounded(.down)) + 1 : Int(position.rounded(.up)) - 1
      target = max(0, home - 1, min(count - 1, home + 1, target))
    }
    settle(to: target, velocity: towards(target, v), from: area)
  }

  private func towards(_ target: Int, _ v: Double) -> Double {
    let d = Double(target) - position
    return d != 0 && v != 0 && (d > 0) == (v > 0) ? v : 0
  }

  // MARK: Switching

  func switchTo(_ index: Int, order newOrder: String? = nil) -> Bool {
    guard configured else { return false }
    sync(order: newOrder)
    let target = min(max(index, 0), count - 1)
    drag.area = nil
    let v = phase == .settling ? velocity : 0
    settle(to: target, velocity: towards(target, v))
    return true
  }

  // A command can arrive before the props carrying its order: adopt the order first, keeping the
  // selected profile (or React's index when that profile is gone).
  private func sync(order newOrder: String?) {
    guard let newOrder, newOrder != order else { return }
    let ids = newOrder.components(separatedBy: "\n")
    guard !ids.isEmpty else { return }
    let current = orderIds.flatMap { selected < $0.count ? $0[selected] : nil }
    let id = current.flatMap { ids.contains($0) ? $0 : nil } ?? ids[min(max(propSelected, 0), ids.count - 1)]
    _ = select(id, order: newOrder)
  }

  // The order is the caller's, which may be newer than the props; the profile's index in it wins.
  func select(_ profileId: String, order newOrder: String) -> Bool {
    guard configured else { return false }
    let ids = newOrder.components(separatedBy: "\n")
    guard let index = ids.firstIndex(of: profileId) else { return false }
    cancelMotion()
    count = ids.count
    setOrder(newOrder)
    jump(to: index, selection: true)
    emitState("selected")
    return true
  }

  func step(_ delta: Int, wrap: Bool, order newOrder: String? = nil) -> Bool {
    guard configured else { return false }
    sync(order: newOrder)
    let target = wrap ? ((selected + delta) % count + count) % count : min(max(selected + delta, 0), count - 1)
    // At an unwrapped edge there is nowhere to go; leave any drag or settle alone.
    return target == selected || switchTo(target)
  }

  // MARK: Settling

  private func settle(to target: Int, velocity v: Double, from origin: SwipeArea? = nil) {
    if target != selected {
      selected = target
      sequence = NNPager.next()
      selectionSequence = sequence
      publish()
      emitState("selected")
    }
    stopSpring()
    phase = .settling
    velocity = v
    spring = Spring(from: position, target: target, velocity: v, start: CACurrentMediaTime())
    let generation = self.generation
    // The gesture's own screen, else any attached area's; never whichever app or window has focus.
    if let screen = origin?.window?.screen ?? areas.allObjects.lazy.compactMap({ $0.window?.screen }).first {
      let link = screen.displayLink(target: NNPagerFrames(self, generation: generation), selector: #selector(NNPagerFrames.frame(_:)))
      let fps = Float(max(60, screen.maximumFramesPerSecond))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: fps, preferred: fps)
      link.add(to: .main, forMode: .common)
      self.link = link
    } else {
      let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] timer in
        guard let self, self.frame(generation: generation) else { return timer.invalidate() }
      }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    }
    publish()
  }

  // False once this generation's spring is over, so its link or timer stops.
  fileprivate func frame(generation: Int) -> Bool {
    guard generation == self.generation, spring != nil else { return false }
    step()
    return generation == self.generation
  }

  private func step() {
    guard let s = spring else { return }
    let t = CACurrentMediaTime() - s.start
    let x0 = s.from - Double(s.target)
    let b = s.velocity + omega * x0
    let decay = exp(-omega * t)
    let x = (x0 + b * t) * decay
    let v = (s.velocity - omega * b * t) * decay
    if abs(x) < restDisplacement && abs(v) < restSpeed {
      stopSpring()
      position = Double(s.target)
      velocity = 0
      phase = .idle
      sequence = NNPager.next()
      publish()
      emitPosition()
      emitState("settled")
      reconcile()
      return
    }
    position = Double(s.target) + x
    velocity = v
    publish()
    emitPosition()
  }

  private func stopSpring() {
    generation += 1
    link?.invalidate()
    link = nil
    timer?.invalidate()
    timer = nil
    spring = nil
  }

  private func cancelMotion() {
    stopSpring()
    drag.area = nil
    phase = .idle
    velocity = 0
  }

  // MARK: Output

  private static func next() -> Int {
    counter += 1
    return counter
  }

  // Both areas map onto one Animated.Value, so one dispatch per frame: the dragging area, else a
  // live one.
  private func emitPosition() {
    let area = phase == .tracking ? drag.area : nil
    let all = areas.allObjects
    (area ?? all.first { $0.window != nil } ?? all.first)?.onPagerPosition(["position": position])
  }

  // Every area delivers it; JS keeps only the newest sequence.
  private func emitState(_ name: String) {
    var event: [String: Any] = ["phase": name, "sequence": sequence, "position": position, "selected": selected, "velocity": velocity]
    if orderIds != nil { event["profileId"] = selectedId }
    for area in areas.allObjects { area.onPagerState(event) }
  }

  private func publish() {
    var state: [String: Any] = [
      "sequence": sequence, "selectionSequence": selectionSequence, "position": position, "selected": selected,
      "phase": phase.rawValue, "velocity": velocity, "count": count,
    ]
    if orderIds != nil { state["profileId"] = selectedId }
    NNPager.lock.lock()
    NNPager.snapshots[key] = state
    NNPager.lock.unlock()
  }

  // In the controller's own order, which may be ahead of or behind the store's.
  private var selectedId: Any {
    guard let ids = orderIds, selected >= 0, selected < ids.count else { return NSNull() }
    return ids[selected]
  }

  #if DEBUG
  func debug() -> [String: Any] {
    var out = NNPager.snapshot(key) ?? [:]
    out["areas"] = areas.allObjects.count
    out["propSelected"] = propSelected
    out["propAck"] = propAck
    out["history"] = history.count
    out["lastInput"] = lastInput
    if phase == .tracking {
      out["drag"] = ["start": drag.start, "lo": drag.lo, "hi": drag.hi, "home": drag.home, "detent": drag.detent]
    }
    return out
  }
  #endif
}
