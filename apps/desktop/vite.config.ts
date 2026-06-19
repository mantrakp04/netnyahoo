import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * Standalone renderer config.
 *
 * The app is built/run with electron-vite (see electron.vite.config.ts). This
 * file exists so tooling that expects a plain Vite project (e.g. the shadcn
 * CLI) can detect the framework and resolve the "@" alias.
 */
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
    },
  },
});
