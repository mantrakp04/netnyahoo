import type { DatabaseSync } from "node:sqlite";

/**
 * Idempotent schema bootstrap.
 *
 * For a template we apply the DDL directly on boot (CREATE TABLE IF NOT EXISTS)
 * so the app always starts with a valid schema without shipping a migrations
 * folder. For real migration history use `pnpm db:generate` (drizzle-kit) and
 * swap this for drizzle's migrator.
 */
export function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT 'Space 1',
      color TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Tab',
      url TEXT NOT NULL DEFAULT 'about:blank',
      favicon TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS tabs_space_idx ON tabs(space_id);

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT,
      visited_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS history_visited_idx ON history(visited_at);

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT,
      folder TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Seed a default space so the UI always has somewhere to put tabs.
  const row = db.prepare("SELECT COUNT(*) AS n FROM spaces").get() as {
    n: number;
  };
  if (row.n === 0) {
    db.prepare(
      "INSERT INTO spaces (id, name, \"order\") VALUES (?, ?, 0)",
    ).run(crypto.randomUUID(), "Space 1");
  }
}
