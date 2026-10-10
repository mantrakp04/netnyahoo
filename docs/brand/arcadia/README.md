# Arcadia logo

Two oil-painted hills (sage `#71955A`, forest `#203F32`) under a sun (`#E6BC62`), on a parchment tile (`#F9F5E3`).
`source/` holds the three paintings, generated with Codex image generation (round 5, "hills"):
`app-icon.png` (the tile), `mark.png` (the hills alone) and `mark-small.png` (flat colours, for 16 pt).

`python3 docs/brand/arcadia/build.py` builds every size into `output/brand/arcadia/final/`. Where they go:

| Built file | Slot |
|---|---|
| `icon-1024.png` (Apple's template: 824 px body at a 100 px inset, with its shadow) | `apps/browser/macos/Arcadia-macOS/Assets.xcassets/AppIcon.appiconset/*` (each size), `apps/browser/assets/app-icon.png` |
| `plate-mark-1024.png` | `AppIconMark.imageset/mark.png`: the coloured app-icon variants (`packages/shell/ios/AppIcon.swift`) |
| `ntp-mark*.png` | `apps/browser/assets/ntp-mark*.png`: the New Tab page, hills on the bottom edge rising from behind the bar |
| `new-tab-mark*.png` | `apps/browser/assets/new-tab-mark*.png`: one colour (drawn tinted), hills split and the sun cut free |
| `icon-512.png` | `extras/raycast-arcadia/assets/icon.png` |
| `apple-touch-icon.png` | `apps/site/public/apple-touch-icon.png` |

The site's header icon, favicon and share image are cut from the same files (`apps/site`).
