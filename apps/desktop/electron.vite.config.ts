import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  main: {
    // Bundle the internal workspace packages (they ship raw TS via the
    // "exports" → ./src/index.ts pattern); their third-party deps stay external.
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@netnyahoo/backend", "@netnyahoo/db", "@netnyahoo/env"],
      }),
    ],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        external: ["electron", "electron-trpc"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        external: ["electron", "electron-trpc"],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: resolve(__dirname, "src/renderer/src/routes"),
        generatedRouteTree: resolve(
          __dirname,
          "src/renderer/src/routeTree.gen.ts",
        ),
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
