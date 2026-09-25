# Dia reference spec

Measured from Dia 1.49.1 on this machine. Sources: asset-catalog color tokens (`assetutil --info`),
disassembled Metal (`metal-objdump`), 2× screen captures, and a 60 fps recording of the New Tab intro.
Units are points unless noted. "Dark" is the dark appearance with the user's plum theme.
Dia 1.50 ("Sunglow") changes are in the last section; where it says "rebrand flag" below, that flag is now on.

## Window

- Window 1512×949, sidebar layout (`tabLayoutStyle.sidebar`), `sidebarWidth` 190.
- Traffic lights: close-button center ≈ (25, 26).
- Window tint (dark, plum theme), top → bottom: `#2A191F` → `#2B2225` (mid) → `#312F30`.
  The Dia default theme uses `#1C1A1F` with a blue→pink overlay at 18%
  (`WindowTint/BaseGradient`).
- Grain is multiply-blended over the tint (ARC_WindowThemeUI `renderFragment`).

- The window tint is not constant. It changes with key state and content: the sidebar samples
  (35,30,32) when key on the NTP, and (58,46,47) when inactive over a web page. Compare backdrops
  only in the same state.
- Active vs inactive: WindowThemeBackgroundViewMetal re-renders on key/main notifications and counts
  a window as active when it or a parent window is key or main. Active, the window is vibrant (its
  tint depends on what's behind it). Inactive, it falls back to an opaque, lighter tint: plum dark
  fitted in OKLab from an inactive 2x capture, de-grained: `#352224` → `#423C3C`
  (ΔOKLab top +0.0382/−0.0002/+0.0072, bottom +0.0548/+0.0035/+0.0036; apps/browser/src/lib/windowTint.ts).

## Content card

- Frame: x = sidebar width, top 6, right 7, bottom 7. Radius 10.
- Fill: `WindowContent/BaseTint`, #121212 at 60% (dark) or white at 80% (light), over the window
  tint. Samples: `#1B1416` at the top, `#1F1C1D` at the bottom. Web content is opaque and sits
  below the toolbar; the toolbar itself is translucent card.

## Toolbar (inside the card)

- Height 41. Icon centers from the card's left edge: 21, 56, 92, 127 (sidebar.left, chevron.left,
  chevron.right, arrow.clockwise). Glyphs are about 15pt, regular weight.
- Button hover: a ~30pt rounded square (radius 7) at white 10%.
- Breadcrumb at x 153: `host` (primary, medium) + ` / ` + the full page title (secondary, 50%).
  The title is not split on `·`, `|` or `—`.
- URL hover: the breadcrumb morphs into a pill (white ~8%, radius 8) showing the full URL, with
  the host bright and the path dim. Actions appear on the right: `bookmark`, `rectangle.split.2x1`,
  `signature`, `slider.horizontal.3`.
- A hairline divider sits under the toolbar on web pages. There is none on the New Tab page.

## URL click → command panel (anchored, no scrim)

- Floating panel over the toolbar, starting ~46pt left of the breadcrumb, ~890 wide, radius ~16,
  fill ≈ `#2A2A2A`, hairline border, drop shadow.
- Row 1 (54 tall): leading icon, then the input at ~17pt with the URL preselected (selection
  `Input/SelectedText/Go` dark = rgba(120,125,134,.7)). The leading icon becomes the selected
  suggestion's favicon.
- Suggestion rows: 36 tall, 16pt favicon, title ~15pt white, ` — url` at 50%. The selected row is
  a warm grey fill (~#5E5A5D) with radius 10, inset 4. A search row (magnifier + query) comes
  after the top hit. Inline autocomplete selects the completed remainder.
- Bottom row (53 tall): outlined chip "+ Add tabs or files" (1px white 15%, fully rounded, 28
  tall), a mic (30%), then "Go ↩" pill (lavender `#DCCBD8`-ish, dark text, ~92×29).

## Sidebar

- Header 46: traffic lights, and a downloads button (`arrow.down.circle`) centered at x 166, y 26.
- Pinned tabs: tiles inset 7 (x 7…183), 40 tall, top at 54.5, radius ~10, favicon centered.
  - Selected (TabUI `TabDockItemView` + `SelectionOutlineView`, from the 1.50.1 binary): themed by
    the icon (`TabIconProcessorImpl._generateTheme`, a `TabIconTheme`). The icon is drawn at most
    32 px on its long side; its pixels with alpha ≥ 0.975 are averaged (RGB 0…1) and their mean
    Euclidean distance from that mean decides:
    - ≥ 0.055, colourful → `blur`: the icon through CIGaussianBlur (radius 5), aspect-filled into
      2.5× the tile, centred. The tile is white 20% (dark) / white (light) under that image at 22%;
      the ring is a 3pt border (`itemStrokeWidth`, backing-aligned) masking the same image over
      black (dark: image at 75% with CIColorControls saturation 2, brightness −0.1) / white (light,
      image at 100%). So YouTube gets a red ring, X a black one.
    - < 0.055, one colour → `template`: the tile filled with the mean colour, the icon drawn as a
      white template, the ring white with a soft-light compositing filter. A near-white icon (WCAG
      relative luminance > 0.88) gets a black fill and an opaque white 30% ring instead.
    - No theme (a non-RGB image, no opaque pixels, no favicon): fill `TabBackgroundSelectedPrimary`
      (black / white), ring `TabDockItemDefaultSelectionStroke` (white .45 dark / black .48 light).
      Netnyahoo still draws its older look there (white 25% fill, black rim, `TabOutline` bevel).
    - Only the primary selection draws the ring; a secondary selection is a
      `TabBackgroundSelectedSecondary` fill with no ring. The dock item has no `TabOutline` bevel
      or `TabSelectedShadow` of its own.
    Emoji custom icons are drawn at 16pt and themed the same way.
  - Unselected: white ~8% (`TabDockItemRestingBackground` white 10%, stroke 14%).
- Tab rows: 33 tall on a ~37 pitch, inset 7. Favicon 16 at x 16, title at x 38.5, 13–14pt.
  Title color: `TabTitleUnselected` white 78% (dark) or black 68% (light); selected white 100%.
  Titles fade out at the trailing edge instead of using an ellipsis.
  - Hover: `TabBackgroundHovered` white 16% (dark) or white 55% (light). An `xmark` close button
    appears on the right, with its own ~22pt hover square.
  - Pressed: white 31% (dark) or 70% (light).
  - Selected (regular): dark fill ≈ black 40% (sample `#1B1618` on `#2A1E23`), white title.
  - Audio: a `speaker.wave.2` glyph after the favicon.
- "+ New Tab" row: plus glyph and label at 50% alpha; hover as above.
- Pinned tile hover: a custom tooltip showing the title and URL.

## New Tab page

- The card is translucent (no black fill). A glass orb (Dia's logo, 68.5pt; see below) sits above the bar.
- Command bar ≈ 652×108: translucent panel, radius 20, 0.5pt border (see "Command bar panel").
  Row 1: magnifier + placeholder "Ask anything…". Row 2: "+ Add tabs or files" chip, mic, and a
  round `arrow.up` send button (disabled grey when empty).
- Bar geometry (from `NewTabPageViewController`): width 652 for views 708–1700pt wide (774 above,
  `viewWidth − 20` capped at 616 when narrower), `x = max(midX − width/2, 14)`,
  `top = max(contentH/2 − 158, 100) + 38` below the toolbar (subtract 80 when a flag is set).
- Entrance: `commandBarElevationMillimeters` springs 0 → 10mm (response 0.7, damping 1.0,
  settle 0.001). Scale is `0.99 + 0.01·mm/10` (panel `sublayerTransform`). It is skipped under
  Reduce Motion. It runs only with the daylight effect (`daylight-effect-enabled`), which is
  mutually exclusive with the area light, so with the area light the bar starts at 10mm (scale 1).
  The daylight shadow projection (a sun-position-based CALayer shadow) is likewise off. The panel's
  own shadow (black 0.08 r2 / 0.04 r1) applies only with the rebrand flag.

### Area light (`NewTabAreaLightView` → `BreathingAreaLightView`, recovered from the binary)

- Created with cornerRadius 22, liftDistance 10, rotation (5°, 0), falloff 1.0, introDelay 0.05,
  introDuration 0.4, and view `alphaValue` 0.75. There is no light for the `neutral` theme.
- Intensity = (dark ? 4 : 0.5) × (negateAngle ? 0.5 : 1); lightMode = !dark. The halving is
  effectively dead code on the NTP: intensity is computed in `init` before NTPVC sets
  negateAngle, and it is only recomputed on an appearance or theme change. The tilt does pick up
  the flag at the next layout. Capture-verified: tilt −2.5° at intensity 4. negateAngle is
  `showDiaIcon`, which is only true with the rebrand flag (off here, even though the orb shows).
- Frame `(0, 0, w, max(0.85h, 720))`; `shapeFrame = lightSourceFrame.insetBy(8, 8)` (the panel).
- `k` = 1 for a key window, 0.5 otherwise. `r = (panelHeight − 112)/240`.
  lift = `k·(r<1 ? 10 − 4·max(r,0) : 6)`;
  tilt° = `k·(r<1 ? 5 − 4·max(r,0) : 1)·(negateAngle ? −0.5 : 1)`.
- Clock: 30 fps display link while the window is key; stops at T ≥ 60s. The link is created
  paused. NTPVC.loadView skips the light ahead to T = 5 (settled) and the edge light to its end;
  the entrance then calls `restart()` (T = 0) only if the window is key and Reduce Motion is off.
  `windowDidBecomeKey` → `resume()` (unless finished), `windowDidResignKey` → `pause()`; both
  relayout, so a paused light is redrawn with the new `k` (setters call `setNeedsDisplay`, and
  only the display link advances time).
- Reduce Motion skips the whole entrance: no bar spring, no power-up band (never created), the
  edge light stays at its skipped-ahead end state, the area light stays at T = 5.
- Per frame:
  - `e = max(T − delay, 0)`, `t = clamp(e/dur)`, `u = 1 − (1+3t)e^(−3t)`
  - `P = u²(3−2u) − 0.25(1−t)·sin(πt)`
  - `lift = 3 + (L−3)·P`, tilt × P
  - `introFade = smoothstep(e/(0.25·dur))`
  - `effectiveTime`: linear until 0.75A, then eases to a stop
  - `breath = exp(−(p−0.365)²/2σ²)` with `p = (T mod 6)/6`, σ = 0.15 before the peak and 0.30 after
  - `fadeOut = 1 − smoothstep((T/A − 0.75)·4)`
  - `intensity = I·introFade·(1 + 0.5·breath·fadeOut)`
- Palettes (one per theme hue family, 5 stops):
  - blue/default: #4691C3 #4BA5B9 #418CBE #48B6DA #55A2E4
  - red: #C1575C #C35F4B #B95058 #DB463C #E16070
  - pink: #D37B8B #C387A0 #C3738C #D27DA8 #E37C94
  - orange: #D87249 #D08C64 #D26941 #DA965A #DE7034
  - yellow: #E3AC38 #F0BE55 #EBB441 #EEBB26 #F3C93B
  - green: #3EB489 #73B982 #4BAA82 #84C978 #45BE74
  - purple: #7873AF #8C69AF #7D78B4 #877ECB #856BD0
- Observed at rest (plum theme): a thin pink-white rim hugging the bar, with a magenta haze above
  and below. The rim pixel just below the bar is `#37282F`.

### Command bar panel (`AssistantPanelRootView`, recovered from the binary)

- With the area light on: an `NSVisualEffectView` (`.hudWindow`, `.withinWindow`) under the
  `TransparentBackground` fill, which is dark (24,24,24) at 0.8 and light (255,255,255) at 0.85.
  The area light shows through. A new tab's bar starts at a neutral (24,22,23) and settles at
  (30,25,26) as the light fades in.
- Corner radius 20 (continuous). Border is 1 device pixel of `Border/None`, dark
  rgba(120,125,134,0.32). Shadow is `Shadow/Default`, black at 0.12.

### Logo (orb), measured from a same-screen capture

- Silhouette = Dia's edge-light logo SDF: a circle of diameter s, minus a circle of radius s
  centred 1.25·s below, smooth-subtracted with k = 0.05·s. Here s = 68.5pt, and the circle's
  centre is 49.5pt above the bar top. The edge light's `logoFrame` (iconFrame + 5) is that box.
- Glass shading (dark): about 5% pink-white at the centre, rising Fresnel-like to about 24% at
  the edge, a crisp 1pt rim, and a white highlight at 0.86R, 52° above the +x axis.

### Intro: power-up band + edge light (recovered from the binary)

- `CommandBarPowerUpView` runs `powerUpFragment` (see `packages/shaders/ios/PowerUpView.swift`):
  direction 0 (it enters from the bottom), origin 0.5, speed 1.25, fadeOutStart 1.0,
  fadeOutDuration 2.0. The clock is frame-counted at 60 fps and finishes at T = 3.75. The palette
  is uploaded as OKLab, and band alpha is scaled by 0.1 in the shader. Output is premultiplied.
- `EdgeLightView` covers (panel ∪ icon) outset by 10pt, at least 480 tall, drawn above the bar.
  It uses cornerRadius 20 and runs for 1.0s with easeOutExpo. The light travels from
  `(midX, maxY + 300)` to `(midX, minY)`. Light color is the theme color at 0.5 alpha (dark). The
  logo rim uses the icon frame shifted +5pt in y.
- The power-up palettes are per hue and separate from the area light's (sRGB, converted to OKLab
  on the CPU). Pink is #FF6AFF #FE8097 #FF9966 #FCE0FF #FA62B1. With the rebrand flag on it is a
  single theme colour instead.
- The band's MTKView layer has a Core Animation `gaussianBlur` filter with inputRadius 24, full
  resolution and no edge normalisation. This turns the shader's hard stagger bins into soft wings.
- `negateAngle` is `showDiaIcon`, which is only on with the rebrand flag, so it is off by default
  even though the logo is visible. Dia's +5° equals −5° in our AreaLight port (verified from a capture).
- The edge light's `lightColor` is the user's theme `primaryColorPalette.midTone` (0.5 dark /
  0.4 light), not a hue table.
- Bar entrance: a spring from 0.99 to 1 that starts +0.25s after appear (response 0.7,
  bounce 0.3). The edge light layer scales with it. **Correction (1.50 capture + binary):** without
  the daylight effect NTPVC stops the entrance animator and pins the elevation at its resting value
  (`0x104e3e72c`), so the bar is at scale 1 from the first frame. The 1.50.1 capture shows no
  movement of the bar edges (< 0.1 px; 0.99 would be 3.3 px).
- Measured at 60 fps (plum, dark): band energy peaks 118–134 ms after appear, with its centroid
  about 180pt below the bar. It is magenta (≈ 133:65:101 in the difference image). It reaches
  the bar by about 270 ms.

## Color tokens (Dia asset catalogs)

| Token | Light | Dark |
|---|---|---|
| TabBackgroundHovered | white .55 | white .16 |
| TabBackgroundPressed | white .70 | white .31 |
| TabBackgroundSelectedPrimary | white 1 | black 1 |
| TabBackgroundSelectedSecondary | white .70 | white .25 |
| TabBackgroundUnselected | black .06 | white .06 |
| TabOutline | white .98 | white .20 |
| TabSelectedShadow | black .12 | white .15 |
| TabTitleSelected / Unselected | black 1 / .68 | white 1 / .78 |
| TabDockItemRestingBackground / Stroke | black .05 / .18 | white .10 / .14 |
| TabDockItemDefaultSelectionStroke | black .48 | white .45 |
| WindowContent/BaseTint | white .80 | #121212 .60 |
| Menu/ItemBackgroundHovered | black .07 | white .07 |
| Menu/HairlineBorder | black .25 | white .30 |
| CommandBar Hover/Go | rgba(15,24,44,.08) | rgba(120,125,134,.32) |
| CommandBar Input/Placeholder | black .40 | white .53 |
| CommandBar PrimaryText / SecondaryText | #0F182C / .6 | white / rgba(239,244,255,.6) |
| CommandBar Input/Cursor/Search | #6395FC | #4A77D4 |
| DownloadsButton ButtonTintColor | black .78 | rgba(247,245,255,.78) |
| Primitives/Primary600 (secondary text) | black .60 | white .60 |
| Primitives/Primary1100 (subtle fill) | black .12 | white .12 |
| Brand spectrum (ProgressBarColor2–7) | #0358F7 #5092C7 #E1E1FE #FFD400 #FA3D1D #FD02F5 | |

## 1.50 "Sunglow" (Dia 1.50.1, build 87750)

Recovered on 2026‑09‑25 from the 1.50.1 bundle (installed 01:11, Xcode 26.4 / macOS 26.4 SDK, minOS 14.0) and diffed
against the 1.49.1 dumps: asset catalogs (`assetutil --info`, all 45 `Assets.car`), Metal (`metal-objdump -d`),
binary strings, the objc class list, the feature-flag table, and function-by-function disassembly of the NTP, tab
and sidebar code. One read-only 2× capture of the user's 1.50.1 window (dark, key, plum) backs the tab values.
Release notes: issue 43, "Crafted with care, because you spend your day here." (1.50.0, 2026‑09‑24).

**What Sunglow is.** A brand refresh, not a chrome redesign: a painted brand (by BCNY's An), a Sunglow Yellow app
icon, and a hand-painted Dia mark per profile colour on the New Tab page. The painted mark is Dia's existing
`ntp-rebrand-enabled` code path (compiled default **false**, flag table `0x100ed7dc0`, definition `0x100ed4428`,
packed default `0x200`), turned on remotely through LaunchDarkly. It is on for this user: the selected tab in the
1.50.1 capture is exactly the rebrand tint (below). There is **no Liquid Glass API use** (`NSGlassEffectView`,
`NSGlassEffectContainerView`, `NSBackgroundExtensionView`, `glassEffect` appear in neither version); the only glass is
what the macOS 26 SDK gives standard AppKit controls, menus and popovers. Our build uses the 27.0 SDK, so it gets the same.

### Unchanged from 1.49.1 (verified)
- All 1017 UI colour tokens except the app icon's (see below). Every token in the table above still holds.
- Every Metal shader (window theme, navigation-bar loading indicator, PowerUp library: edge light, halo, power-up,
  area light, chroma power-up, logo volume, unboxing, ripple shimmer, swirl, spotlight): identical IR; only function
  offsets moved.
- Tab shape/background drawing, sidebar header, pinned dock, window controls: 167/170 functions matched, no float
  constant changed. Row pitch 37 (collection item 34), tile height 40, radius 10.
- NTP: bar width table, `top = max(contentH/2 − 158, 100) + 38` (− 80 while the Connect Apps upsell reserves layout
  space, `ConnectAppsUpsellViewModel…reservesLayoutSpace`; it is not a rebrand term), x = `max(midX − w/2, 14)`,
  halo radius 22, edge light, area light, entrance begins +0.25 s from scale 0.99 with the same spring.
  Correction to the 1.49 notes: the height left for the panel below the bar is `contentH − top − 80`.
- Geometry: the logo's button is 50×50 at `x = (W − 50)/2`, `y = barTop − 74`; the icon view is 84×84 centred 1pt
  below the button centre, i.e. **48pt above the bar top**. Same constants in 1.49.1; our 68.5pt / 49.5pt logo box was
  measured from the screen, not read from these.

### Changed in 1.50 (delta list)
1. **App icon.** `AppIcon_Assets/Color-2` p3 (1, 1, 1) → (0.984, 0.976, 0.941); `Color-3` p3 (0.900, 0.900, 0.948) →
   (0.933, 0.925, 0.890): the plate is now cream (sRGB ≈ #FBF8EF top → #EEEBE2 bottom), with a painted Sunglow
   Yellow mark (median sRGB (252, 201, 47), range (251, 197, 45)…(252, 218, 59)). In the 256px icon the plate spans
   25…230 and the mark 52…202 × 65…185. Same logo shape. The Beta/Canary/Dev/Pro icon colour sets left the main catalog.
2. **Painted New Tab mark** (rebrand). `diaIconView` is a `LogoParticleView` whose factory (`0x102b6e78c`) takes
   `renderStyle = isRebrandEnabled`: the particle MTKView drops to 30 fps and alpha 0 (it still feeds uniforms) and a
   `LogoTexturedMaskView` on top draws:
   - `textureLayer`: a painting, `contentsGravity = resizeAspectFill` in the 84pt view, masked by `shapeLayer`
     (the Dia outline from the particle uniforms, `0x102b697d0`: constants 19/21, 15.8852, −8, k 0.05, −0.45);
   - `shadeLayer`: black at opacity 0.05 inside the texture layer (path `0x102b69e28`, not decoded);
   - texture opacity `u ≤ 0 ? 1 : 1 − 0.9·min(u, 1)` (uniform +0x14);
   - paintings: `BoostBrowser_PowerUp.bundle/Contents/Resources/{neutral,red,orange,yellow,green,blue,pink,purple}{,-dark}.png`,
     1200×1200 RGBA at 216 dpi (loose files, dated Sep 11). Picked by the theme's palette name (`0x102b6ac70`:
     0 neutral … 7 purple), with `-dark` when the view's appearance best-matches DarkAqua; neutral themes use grey.
     Each is a different technique: neutral horizontal brush strokes on canvas, red vertical wood-like streaks, orange
     flat matte, yellow soft impasto, green sweeping strokes, blue cloudy wash, pink mottled canvas, purple canvas
     with soft light.
   - Measured OKLab of the logo-sized middle (68.5/84) of each painting (L 5th/50th/95th percentile; mean a, b):

     | Painting | Light L | Light a, b | Dark L | Dark a, b |
     |---|---|---|---|---|
     | neutral | .510/.663/.760 | 0, 0 | .360/.482/.573 | 0, 0 |
     | red | .563/.675/.723 | +.084, +.055 | .365/.456/.500 | +.071, +.047 |
     | orange | .710/.748/.778 | +.061, +.071 | .593/.606/.620 | +.058, +.076 |
     | yellow | .747/.797/.844 | +.024, +.113 | .639/.695/.745 | +.029, +.124 |
     | green | .513/.695/.839 | −.068, +.036 | .348/.491/.647 | −.061, +.033 |
     | blue | .788/.836/.864 | −.005, −.035 | .606/.666/.700 | −.008, −.050 |
     | pink | .726/.801/.865 | +.033, +.012 | .505/.583/.666 | +.045, +.016 |
     | purple | .646/.737/.829 | +.016, −.048 | .457/.540/.644 | +.018, −.057 |
   - `showDiaIcon = X || isRebrandEnabled`, so `NewTabAreaLightView.negateAngle` is on (tilt flipped and halved).
3. **Command bar shadow** (rebrand, only without the daylight effect; new applier `0x104e3cf04`): two layer shadows,
   black 0.08 radius 2 offset (0, 0.5), and black 0.04 radius 1 offset (0, 2), spread 0. The panel itself
   (`AssistantPanelRootView`) is unchanged.
4. **Power-up band** (rebrand): one theme colour instead of the per-hue palette: the palette's primary colour, or
   sRGB (0.502, 0.502, 0.502, 0.65) for neutral. `CommandBarPowerUpView` now takes `cornerRadius` (NTP passes 20; halo
   uses +2 = 22, as before). With the rebrand the area light and edge light are **off**, so the band runs at speed
   1.0 and the halo is shown: see "1.50 New Tab intro" below.
5. **Entrance elevation** 10mm → **5mm** (8 sites, e.g. `0x104e3e784`); the scale is now `0.99 + 0.01·mm/5`, so the
   scale curve (0.99 → 1, response 0.7, damping 1.0) looks the same. Only the daylight shadow depth would differ.
   The spring runs only with the daylight effect; otherwise the elevation is set straight to 5 (scale 1).
6. **Selected tab tint** (`TabShapeView`, rebrand override `0x103b0e6f0`): dark `#121212` at 0.5, light white at 0.7
   (1.49: black ≈ 0.36–0.4 / opaque white). Capture check: fill (42, 35, 37) over sidebar (66, 52, 54) =
   #121212 at 0.50 exactly. `gradientLightnessDelta` 0.25 with the rebrand (0.4 without); its use is not decoded.
7. **Profile (space) swipe settling**: `sidebar-space-swipe-animations` (default **on**) settles the sidebar pages
   with a `CAKeyframeAnimation` on `sublayerTransform.translation.x` (key `space_swipe_settling`, linear, sampled
   every 1/240 s from the spring) and a **0.25 s** critically damped spring (0.4 s without). Rubber band unchanged:
   `255·(1 − 1/(0.15·x/255 + 1))`; no keyframes when the overshoot reaches 255pt.
8. **Tab loading spinner** turns the other way: `transform.rotation.z` 0 → −2π (was +2π), 1.88 s, linear, repeating
   (`0x103d9e9a4`, key `activityRotation`). The view is unflipped, so −2π is clockwise on screen (1.49 turned
   counter-clockwise). It's TabUI's private `ActivitySpinnerView` (`0x103dab0bc`): a `trackLayer` and a `ringLayer`
   (CAShapeLayers, no fill, line width 1.5) on an ellipse in the bounds inset 1.25; the ring has round caps and
   strokeEnd 0.72; colours `secondaryLabelColor` (ring) and the same at alpha 0.18 (track), resolved per appearance.
   `TabContentView` shows it as its trailing affordance when the view model's `showsActivitySpinner` is set and the
   row is at least 48 pt wide: 12 × 12 at x = width − 8 − 12, centred vertically (`0x103d9fea4`).
9. Tab row background change fades 0.3 s easeOut (new, `0x103dbce4c`); an 82pt width gate and a 17.5pt bottom inset
   belong to the Tasks sidebar style (`TabGroupSidebarStyle.tasks`, AI, off by default).
10. Settings: the Appearance pane (`better-days-appearance-settings-enabled`: Light/Dark/Automatic, app icon options)
    was deleted; "Double-click empty sidebar space for a new tab" and "Paste and Go" lost their flags (always on).
11. NTP postcards hide when a (48, 40, 320, 200) rect meets the command bar (new flag
    `new-tab-page-postcards-hide-on-command-bar-intersection-enabled`). The NTP and Personalization "Pro Badge"
    images and the Dia Pro background button are gone.
12. Not in the binary, despite the release-notes mock-up: the placeholder "Search or ask a question" and a "…" button
    in the bar. 1.50.1 still says "Ask anything…".

### 1.50 New Tab intro (rebrand light configuration)

Recovered from the 1.50.1 binary and checked against a window-only ScreenCaptureKit capture of the user's Dia
(1512×949 pt at 1×, ~60 fps, dark, key, plum-like theme; 7 New Tab intros, ⌘T ~4 s apart). t = 0 is the first
frame that changes.

**What drives the change.** `NewTabPage…State.lightConfiguration` is `{isAreaLightEnabled, isEdgeLightEnabled,
isDaylightEffectEnabled}` (state bytes +0x5a/+0x5b/+0x5c; NTPVC applies it in `0x104e3e584`). The controller
(`0x104e0c2d0`) sets it to **all false when `isRebrandEnabled` and the daylight flag is off**, and to
`(false, false, true)` with the daylight effect. The 1.49 path (area + edge light) is only taken without the rebrand.
So on 1.50.1 with the rebrand rolled out:
- **No area light** (`NewTabAreaLightView` is removed) and **no edge light**. The page is perfectly flat once the
  band has faded: at t ≥ 3.25 s every pixel around the bar equals the page background.
- `CommandBarPowerUpView(colors: [theme colour], direction: 0, showHalo: !isAreaLightEnabled, cornerRadius: 20,
  origin: 0.5)` (`0x104e48080`), added at the bottom of the NTP view. **Speed** = `isAreaLightEnabled ? 1.25 : 1.0`
  (`0x104e480bc`), so **1.0**; the speed setter (`0x102b6202c`) also sets the halo's.
- The command bar panel uses the opaque `AssistantPanelUIBase/Background` (dark sRGB 0.176 = #2D2D2D, light
  (0.996, 1, 1)) instead of `TransparentBackground` over a `.hudWindow` material. Capture: flat (45, 45, 45).
- No bar entrance (scale 1 throughout) and no logo entrance: the painted mark is at full opacity in the first frame.
- Shaders are unchanged from 1.49; only which views exist and their parameters changed.

**Power-up band** (`PowerUpBackgroundView`, same shader, blur 24): speed 1.0, so `t = 0.75·time + 0.45`; the fade
starts at time 0.73 s and ends at 3.4 s. Capture (band region 300–600pt below the bar, mean delta over the page,
dark): rises within 1 frame, peaks at t = 0.10–0.20 s (≈ +9.3, +3.0, +4.6 RGB levels over (44, 40, 41)), the head
passes the bar at ≈ 0.3 s, plateau ≈ +5 levels from 0.4 to 1.2 s, then a linear fade to 0 at ≈ 3.25 s (last visible
levels). The band covers the page from ≈ 125pt above the bar to ≈ 20pt above the bottom edge. Colour fitted from the
capture: **#B5556B** (the delta is `α·(c − page)` with the same α in all three channels).

**Halo** (`HaloView`, `haloVertex`/`haloFragment` in the PowerUp metallib):
- View frame = `haloFrame` (the command bar) outset by 50 (`CommandBarPowerUpView.layout`, `0x102b62f0c`); set by
  CBPU init: inset 50, delay 0.18, cornerRadius = bar radius + 2 = 22. HaloView defaults: speed 1, direction 0,
  cornerRadius 18, fadeOutStart 1.0, fadeOutDuration 0.2, colours #FF844F → #F773A5 (replaced by the theme colour).
- Clock: `time += 1/preferredFramesPerSecond` per drawn frame (60 fps); paused once time > 2. Pipeline bgra8Unorm,
  no blending (the fragment writes premultiplied colour).
- Fragment (buffers: 0 resolution, 1 direction, 2 two float4 colours (sRGB), 3 isDark (bool), 4 time, 5 speed,
  6 delay, 7 fadeOutStart, 8 fadeOutDuration, 9 inset, 10 cornerRadius):
  - `p = (uv − 0.5)·2`, `p.x ·= w/h`; half size `(1 − 2i/w)·aspect, 1 − 2i/h` (for w > h);
    `r = cornerRadius / min(w − 2i, h − 2i)`; `dist = |length(max(|p| − half + r, 0)) − r|`.
  - `t = 0.8·speed·time − delay`; `sweep = 1.25·(1 − 2^(−10t))`.
  - `around`: angle of `p/half` from +x, + direction·π/2, as a fraction of a turn `a`;
    `around = 2·fold(fmod(1.25 − a, 1))` (fold: x > 0.5 → 1 − x), so 0 at the bottom centre, 1 at the top.
  - `arc = smoothstep(clamp(1 − |around − sweep|/0.22))`; `line = smoothstep(clamp(1 − dist/0.025))·arc·(dark ? 0.4 : 1)`.
  - `nz = simplex(p·0.5, time) + 0.5` (3D simplex, Hoskins hash33 (.1031, .11369, .13787, +19.19), kernel
    `max(0.6 − d², 0)^4`, ×31.316); glow width `mix(0.1, 0.2, nz)`; `g1 = clamp(1 − dist/(0.95·(1 − t)))`,
    `g2 = clamp(1 − dist/width)`; `glow = (g1·g2)²·(3 − 2g1)(3 − 2g2)·(dark ? 0.1 : 0.12)·arc`.
  - `alpha = mix(c0.a, c1.a, nz)·clamp(glow + line)`, faded by `1 − clamp((t − 1)/0.2)`;
    `rgb = clamp(mix(c0, c1, nz) + line)·alpha`.
- Timing (delay 0.18 at speed 1): nothing until time 0.225 s; the lit arc starts at the bottom centre, runs up both
  sides and meets at the top; faded out by time 1.725 s. Capture (mean of 6 intros, a >20-level line 1pt outside
  the bar): bottom **0.225 ± 0.007 s**, sides peak ≈ 0.30 s (+36, +20, +23), top **0.376 ± 0.007 s** (peak +61, +36,
  +42 at 0.40–0.45 s), top gone at **0.529 ± 0.006 s**. The line sits 1pt outside the bar edge, half under the bar.

**Compared with 1.49** (user-dia.mov): 1.49 showed the multi-colour pink band at speed 1.25, then a persistent
magenta area-light haze around a translucent bar (breathing, 60 s), the edge light tracing the border from below,
and the glass orb. 1.50.1 shows a single-colour band at speed 1.0, a halo that runs around the opaque bar once, the
painted mark, and a completely flat page after ≈ 3.25 s.

**Page background.** In the 1.50.1 capture the NTP page around the bar is (43, 37, 39) at the top to (46, 42, 42) at
the bottom; the 1.49 recording (different capture path) read ≈ (25, 23, 24). It is the content card over the window
tint, and it fits #121212 at **0.5** over the tint exactly (page = 0.5·tint + 9 in every channel, all samples within 1
level): the same #121212 0.5 / white 0.7 pair the binary sets next to `WindowBackgroundOverlayTintView` (`0x103b0e6f0`,
the "selected tab" override in item 6), where 1.49's card was 0.6 / 0.8. The window tint itself reads (65, 50, 53) at
the top to (73, 66, 67) at the bottom (key, plum), much lighter than 1.49's key values. The capture is opaque and the
tint is the same across the window's width, so it isn't the desktop showing through
(`WindowThemeBackgroundViewMetal` does make its CAMetalLayer non-opaque, `0x1042d73e8`).

**Bar geometry, measured.** Fitting the capture's edges through its resampling (to 0.5 pt): the bar spans x 522.5 …
1174.5 and y 375.5 … 487.5 in the 1512 × 949 window (card 190 … 1505 × 6 … 942), i.e. 652 × 112, 1 pt right of and
1 pt below `x = midX − w/2`, `top = contentH/2 − 158 + 38` for the card's content area (1315 × 895).

**Painted mark, fitted.** Fitting the orb outline (circle of diameter s minus a circle of radius s centred 1.25·s
below, smooth-subtracted with k = 0.05·s) to the capture's silhouette: s = 76.5 (≈ 76.1 after the method's bias,
checked on our own render), centre x 848.5, y 327.0 (≈ 326.9), i.e. **s = 76 = 19/21 of the 84 pt icon view** (the
shape layer's 19/21 constant) with its centre **48.6 pt above the bar top** and 1 pt right of the page centre, like
the bar. 1.49's glass orb measured 68.5 / 49.5.

**Inside the bar** (same capture, dark): magnifier centre 30.5 pt below the bar top; the chip (31 pt between its
border lines, 441.5 … 472.5) centred 30.5 pt above the bar bottom, with the mic and send button on the same line.
The magnifier sits at x ≈ 30 pt from the bar's left edge and is about 14 pt wide; the placeholder is ~5 % narrower
than ours at the same cap height.

**Grain.** With the gradient removed row by row, the 1.50.1 window has almost no grain in the capture: 0.09 levels
(sidebar) and 0.05 (page) of channel-mean noise. 1.49 captures needed a multiply grain of 0.06.

### Still unknown (needs a capture of Dia 1.50.1)
- The painted mark's exact outline and position inside the 84pt view (particle uniforms), and the `shadeLayer` path.
- The toolbar breadcrumb: the 1.50.1 window shows the host alone ("…trycloudflare.com") where 1.49.1 showed
  `host / title`; the rule (`displayPageTitleInURLBarEnabled`, `AssistantBarViewModel.State.pageTitle`) is not decoded.
- Light appearance of everything above (the user's Dia runs dark).
