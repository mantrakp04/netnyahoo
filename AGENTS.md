# AGENTS.md

Netnyahoo is a macOS browser: Dia's polish and Arc's sidebar, built on our own patched Chromium (CEF 154),
with no account and no AI. It's also a satire brand. This file is how the owner works; follow it.
For the architecture and the test tooling, read `docs/agent-brief.md`.

## How work gets done
- **Move fast.** Don't break work into phases or ask about details you can decide; there are no users to
  migrate yet. Ask only when the answer changes what you build.
- **Orchestrate.** The main session plans, hands implementation to Opus subagents, and verifies what they
  return (build, run, capture). Give each agent its own files, its own derived-data dir and its own
  `NETNYAHOO_DATA_DIR`.
- **No git worktrees, ever.** Everyone works in this checkout.
- **Commit straight to `main`.** Stage only your own hunks (`git add -p` or explicit paths), never
  someone else's work in progress. End every message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Progress reports.** Keep them short and plain: what shipped, what's left, what needs the owner.
- **Clean up.** Quit your test instances, stop the servers and background jobs you started, and never
  kill processes you didn't start.

## Hard rules
- **The Chromium build cache is sacred.** Never touch `~/chromium-build/chromium_git/chromium/src/out`,
  and never run `gclient sync` or `gn clean`: a full rebuild costs about 5 hours. Engine changes are
  incremental builds only, holding `/tmp/nn-chromium.lock`
  (`docs/cef-source-build.md`). When freeing disk space, stay out of `~/chromium-build`.
- **Never launch or touch `/Applications/Netnyahoo.app`.** The owner is using it.
- **Never steal focus.** Run builds only as hidden instances:
  `open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR=<throwaway dir> --env NETNYAHOO_REMOTE_DEBUGGING_PORT=<port> <app>`.
  Never use plain `open`. Background mode logs context menus and file panels instead of showing them.
  Keep test data in a scratch dir, not in `~/Documents`.
- **Dia is a read-only reference.** You may take screenshots and read its app bundle; never click or type
  in it, and never read its user data or any browser's real profile.
- **No AI features.** This is the owner's decision. Dia's AI rows in `docs/dia-feature-parity.md`
  stay ⏸.
- **Satire guardrails.** Netanyahu appears only as a public figure (the mascot is Big Yahu). No ethnic,
  religious or war imagery, no accusations against real named people, and nothing sexual about any real
  person.

## Building features
- **Sources of truth.** `docs/dia-feature-parity.md` is the checklist; update its row when you ship.
  `docs/dia-spec.md` has Dia's measured values.
- **Match Dia with numbers.** Compare against a capture with the same crop and the same state; "looks
  close" isn't enough. When the owner asks for Arc's layout, keep Dia's styling unless told otherwise.
- **Verify before you call it done.** Typecheck, build, and exercise the feature in a hidden instance
  (dev harness, CDP, window snapshots).
  - The screen is often locked, and then WindowServer captures fail. Use the in-process snapshots
    (`docs/agent-brief.md`) and say exactly what still needs a visual check.
- **Build safely.** Run xcodebuild, `pod install`/`pnpm install` and Chromium builds through
  `scripts/agent/locked <xcodebuild|pod|chromium> -- <command>` (usage in the script). Its lock dies with
  its holder; the old `until mkdir /tmp/nn-*.lock` pattern left locks behind that stalled every agent.
  A "resources-to-copy" error means a collision; retry once nothing else is building.
- **Never wait open-ended.** Every wait has a deadline under the Bash tool's 10-minute limit and fails
  fast when the thing it waits on dies: `scripts/agent/await --pid <pid> -- <test>` instead of
  `until …; do sleep; done`. Run builds with `run_in_background` and act on the notification. Wrap
  screen captures in `timeout 20` (they hang while the screen is locked). Never wait for another agent's
  edit to appear; report the dependency instead.

## Shipping
- **Use the `release` skill** (`.claude/skills/release/SKILL.md`). The flow is:
  - write the notes in `docs/release-notes/<version>.md` (style guide in that folder);
  - bump the version;
  - run `scripts/release.sh`, which signs and notarizes;
  - run the smoke test;
  - publish the GitHub release and the appcast;
  - bump `VERSION` in `apps/site/src/data/release.ts`;
  - deploy the site with `pnpm -C apps/site run deploy`.

  The owner has authorized releases to go all the way through. After an update, the app opens the
  release notes on netnyahoo.com.
- **Other public actions** (a site deploy outside a release, posting anywhere) need the owner's OK first.

## Site and launch films
- **Site** (`apps/site`, Astro): short and witty, with real product captures and no generic AI-site
  patterns. It has to look great on phones.
- **Launch films** (`apps/launch-video`, Remotion; renders go to `output/launch-video/`):
  - Follow the Apple framework: design and storyboard first, one idea per shot, eased and overlapping
    motion, a beat grid, and a subtractive sound pass. The edit check must pass before rendering.
  - Every UI pixel is a real capture of the app.

## Repo map
`apps/browser` is the React Native macOS app. The native Expo modules are in `packages/{cef,shell,shaders,import,sync}`,
and `packages/core` holds the omnibox logic and its tests. `apps/site` is netnyahoo.com and
`apps/launch-video` holds the launch films. The license is Apache-2.0.
