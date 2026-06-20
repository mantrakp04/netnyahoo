# netnyahoo — agent guide

An Arc + Dia - style web browser built with Electron. The app chrome (sidebar, tabs,
omnibox) is React; web pages render inside Chromium via `<webview>`. This is a
pnpm + Turborepo monorepo: one app, a few internal packages.

`CLAUDE.md` is a symlink to this file — keep guidance here.

Follow YAGNI and CLEAN CODE principle

## Code stewardship

- **Good citizen** — when you open a piece of code to change it, don't do only the
  minimum work to make the change. Leave it better than you found it: reconcile the
  thing you're touching with related-but-unrelated code nearby, and anticipate where
  it's heading so the next change is easier. The opposite is a **politician** — code
  that does only what's expedient for the immediate change and reconciles nothing.
- **Static discipline** (from electrical engineering) — the same idea: the signal
  coming *out* of a stage should be at least as clean as the signal that came *in*.
  Applied to code, the diff you leave behind should be at least as clean as what you
  started with.
- **Caveat (two-edged sword)** — good-citizen instincts cut both ways. If you "clean
  up" or extend the *wrong* piece of code, you propel a bad idea through the codebase
  and pave a fast path to hell. Before generalizing or reconciling, make sure the
  thing you're building on is worth building on.

## Layout

```
apps/
  desktop/              Electron app (electron-vite: main / preload / renderer)
    src/
      main/index.ts     BrowserWindow + local tRPC IPC handler + db/env wiring
      preload/index.ts  electronTRPC bridge exposure
      renderer/         React app — TanStack Router (file routes), Query, shadcn UI
packages/
  db/                   @netnyahoo/db    — Drizzle schema + node:sqlite client + migrations
  backend/              @netnyahoo/backend — tRPC v11 router + procedures (the "backend")
  env/                  @netnyahoo/env   — t3-env (@t3-oss/env-core) validated environment
  config/               @netnyahoo/config — shared tsconfig base
```

Data flows: renderer → local tRPC IPC bridge → `@netnyahoo/backend` router →
`@netnyahoo/db` Drizzle client → Electron's native `node:sqlite`. The DB file
lives in Electron's `userData` dir as `netnyahoo.db`.

## Internal packages (important)

The `db`, `backend`, and `env` packages are **just-in-time TypeScript packages** —
they ship raw `.ts` via `"exports": "./src/index.ts"` and are compiled by the
*consumer's* bundler. There is no build step for them. Consequences:

- In `apps/desktop/electron.vite.config.ts`, the main-process
  `externalizeDepsPlugin` **excludes** the three `@netnyahoo/*` packages so their
  source gets bundled into `out/main`. Their third-party deps (drizzle-orm,
  @trpc/server, zod, @t3-oss/env-core) are plain JS and get bundled too; only
  `node:sqlite` and `electron` stay external (Node/Electron builtins).
- The renderer imports only **types** from `@netnyahoo/backend` (the `AppRouter`)
  and `@netnyahoo/db` (row types like `Tab`) — erased at build, no runtime cost.
- Add a new internal package the same way: `"type": "module"`,
  `"exports": { ".": "./src/index.ts" }`, extend `@netnyahoo/config`, add
  `@types/node`, and add it to the desktop `externalizeDepsPlugin` exclude list
  if the main process imports it.

## Database

`@netnyahoo/db` is Electron-free: `initDb(file)` takes an absolute path and the
desktop main process passes `env.NETNYAHOO_DB_URL`. `@netnyahoo/env` owns the
default `userData` directory and database path via zod defaults.
The package keeps Electron's native `node:sqlite` under Drizzle's stable
`sqlite-proxy` driver, so Drizzle and drizzle-kit stay on normal semver ranges
and pnpm resolves the current versions. We do not have users, so it is ok to
delete migrations and the dev db, then regenerate and push them.

```bash
pnpm --filter @netnyahoo/db db:generate   # emits SQL to packages/db/drizzle
pnpm --filter @netnyahoo/db db:push       # applies migrations to the dev db
pnpm --filter @netnyahoo/db db:delete     # deletes the dev db
```

## Environment

`@netnyahoo/env` validates `process.env` at import via `@t3-oss/env-core`.
Import `env` instead of touching `process.env` directly. Add new vars under
`server` in `packages/env/src/index.ts`.

## Commands

```bash
pnpm install
pnpm dev          # turbo dev → electron-vite dev --watch
pnpm build        # turbo build
pnpm check-types  # turbo check-types (tsc across all packages)
```

## Gotchas

- Verify the running app over CDP (port 9222 in dev): screenshots return black
  without screen-recording perms, so assert on DOM/text instead.

## Worktrees/Cloud Environments

If you are working in a worktree or a cloud environment then its your job to make sure this pr reaches end to end. That means once you are done with the task, you spawn subagents to do the following in parallel if you can:

- review the code from a fresh perspective, for bugs, security issues, cleanniness (follow clean code guidelines by bob), dead code, fallback code (often indicates an underlying issue that need to be resolved instead of fallback code, avoid writing this in the first place but if there somehow then remove it)
- monitor for code review comments on github by various bots, read em, check the diff the code and validate em if they seem valid and obvious then fix it, if not obvious then validate it by writing code and testing it against the dev environment by reproducing it, if valid make a fix (spawn parallel sub/background agents to tackle each comment that requires reproduction else obvious ones can be handled in the same thread), additionally check for whic review bots commented and tag em for a re-review after each following commit in a loop until none popup. make sure you resolve the ones you implement on github, including the invalid ones with a reason.
- create a demo video of the changes/behaviour/etc by interacting with the ui in any way you deem fit.
