import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

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
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
