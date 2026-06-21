import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const uuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/** A "Space" groups tabs together, like Arc spaces. */
export const spaces = sqliteTable("spaces", {
  id: uuid(),
  name: text("name").notNull().default("Space 1"),
  color: text("color"),
  order: integer("order").notNull().default(0),
  createdAt: createdAt(),
});

/** Named tab groups within a space. */
export const tabGroups = sqliteTable(
  "tab_groups",
  {
    id: uuid(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Tab Group"),
    collapsed: integer("collapsed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (table) => [index("tab_groups_space_idx").on(table.spaceId)],
);

/** Open tabs shown in the sidebar. */
export const tabs = sqliteTable(
  "tabs",
  {
    id: uuid(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Tab"),
    url: text("url").notNull().default("about:blank"),
    favicon: text("favicon"),
    groupId: text("group_id"),
    order: integer("order").notNull().default(0),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    lastAccessedAt: integer("last_accessed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("tabs_space_idx").on(table.spaceId),
    index("tabs_group_idx").on(table.groupId),
  ],
);

/** Browsing history. */
export const history = sqliteTable(
  "history",
  {
    id: uuid(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    favicon: text("favicon"),
    visitedAt: integer("visited_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("history_visited_idx").on(table.visitedAt)],
);

/** Saved bookmarks. */
export const bookmarks = sqliteTable("bookmarks", {
  id: uuid(),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  favicon: text("favicon"),
  folder: text("folder"),
  order: integer("order").notNull().default(0),
  createdAt: createdAt(),
});

export type Space = typeof spaces.$inferSelect;
export type TabGroup = typeof tabGroups.$inferSelect;
export type Tab = typeof tabs.$inferSelect;
export type HistoryEntry = typeof history.$inferSelect;
export type Bookmark = typeof bookmarks.$inferSelect;
