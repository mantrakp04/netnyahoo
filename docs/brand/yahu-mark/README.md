# Big Yahu replaces Dia's mark

The owner's call (see `../directions.md` › Decision): keep everything Dia and swap only the logo. Big Yahu
replaces Dia's painted dome on the New Tab page and Dia's dome on the sidebar's New Tab row. The PowerUp band and
halo, the bar, tints and copy don't change.

## Assets

| File | What | Replaces |
|---|---|---|
| `ntp-yahu.png`, `@2x`, `@3x` (100 / 200 / 300 px) | Big Yahu bust, transparent, frame 100×100 pt | `OrbView` (the painted dome) in `apps/browser/src/components/NewTabPage.tsx` |
| `new-tab-yahu.png`, `@2x`, `@3x` (16 / 32 / 48 px) | Head glyph, white on transparent, tinted in code | `apps/browser/assets/new-tab-mark{,@2x,@3x}.png` |
| `source-ntp-yahu-1152.png` | The 1152 px master render the bust sizes come from | none |
| `source-new-tab-yahu-512.png` | The glyph at 512 px | none |
| `source/render-bust.html` | three.js render of `apps/site/public/models/big-yahu.glb` (camera, lights, pose) | none |
| `source/render-row-icon.html` | The glyph as SVG, with per-size stroke weights | none |

**The bust.** It's rendered from the site's GLB in the idle pose (Default Dance, t = 0), turned 0.14 rad, with a
long lens (8°). The frame covers model height 0.40–1.03, and the model is 1 unit tall.

- **Lighting.** A neutral warm key from the upper left, a cool-white fill, two white rims from behind, and
  RoomEnvironment reflections under neutral tone mapping.
- **One asset works everywhere.** I tested a rim-heavy version for dark and a softer one for light, and they're
  indistinguishable at 2×. `ntp-yahu` is the rim-lit one and works on light, dark, and every profile tint.
  - The mark carries no profile colour: his tie is the only saturated blue and it doesn't fight any tint.
  - So there are no per-theme or per-profile variants, and `logoPaint` / `orbTint` go away (see below).

**The glyph.** It's a hand-traced vector of the render: silhouette, a knocked-out hairline, the scowl and a
smirk. Stroke weights are tuned per size (hairline 1 / 1.6 / 2.2 px, brows 1.35 / 2.3 / 3.2 px). The RGB is pure
white like the old files, so `tintColor` works unchanged.

## Mocks (`mocks/`)

- `ntp-compare.png`: today versus Big Yahu, same captures, same crop, in four states.
  - Light Plum and Light Blue are real captures from `apps/site/src/assets/shots`.
  - Dark Plum is a real capture.
  - Dark Blue is the Dark Plum capture re-tinted to Blue.
- `sidebar-row-compare.png`: the New Tab row today versus new (real captures at 2×), plus the 16 / 32 / 48 px
  assets at full opacity and as tinted.
- `intro-frames.png`: the pop-up intro, dark and light.
- `window-<state>-{today,yahu}.png`: the full windows behind those crops.

Only the mark and the row icon change in these mocks. The rest (including "Ask anything…") is today's app as
captured.

## Placement

The asset frame is 100×100 pt, centred on the bar the same way the dome is (`viewWidth / 2 + DIA_OFFSET`).

- **Rest position.** The frame's top sits **84.1 pt above the bar's top edge**, so its bottom is 15.9 pt below it.
- **What shows.** He is cut at the bar's top edge. Head, collar and tie knot are visible: about 82 pt wide and
  79 pt tall, a similar footprint to Dia's 76 pt dome, whose top sits 86.6 pt above the bar.
- **Clipping.** Clip him to the bar's top edge with a container that ends at the bar's top and has
  `overflow: "hidden"`. Don't rely on the bar covering him: it is opaque today (`ntpBarSolid`), but the
  `REBRAND = false` path is translucent.

## Intro

He pops up from behind the bar, taking the mark's part of Dia's intro. The band and halo keep playing as today.

- **When it plays.** On the same `playIntro` gate (the first time a tab shows its New Tab page), starting 80 ms
  after the page appears.
- **Motion.** `translateY` goes from 86 pt (fully hidden) to 0 on a spring: response ≈ 0.45 s, damping ratio
  ≈ 0.62, which is about stiffness 195 and damping 17 at mass 1.
  - That gives one overshoot of about 4 pt at ≈ 0.24 s, settling by ≈ 0.5 s.
- **Tilt.** Rotate about the bottom centre, following the overshoot: map `translateY` −4 → 0 → 86 to −3° → 0° → 0°.
- **Reduce Motion, or a tab that already played its intro.** He's at rest with no animation, as the band is today.

## Wiring

These edits belong to whoever owns these files. I haven't touched app code.

1. **Copy the assets.**
   - `ntp-yahu{,@2x,@3x}.png` → `apps/browser/assets/`.
   - `new-tab-yahu{,@2x,@3x}.png` → `apps/browser/assets/new-tab-mark{,@2x,@3x}.png`, overwriting them. Or add
     them under the new name and change the `require` in `components/primitives.tsx`.
2. **`components/NewTabPage.tsx`:**
   - Drop `Orb` from the `@netnyahoo/shaders` import.
   - Replace `LOGO_SIZE`, `LOGO_CENTER_ABOVE_BAR`, `ORB_PAD`, `SHOW_ORB` and `logoFrame()` with:

     ```tsx
     const YAHU = require("../../assets/ntp-yahu.png");
     /** Big Yahu's frame (100 pt) and how far its top sits above the bar; he's cut at the bar's top edge. */
     const YAHU_SIZE = 100;
     const YAHU_ABOVE_BAR = 84.1;
     ```

   - Where `<Orb …/>` is, render a clip view:
     - `position: "absolute"`, `left: size.width / 2 + DIA_OFFSET - YAHU_SIZE / 2`, `top: top - YAHU_ABOVE_BAR`,
       `width: YAHU_SIZE`, `height: YAHU_ABOVE_BAR`, `overflow: "hidden"`, `pointerEvents: "none"`.
     - Inside it, an `Animated.Image` of `YAHU`, 100×100, with the intro transform above.
     - Keep it before the bar's `View`.
   - Pass `logoFrame={null}` (or drop the prop) in the dead `EdgeLightLayer` path.
   - Update the header comments that describe Dia's mark.
3. **`components/primitives.tsx`:**
   - Update the `NewTabIcon` comment, which describes Dia's dome.
   - Keep the tint (white 0.28 / black 0.30). If the head reads too faint in a real build, try 0.34 in dark;
     check it against a capture.
4. **Delete what only the dome used:**
   - `packages/shaders/ios/OrbView.swift`.
   - `OrbModule` in `packages/shaders/ios/ShadersModule.swift`, and `"OrbModule"` in
     `packages/shaders/expo-module.config.json`.
   - `LogoPaint`, `OrbProps`, `NativeOrb` and `Orb` in `packages/shaders/src/index.tsx`.
   - `logoPaint` in `Theme` and `orbTint` in `ProfileTheme` in `apps/browser/src/lib/theme.ts`, with their
     values in `PROFILE_COLORS`, `INCOGNITO` and the fallback theme builder, and the `LogoPaint` import.
   - Removing a Swift file from the pod needs `pod install` under `/tmp/nn-pod.lock`.
   - `pnpm -w typecheck` will find anything left.
5. **Docs.**
   - `docs/dia-feature-parity.md`: mark the New Tab logo row as intentionally ours.
   - `docs/dia-spec.md`: leave the dome measurements as reference.

## Verify in a build

1. Run a hidden instance with `NETNYAHOO_SHADERS_FORCE_KEY=1` and compare against `mocks/ntp-compare.png` in
   light and dark, with Plum and Blue.
2. Check the intro timing with the SCK recorder.
3. Check that nothing shows below the bar's top edge during the pop-up.
4. Check the row icon at 1× on a non-Retina display.
