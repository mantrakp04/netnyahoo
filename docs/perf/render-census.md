# Render census

What each journey interaction costs React and the store, per action, on 0.2.27's Release app with a bundle of the
current tree. The idea is the claude.ai team's "React hook census" (6,900 hooks and 900 store subscriptions
re-rendering on every keystroke): count what runs, find what didn't have to, fix it, count again.

Tool: `apps/browser/scripts/perf/census.mjs` (scenarios `cen*` in `bench-app.js`, counters in `src/lib/perfProbe.ts`).

```sh
node apps/browser/scripts/perf/js-bench.mjs bundle <dir> --profiling 1      # React's profiling renderer
node apps/browser/scripts/perf/census.mjs run --app dist/0.2.27/export/Netnyahoo.app --bundle <dir>/main.jsbundle \
  --label <name> --runs 3 --tabs 20 --out <dir>                              # cheap pass (renders, hooks, ms)
  ... --probe renders,selectors,listeners                                    # + selector call sites, subscriptions
  ... --tabs 100 | --address-bar sidebar | --trace 12                        # scale, the other layout, timer call sites
node apps/browser/scripts/perf/census.mjs report <out>/<label>.json          # these tables
node apps/browser/scripts/perf/census.mjs compare <before.json> <after.json> # before/after medians
```

Setup: a 20-tab session (3 pinned, a group of 4), the 5000-entry history and 1000 bookmarks of `seed.mjs`, a local test
server, a hidden instance per run (3 runs, 2 for the selector pass). Every action is measured alone: probe reset, the
action, a settle, read; the tables are medians over the actions of all runs.

| Counted | How |
|---|---|
| components rendered | function components React re-rendered in the commit (host wrappers such as `View` and `Pressable` included in the totals, left out of the offender lists) |
| wasted renders | same props, state and context as last time (React's profiler classifies it in `perfProbe.ts`) |
| hooks run | the length of each rendered component's hook list |
| subscriptions notified, selectors evaluated | `selectors` probe: store notifications that reached a component's subscription, and every evaluation of a selector (renders included), by call site |
| native view updates | host components React updated (each is a native prop diff) |
| timers scheduled | `setTimeout`, `setInterval`, `requestAnimationFrame`, `setImmediate` calls. The harness adds about one timer and two `setImmediate` per action (its settle sleep and its promise). |
| render ms (profiler) | the sum of each re-rendered component's self time. Not run under the `perflab` lock: the machine was at load average 500-900 for most of this work (other agents' builds), so read every ms as a ratio between two runs, not as a number to quote. Counts don't depend on load. |

Not covered: the launch journey's fixes (the `firstrender` agent has them; its numbers here are start to the harness
answering, including the restored tab's load), a window with a split, and a profile swipe.

## Totals per action, before → after the fixes below

"Before" is the tree at the start of this work (0.2.27 plus others' commits, with the census probe), "after" is
`861b3b73`. Other agents landed sidebar and launch commits in between, so rows my fixes don't touch can move
(the launch row, Cmd-T's 55 → 68 timers and 3 → 4 commits, tab switch's 72.5 → 93 renders between the first and the
second baseline run). The per-fix numbers in each commit message come from before and after bundles built minutes apart
from the same tree, and are the ones to trust.

| interaction | journey | components rendered | wasted | hooks run | native view updates | timers scheduled | commits | store updates |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| launch: first window | J1 | 460 → 414 | 45.0 → 36.0 | 2710 → 2443 | 240 → 213 | 233 → 266 | 24.0 | 16.0 → 18.0 |
| Cmd-T (new tab) | J2 | 50.0 → 52.0 | 0 | 387 → 393 | 26.0 → 27.0 | 55.0 → 68.5 | 3 → 4 | 2 |
| keystroke, new tab page field | J2 | 43.0 → 25.0 | 0 | 203 → 170 | 29.0 → 17.0 | 3 | 4 | 0 |
| Cmd-L (open command bar) | J2 | 35.0 → 15.0 | 0 | 214 → 179 | 24.0 → 10.0 | 6 | 4 | 1 |
| keystroke, command bar | J2 | 45.0 → 25.0 | 0 | 205 → 170 | 31.0 → 17.0 | 3 | 4 | 0 |
| Esc (close command bar) | J2 | 2 | 0 | 35.0 | 0 | 3 | 1 | 1 |
| tab switch, click | J3 | 93.0 → 89.0 | 3 → 1 | 670 | 49.0 | 51.0 | 2 | 2 |
| tab switch, shortcut | J3 | 93.0 → 89.0 | 5 → 1 | 670 | 49.0 | 53.0 | 2 | 1 |
| Enter (navigate) | J4 | 335 → 255 | 21.0 → 15.0 | 1343 → 1107 | 176 → 132 | 68.0 → 58.0 | 7 → 6 | 15.0 |
| page load (active tab), after Enter | J4 | 414 → 134 | 15.0 → 0 | 1297 → 342 | 239 → 79.0 | 128 → 109 | 9 | 13.0 |
| page load (background tab) | J4 | 140 → 146 | 0 | 406 → 418 | 84.0 → 87.0 | 39.0 → 44.5 | 6.5 → 7 | 19.5 → 20.0 |
| sidebar hover (enter and leave a row) | – | 28.0 | 0 | 50.0 | 16.0 | 4 | 1 | 0 |

Cmd-T is bimodal: 50 renders when the new tab page's layout events land inside the settle, 90-130 when more of them do
(the same in the before and after runs).

## Store fan-out: subscriptions notified and selectors evaluated

Every `useBrowser(selector)` in the app is a subscription (`useSyncExternalStore`): each store update notifies all of
them and runs each one's selector, whatever changed. Live subscriptions at the end of a session: **857 at 20 tabs, 3,337
at 100 tabs**. The biggest groups at 20 tabs: `useToolbarMode` in `TabPane` 120 (6 per tab, 4 of them on other stores),
`TabPane` itself 76, `TabWebView` 60, `Favicon` 42+21+21, `TabRow` 34+34, `PipBadge` and `CaptureBadge` 20 each.

| interaction | store updates | subscriptions notified | selectors evaluated | per store update (notified) |
|---|---:|---:|---:|---:|
| launch: first window | 16.5 | 2088 | 3770 | 127 |
| Cmd-T (new tab) | 2 | 553 | 851 | 276 |
| keystroke, new tab page field | 0 | 0 | 30 | 0 |
| Cmd-L (open command bar) | 1 | 435 | 511 | 435 |
| keystroke, command bar | 0 | 0 | 30 | 0 |
| Esc (close command bar) | 1 | 450 | 466 | 450 |
| tab switch, click | 2 | 870 | 1144 | 435 |
| tab switch, shortcut | 1 | 435 | 719 | 435 |
| Enter (navigate) | 15 | 4980 | 5321 | 332 |
| page load (active tab), after Enter | 13.5 | 5522 | 5813 | 409 |
| page load (background tab) | 21 | 7550 | 7675 | 360 |
| sidebar hover (enter and leave a row) | 0 | 0 | 12 | 0 |

Per store update about 435 subscriptions are notified at 20 tabs (about 2,700 at 100). A page load makes 13 to 21
store updates (a `tabs` write per page report, `live` for loading and progress, five `history` events, `pages`), so
**one page load runs 5,500 to 7,500 selectors**. Each is cheap (a property read), the total is not: the selector probe
puts the 20-tab tab switch at 3.5 ms of selectors (probe included) and the 100-tab one at about 20 ms.

Scale (not run under the perflab lock; the ratio is what to read): the render counts don't change from 20 to 100 tabs,
the JS time of the act does.

| act (ms, store update to commit) | 20 tabs | 100 tabs |
|---|---:|---:|
| tab switch, click | 11.5 | 22.6 |
| tab switch, shortcut | 10.5 | 21.8 |
| Cmd-T | 13.8 | 30.0 |
| Enter | 4.6 | 10.1 |
| keystroke, command bar | 6.5 | 5.5 |
| hover | 2.7 | 3.1 |

Typing and hover don't grow with the tab count; the store-driven interactions do, almost entirely through the per-tab
subscriptions.

## Per interaction: the top 10 components and what they render for

Before the fixes, 20 tabs, per action. `why`: `props:x` a prop changed, `fn:x` a new function with the same behaviour,
`obj:x` a new but shallow-equal object, `state`/`state~` own state (changed / new but equal), `wasted` nothing changed.

### launch: first window

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| ToolbarButton | 14.0 | 0 | 28.0 | 0.24 | fn:onPress 14.0, fn:onLongPress 5.33, fn:onContextMenu 5.33 |
| Toolbar | 5.33 | 0 | 347 | 1.36 | state 3.33, state~ 2 |
| HistoryButton | 5.33 | 0 | 0 | 0.09 | props:tab 4, props:palette 2 |
| TranslateButton | 4.67 | 2.67 | 18.7 | 0.12 | wasted 2.67, props:palette 1, state~ 1 |
| ToolbarExtensions | 4 | 0 | 104 | 0.47 | state~ 2, state 1, props:palette 1 |
| SidebarPage | 4 | 0 | 96.0 | 0.46 | fn:onListHeight 4, fn:onScrollView 4, fn:onScrollY 4 |
| PageContent | 4 | 0 | 0 | 0.31 | fn:children 4 |
| Dot | 4 | 4 | 24.0 | 0.17 | wasted 4 |
| AnimatedScrollViewWithOrWithoutInvertedRefreshControl | 4 | 0 | 0 | 0.16 | obj:style 4, obj:contentContainerStyle 4, props:children 4 |
| ThemeScope | 4 | 0 | 16.0 | 0.08 | props:children 4 |

Store keys changed per action: browser.live 6, browser.bookmarks 5, browser.tabs 3.33, browser.bookmarksReady 3, browser.history 2.33, browser.historyReady 2.33.  
Timers scheduled per action: setImmediate:anonymous 179, requestAnimationFrame:bound onUpdate 48.0, setTimeout:anonymous 15.7, setInterval:anonymous 7, setTimeout:flush 6.67, requestAnimationFrame:anonymous 4.67.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabRow < renderWithHooks | 235 | 153 | 0.46 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 233 | 189 | 0.24 |
| useStore < useBoundStore < useTab < TabRow | 194 | 153 | 0.25 |
| useStore < useBoundStore < useFaviconTheme < Favicon | 151 | 63.0 | 0.17 |
| useStore < useBoundStore < ContentCard < renderWithHooks | 135 | 63.0 | 0.66 |
| useStore < useBoundStore < usePage < CaptureBadge | 100 | 60.0 | 0.15 |

### Cmd-T (new tab)

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| ContentCard | 1 | 0 | 78.0 | 1.14 | state 1 |
| SwipeOverlay | 1 | 0 | 25.0 | 0.28 | state 1 |
| SidebarPage | 1 | 0 | 24.0 | 0.15 | state 1 |
| TabPane | 1 | 0 | 62.0 | 0.14 | props:rect 1, props:focused 1, props:geometry 1 |
| TabRow | 1 | 0 | 15.0 | 0.13 | state 1 |
| WebView | 1 | 0 | 2 | 0.09 | props:visible 1, fn:onReady 1, fn:onNavigationChange 1 |
| TabWebView | 1 | 0 | 33.0 | 0.07 | props:visible 1 |
| DropTargets | 1 | 0 | 38.0 | 0.07 | props:panes 1 |
| PageContent | 1 | 0 | 0 | 0.06 | fn:children 1 |
| SwipeArea | 1 | 0 | 2 | 0.03 | fn:onSwipe 1, fn:onLayout 1 |

Store keys changed per action: browser.live 2.5, browser.windows 1, browser.tabs 1, pages.pages 1, lifecycle.discarded 0.5.  
Timers scheduled per action: setImmediate:anonymous 25.2, requestAnimationFrame:bound onUpdate 21.4, setTimeout:anonymous 6.58, setTimeout:step 5.67, setTimeout:syncMenu 1.08, setTimeout:save 1.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 96.0 | 80.0 | 0.15 |
| useStore < useBoundStore < useToolbarMode < TabPane | 84.0 | 60.0 | 0.09 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 66.0 | 60.0 | 0.08 |
| useStore < useBoundStore < TabRow < renderWithHooks | 25.0 | 17.0 | 0.06 |
| useStore < useBoundStore < ContentCard < renderWithHooks | 25.0 | 7 | 0.34 |
| useStore < useBoundStore < usePopover < TabPane | 25.0 | 21.0 | 0.02 |

### keystroke, new tab page field

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| SuggestionIcon | 3.31 | 0.04 | 0 | 0.03 | props:suggestion 2.35, obj:suggestion 0.92, wasted 0.04 |
| SuggestionRow | 2.31 | 0 | 4.61 | 0.08 | props:suggestion 2.23, props:trailing 0.12, obj:suggestion 0.08 |
| Favicon | 1.39 | 0 | 26.3 | 0.11 | props:url 1.39 |
| FaviconFallback | 1.39 | 0 | 0 | 0.02 | props:url 1.39 |
| IconButton | 1.08 | 0 | 2.16 | 0.02 | fn:onPress 1.08 |
| Omnibox | 1.04 | 0.04 | 105 | 2.42 | state 1, wasted 0.04 |
| AddChip | 1.04 | 0 | 2.08 | 0.03 | fn:onGo 1.04 |
| SendButton | 1.04 | 0 | 0 | 0.01 | fn:onPress 1.04, props:active 0.04 |
| SuggestionList | 1 | 0 | 0 | 0.02 | props:items 1, props:trailing 0.12, props:selectedIndex 0.04 |
| AskButton | 0.08 | 0 | 0.24 | 0 | fn:onPress 0.08 |

Store keys changed per action: favicons.profiles 0.56.  
Timers scheduled per action: setImmediate:anonymous 4.55, setTimeout:anonymous 1, setTimeout:lookUp 0.28.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < useFaviconTheme < Favicon | 40.6 | 33.6 | 0.04 |
| useStore < useBoundStore < useFavicon < Favicon | 20.3 | 16.8 | 0.21 |
| useStore < useBoundStore < useSuggestions < Omnibox | 16.6 | 0 | 0.03 |
| useStore < useBoundStore < useDropdownStart < Omnibox | 8.32 | 0 | 0.01 |
| useStore < useBoundStore < Omnibox < renderWithHooks | 4.16 | 0 | 0.05 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 3.48 | 0 | 0.01 |

After the command-bar fix (cbfeb1a) the buttons are gone from this list: 25 renders, 170 hooks.

### Cmd-L (open command bar)

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| Omnibox | 1 | 0 | 101 | 0.19 | state 1 |
| CommandPanel | 1 | 0 | 12.0 | 0.1 | state 1 |
| DownloadsPopover | 1 | 0 | 23.0 | 0.09 | state 1 |
| AddChip | 1 | 0 | 2 | 0.03 | fn:onGo 1 |
| GoButton | 1 | 0 | 2 | 0.02 | fn:onPress 1 |
| IconButton | 1 | 0 | 2 | 0.02 | fn:onPress 1 |

Store keys changed per action: browser.windowUi 1.  
Timers scheduled per action: setImmediate:anonymous 2.89, setTimeout:syncMenu 1, setTimeout:step 1, setTimeout:anonymous 1.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 80.0 | 80.0 | 0.1 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 60.0 | 60.0 | 0.07 |
| useStore < useBoundStore < useToolbarMode < TabPane | 40.0 | 40.0 | 0.04 |
| useStore < useBoundStore < useSuggestions < Omnibox | 32.0 | 0 | 0.17 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 21.0 | 21.0 | 0.02 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 20.0 | 20.0 | 0.02 |

After cbfeb1a: 15 renders.

### keystroke, command bar

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| SuggestionIcon | 3.27 | 0 | 0 | 0.03 | props:suggestion 2.35, obj:suggestion 0.92 |
| SuggestionRow | 2.31 | 0 | 4.61 | 0.1 | props:suggestion 2.23, props:trailing 0.12, obj:suggestion 0.08 |
| Favicon | 1.39 | 0 | 26.3 | 0.13 | props:url 1.39 |
| FaviconFallback | 1.39 | 0 | 0 | 0.02 | props:url 1.39 |
| IconButton | 1.04 | 0 | 2.08 | 0.02 | fn:onPress 1.04 |
| Omnibox | 1 | 0 | 101 | 2.63 | state 1 |
| AddChip | 1 | 0 | 2 | 0.03 | fn:onGo 1 |
| GoButton | 1 | 0 | 2 | 0.02 | fn:onPress 1 |
| SuggestionList | 1 | 0 | 0 | 0.02 | props:items 1, props:trailing 0.12, props:selectedIndex 0.04 |
timers scheduled/action: setImmediate:anonymous 2.15, setTimeout:anonymous 1

Timers scheduled per action: setImmediate:anonymous 2.15, setTimeout:anonymous 1.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 48.0 | 48.0 | 0.06 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 36.0 | 36.0 | 0.04 |
| useStore < useBoundStore < useToolbarMode < TabPane | 24.0 | 24.0 | 0.02 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 20.9 | 17.4 | 0.02 |
| useStore < useBoundStore < useSuggestions < Omnibox | 20.8 | 4.8 | 0.04 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 12.0 | 12.0 | 0.01 |

After cbfeb1a: 25 renders, 170 hooks, 17 native view updates; AddChip, GoButton, IconButton, SendButton and their Views no longer appear.

### Esc (close command bar)

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| DownloadsPopover | 1 | 0 | 23.0 | 0.08 | state 1 |
| CommandPanel | 1 | 0 | 12.0 | 0.05 | state 1 |

Store keys changed per action: browser.windowUi 1.  
Timers scheduled per action: setImmediate:anonymous 1.78, setTimeout:syncMenu 1, setTimeout:anonymous 1.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 80.0 | 80.0 | 0.1 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 60.0 | 60.0 | 0.06 |
| useStore < useBoundStore < useToolbarMode < TabPane | 40.0 | 40.0 | 0.03 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 23.7 | 23.7 | 0.02 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 20.0 | 20.0 | 0.02 |
| useStore < useBoundStore < useAutoPictureInPicture < TabWebView | 20.0 | 20.0 | 0.02 |

### tab switch, click

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| HoverSlot | 2.97 | 0 | 0 | 0.02 | props:hover 2.97, props:children 0.47 |
| ToolbarButton | 2.8 | 0 | 5.6 | 0.06 | fn:onPress 2.8, props:palette 1.87, fn:onLongPress 0.93 |
| TabRow | 2.47 | 0 | 37.0 | 0.22 | state 2.47 |
| TabPane | 2 | 0 | 124 | 0.69 | props:rect 2, props:focused 2, props:geometry 2 |
| TabWebView | 2 | 0 | 66.0 | 0.16 | props:visible 2 |
| WebView | 2 | 0 | 4 | 0.15 | props:visible 2, fn:onReady 2, fn:onNavigationChange 2 |
| Entry | 2 | 2 | 0 | 0.01 | wasted 2 |
| ContentCard | 1 | 0 | 78.0 | 0.77 | state 1 |
| SwipeOverlay | 1 | 0 | 25.0 | 0.23 | state 1 |
| DropTargets | 1 | 0 | 38.0 | 0.08 | props:panes 1 |

Store keys changed per action: browser.live 1.63, browser.windows 1, browser.tabs 1, pages.pages 0.47, pages.browsers 0.23, lifecycle.discarded 0.23.  
Timers scheduled per action: requestAnimationFrame:bound onUpdate 27.8, setImmediate:anonymous 26.6, setTimeout:anonymous 5.23, requestAnimationFrame:anonymous 1.7, setTimeout:flush 1.27, setTimeout:syncMenu 1.23.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 487 | 471 | 1.12 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 366 | 354 | 0.39 |
| useStore < useBoundStore < useToolbarMode < TabPane | 287 | 263 | 0.31 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 124 | 124 | 0.11 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 122 | 118 | 0.1 |
| useStore < useBoundStore < useAutoPictureInPicture < TabWebView | 122 | 118 | 0.11 |

After 9b7eab7: `Entry` is no longer wasted (wasted 3 → 1).

### tab switch, shortcut

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| Entry | 2.4 | 2.4 | 0 | 0.01 | wasted 2.4 |
| TabPane | 2 | 0 | 124 | 0.27 | props:rect 2, props:focused 2, props:geometry 2 |
| WebView | 2 | 0 | 4 | 0.16 | props:visible 2, fn:onReady 2, fn:onNavigationChange 2 |
| TabWebView | 2 | 0 | 66.0 | 0.15 | props:visible 2 |
| HoverSlot | 1.6 | 0 | 0 | 0.01 | props:hover 1.6 |
| GlassFill | 1.2 | 0 | 0 | 0.05 | props:fill 1.2, props:raised 1, props:dark 0.2 |
| ToolbarButton | 1.2 | 0 | 2.4 | 0.02 | fn:onPress 1.2, props:palette 0.8, fn:onLongPress 0.4 |
| ContentCard | 1 | 0 | 78.0 | 0.35 | state 1 |
| PinnedTile | 1 | 0 | 55.0 | 0.24 | state 1 |
| SwipeOverlay | 1 | 0 | 25.0 | 0.22 | state 1 |

Store keys changed per action: browser.windows 1, browser.tabs 1, browser.live 0.7, pages.pages 0.2, pages.browsers 0.1, lifecycle.discarded 0.1.  
Timers scheduled per action: setImmediate:anonymous 25.5, requestAnimationFrame:bound onUpdate 24.8, setTimeout:anonymous 5.1, requestAnimationFrame:anonymous 1.37, setTimeout:syncMenu 1.1, requestAnimationFrame:reveal 1.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 192 | 176 | 0.26 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 144 | 132 | 0.16 |
| useStore < useBoundStore < useToolbarMode < TabPane | 121 | 97.0 | 0.11 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 48.0 | 44.0 | 0.04 |
| useStore < useBoundStore < useAutoPictureInPicture < TabWebView | 48.0 | 44.0 | 0.05 |
| useStore < useBoundStore < useBookmarksBarShown < TabPane | 48.0 | 44.0 | 0.05 |

After 9b7eab7: `Entry` and `NextMeetingBadge` are no longer wasted (wasted 5 → 1).

### Enter (navigate)

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| ToolbarButton | 16.0 | 0 | 32.0 | 0.28 | fn:onPress 16.0, fn:onLongPress 8, fn:onContextMenu 8 |
| HistoryButton | 8 | 0 | 0 | 0.1 | props:tab 6, props:palette 4, props:disabled 0.33 |
| Toolbar | 4 | 0 | 260 | 0.98 | state 4 |
| UrlField | 4 | 0 | 88.0 | 0.6 | props:tab 3, props:palette 2 |
| TabRow | 4 | 0 | 60.0 | 0.41 | state 4 |
| GlassFill | 4 | 2 | 0 | 0.16 | wasted 2, props:fill 2, props:dark 2 |
| TranslateButton | 4 | 2 | 16.0 | 0.08 | wasted 2, props:palette 2 |
| HoverSlot | 4 | 0 | 0 | 0.04 | props:hover 4, props:children 3 |
| ReloadButton | 4 | 0 | 0 | 0.03 | props:tab 3, props:palette 2, props:loading 1 |
| ZoomIndicator | 4 | 2 | 0 | 0.01 | wasted 2, props:palette 2 |

Store keys changed per action: browser.live 5.33, browser.tabs 4, pages.pages 4, browser.history 2, browser.historyReady 2, browser.historyFloor 2.  
Timers scheduled per action: setImmediate:anonymous 35.1, requestAnimationFrame:bound onUpdate 16.8, setTimeout:flush 6.44, setTimeout:anonymous 4.78, requestAnimationFrame:anonymous 3.56, setTimeout:syncMenu 1.56.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 680 | 676 | 0.85 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 536 | 530 | 0.59 |
| useStore < useBoundStore < useToolbarMode < TabPane | 461 | 443 | 0.4 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 192 | 190 | 0.18 |
| useStore < useBoundStore < useBookmarksBarShown < TabPane | 180 | 177 | 0.18 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 179 | 177 | 0.15 |

After 099fc05 and 9b7eab7: 255 renders; Toolbar renders 3.8 → 3.3 (url, zoom and the website color still change), `HistoryButton` stops following `tab`.

### page load (active tab), after Enter

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| ToolbarButton | 22.0 | 0 | 44.0 | 0.53 | fn:onPress 22.0, fn:onLongPress 10.0, fn:onContextMenu 10.0 |
| HistoryButton | 10.0 | 0 | 0 | 0.11 | props:tab 10.0 |
| TabRow | 7 | 0 | 105 | 0.74 | state 7 |
| HoverSlot | 7 | 0 | 0 | 0.07 | props:hover 7, props:children 6 |
| Toolbar | 6 | 0 | 390 | 1.45 | state 6 |
| TranslateButton | 6 | 5 | 24.0 | 0.15 | wasted 5, state~ 1 |
| ReloadButton | 6 | 0 | 0 | 0.05 | props:tab 5, props:loading 1 |
| UrlField | 5 | 0 | 110 | 0.8 | props:tab 5 |
| GlassFill | 5 | 5 | 0 | 0.18 | wasted 5 |
| ZoomIndicator | 5 | 5 | 0 | 0.01 | wasted 5 |

Store keys changed per action: browser.tabs 6, browser.history 5, browser.historyReady 5, browser.historyFloor 5, browser.live 1.33, favicons.profiles 1.  
Timers scheduled per action: setImmediate:anonymous 61.1, requestAnimationFrame:bound onUpdate 37.0, setTimeout:anonymous 12.2, setTimeout:flush 8.33, setTimeout:syncMenu 7, setTimeout:save 2.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 1026 | 1026 | 1.53 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 810 | 810 | 0.83 |
| useStore < useBoundStore < useToolbarMode < TabPane | 550 | 550 | 0.45 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 288 | 284 | 0.26 |
| useStore < useBoundStore < TabRow < renderWithHooks | 273 | 235 | 0.59 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 270 | 270 | 0.22 |

After 099fc05: 134 renders, 0 wasted, 342 hooks; Toolbar, UrlField, both history buttons, the reload button and their children no longer re-render for a title change. What is left is the sidebar row (title and icon) and the progress bar.

### page load (background tab)

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| HoverSlot | 7.67 | 0 | 0 | 0.07 | props:hover 7.67, props:children 6.17 |
| TabRow | 6.67 | 0 | 100 | 0.63 | state 6.67 |
| Favicon | 2 | 0 | 38.0 | 0.13 | props:url 2 |
| TabIcon | 2 | 0 | 8 | 0.05 | props:url 2 |
| Icon | 2 | 0 | 0 | 0.02 | props:url 2 |
| TabPane | 1 | 0 | 62.0 | 0.24 | state 1, context:? 0.5 |
| GroupHeader | 1 | 0 | 32.0 | 0.18 | state 1 |
| TabWebView | 1 | 0 | 33.0 | 0.08 | state 1 |
| WebView | 1 | 0 | 2 | 0.07 | props:url 1, fn:onReady 1, fn:onNavigationChange 1 |

Store keys changed per action: browser.tabs 6.67, browser.history 5.17, browser.historyReady 5.17, browser.historyFloor 5.17, browser.live 5, pages.pages 4.  
Timers scheduled per action: setImmediate:anonymous 13.0, setTimeout:anonymous 9.83, setTimeout:flush 8.5, setTimeout:syncMenu 4.5, setTimeout:save 3.33.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabPane < renderWithHooks | 1207 | 1203 | 1.6 |
| useStore < useBoundStore < TabWebView < renderWithHooks | 951 | 945 | 0.98 |
| useStore < useBoundStore < useToolbarMode < TabPane | 748 | 730 | 0.62 |
| useStore < useBoundStore < useAppearanceDark < Favicon | 335 | 331 | 0.32 |
| useStore < useBoundStore < useBookmarksBarShown < TabPane | 318 | 315 | 0.28 |
| useStore < useBoundStore < useSettings < useAutoPictureInPicture | 317 | 315 | 0.29 |

Unchanged by the fixes so far: the row, its favicon and the pane's own hooks. Its cost is the store fan-out below, not renders.

### sidebar hover (enter and leave a row)

| component | renders/action | wasted | hooks | ms | why |
|---|---:|---:|---:|---:|---|
| TabRow | 1.87 | 0 | 28.0 | 0.15 | state 1.87 |
| HoverSlot | 1.87 | 0 | 0 | 0.02 | props:hovered 1.87, props:hover 1.87 |
timers scheduled/action: setTimeout:anonymous 2.87, setImmediate:anonymous 1.22

Timers scheduled per action: setTimeout:anonymous 2.87, setImmediate:anonymous 1.22.

Selectors (the "selectors" probe; ms include the probe's own cost):

| selector call site | evaluated/action | notified | ms |
|---|---:|---:|---:|
| useStore < useBoundStore < TabRow < renderWithHooks | 7.47 | 0 | 0.02 |
| useStore < useBoundStore < useTab < TabRow | 3.73 | 0 | 0.01 |
timers scheduled/action: setTimeout:anonymous 2.87, setImmediate:anonymous 1.2

## Fixes landed

Each is one commit with its before and after counts from this census. Typecheck (`pnpm -C apps/browser exec tsc --noEmit`)
and the unit tests (106) pass; nothing visible changes.

| Commit | Fix | Result |
|---|---|---|
| `099fc058` | The toolbar's view of its tab holds the title only for non-web addresses (the only place it is shown); the history buttons take the tab's id and window; the sidebar address bar's field reads the same narrowed view | page load after Enter: 414 → 134 renders, 15 → 0 wasted, 1297 → 342 hooks, 239 → 79 native view updates (-68 %); Enter: 334 → 263 renders |
| `477ad6d7` | History view: a visit or title change copies the 5000-entry list once (was find + filter + findIndex + two spreads + slice, or a map over all entries); `setView` doesn't rewrite `historyFloor`/`historyReady` for a list-only change; `lib/history.test.mjs` pins the new functions to the old ones on random changes | `module:onEngineEvent` per page load (15 events): 13.4 / 13.6 / 16.5 ms → 6.7 / 7.0 / 8.8 ms. Counts unchanged. |
| `cbfeb1ab` | Command bar: AddChip, dictation, Go/Send take stable callbacks (the latest-render ref the suggestion rows already use); AddChip, GoButton, SendButton and IconButton are memoized | keystroke: 45 → 25 renders, 205 → 170 hooks, 31 → 17 native view updates; Cmd-L: 35 → 15 renders; new tab page field: 43 → 25 |
| `9b7eab76` | Memoized the leaves that re-rendered with the same props: group `Entry`, `NextMeetingBadge`, `GlassFill`, `ZoomIndicator`, `TranslateButton` | wasted per action: switch 2.5 → 0.5 (click), 5 → 1 (shortcut), Enter 18 → 15 |
| `861b3b73` | ContentCard: mounted-tabs and pane-key selectors skip the O(n log n) rebuild when a switch only rewrote `lastActiveAt` | at 100 tabs the card's selector time per action: click 2.38 → 1.43 ms, shortcut 1.95 → 0.97 ms, Cmd-T 1.71 → 1.36 ms (probe on; counts unchanged) |

Tooling commits: `ff22f2b3`, `bc34bc05`, `845fc67e` (the census itself).

## Ranked fix list (what is left)

Savings are per action at 20 tabs unless marked; "risk" is the chance of a visible behaviour change or a regression.

| # | Fix | Saves | Risk | Notes |
|---|---|---|---|---|
| 1 | **Hidden tab panes stop subscribing.** `TabPane` (14 store hooks) and `TabWebView` (6) run for every tab of the window, visible or not; merge each pane's `useBrowser` reads into one `useShallow` selector and take the toolbar-mode, PiP, popover and bookmarks-bar reads out of panes that are neither shown nor warm (a child that mounts only when they are) | subscriptions 857 → ~300 (3,337 → ~1,100 at 100 tabs); per store update 435 → ~150 selectors; a page load 5,500-7,500 → ~2,000 selector runs: ~3-4 ms per load at 20 tabs, 15-25 ms at 100; a tab switch 0.4 ms / 2.5 ms | medium | touches ContentCard's pane and the auto-hide, PiP and popover paths; needs the auto-hide toolbar and PiP checks (`toolbarAutoHide.test.mjs`, acceptance) |
| 2 | **Skip store writes for a background tab's loading progress** (`live.progress`): nothing reads it for a tab that isn't shown | 5 of ~20 store updates per background load (-25 % of the fan-out): ~1.5 ms per load at 20 tabs | medium | Visible if a tab shown while it loads keeps an older bar value until its next progress event: the activation would need to write the current value. Owner's call. |
| 3 | **Coalesce the page reports of one flush into one `set`** (`lib/nativeEvents.ts` already applies them in one React batch, but each `updateTab` still notifies every subscriber: 6.5 `tabs` writes per load) | `tabs` writes per load 6.5 → ~2: ~13-20 store updates → ~8-14 per load; about 2-3 ms per load at 20 tabs | medium | Changes what a store listener sees between reports (it would see the end state); the listeners in `startNativeSync`, `startPersistence`, `chromeTabs` diff consecutive states, so each needs a look |
| 4 | **Coalesce Chrome's history events** over ~50-100 ms before they reach `setView` | 5 `history` store updates per load → ~2: ~1-1.5 ms per load at 20 tabs, 4-6 ms at 100 | low-medium | The view lags Chrome by the window; `removeHistory` keeps its immediate path |
| 5 | **Omnibox's own render: 2.8 ms of a 3.9 ms keystroke** is `buildSuggestions` (5000 history, 1000 bookmarks, 20 tabs). `micro-bench.mjs suggest-seed` is its Node bench | up to 1-2 ms per key | medium | In `packages/core`; the ratchet's `counts.suggest` is the guard |
| 6 | **RN TextInput's three extra commits per key** (`InternalTextInput` state for `lastNativeText` and two selection events; each re-renders only the input, 0.3-0.4 ms with the commit) | 3 of 4 commits per key | medium | A patch to react-native-macos's `TextInput.macos.js` (JS only, in `patches/`): skip `setLastNativeSelection` when no `selection` prop is controlled. Inline completion needs a controlled field, so check it. |
| 7 | `ContentCard`: `mounted.includes(tabId)` runs per pane (O(n²) per render); a `Set` per render | 0.1-0.3 ms at 100 tabs | none | trivial, only measurable at 200 tabs |
| 8 | Launch, for `firstrender`: the first window renders 414-460 components in 24 commits (873 mounts). Offenders above: `Toolbar` 4-5 times (state), `ToolbarButton` 14, `SidebarPage` 4 (new `onListHeight`, `onScrollView`, `onScrollY` each `Sidebar` render, and not memoized), `Dot` 4 wasted, `PageContent`/`ThemeScope`/the scroll view 4 each; `browser.bookmarks` changes 5 times and `browser.live` 6 before the first window settles | not sized here | low | see its section above; 18 module events (`onEngineEvent` 5.8 ms), 13 `topLayout` events (19 ms) and `AppRegistry.runApplication` (34 ms) are the JS tasks |
| 9 | Sidebar hover and the tab row: already minimal (14 renders per row, `TabIcon` and `TabBadges` don't re-render); tab switch is near its floor (2 panes, 2 rows, the card) | – | – | the remaining switch cost is the pane swap itself (38-49 native view updates) |

Nothing in the first five landed fixes changed visible behaviour. Items 2, 3 and 6 could, and are left for the owner.
