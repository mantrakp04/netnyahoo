# @netnyahoo/desktop

An Arc-style web browser built with Electron + React. The app chrome (sidebar,
tabs, omnibox) is React; web pages are rendered by Chromium via `<webview>`.

## Stack

| Concern        | Choice                                                            |
| -------------- | ---------------------------------------------------------------- |
| Shell          | [electron-vite](https://electron-vite.org) (main / preload / renderer) |
| UI             | React 19, [TanStack Router](https://tanstack.com/router) (file routes) |
| Data fetching  | [TanStack Query](https://tanstack.com/query)                     |
| IPC / backend  | [tRPC v11](https://trpc.io) over a local Electron IPC bridge |
| Database       | Electron's native `node:sqlite` + [Drizzle ORM](https://orm.drizzle.team) through Drizzle's sqlite proxy driver |
| Components     | [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS v4             |
| Keybinds       | [react-hotkeys-hook](https://react-hotkeys-hook.vercel.app)      |

## Layout

```
src/
  main/index.ts         BrowserWindow + local tRPC IPC handler; wires db + env
  preload/index.ts      electronTRPC bridge exposure
  renderer/             React app
    src/
      routes/           __root (app shell), index, history, bookmarks
      components/        sidebar, tab-list, browser-area (webview), omnibox
      hooks/use-browser  central browser state (tabs, nav, omnibox actions)
      lib/trpc.ts        typed tRPC + TanStack Query context
```

The data layer lives in workspace packages, consumed here:

- `@netnyahoo/db` — Drizzle schema, `node:sqlite` adapter, Drizzle migrations
- `@netnyahoo/backend` — tRPC router + procedures (spaces, tabs, history, bookmarks)
- `@netnyahoo/env` — t3-env validated environment

These are bundled into the main process (see the `externalizeDepsPlugin` exclude
list in `electron.vite.config.ts`); the renderer imports only their types. The
database path is resolved by `@netnyahoo/env` as `env.NETNYAHOO_DB_URL`, with
zod defaults for the app `userData` directory and `netnyahoo.db`. `initDb()`
runs Drizzle's migrator against `packages/db/drizzle` in dev and the packaged
`drizzle` resource in production.

## Keybinds

| Shortcut         | Action               |
| ---------------- | -------------------- |
| ⌘T               | New tab (omnibox)    |
| ⌘L               | Edit current URL     |
| ⌘W               | Close active tab     |
| ⌘R               | Reload               |
| ⌘← / ⌘[          | Back                 |
| ⌘→ / ⌘]          | Forward              |

## Scripts

- `pnpm dev` — run the app with HMR
- `pnpm build` — bundle main/preload/renderer to `out/`
- `pnpm check-types` — type-check all three TS projects
- `pnpm --filter @netnyahoo/db db:generate` / `db:push` / `db:studio` — drizzle-kit
- `pnpm pack:mac` — build + sign a DMG, **no** notarization (fast local check)
- `pnpm dist:mac` — build + sign + (if Apple creds are set) notarize a DMG

## Packaging & code signing (macOS)

Packaging is handled by `electron-builder` (`electron-builder.config.mjs`).
`electron-vite build` produces `out/`; electron-builder bundles it into a signed
`.dmg` for `arm64` + `x64`.

**Output lives outside the repo, at `~/netnyahoo-build`** (override with
`NETNYAHOO_DIST`). This is deliberate: this repo sits under `~/Desktop`, which is
synced by **iCloud Desktop & Documents**. The iCloud file provider stamps managed
files with `com.apple.FinderInfo` / `com.apple.fileprovider.fpfs#P` xattrs that
`codesign` rejects ("resource fork, Finder information, or similar detritus not
allowed") and that cannot be stripped while iCloud owns the file. Staging the app
outside the synced tree sidesteps it. (Moving the whole repo out of `~/Desktop`
would also fix it.)

Signing uses the **`Developer ID Application: mantra patel (U5L5T3NGVV)`**
identity, auto-discovered from the login keychain. Hardened runtime + the
entitlements in `build/entitlements.mac.plist` (JIT / unsigned-exec-memory /
library-validation-off) are required for both notarization and a working V8.

### Notarization

`mac.notarize` flips on automatically when Apple credentials are present in the
environment. Use **one** of:

```sh
# App Store Connect API key (recommended)
export APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# …or an Apple ID app-specific password
export APPLE_ID=mantrakp@gmail.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=U5L5T3NGVV
```

Then `pnpm dist:mac`. electron-builder uploads to Apple's notary service and
staples the ticket into the DMG. Verify the result with
`spctl -a -t open --context context:primary-signature -vv <app-or-dmg>`.

## Dependency Notes

The Electron IPC bridge lives in app source and speaks tRPC v11 directly; there
is no pnpm patch for `electron-trpc`. Drizzle packages use normal semver ranges;
pnpm resolves the current stable versions. Because stable Drizzle does not
expose a dedicated `node:sqlite` driver, `@netnyahoo/db` wraps Electron's native
sqlite connection with Drizzle's sqlite proxy driver.
