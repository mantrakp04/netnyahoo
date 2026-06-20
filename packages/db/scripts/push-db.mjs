import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { env } from "@netnyahoo/env";

const dbFile = env.NETNYAHOO_DB_URL;
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

mkdirSync(dirname(dbFile), { recursive: true });

const sqlite = new DatabaseSync(dbFile);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(createNodeSqliteCallback(sqlite));
try {
  await migrate(db, async (migrationQueries) => {
    sqlite.exec("BEGIN;");
    try {
      for (const query of migrationQueries) {
        if (query.trim()) sqlite.exec(query);
      }
      sqlite.exec("COMMIT;");
    } catch (error) {
      sqlite.exec("ROLLBACK;");
      throw error;
    }
  }, { migrationsFolder });
} finally {
  sqlite.close();
}

console.log(`Applied Drizzle migrations to ${dbFile}`);

function createNodeSqliteCallback(sqlite) {
  return async (sql, params, method) => {
    const statement = sqlite.prepare(sql, { returnArrays: method !== "run" });

    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }

    if (method === "get") {
      return { rows: statement.get(...params) };
    }

    return { rows: statement.all(...params) };
  };
}
