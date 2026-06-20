import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { env } from "@netnyahoo/env";

const dbFile = env.NETNYAHOO_DB_URL;
const userDataDir = dirname(dbFile);
const dbName = basename(dbFile);

if (!existsSync(userDataDir)) {
  console.log(`No netnyahoo userData directory found at ${userDataDir}`);
  process.exit(0);
}

const dbFiles = readdirSync(userDataDir).filter(
  (file) => file === dbName || file.startsWith(`${dbName}-`),
);

for (const file of dbFiles) {
  rmSync(join(userDataDir, file), { force: true });
}

console.log(
  dbFiles.length === 0
    ? "No netnyahoo database files found."
    : `Deleted ${dbFiles.length} netnyahoo database file(s).`,
);
