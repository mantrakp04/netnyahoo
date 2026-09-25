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
  - Selected: `TabBackgroundSelectedSecondary` (white 25%) fill, black rim (`SelectedPrimary`),
    `TabOutline` (white 20%) top bevel, shadow `TabSelectedShadow`.
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
  bounce 0.3). The edge light layer scales with it.
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
   uses +2 = 22, as before).
5. **Entrance elevation** 10mm → **5mm** (8 sites, e.g. `0x104e3e784`); the scale is now `0.99 + 0.01·mm/5`, so the
   scale curve (0.99 → 1, response 0.7, damping 1.0) looks the same. Only the daylight shadow depth would differ.
6. **Selected tab tint** (`TabShapeView`, rebrand override `0x103b0e6f0`): dark `#121212` at 0.5, light white at 0.7
   (1.49: black ≈ 0.36–0.4 / opaque white). Capture check: fill (42, 35, 37) over sidebar (66, 52, 54) =
   #121212 at 0.50 exactly. `gradientLightnessDelta` 0.25 with the rebrand (0.4 without); its use is not decoded.
7. **Profile (space) swipe settling**: `sidebar-space-swipe-animations` (default **on**) settles the sidebar pages
   with a `CAKeyframeAnimation` on `sublayerTransform.translation.x` (key `space_swipe_settling`, linear, sampled
   every 1/240 s from the spring) and a **0.25 s** critically damped spring (0.4 s without). Rubber band unchanged:
   `255·(1 − 1/(0.15·x/255 + 1))`; no keyframes when the overshoot reaches 255pt.
8. **Tab loading spinner** turns the other way: `transform.rotation.z` 0 → −2π (was +2π), 1.88 s, linear, repeating.
9. Tab row background change fades 0.3 s easeOut (new, `0x103dbce4c`); an 82pt width gate and a 17.5pt bottom inset
   belong to the Tasks sidebar style (`TabGroupSidebarStyle.tasks`, AI, off by default).
10. Settings: the Appearance pane (`better-days-appearance-settings-enabled`: Light/Dark/Automatic, app icon options)
    was deleted; "Double-click empty sidebar space for a new tab" and "Paste and Go" lost their flags (always on).
11. NTP postcards hide when a (48, 40, 320, 200) rect meets the command bar (new flag
    `new-tab-page-postcards-hide-on-command-bar-intersection-enabled`). The NTP and Personalization "Pro Badge"
    images and the Dia Pro background button are gone.
12. Not in the binary, despite the release-notes mock-up: the placeholder "Search or ask a question" and a "…" button
    in the bar. 1.50.1 still says "Ask anything…".

### Still unknown (needs a capture of Dia 1.50.1)
- The painted mark's exact outline and position inside the 84pt view (particle uniforms), and the `shadeLayer` path.
- The toolbar breadcrumb: the 1.50.1 window shows the host alone ("…trycloudflare.com") where 1.49.1 showed
  `host / title`; the rule (`displayPageTitleInURLBarEnabled`, `AssistantBarViewModel.State.pageTitle`) is not decoded.
- Light appearance of everything above (the user's Dia runs dark).
