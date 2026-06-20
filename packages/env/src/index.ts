import { createEnv } from "@t3-oss/env-core";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const defaultUserDataDir = join(
  homedir(),
  "Library/Application Support/@netnyahoo/desktop",
);
const defaultDbUrl = join(
  process.env.NETNYAHOO_USER_DATA_DIR || defaultUserDataDir,
  "netnyahoo.db",
);

/**
 * Type-safe, validated environment for the Electron main process.
 *
 * This is the single source of truth for env access — import `env` instead of
 * reading `process.env` directly so missing/malformed values fail loudly at
 * startup rather than surfacing as `undefined` deep in the app. Add new vars
 * under `server` and they become typed everywhere.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    /** Dev-only renderer URL injected by electron-vite; absent in packaged builds. */
    ELECTRON_RENDERER_URL: z.string().url().optional(),
    NETNYAHOO_USER_DATA_DIR: z.string().min(1).default(defaultUserDataDir),
    NETNYAHOO_DB_URL: z.string().min(1).default(defaultDbUrl),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
