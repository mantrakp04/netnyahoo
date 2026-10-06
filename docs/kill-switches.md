# Kill switches

A speed change people can feel ships behind a switch, so a release that turns out slow or broken on some Macs can be
backed out without another build. `apps/browser/src/lib/killSwitches.ts` is the registry; `apps/site/public/switches.json`
(served at `https://netnyahoo.com/switches.json`) says which are off.

## Rules

- **At most 8 switches live** (`MAX_SWITCHES`). `killSwitches.test.mjs` fails above 8, and for any switch past its
  `removeBy` date: delete the switch and its old path, or move the date and say why in the commit.
- Every switch is **on by default**, has an `owner` (an area) and an `about` line, and falls back to the behaviour from
  before the change when off, with a unit test of both paths.
- A switch is **`live`** when it's read where it's used (each call, never held in state), so a value that arrives mid-launch
  applies at once. Otherwise it's read once at launch and a change applies at the next one.
- Reads are synchronous (`switchOn(name)`) and never re-render anything.

## The file

```json
{ "version": 1, "switches": { "omniboxPreload": false } }
```

Only names the app knows and booleans count; anything else is ignored. Leaving a switch out means on (the cache follows
the file, not the first answer). Editing the file is a site deploy (`pnpm -C apps/site run deploy`: an owner-approved
public action like any other).

## The request

Once a launch, after the first window, and only where the update check runs too (an updater that's set up, automatic
checks on: `killSwitchesLaunch.ts`). A plain GET of the static file: no cookies (`credentials: "omit"`), no headers of ours,
no query string, no ID, a 5 s timeout, 4 KB at most. The answer is cached in the data dir (`switches-cache.json`) and used
offline; a failed or odd answer leaves the cache as it was. The same file goes to everyone, so it can't tell one Mac from
another. Disclosed in Settings › What's Sent (“Even with sharing off”) and next to the update check in Settings › General
(`telemetry/copy.ts`, `switchFile`).

## For a bench or a test instance

`NETNYAHOO_SWITCHES="omniboxPreload=off,lazySidebarRows=off"` sets a launch's values over everything else (the app and
the updater both read it). A test instance has no updater, so it never fetches.

## The switches (see `SWITCHES` for owners and dates)

| Switch | Off means | Live |
|---|---|---|
| `omniboxPreload` | the command bar tells the engine nothing: no preconnect or prerender | yes |
| `newTabPrewarm` | a New Tab page's tab is made by Enter, as before the prewarm | yes |
| `lazySidebarRows` | a launch mounts 64 rows per page and every profile page at once | no |
| `updatePrewarm` | a staged update waits for the quit without the hidden first run (read natively: `KillSwitch` in `Updater.swift`) | yes |

## Staged rollout

A release can also reach people in steps: `scripts/release.sh <version> --phased <seconds>` and the release skill's step 5b.
