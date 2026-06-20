import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig } from "drizzle-kit";
import { env } from "@netnyahoo/env";

const dbUrl = env.NETNYAHOO_DB_URL;

mkdirSync(dirname(dbUrl), { recursive: true });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: dbUrl,
  },
});
