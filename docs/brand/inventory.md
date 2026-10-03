# Identity inventory: what still reads as Dia

Scope: every surface that carries *identity* (logo, colour, light effects, type, sound, copy, artwork), not
layout or behaviour. Dia's UX and geometry (sidebar 190pt, card inset 7 / radius 10, bar 652×112 radius 20,
menus, shortcuts) stay and are out of scope unless they carry a mark or a colour.

Snapshot of branch `experimental/brand` at `5a905261` (0.2.7). Paths are relative to the repo root.

**Since the snapshot:** the New Tab mark and the sidebar New Tab row icon are Big Yahu (`yahu-mark/`), and
`OrbView`, `Orb`, `logoPaint` and `orbTint` are gone. The rows below still describe Dia's versions.

**Ratings**

- **Verbatim**: Dia's value, shape or string copied as is (often with "Dia" swapped for "Netnyahoo").
- **Dia-derived**: built to match Dia, but the value is measured, fitted or re-created rather than copied.
- **Generic**: stock macOS / Chromium / SF behaviour that any Mac app has.
- **Netnyahoo**: already our own identity.

**Cost**: *cheap* = edit tokens or strings in TS; *medium* = a new PNG/asset or a small native change;
*expensive* = new shader work, new artwork pipeline, or a CEF/Chromium rebuild.

Dia's reference values are in `docs/dia-spec.md` (section names quoted below). The requested Dia UI string dump
(`scratchpad/ui.txt`) did not exist when this was written; copied wording was checked against
`scratchpad/dia_main_strings.txt` (strings from the Dia 1.50.1 binary) instead.

---

## 1. App icon, logo and marks

| Surface | Where | What it is now | Rating | Rebrand change / cost |
|---|---|---|---|---|
| App icon (bundle) | `apps/browser/macos/Netnyahoo-macOS/Assets.xcassets/AppIcon.appiconset/icon_{16…512}x…_{1x,2x}.png`, source `apps/browser/assets/app-icon.png` (1254², prompt in `apps/browser/assets/app-icon-prompt.md`) | Big Yahu caricature head fused with a browser frame (traffic-light dots, URL bar across the forehead), silver hair, blue tie, glossy clay render, transparent background, no plate. Info.plist `CFBundleIconFile` is empty, the asset catalog supplies it. | Netnyahoo | Keep, or re-draw for a new mascot. It has no macOS squircle plate, so it sits unlike other Dock icons. Medium (asset only). |
| Alternate Dock icons | `packages/shell/ios/AppIcon.swift` (`AppIcons.variants`), Dock plug-in `packages/shell/docktile/DockTilePlugIn.swift`, picker in `apps/browser/src/components/settings/panes/Appearance.tsx` (~L208, "App Icon") | Default (bare art); Midnight (#333038→#121214 plate), Daylight (#FFFFFF→#E6E6E8), Plum (#D48FAD→#85476A), Ocean (#73B3ED→#295CB3), Mono, Noir (#292929→#080808, mono). Squircle 824/1024, r 0.225. | Netnyahoo (mechanism mirrors Dia's DiaDockTilePlugIn) | Plate colours are tokens; "Plum" follows Dia's pink. Cheap. |
| In-app icon uses | `components/onboarding/Intro.tsx` (96pt), `onboarding/steps.tsx`, `ntp/Postcard.tsx` (stamp, 54pt), `ntp/CheckInBanner.tsx` (37pt), `taskManager/TaskManagerWindow.tsx` | All `require("assets/app-icon.png")`. | Netnyahoo | Follows the icon. Cheap. |
| New Tab mark (painted logo above the bar) | `packages/shaders/ios/OrbView.swift` (`orbFragment` L198, `paints` L32), placed by `components/NewTabPage.tsx` (`LOGO_SIZE` 76, 48.6pt above bar, `SHOW_ORB = true`) | **Dia's logo shape**: a circle of diameter s minus a circle of radius s centred 1.25·s below, smooth-subtracted (k 0.05·s) = Dia's dome with a concave base. Filled with a procedural "painting" whose OKLab tone and style are measured from Dia 1.50's hand-painted marks (`BoostBrowser_PowerUp.bundle/{colour}{,-dark}.png`). For plum/pink: style 4 mottled canvas, dark L .505/.583/.666, a/b +.045/+.016 (a muted rose). A 1.49 "glass orb" variant (pink-white Fresnel bubble, rgb 1/.83/.93) is still in the shader. | **Verbatim** (shape) + Dia-derived (paint) | The single most Dia-identifying pixel in the app. Replace the SDF with our own mark (or drop the Orb and show a flat asset). Medium if an image, expensive if kept as a shader. |
| Sidebar New Tab row icon | `apps/browser/assets/new-tab-mark{,@2x,@3x}.png` (16/32/48 px, white), used by `NewTabIcon` in `components/primitives.tsx` L150-172 | The same Dia dome-with-concave-base silhouette, tinted white 0.28 (dark) / black 0.30 (light). | **Verbatim** | New 3-size PNG of our mark. Cheap-medium. |
| Empty-favicon tile | `components/primitives.tsx` (`Favicon`, ~L76) | Dia's rule: squircle at 28% of icon colour + site initial, or a globe. | Dia-derived | Generic enough; leave. |
| About panel | `packages/shell/ios/Menus.swift` L227 (`orderFrontStandardAboutPanel`) | Stock AppKit About: app icon, "Netnyahoo", version. No Credits.rtf, no custom art. | Generic | Optionally add Credits/tagline. Cheap. |
| Sparkle update dialog | `packages/shell/ios/Updater.swift` (`SPUStandardUpdaterController`), notes embedded by `scripts/release.sh` | Stock Sparkle window with our icon and Markdown notes. | Generic | Nothing to change. |
| DMG | `scripts/release.sh` L142-151 (`hdiutil create -volname Netnyahoo … -format ULFO`) | Plain volume, no background image, no custom volume icon, no layout. | Generic | Opportunity: branded DMG background. Medium. |
| Menu bar extra | none | No `NSStatusItem`. | n/a | n/a |
| Website favicon / touch icon / OG | `apps/site/public/favicon.png` (64²), `apple-touch-icon.png` (180²), `og.png` (1200×630: "FULL IMMUNITY." in black condensed caps on cream, full-body Big Yahu, "netnyahoo · A FREE CHROMIUM BROWSER FOR THE MAC") | Campaign-poster brand. | Netnyahoo | Keep. |

## 2. Colour tokens

### 2.1 Chrome palette: `apps/browser/src/lib/theme.ts`

`dark` L30-89, `light` L91-140. Header comment: "Chrome colors, taken from Dia's asset-catalog tokens and pixel
samples of the real app". Cross-checked with `docs/dia-spec.md` › "Color tokens (Dia asset catalogs)" and
"1.50 Sunglow › Changed in 1.50".

| Token | Dark | Light | Dia source | Rating |
|---|---|---|---|---|
| `card` (content card over tint) | rgba(18,18,18,0.5) | rgba(255,255,255,0.7) | WindowContent/BaseTint, 1.50 rebrand override (#121212 .5 / white .7) | Verbatim |
| `cardEdge` | rgba(0,0,0,.35) | rgba(0,0,0,.08) | measured | Dia-derived |
| `divider` | white .08 | black .08 | | Dia-derived |
| `textPrimary` | #FFFFFF | #000000 | TabTitleSelected | Verbatim |
| `textTab` | #FFFFFFC7 (.78) | #000000AD (.68) | TabTitleUnselected | Verbatim |
| `textSecondary` / `textTertiary` | white .50 / .35 | black .50 / .35 | | Dia-derived |
| `icon` / `iconDisabled` | #F7F5FFC6 / #F7F5FF4D | #000000C6 / #0000004D | DownloadsButton/ButtonTintColor rgba(247,245,255,.78) | Verbatim |
| `tabHover` / `tabPressed` | white .16 / .31 | white .55 / .70 | TabBackgroundHovered / Pressed | Verbatim |
| `tabSelected` | rgba(18,18,18,.5) | white .70 | TabShapeView rebrand override | Verbatim |
| `tabSelectedBorder` | white .15 / .15 | white .98 / black .06 | TabOutline + capture | Verbatim |
| `tabSelectedShadow` (+radius) | white .15 (r 15) | black .12 (r 12.5) | TabSelectedShadow | Verbatim |
| `pinnedResting` / `pinnedRestingStroke` | white .10 / .14 | black .05 / .18 | TabDockItemResting* | Verbatim |
| `pinnedSelectedFill` / `Rim` / `Outline` | white .25 / black .85 / white .20 | white .70 / black .12 / white .98 | TabBackgroundSelectedSecondary etc. | Verbatim |
| `toolbarHover` / `toolbarPressed` / `urlPill` | white .10 / .18 / .07 | black .06 / .10 / .05 | | Dia-derived |
| `panel` / `panelBorder` | #2A2A2A / white .10 | #FFFFFF / black .10 | command panel fill ≈#2A2A2A (spec › URL click) | Dia-derived |
| `rowSelected` / `rowHover` | white .22 / .07 | rgba(15,24,44,.08) / (15,24,44,.05) | CommandBar Hover/Go, Menu/ItemBackgroundHovered | Verbatim |
| `selection` | rgba(120,125,134,.7) | rgba(120,125,134,.4) | CommandBar Hover/Go dark | Verbatim |
| `placeholder` | #FFFFFF87 (.53) | #00000066 (.40) | CommandBar Input/Placeholder | Verbatim |
| `chipBorder` / `chipText` | white .15 / .60 | black .12 / .60 | | Dia-derived |
| `goButton` / `goButtonText` | **#DCCBD8** (lavender-pink) / #1A1418 | **#0F182C** (navy) / #FFFFFF | Dia's "Go ↩" pill (spec › URL click), CommandBar PrimaryText #0F182C | Verbatim |
| `ntpBar` | rgba(24,24,24,.8) | rgba(255,255,255,.85) | TransparentBackground | Verbatim |
| `ntpBarSolid` (used, since REBRAND) | #2D2D2D | #FEFFFF | AssistantPanelUIBase/Background (0.176 grey) | Verbatim |
| `ntpBarBorder` | rgba(120,125,134,.32) | black .07 | Border/None | Verbatim |
| `accent` (caret, focus) | **#4A77D4** | **#6395FC** | CommandBar Input/Cursor/Search | Verbatim |
| `grain` | 0.006 | 0.05 | fitted to 1.50.1 capture | Dia-derived |

`GLASS` (L149-199, the "Liquid Glass" sidebar style): white/black alpha pills over a cool grey glass
(≈#D2D4D8 light). Measured from an Arc-like reference, not Dia. Rating: Dia-derived (Arc). Cheap.

`layout` (L323-342): sidebar 190, header 46, pinned tiles 41 @ y54, rows 34 on a 37 pitch, card inset 7 radius 10,
toolbar 41. Layout, out of scope.

**Rebrand note:** the whole neutral chrome ramp is Dia's asset catalog. Most of it (white/black at alpha) is
indistinguishable from any dark macOS app, so it can stay. The four values that carry Dia's personality are the
**Go pill (#DCCBD8 / #0F182C)**, the **accent (#4A77D4 / #6395FC)**, the **selection grey-blue (120,125,134)** and the
**navy tint on light rows (15,24,44)**. Swapping those four is cheap and removes most of the "Dia command bar" read.

### 2.2 Profile (theme) colours: `PROFILE_COLORS`, `lib/theme.ts` L219-248

The window tint, New Tab band, painted mark and sidebar profile name all derive from the profile colour. Default
profile is **Personal / plum** (`store/profiles.ts` L27), i.e. every new install wears Dia's pink.

| Colour | Swatch | Window tint (P3 hex) | Power-up band | Other | Rating |
|---|---|---|---|---|---|
| **plum** (default) | #C07A98 | #B25B6B (fitted from inactive Dia 1.50.1) | #B5556B (measured from Dia's band) | action #DD899B, orbTint #E9A9C4 (dark) / #E59CC0 (light), edgeLight #EBB3CB80 / #D37B8B66 | Verbatim (measured) |
| blue | #4691C3 | from hue at S .36 L .527 | = swatch | | Verbatim (Dia area-light palette[0]) |
| purple | #7873AF | " | " | | Verbatim |
| pink | #D37B8B | " | " | | Verbatim |
| red | #C1575C | " | " | | Verbatim |
| orange | #D87249 | " | " | | Verbatim |
| yellow | #E3AC38 | " | " | | Verbatim |
| green | #3EB489 | " | " | | Verbatim |
| neutral | #8E8E93 | grey, alpha .12 | #808080A6 | edgeLight #FFFFFF40 / #00000026 | Verbatim (Dia neutral theme) |
| incognito | — | #3A3A3C | none | orbTint #C8C8CC | Dia-derived |

Swatches are exactly the first stop of Dia's seven area-light tables (`AreaLightView.palettes`), so the picker
(`components/onboarding/personalize.tsx` `ThemeColorPicker`, reused by NTP Personalize) offers Dia's seven hues.
Names (Plum, Blue…) are ours; the values are Dia's. Cheap to change (one table), but every downstream surface
(tint, band, mark paint, icon plate) reads from it, so it is the highest-leverage colour decision.

### 2.3 Window backdrop tint: `apps/browser/src/lib/windowTint.ts` + native `WindowBackdropView`

Model (Dia 1.50 `PlatformWindowViewController`, spec › "Window translucency"): desktop blur (material 29 dark /
`.hudWindow` light) → base tint black .4 / white .8 → profile colour gradient at alpha .36 (neutral .12) in a view at
.5 (dark) / .75 (light), bottom lightened by HSL +0.25. `tintForHue` forces every hue to Dia plum's S .36 / L .527.

Resulting opaque (inactive-window) tint, top → bottom, computed from the code:

| Colour | Dark | Light |
|---|---|---|
| plum / pink | #342123 → #3B3031 | #E7CFD3 → #F2E7E9 |
| blue | #242A30 → #343537 | #D0DDE7 → #E7EDF2 |
| purple | #262130 → #353037 | #D2CFE7 → #E8E7F2 |
| red | #342121 → #3B3030 | #E7CFD0 → #F2E7E7 |
| orange | #342520 → #3B3230 | #E7D6CF → #F2EAE6 |
| yellow | #342B20 → #3B3530 | #E7DFCF → #F2EEE6 |
| green | #24302A → #343834 | #D0E7DE → #E7F2ED |
| neutral | #1F1B1A → #231F1E | #F0F0F0 → #F6F5F5 |

Rating: **Verbatim** (the recipe and plum's numbers are reverse-engineered from Dia). This muted, warm,
profile-tinted frosted window is the second most recognisable Dia trait after the mark. Changing the constants
(alpha .36, lightness .25, S .36/L .527) is cheap; changing the look (e.g. no desktop blur, a flat paper colour) is a
native change in `WindowBackdropView.swift` L220-240 (medium).

### 2.4 Sidebar tokens: `apps/browser/src/components/sidebar/tokens.ts`

`DARK`/`LIGHT` L9-51, "from Dia's asset catalogs (BoostBrowser_TabUI, _RecentTabs, _DragDrop, _CustomIconUI,
ARCClients_BaseAssets)": group fill white .10 / black .05, count pill .15, drag silhouette #0F0F14 / #FFFFFF,
separator .15, badge white .9 with glyph #1B1618, upsell button .08. Rating: Verbatim, but neutral alphas, so low
identity. `GROUP_COLORS` L66-76 (grey #8E8E93, blue #4C8DF6, red #E5534B, yellow #E3B341, green #3FB06C, pink #DB61A2,
purple #9B6CF0, cyan #35B8C6, orange #EE8434): ours (Primer/Chrome-like). Rating: Generic. Cheap.

### 2.5 Tile themes: `apps/browser/src/lib/tileTheme.ts` + `packages/shell/ios/DockSelection.swift`

Selected pinned tile themed from its favicon or emoji: Dia 1.50.1 `TabIconTheme` rules (32px sample, colourful →
blurred icon at 22% over white 20% with a 3pt ring; one-colour → filled with that colour, white glyph). No brand
colour of its own. Rating: Dia-derived behaviour, no identity. Leave.

### 2.6 Other hard-coded colour clusters

| Cluster | Where | Values | Rating | Note |
|---|---|---|---|---|
| Onboarding palette | `components/onboarding/ui.tsx` L11-80 (`onboardingColors`, "Dia's UnboxingUI / Unboxing asset-catalog tokens") | Dark: bg #000000, card #161616, title #FEFFFF, primary pill white .85 with black text, rows white .08; light bg #FEFFFF. **`progressFill: #FDD023`** (Dia's `RebrandProgressFill`, the Sunglow yellow). | Verbatim | #FDD023 is Dia 1.50's brand yellow; swap it. Cheap. |
| Onboarding intro wash | `components/onboarding/Intro.tsx` L95, `DIA_SPECTRUM` in `packages/shaders/src/index.tsx` L5 | #0358F7 #5092C7 #E1E1FE #FFD400 #FA3D1D #FD02F5 (Dia `ProgressBarColor2–7`, "Dia's brand spectrum") | **Verbatim** | Dia's literal brand gradient behind our wordmark. Cheap (palette array). |
| Postcard paper | `components/ntp/Postcard.tsx` L21-22 | PAPER #FCFCFA, INK #1D1B1A; artwork gradient = swatch→white 45% to swatch→#10121A 50% | Dia-derived layout, our colours | Cheap. |
| Check-in banner | `components/ntp/CheckInBanner.tsx` L74-116 | white .09 / .5 fills, hairlines | Dia-derived | Cheap. |
| Settings controls | `components/settings/controls.tsx` L26-42 | accent #0A84FF / #007AFF, destructive #FF453A / #FF3B30, button #0060D0 | Generic macOS | Leave. |
| Settings window bg | `components/settings/SettingsWindow.tsx` L55 | #1E1E1E / #F2F2F2 | Generic | Leave. |
| Appearance previews | `settings/panes/Appearance.tsx` L70-87, L267-273; `onboarding/steps.tsx` L219-231, L407 | plum-tinted mock windows #2B2226 / #EDE6EA, page #1A1618; traffic lights #FF5F57 #FEBC2E #28C840 | Dia-derived (plum) | Follow new tint. Cheap. |
| Split / pane controls | `components/layout/controls.tsx` L229-261 | Go-pill hover/press #E6D8E2 #C9B8C5 (dark) / #1B2640 #26314A (light), toggle #3478F6 | Verbatim (Go pill family) | Change with `goButton`. Cheap. |
| Crash overlay bg | `components/layout/PaneOverlays.tsx` ~L77 | #1C1A1B / #F6F5F6 | Dia-derived | Cheap. |
| Live folder status | `components/live/colors.ts` | GitHub Primer (#3FB950, #F85149, #D29922, #A371F7…), pip #4C8DF6 | Generic | Leave. |
| Offline page CSS | `apps/browser/assets/offline-game/game.css` L1-60 ("Tokens mirror theme.ts") | bg #121212 / #F6F5F6, accent #4A77D4 / #6395FC, primary #DCCBD8 / #0F182C, plum #C07A98 / #B5556B | Verbatim tokens inside a Netnyahoo page | Update with theme. Cheap, but ships via Chromium resource (see §7). |

## 3. Shaders: `packages/shaders/ios`

All Metal source is embedded as Swift strings (`MetalSurface.swift` compiles at runtime; `pnpm shaders:check`
compiles offline). JS bindings in `packages/shaders/src/index.tsx`.

| View | What it draws | Used by (live?) | Colour constants | Dia-specificity | Rebrand |
|---|---|---|---|---|---|
| `MetalSurface.swift` (243 lines) | Base class: transparent MTKView, one full-screen strip, offscreen PNG snapshots, `WindowActivity` (key/active/visible, Reduce Motion) | all below | `#RRGGBB[AA]` parser only | Generic infra (key/active rules are Dia's) | Keep. |
| `WindowBackdropView.swift` (271) | With `vibrancy`: AppKit NSVisualEffectView (material 29 / `.hudWindow`) + base tint (black .4 / white .8) + profile-colour gradient layer (Dia 1.50 WindowTreatment). Without: Metal OKLab two-stop gradient + multiply film grain (Dia/Arc `gradientFragment` + `renderFragment`). | **Live**: every window backdrop (`App.tsx` L76), profile-swipe cross-fade (`layout/ProfileSwipe.tsx` L83); Metal mode on the release-notes postcard art (`ntp/Postcard.tsx` L189) | base tints above; default OKLab labA (.27,.02,0) / labB (.23,.02,0) | **Verbatim** (Dia's window treatment) | Keep the mechanism; change inputs (§2.3). Different look = medium. |
| `PowerUpView.swift` (499), incl. `HaloView` L154 | **Band** (`powerUpFragment` L447): a faint, slightly sheared wash of the palette rising from the bottom of the New Tab page past the bar, alpha ×0.1, CA gaussian blur r24, done at t 3.75 (speed 1: fades out 0.73→3.4 s). **Halo** (`haloFragment` L248): a 1pt line plus soft glow that starts at the bar's bottom centre, runs up both sides and meets at the top (0.225→0.53 s), easeOutExpo sweep, simplex-noise glow width. | **Live**: New Tab intro (single theme colour: plum #B5556B, neutral #808080A6; speed 1; halo on). Onboarding intro (DIA_SPECTRUM, speed 0.8, no halo). | 7 per-hue 5-stop tables (e.g. pink #FF6AFF #FE8097 #FF9966 #FCE0FF #FA62B1; `default` #7E1731 #334CB4 #2D81FF #2D81FF #FFF268 #F70305 #FE64CD), halo default #FF844F → #F773A5 | **Verbatim** (reconstructed from Dia's `CommandBarPowerUpView` metallib, timings fitted to 60 fps captures) | This "light wraps the bar" entrance is Dia's signature motion. Replace with our own entrance or remove. Expensive to redesign as a shader; cheap to delete (`NewTabPage.tsx` L140-148). |
| `OrbView.swift` (231) | Dia's logo SDF (see §1), filled either with the 1.49 glass-bubble shading or a procedural painting (5 styles: brush strokes, cloudy wash, impasto, matte, mottled canvas) tuned to Dia 1.50's per-colour paintings | **Live**: New Tab mark, `variant="painted"`, `paint = theme.logoPaint` | glass rgb (1,.83,.93) dark; `paints` table of OKLab tones per colour | **Verbatim** shape, Dia-derived paint | Replace. Medium (swap for an image/our SDF) to expensive (new painted look). |
| `AreaLightView.swift` (383) | 1.49 New Tab light: the bar as a rounded-rect area light floating `lift` pt above the page; analytic irradiance tinted by a noise-warped scrolling palette, breathing for 60 s at 30 fps | **Dead**: `NewTabPage.tsx` `REBRAND = true` sets `lightPalette = null` | 7 five-stop tables: blue #4691C3 #4BA5B9 #418CBE #48B6DA #55A2E4; red #C1575C…; pink #D37B8B #C387A0 #C3738C #D27DA8 #E37C94; orange #D87249…; yellow #E3AC38…; green #3EB489…; purple #7873AF… | **Verbatim** (`breathingAreaLightFragment`) | Not on screen. Its table's first stops are still the profile swatches. Delete or keep dormant. |
| `EdgeLightView.swift` (250) | 1.49 "wrap": a point light rising from 300pt below the bar to its top over 1 s, tracing the border with a 1pt hairline, ~10pt halo, rim-lighting the logo | **Dead** (`edgeLight = !REBRAND`) | colour from theme `edgeLight` (#EBB3CB80 plum dark) | **Verbatim** (`edgeLightFragment`) | Not on screen. Delete or keep. |

## 4. New Tab page

Files: `apps/browser/src/components/NewTabPage.tsx` (196 lines), `components/ntp/{index,Postcard,CheckInBanner,Personalize}.tsx`,
`components/Omnibox.tsx` (`variant="hero"`).

What a user sees today (plum, dark): the window's frosted plum tint under a #121212/50% card; centred 652×112
command bar, radius 20, opaque #2D2D2D fill, 0.5pt rgba(120,125,134,.32) border, two soft shadows (black .08 r2 y.5,
black .04 r1 y2); **Dia's dome mark painted in muted rose, 76pt, centred 48.6pt above the bar**; on open, a rose
wash (#B5556B) rises from the bottom and fades over ~3.3 s while a thin rose line runs up both sides of the bar and
meets at the top by ~0.4 s. This is Dia 1.50.1's "rebrand" New Tab, copied frame by frame (spec › "1.50 New Tab intro").

| Surface | Where | Now | Rating | Rebrand / cost |
|---|---|---|---|---|
| Intro (band + halo) | `NewTabPage.tsx` L140-148, `PowerUpView` | as above | Verbatim | Redesign or cut. Expensive / cheap. |
| Mark | `NewTabPage.tsx` L159-165, `OrbView` | Dia shape | Verbatim | Replace. Medium. |
| Bar chrome | `NewTabPage.tsx` L166-190 | #2D2D2D / #FEFFFF, radius 20, Dia shadows | Verbatim | Tokens. Cheap. |
| Hero omnibox | `Omnibox.tsx` L300-360, L418-500 | Placeholder **"Ask anything…"** (17pt), magnifier, "+ Add tabs or files" pill chip (32pt, radius 16), mic, round `arrow.up` send button / "Go ↩" pill (#DCCBD8 / #0F182C) | **Verbatim** (Dia's AI composer layout and copy, on an app with no AI) | Rewrite placeholder, drop or rename the chip; restyle Go pill. Cheap. |
| Release-notes postcard | `ntp/Postcard.tsx` | Dia's `ReleaseNotesPostcardView`: 320×200 card tilted 2°, hanging off the top-right corner, drops in on a 0.65 s spring, tooltip "Latest Release Notes"; our art: "NETNYAHOO 0.2.7" tracked caps + "What's new" italic light on a profile-colour gradient with grain, app-icon stamp, "WHAT'S NEW" postmark | Dia-derived frame, Netnyahoo content | Keep or restyle as a campaign flyer. Cheap-medium. |
| Check-in banner | `ntp/CheckInBanner.tsx`, copy in `lib/defaultBrowserCheckIn.ts` L18 | Dia's `TryForAWeekView` (top-left, ~242×69): icon + "How are you liking Netnyahoo?" / "Leave us feedback" | Verbatim (copy + layout) | Rewrite copy. Cheap. |
| Personalize button + panel | `ntp/Personalize.tsx`, copy `onboarding/personalize.tsx` L13-17 | 30pt button bottom-right; "Make it yours" / "Pick the theme color and layout that feel right for you." / "Choose how you would like to view your tabs:" | Verbatim (last two strings are Dia's) | Rewrite copy. Cheap. |

## 5. Type

| Surface | Where | Now | Rating | Note |
|---|---|---|---|---|
| App UI font | everywhere (RN default) | **System font (SF Pro)** only; no bundled fonts, no `ATSApplicationFontsPath`, no `fontFamily` except Menlo | Generic (same as Dia) | A bundled face would be the cheapest way to look unlike Dia; needs Info.plist fonts + `fontFamily` in a shared text style. Medium. |
| Monospace | `settings/panes/SyncSheets.tsx`, `Passwords.tsx`, `LiveFolders.tsx`; `packages/sync/ios/Core/RecoveryKit.swift` (Courier-Bold) | Menlo | Generic | |
| Size scale | grep across `components/` | 12 (107 uses), 13 (93), 11 / 11.5 (59), 15 (20), 12.5 (18), 14, 17 (hero input, onboarding tagline), 20, 22, 26, 64 (intro wordmark) | Dia-derived (tab rows 13, pinned/top-tab 12, bar 17/15/14) | Layout-bound; keep. |
| Weights | | 600 (75), 500 (34), 700, 300 (italic light for "What's new", "Hello!"), 200 (intro wordmark 64pt, tracking −1.5) | Mixed | The thin 64pt wordmark and italic-light display lines echo Dia's onboarding. Cheap to restyle. |
| Site type | `apps/site/src/styles/global.css` L23-25 | Archivo Variable (poster), Newsreader Variable (serif), Martian Mono Variable | Netnyahoo | Candidate source for an in-app display face. |

## 6. Onboarding, About, Settings, release notes

| Surface | Where | Now | Rating | Rebrand / cost |
|---|---|---|---|---|
| Intro title sequence | `components/onboarding/Intro.tsx` | Dia's `OnboardingIntro2` structure: icon springs in, wordmark "Netnyahoo" writes letter by letter (64pt weight 200), tagline **"Your new home on the internet"** (17pt light), stage zooms 1.08 and fades; over a **Dia brand-spectrum** power-up wash; mute (bottom-left) + Skip (bottom-right) | Dia-derived sequence, **Verbatim** palette and tagline idea (Dia: "Welcome to your new / home on the internet") | New tagline + palette. Cheap. Redo the choreography: medium. |
| Intro music | `packages/shell/ios/IntroMusic.swift` | Original synthesized piece (open fifths, bell on icon, pentatonic sparkle per letter, Gmaj7 → Dmaj9), cued to the animation | Netnyahoo (Dia plays a recording) | Keep / re-score. |
| Step cards | `onboarding/steps.tsx`, `ui.tsx`, `OnboardingOverlay.tsx` | Dia Unboxing layout (card over dimmed window, content left, illustration right, "Step n of 4" + segmented progress in **#FDD023**), pill buttons (white .85 / black text) | Verbatim tokens, Dia-derived layout | Recolour, rewrite copy (§8). Cheap. |
| Outro postcard | `onboarding/steps.tsx` L481+ | "Hello!" italic light, "Glad you're here. Make yourself at home…", stamp + postmark | Netnyahoo content in Dia postcard idiom | Cheap. |
| Tool tour | `onboarding/tour/ToolTour.tsx`, `tour/state.ts` L30-67 | Our copy ("Search or go anywhere", "Your tabs live in the sidebar", "Room to focus", "Two pages, side by side", "You're all set"); "Watch Video Tour" hidden (no `NNVideoTourURL`) | Netnyahoo (Dia-like format) | Voice pass. Cheap. |
| About | stock panel | §1 | Generic | |
| Settings window | `components/settings/SettingsWindow.tsx`, `panes/*` | Dia's sidebar-navigated window, SF Symbol pane icons, no artwork. Appearance pane offers **Sidebar Style "Dia"** vs "Liquid Glass" and says "the window keeps Dia's look" (`Appearance.tsx` L50-57); setting value `sidebarStyle: "dia"` (`store/settings.ts` L87, L131) | Verbatim (name) | Rename the option (label cheap; stored value needs a migration or keep the key). |
| Release notes (in app) | `lib/releaseNotesPage.ts` | Opens `https://netnyahoo.com/release-notes#<version>` in a tab after an update (Dia's behaviour) | Dia-derived behaviour | none |
| Release notes (site) | `apps/site/src/pages/release-notes.astro`, `docs/release-notes/*.md` | "Official gazette" styling on the campaign-poster system (paper #F1ECE2, ink #16130F, tie blue #2150D9, stamp red #C3371F) | Netnyahoo | Keep. The skill still calls them "Dia-style release notes" (process, not UI). |

## 7. Internal, error, loading and empty pages

| Surface | Where | Now | Rating | Rebrand / cost |
|---|---|---|---|---|
| Offline page | `apps/browser/assets/offline-game/` (index.html, game.css, game.js, webp sprites), packed by `engine/patches/build/yahu-resource.sh` into `IDR_NETNYAHOO_YAHU_HTML` via `engine/patches/chromium-neterror-yahu.patch` | "No internet" header + **"Where's Big Yahu?"** hidden-object game (crowd of donors and lobbyists, 60 s timer, hints), "Rounding up donors…" | Netnyahoo (tokens Dia's, §2.6) | Content is ours. Any change **needs a Chromium resource rebuild** (incremental, but a CEF build). Expensive-ish. |
| Other net errors (DNS, TLS, 404 from server, etc.) | Chromium stock `neterror` page | Chrome's grey page and copy | Generic (Chromium) | Theming them is a Chromium patch. Expensive. |
| `chrome://` pages (extensions, settings sub-pages, devtools) | CEF / `packages/cef/ios/NNChromePages.mm` | Stock Chromium WebUI | Generic | Leave. |
| Internal pages | `components/pages/{History,Bookmarks,Downloads}Page.tsx`, scheme `netnyahoo://` (`pages/urls.ts`) | React pages on theme tokens; empty states: SF Symbol (clock, 30pt) + "Your browsing history appears here" / "Files you download appear here" / "No search results found" | Dia-derived (Dia's `dia://history` etc.), copy generic | Voice pass possible. Cheap. |
| Crashed tab | `components/layout/PaneOverlays.tsx` L68-95 | Dia's native error view: triangle symbol, **"This tab needs to reload"** (Dia string), Reload | Verbatim | Rewrite. Cheap. |
| Unresponsive page | same file | "Page Unresponsive" / "You can wait…" | Generic (Chrome) | |
| Split empty state | `components/layout/SplitEmptyState.tsx` | Dia's "Add a tab to this Split View" + search field **"Search or Ask a Question"** (Dia string, AI wording) | Verbatim | Rewrite. Cheap. |
| Sidebar tab clean-up upsell | `components/Sidebar.tsx` L450-505 | wand symbol, "{n} tabs haven't been touched in a while", "Netnyahoo can tidy up for you. …" (Dia: "Dia can tidy up for you."), "Clean Up Once" / "Clean Up Daily" | Verbatim (name swapped) | Rewrite. Cheap. |
| Other empty states | `components/Downloads.tsx` L189 ("No downloads yet"), `sidebar/SearchTabs.tsx` L152, `sidebar/LiveFolderBlock.tsx` L133, `settings/panes/*` ("No saved passwords", "No extensions yet"…), `bookmarks/BookmarksBar.tsx` L299 (Dia's "Import bookmarks" empty-bar button) | Plain one-liners | Generic | Voice pass optional. |
| Tab loading spinner | `packages/shell` `ActivitySpinner`, used in `sidebar/TabRow.tsx` L112 | Dia 1.50's `ActivitySpinnerView`: 12pt ring, 1.5 line, strokeEnd .72, clockwise 1.88 s | Dia-derived | Low identity. Leave. |

## 8. Strings: brand voice and copied Dia wording

App name strings are clean: `CFBundleDisplayName`/`PRODUCT_NAME` Netnyahoo, bundle id `com.netnyahoo.browser`,
`app.json` displayName Netnyahoo, menus use `appName`. Info.plist usage strings are our own wording
(`NSAppleEventsUsageDescription` mentions Dia only because it imports from Dia). `Netnyahoo.sdef` keeps Dia's
AppleScript four-char codes (`DiaT`, `DiaP`, `DiaTabFc`) on purpose for script compatibility: invisible, keep.

Dia's wording (binary strings) found verbatim in our UI, excluding generic browser/menu vocabulary (Close Other Tabs,
Clear Browsing Data, etc.; ~200 of those match Dia and Chrome alike):

| Our string | Where | Dia's original | Note |
|---|---|---|---|
| "Ask anything…" | `components/Omnibox.tsx` L308 | "Ask anything" | AI prompt on an AI-free app. Highest-visibility string. |
| "Search or Ask a Question" | `layout/SplitEmptyState.tsx` L59, L75 | same | AI wording. |
| "Search or enter address" | `Omnibox.tsx` L308, `sidebar/AddressBar.tsx` | (Arc/Chrome-style) | Generic. |
| "Fast, secure, and packed with all your browser essentials" | `onboarding/steps.tsx` L106 | same | Verbatim. |
| "Netnyahoo works best as your default browser." | steps.tsx L106 | "Dia works best as your default browser" | Name swap. |
| "Set Netnyahoo as default browser" / "Open links and web pages in Netnyahoo by default" | steps.tsx L111-112 | "Set Dia as default browser" / "…in Dia by default" | Name swap. |
| "Try Netnyahoo as your default for seven days" / "We'll check in to make sure you love it." | steps.tsx L120-121 | "Try Dia as your default for seven days" / "…ll check in to make sure you love it." | Name swap. |
| "Add Netnyahoo to Dock" / "Quick access to Netnyahoo whenever you need it" / "Open Netnyahoo at login" | steps.tsx L127-129 | Dia equivalents | Name swap. |
| "Keep your favorite apps handy" / "Pin important apps so they're always available when you open Netnyahoo." | steps.tsx L351 | same / "Pin important apps so they…" | Verbatim / swap. |
| "Welcome to your new\nhome on the internet" | steps.tsx L460 | "Welcome to your new" + "home on the internet" | Verbatim, and the intro tagline "Your new home on the internet" riffs on it. |
| "Pick the theme color and layout that feel right for you." / "Choose how you would like to view your tabs:" | `onboarding/personalize.tsx` L15-16 | same | Verbatim. |
| "How are you liking Netnyahoo?" / "Leave us feedback" | `lib/defaultBrowserCheckIn.ts` L18 | "How are you liking Dia?" / same | Swap / verbatim. |
| "Latest Release Notes" | `ntp/Postcard.tsx` L133 | same | Verbatim. |
| "{n} tabs haven't been touched in a while" / "Netnyahoo can tidy up for you." | `Sidebar.tsx` ~L489-491 | "…t been touched in a while" / "Dia can tidy up for you." | Swap. |
| "This tab needs to reload" / "Web content has been discarded" | `layout/PaneOverlays.tsx`, `sidebar/HoverCard.tsx` L88-90 | same | Verbatim. |
| "Add tabs or files" | `Omnibox.tsx` L458 | same | Verbatim (AI context chip). |
| "Mute intro music" / "Unmute intro music" / "Button that skips the onboarding intro animation" | `onboarding/Intro.tsx` L135-146 | same | Verbatim (accessibility). |
| "Copied a clean link without trackers", "Share a link directly to this text instead?", "Click the lock to change this any time", "The built-in ad blocker is …" | `components/site/*` | same | Verbatim, low visibility. |
| "Your Recovery Kit contains all you need to recover your data…", "Save Your Recovery Kit" | `settings/panes/SyncSheets.tsx` | same (Arc/Dia sync) | Verbatim, low visibility. |
| "Hold on while we fetch your data...", "Only some of your data imported. Please try again!", "Preparing your profile" | `import/ImportWindow.tsx` | same | Verbatim (Dia's importer). |
| "Open Command Bar" (menu) | `packages/shell/ios/Menus.swift` L250 | same | Dia's product noun "command bar"; also in tour copy. |
| Sidebar Style "Dia", "the window keeps Dia's look" | `settings/panes/Appearance.tsx` L50-57 | — | Names the competitor in our UI. |

Strings that are already ours and carry the satire voice: offline game copy ("somebody slipped into the crowd",
"He's hiding in a crowd of donors, lobbyists and very generous friends"), the site and OG ("Full immunity."), release
notes headlines, the outro postcard, tour copy. In-app chrome copy outside those is neutral or Dia's.

## 9. Other identity-ish surfaces

| Surface | Where | Now | Rating | Rebrand / cost |
|---|---|---|---|---|
| Command panel (⌘L / URL click) | `components/CommandPanel.tsx` | Dia's in-place expansion over the toolbar, 888pt, `panel` #2A2A2A / #FFFFFF, popover radius 12, selected row white .22 / navy .08 | Dia-derived | Colour via tokens (cheap). |
| Profile colours / icons | `lib/theme.ts` `PROFILE_COLORS`; `components/profiles/icons.tsx` (20 SF Symbols, 20 emoji); default profile "Personal"/plum | Dia's hues; icons are ours (Dia has no profile artwork) | Verbatim hues / Netnyahoo icons | §2.2. |
| Sidebar profile name colour | `lib/theme.ts` `profileNameColor` | action colour 60% to white (dark) / 40% to black (light); plum → Dia's measured (236,209,215) | Verbatim | Follows palette. |
| Window tint picker | NTP Personalize + onboarding `ThemeColorPicker` | the 9 `PROFILE_COLORS`; no free-form picker, no presets beyond those | Verbatim values | §2.2. |
| Tab tile themes | §2.5 | | Dia-derived | Leave. |
| Liquid Glass sidebar | `components/sidebar/Glass.tsx`, `GLASS` tokens | Arc-style neutral grey glass | Arc-derived | Could become the default "non-Dia" look. |
| Task manager | `taskManager/TaskManagerWindow.tsx` | Chrome/Dia-style table, app icon for the browser row | Generic | Leave. |
| Website | `apps/site` | Campaign poster system (§1, §6) | Netnyahoo | Source of truth for a new in-app identity. |

## 10. Biggest-ticket items

The surfaces that most make Netnyahoo read as Dia, in order:

1. **Dia's logo on the New Tab page**: `OrbView` SDF (dome with concave base), painted in the profile colour,
   76pt above the bar. Medium to expensive.
2. **The New Tab intro motion**: `PowerUpView` band + halo tracing the bar in the theme colour. Cutting it is cheap;
   replacing it is expensive.
3. **The plum default and Dia's seven profile hues** (`PROFILE_COLORS`, default profile plum): they drive the window
   tint, band, mark paint and profile name. Cheap to change, high leverage.
4. **The frosted, profile-tinted window** (`windowTint.ts` + `WindowBackdropView` vibrancy recipe: black .4 base,
   tint .36 at .5, +0.25 lightness). Constants cheap; a different material is medium.
5. **The AI-composer New Tab bar**: "Ask anything…", "+ Add tabs or files" chip, mic, send / lavender "Go ↩" pill
   (#DCCBD8 / #0F182C) on the opaque #2D2D2D bar. Cheap (strings and tokens).
6. **Sidebar New Tab row mark** (`assets/new-tab-mark*.png`): Dia's logo at 16pt in every window. Cheap-medium.
7. **Onboarding**: the Dia brand spectrum (`DIA_SPECTRUM`) behind the intro, Sunglow yellow (#FDD023) progress,
   Dia's unboxing layout and near-verbatim copy with "Dia" swapped out. Cheap for colours and copy.
8. **Dia accent and command-bar tints**: caret/focus #4A77D4 / #6395FC, selection rgba(120,125,134), navy row tint
   rgba(15,24,44). Cheap.
9. **Copied microcopy**: check-in banner, Personalize, "Latest Release Notes", "This tab needs to reload",
   "Search or Ask a Question", tidy-up upsell. Cheap.
10. **Type**: the app uses only SF, exactly like Dia; the site already has Archivo / Newsreader / Martian Mono.
    Bundling one display face for the wordmark, NTP and onboarding is the cheapest large visual difference. Medium.

Already ours and fine to keep: the Big Yahu app icon and its Dock variants, the offline "Where's Big Yahu?" page,
the site, release-notes gazette, OG image, intro music. Dead Dia code that could be deleted with no visual change:
`AreaLightView`, `EdgeLightView`, and the `REBRAND = false` paths in `NewTabPage.tsx` (`OrbView` is deleted).
