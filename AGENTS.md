# netnyahoo — agent guide

An Arc-style web browser built with Electron. The app chrome (sidebar, tabs,
omnibox) is React; web pages render inside Chromium via `<webview>`. This is a
pnpm + Turborepo monorepo: one app, a few internal packages.

`CLAUDE.md` is a symlink to this file — keep guidance here.

## Layout

```
apps/
  desktop/              Electron app (electron-vite: main / preload / renderer)
    src/
      main/index.ts     BrowserWindow + electron-trpc IPC handler + db/env wiring
      preload/index.ts  exposeElectronTRPC() bridge
      renderer/         React app — TanStack Router (file routes), Query, shadcn UI
packages/
  db/                   @netnyahoo/db    — Drizzle schema + node:sqlite client + migrations
  backend/              @netnyahoo/backend — tRPC v11 router + procedures (the "backend")
  env/                  @netnyahoo/env   — t3-env (@t3-oss/env-core) validated environment
  config/               @netnyahoo/config — shared tsconfig base
```

Data flows: renderer → `electron-trpc` IPC → `@netnyahoo/backend` router →
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
desktop main process passes `join(app.getPath("userData"), "netnyahoo.db")`.
`getDb()` returns the client (throws if `initDb` hasn't run). Schema is applied
idempotently on boot (`src/migrate.ts`, `CREATE TABLE IF NOT EXISTS` + seed).
For real migration history use drizzle-kit from the package:

```bash
pnpm --filter @netnyahoo/db db:generate   # emits SQL to packages/db/drizzle
pnpm --filter @netnyahoo/db db:studio
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

- **electron-trpc 0.7.1 is tRPC-v10-only.** It's pinned to tRPC v11 via a
  `pnpm patch` (`patches/electron-trpc@0.7.1.patch`, recorded in
  `pnpm-workspace.yaml`). It re-applies on install; don't bump the dep without
  re-checking the patch.
- **Drizzle's `node:sqlite` driver only exists in the 1.0 line** — pinned to
  `drizzle-orm@1.0.0-rc.3`.
- Main process is **ESM**: use `import.meta.url` for `__dirname`.
- Verify the running app over CDP (port 9222 in dev): screenshots return black
  without screen-recording perms, so assert on DOM/text instead.
