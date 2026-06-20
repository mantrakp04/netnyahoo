import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle, type RemoteCallback } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;
type SqliteParam = null | number | bigint | string | NodeJS.ArrayBufferView;

export interface InitDbOptions {
  migrationsFolder?: string;
}

let _db: DB | null = null;

/**
 * Open (or reuse) the SQLite database at `file`, run Drizzle migrations, and
 * return a Drizzle client. The caller owns the path — in the desktop app that's
 * Electron's `userData` dir — so this package stays free of any Electron
 * dependency.
 */
export async function initDb(file: string, options: InitDbOptions = {}): Promise<DB> {
  if (_db) return _db;

  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  _db = drizzle(createNodeSqliteCallback(sqlite), { schema });
  await migrate(
    _db,
    async (migrationQueries) => runMigrations(sqlite, migrationQueries),
    {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder(),
    },
  );

  return _db;
}

export function getDb(): DB {
  if (!_db) throw new Error("Database not initialized — call initDb() first.");
  return _db;
}

export { schema };
export * from "./schema";

function defaultMigrationsFolder() {
  return join(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

function createNodeSqliteCallback(sqlite: DatabaseSync): RemoteCallback {
  return async (sql, params, method) => {
    const statement = sqlite.prepare(sql, { returnArrays: method !== "run" });
    const sqliteParams = params as SqliteParam[];

    if (method === "run") {
      statement.run(...sqliteParams);
      return { rows: [] };
    }

    if (method === "get") {
      return { rows: statement.get(...sqliteParams) as any };
    }

    return { rows: statement.all(...sqliteParams) as unknown as unknown[][] };
  };
}

function runMigrations(sqlite: DatabaseSync, migrationQueries: string[]) {
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
}
