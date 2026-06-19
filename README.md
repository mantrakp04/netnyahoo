# netnyahoo

An Arc-style web browser built with Electron + React, in a pnpm + Turborepo
monorepo. The browser chrome (sidebar, tabs, omnibox) is React; web pages render
inside Chromium via `<webview>`.

## Features

- **Arc-like UI** — sidebar tabs, an omnibox/URL bar, a ⌘K command palette, and
  History / Bookmarks views, all backed by the database.
- **Electron + React** — [electron-vite](https://electron-vite.org) with
  [TanStack Router](https://tanstack.com/router),
  [TanStack Query](https://tanstack.com/query), and
  [shadcn/ui](https://ui.shadcn.com) (Tailwind v4).
- **Type-safe IPC** — [tRPC v11](https://trpc.io) over
  [electron-trpc](https://github.com/jsonnull/electron-trpc) (patched for v11).
- **Native SQLite** — Electron's built-in `node:sqlite` with
  [Drizzle ORM](https://orm.drizzle.team).
- **Validated env** — [t3-env](https://env.t3.gg) (`@t3-oss/env-core`).
- **Turborepo** — monorepo task orchestration with shared internal packages.

## Getting Started

```bash
pnpm install      # installs deps; re-applies the electron-trpc v11 patch
pnpm dev          # runs the desktop app with HMR
```

`pnpm dev` runs every app via Turborepo; the only app today is the Electron
browser in `apps/desktop`. To run just it:
`pnpm --filter @netnyahoo/desktop dev`.

## Project Structure

```
netnyahoo/
├── apps/
│   └── desktop/          Electron browser (main / preload / renderer)
├── packages/
│   ├── db/               @netnyahoo/db      — Drizzle schema + node:sqlite client + migrations
│   ├── backend/          @netnyahoo/backend — tRPC v11 router + procedures
│   ├── env/              @netnyahoo/env     — t3-env validated environment
│   └── config/           @netnyahoo/config  — shared TypeScript base config
└── patches/
    └── electron-trpc@0.7.1.patch            tRPC v11 compatibility patch
```

The data layer is split into small **internal TypeScript packages** that ship
raw `.ts` (no build step) and are bundled by the desktop app. The request path
is: renderer → electron-trpc IPC → `@netnyahoo/backend` → `@netnyahoo/db` →
`node:sqlite`. The database lives in Electron's `userData` dir as `netnyahoo.db`.

See [`AGENTS.md`](AGENTS.md) for architecture, the internal-package pattern, and
the electron-trpc patch rationale, and
[`apps/desktop/README.md`](apps/desktop/README.md) for the app itself and its
keybinds.

## Available Scripts

- `pnpm dev` — start all apps in dev mode
- `pnpm build` — build all apps
- `pnpm check-types` — type-check across the monorepo
- `pnpm --filter @netnyahoo/db db:generate` — generate Drizzle migrations
