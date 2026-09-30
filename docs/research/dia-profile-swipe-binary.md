# Dia profile swipe: binary comparison

Inspected the installed `/Applications/Dia.app/Contents/MacOS/Dia` on 2026-09-30:
Dia **1.50.1**, arm64 UUID **C3CA2D1A-50CB-32CE-B0F6-17C7DE74D134**.
This is static analysis of the app bundle; no launch, interaction, or user-profile access.
Addresses below are unslid virtual addresses in this executable.

## Confirmed differences

### Dia processes MayBegin before our recognition gate

At `0x1005974c8`–`0x1005974ec`, Dia accepts the `MayBegin` phase (32) into
the event loop. For `Began` (1), it compares the event's absolute deltas at
`0x1005974f8`–`0x100597510`, rejects if vertical exceeds horizontal, and consults
`scrollingShouldBeginHandler` at `0x100597530`.

Ours passes `MayBegin` through without preparing the pager. It waits for a
cumulative **4 pt** horizontal displacement and its axis/arbitration checks
before emitting `began`. No 4 pt or 1.5 multiplier appears in the inspected
Dia controller entry; an external delegate may still impose additional rules.
The comment in `NNSwipe.mm` calling these values a Dia threshold is therefore
not established by this controller's binary.

**Inference:** waiting for 4 pt may delay visible feedback on light, short
gestures. The MayBegin branch alone does not prove that Dia moves pixels during
MayBegin. Keep page-content arbitration separate from sidebar-pager recognition
when replacing this path.

### Drag updates stay native in Dia

Swift metadata identifies `ARCUI.PageSwipeController` at descriptor `0x10648b8b0`,
with fields including `positionUpdateHandler`, `pageSelectionHandler`,
`settlingAnimationSession`, and `presentationAdoptionRange`.

Its tracking function begins at `0x10059733c`. It pulls AppKit events with
`nextEventMatchingMask:` at `0x1005978bc`, `0x1005979ac`, and `0x100597c90`.
At `0x100597ba0` it reads `scrollingDeltaX`, multiplies by **−0.5** at
`0x100597ba4`, adds it to the current native position, and publishes that position
without a JavaScript bridge.

Netnyahoo 0.2.17 still sends each event through `NNSwipe.mm` →
`SwipeArea.swipeEvent` / Expo `EventDispatcher` → `ProfileSwipeArea.onSwipe` →
`ProfilePager.track` → `Animated.Value.setValue` → native animation graph.
Only the settle animation was moved fully native. Native-driven `Animated.Value`
does not make its JavaScript gesture handler native.

**Implication:** JS scheduling can still delay drag motion, the release decision,
and the start of a new gesture. The earlier JS-stall settle test does not prove
drag responsiveness or immediate interruption.

### Selection happens before the settle begins

At trackpad release, `0x100597df0` reads velocity, `0x100597ebc` chooses a target,
and `0x100597fbc` enters the selection/settle function `0x100598c30`.
That function invokes `pageSelectionHandler` synchronously at `0x100598eb0`,
then starts the settle through `0x100596e30` at `0x100598ec4`.

Netnyahoo commits a swipe's target in `ProfilePager.settled()` after the native
spring's completion callback. Its response parameter **0.25 s is a spring
parameter, not a fixed duration**. With zero release velocity, the current
rest thresholds finish a 0.3 / 0.6 / 1-page displacement at approximately
267 / 300 / 333 ms at 60 Hz, before callback delivery and the profile-window swap.
These are calculations from `swipeMotion.ts::springParams` and
`react-native-macos/Libraries/NativeAnimation/Drivers/RCTSpringAnimation.mm`,
not measured physical trackpad latency. For zero initial velocity, with
`ω = 2π / 0.25` and initial distance `d`, displacement is
`d·exp(−ωt)·(1 + ωt)` and speed is `d·ω²·t·exp(−ωt)`. Stop at displacement
≤ 0.003 pages and speed ≤ 0.1 pages/s, sampled every 1/60 s.

**Inference:** announcing the destination before settling can let Dia's owner
advance selection during motion. The callback body is not decoded here; its
early invocation is verified, not the timing of all downstream state changes.
Ours continues to identify the old profile until completion, so reversal may
be based on a different selected page.
Netnyahoo moves its React root between separate Chrome profile windows, so simply
moving `finish()` earlier needs verification of window ownership and visual
continuity; Dia's callback ordering alone does not prove that change safe.

### Interruptions read position synchronously

The interrupt/adoption method `0x10059a650` checks the existing native settling
session, obtains the animator's current position through its vtable at
`0x10059a698`, subtracts the selected-page origin at `0x10059a6b0`, and invokes
the session's adoption/cancellation callback through `0x1005949d4` at
`0x10059a6b8`. It returns the adopted position synchronously to the tracking
loop. Separately, the sidebar has a `space_swipe_settling` removal site at
`0x10541ac98` (`removeAnimationForKey:`), verified in the scratch
`keyframes.asm`; the full callback chain from this interrupt to that removal
site is not decoded here.

Ours calls `Animated.Value.stopAnimation`, waits for native `getValue` to return
to JavaScript, and buffers track/release events in `pending` meanwhile. Generation
guards prevent stale callbacks, but they do not remove that round trip.

### Velocity is based on position history

Dia's tracker initializer `0x100696460` configures a **100 ms** history. Its clock
provider `0x1006964f4` uses `DispatchTime.now`. The getter `0x100696720` prunes
old position samples and computes `(lastPosition − firstPosition) /
(lastTime − firstTime)`. Release reads that getter without inserting an ended
event as another motion sample.

Ours keeps at most **six raw delta samples**, uses `NSEvent.timestamp`, and sums
the retained deltas over the interval through the ended event. This is not the
same estimator, even though both use a 100 ms age limit and the same 5 pt/s
target-selection threshold.

## Native settling mechanism

The sidebar uses `CAKeyframeAnimation` for `sublayerTransform.translation.x`,
under key `space_swipe_settling` (string `0x1061b1da0`). Verified call sites:

| Address | Operation |
| --- | --- |
| `0x105422f4c` | `animationWithKeyPath:` |
| `0x10542303c` | `setValues:` |
| `0x105423080` | `setKeyTimes:` |
| `0x1054230a0` | `setDuration:` from generated animation data |
| `0x1054230ac` | `setCalculationMode:` |
| `0x1054230d8` | `setTimingFunction:` |
| `0x1054230ec` | `setRemovedOnCompletion:false` |
| `0x1054230f8` | `setFillMode:` |
| `0x10542321c` | Write destination `sublayerTransform` |
| `0x105423244` | `addAnimation:forKey:` |
| `0x105423290`, `0x105423298` | Commit and flush transaction |

The controller sets spring response 0.25 s with the sidebar animation handler
present, otherwise 0.4 s (`0x100597040`–`0x10059707c`). This analysis verifies the
native layer animation path; it does not establish a fixed 250 ms completion
time or a measured frame rate.

## Implementation direction

The remaining structural change is to give a native controller ownership of
drag position, velocity, interruption, and settle. React should supply the page
configuration and receive semantic selection changes, without processing every
scroll event. Preserve existing Chrome history-scroll arbitration and verify
profile-window ownership during early selection. Retuning the spring alone
would leave the observed architecture mismatch in place.

No gesture implementation or release changed during this investigation. Static
analysis establishes these differences, not which one dominates the owner's
physical gesture. Native drag and interruption need their own blocked-JS test,
and the user's trackpad comparison remains the final feel check.

## Reproduction

Read the version with `PlistBuddy`, UUID with `xcrun dwarfdump --uuid`, and Swift
type/field metadata directly from Mach-O sections. Decode Objective-C stub
selectors through `__objc_stubs` and `__objc_selrefs`; the binary is stripped,
so nearby surviving symbol labels in disassembly are not function identities.
Use bounded **non-Mach-O-mode** disassembly, for example:

```sh
xcrun llvm-objdump --disassemble --start-address=0x10059733c \
  --stop-address=0x100598000 /Applications/Dia.app/Contents/MacOS/Dia
```

`llvm-objdump --macho --disassemble` ignores those address limits here and dumps
the whole executable. Scratch evidence for this run is in
`/tmp/nn-dia-swipe-binary/` and `/tmp/nn-dia-swipe-agent/`.
