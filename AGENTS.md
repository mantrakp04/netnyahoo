# AGENTS.md

Netnyahoo is a macOS browser: Dia's polish and Arc's sidebar, built on Chrome's own framework (Chromium 154) through NNCore, our thin layer,
with no account. It's also a satire brand. This file is how the owner works; follow it.
For the architecture and the test tooling, read `docs/agent-brief.md`.

## How work gets done
- **Move fast.** Don't break work into phases or ask about details you can decide; there are no users to
  migrate yet. Ask only when the answer changes what you build.
- **Speed is the point.** Do independent work in parallel: agents, builds, test instances, tool calls. Batch what you
  plan to check into one script or one call instead of one step at a time. Only timing measurements run one at a
  time, interleaved with their control, because sharing the CPU skews them.
- **Orchestrate.** The main session plans, hands implementation to Opus subagents, and verifies what they
  return (build, run, capture). Give each agent its own files, its own derived-data dir and its own
  `NETNYAHOO_DATA_DIR`.
- **Watch the agents.** Every ~30 minutes the main session checks any agent it hasn't heard from (last
  transcript activity, a pending tool call, `/tmp/nn-*.holder`, its processes). A stuck agent means a root
  cause to fix (a lock, a wait, a hang), not just a restart. Send new feedback to the agent that owns
  that area (SendMessage) instead of starting a new one, and batch finished fixes into the next release.
- **Ask Codex for a second opinion** on risky logic (races, lifetimes, security, migrations, sync) and reviews,
  before and after the change. Use the CLI bundled with ChatGPT.app (Homebrew's rejects this model); stdin must be
  `/dev/null` or it hangs; give it a deadline (`timeout 1500`) and run it in the background:
  `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex exec -m gpt-6.1-sol -c model_reasoning_effort='"high"' -c service_tier='"priority"' -s read-only -o <out.md> "<what to check>" < /dev/null`.
  It reads more than it runs: reproduce each finding before fixing it.
- **No git worktrees, ever.** Everyone works in this checkout.
- **Commit straight to `main`.** Stage only your own hunks (`git add -p` or explicit paths), never
  someone else's work in progress. Never stage with `git apply --unidiff-zero`: it drops hunks into the wrong
  place (it once committed an `NNClient.mm` that didn't compile). Check `git diff --cached` reads as you meant. End every message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Progress reports.** Keep them short and plain: what shipped, what's left, what needs the owner.
- **Clean up.** Quit your test instances, stop the servers and background jobs you started, and never
  kill processes you didn't start.

## Hard rules
- **The Chromium build cache is sacred.** Never touch `~/chromium-build/chromium_git/chromium/src/out`,
  and never run `gclient sync` or `gn clean`: a full rebuild costs about 5 hours. Engine changes are
  incremental builds only, holding the chromium lock (`scripts/agent/locked chromium`,
  `docs/engine-build.md`). When freeing disk space, stay out of `~/chromium-build`.
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
- **Parity means UI and UX.** Match what Dia does, not only how it looks: what each click does, what it
  remembers (positions, sizes), its animations and their timing in frames, and what keeps running.
  Obvious UX holds everywhere: dismissing something never pauses playback or drags you to another tab;
  going back to the source ends a temporary view (the mini player); nothing reopens right after you close it.
- **Owner recordings and screenshots.** Copy a recording out of its temp folder at once (it vanishes, and
  the name has a narrow no-break space: use a glob). Extract 30 fps frames with ffmpeg, find events by
  frame difference, and measure positions and timings from the pixels. A position or size in the owner's
  recording may be their saved preference rather than Dia's default.
- **Errors get fixed without asking.** When `crash.log` shows up in the repo root, a crash report appears, or
  PostHog shows a new `$exception` from the site or the app, find the cause and fix it; don't wait for the
  owner to ask. Check the binary UUID against the current build first (older builds are usually
  known-fixed), and skip noise that isn't ours (X's in-app browser, wallet extensions, telemetry self-tests).
  Site fixes deploy right away; app fixes ship in the next release. Delete `crash.log` once handled.
- **Verify before you call it done.** Typecheck, build, and exercise the feature in a hidden instance
  (dev harness, CDP, window snapshots).
  - The screen is often locked, and then WindowServer captures fail. Use the in-process snapshots
    (`docs/agent-brief.md`) and say exactly what still needs a visual check.
  - Verify in proportion. A JS-only change needs no app build (Metro reloads it); run the checks for what
    you changed, each once before and once after, plus one final pass of the nearby checks. The full suite
    and Codex are for engine, native lifetime, focus, quit or security changes, and run once at the end.
- **Build safely.** Build the app with `scripts/agent/build-app --as <you>`: quiet, in parallel with other agents'
  builds, and it refuses JS-only changes. Run `pod install`/`pnpm install` and Chromium builds through
  `scripts/agent/locked <pod|chromium> -- <command>` (usage in the script); its lock dies with its holder.
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
- **Every release gets a tweet draft**: a version line, 4–5 short, witty, simple bullets and
  the URL, under 280 characters. Add a 1600×1000 image in the site's style built from
  real captures of neutral pages (no random user posts or personal data) at `output/tweets/<version>.png`.
  Only the owner posts it.
- **Other public actions** (a site deploy outside a release, posting anywhere) need the owner's OK first.

## Site and videos
- **Site** (`apps/site`, Astro): short and witty, with real product captures and no generic AI-site
  patterns. It has to look great on phones.
- **Videos** (`apps/videos`): Remotion videos (Remocn Studio project); each folder in `src/videos` is a
  composition; render with `pnpm -C apps/videos render <id>`.

## Repo map
`apps/browser` is the React Native macOS app. The native Expo modules are in `packages/{nncore,shell,shaders,import,sync}`; `engine/chromium` is our Chrome-services code (the `nn_*` C calls) and `engine/nncore` NNCore's window and tab layer,
and `packages/core` holds the omnibox logic and its tests. `apps/site` is netnyahoo.com and
`apps/videos` holds the Remotion videos. The license is Apache-2.0.
