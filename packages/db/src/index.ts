import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;
let _sqlite: DatabaseSync | null = null;

/**
 * Open (or reuse) the SQLite database at `file`, run the idempotent schema
 * bootstrap, and return a Drizzle client. The caller owns the path — in the
 * desktop app that's Electron's `userData` dir — so this package stays free of
 * any Electron dependency.
 */
export function initDb(file: string): DB {
  if (_db) return _db;

  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _sqlite = new DatabaseSync(file);
  _sqlite.exec("PRAGMA journal_mode = WAL;");
  _sqlite.exec("PRAGMA foreign_keys = ON;");

  _db = drizzle({ client: _sqlite, schema });
  runMigrations(_sqlite);

  return _db;
}

export function getDb(): DB {
  if (!_db) throw new Error("Database not initialized — call initDb() first.");
  return _db;
}

export { schema };
export * from "./schema";
