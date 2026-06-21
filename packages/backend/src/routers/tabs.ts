import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns, ne } from "drizzle-orm";
import { z } from "zod";
import { spaces, tabGroups, tabs, type Tab } from "@netnyahoo/db";
import type { Context } from "../trpc";
import { publicProcedure, router } from "../trpc";

export async function ensureDefaultTab(db: Context["db"]) {
  const space = await db.select().from(spaces).orderBy(asc(spaces.order)).get();
  if (!space) return null;

  const existingTabs = await db
    .select()
    .from(tabs)
    .where(eq(tabs.spaceId, space.id))
    .orderBy(asc(tabs.order))
    .all();

  if (existingTabs.length > 0) {
    return existingTabs.find((tab) => tab.active) ?? existingTabs[0];
  }

  return await db
    .insert(tabs)
    .values({
      spaceId: space.id,
      url: "about:blank",
      title: "New Tab",
      order: 0,
      active: true,
    })
    .returning()
    .get();
}

async function clearSingletonGroups(db: Context["db"], spaceId: string) {
  const rows = await db.select().from(tabs).where(eq(tabs.spaceId, spaceId)).all();
  const counts = new Map<string, number>();

  for (const tab of rows) {
    if (!tab.groupId) continue;
    counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);
  }

  for (const [groupId, count] of counts) {
    if (count > 1) continue;
    await db
      .update(tabs)
      .set({ groupId: null })
      .where(and(eq(tabs.spaceId, spaceId), eq(tabs.groupId, groupId)))
      .run();
    await db.delete(tabGroups).where(eq(tabGroups.id, groupId)).run();
  }
}

async function ensureTabGroup(
  db: Context["db"],
  id: string,
  spaceId: string,
  fallbackName: string,
) {
  const existing = await db
    .select()
    .from(tabGroups)
    .where(eq(tabGroups.id, id))
    .get();

  if (existing) return existing;

  return await db
    .insert(tabGroups)
    .values({ id, spaceId, name: fallbackName })
    .returning()
    .get();
}

function getFallbackGroupName(groupTabs: Tab[]) {
  const firstNamedTab = groupTabs.find((tab) => {
    const title = tab.title.trim();
    return title && title !== "New Tab";
  });

  return firstNamedTab?.title ?? "Tab Group";
}

export const tabsRouter = router({
  list: publicProcedure
    .input(z.object({ spaceId: z.string() }).optional())
    .query(async ({ ctx, input }) => {
      const base = ctx.db
        .select({
          ...getTableColumns(tabs),
          groupName: tabGroups.name,
          groupCollapsed: tabGroups.collapsed,
        })
        .from(tabs)
        .leftJoin(tabGroups, eq(tabGroups.id, tabs.groupId));
      const rows = input?.spaceId
        ? base.where(eq(tabs.spaceId, input.spaceId))
        : base;
      return await rows.orderBy(asc(tabs.order)).all();
    }),

  create: publicProcedure
    .input(
      z.object({
        spaceId: z.string(),
        url: z.string().default("about:blank"),
        title: z.string().default("New Tab"),
        favicon: z.string().nullable().optional(),
        groupId: z.string().nullable().optional(),
        pinned: z.boolean().optional(),
        activate: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const max = await ctx.db
        .select({ order: tabs.order })
        .from(tabs)
        .where(eq(tabs.spaceId, input.spaceId))
        .orderBy(asc(tabs.order))
        .all();
      const order = max.length ? Math.max(...max.map((t) => t.order)) + 1 : 0;

      if (input.activate) {
        await ctx.db
          .update(tabs)
          .set({ active: false })
          .where(eq(tabs.spaceId, input.spaceId))
          .run();
      }

      if (input.groupId) {
        await ensureTabGroup(ctx.db, input.groupId, input.spaceId, input.title);
      }

      return await ctx.db
        .insert(tabs)
        .values({
          spaceId: input.spaceId,
          url: input.url,
          title: input.title,
          favicon: input.favicon ?? null,
          groupId: input.groupId ?? null,
          pinned: input.pinned ?? false,
          order,
          active: input.activate,
        })
        .returning()
        .get();
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        url: z.string().optional(),
        favicon: z.string().nullish(),
        groupId: z.string().nullable().optional(),
        pinned: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      return await ctx.db
        .update(tabs)
        .set({ ...rest, lastAccessedAt: new Date() })
        .where(eq(tabs.id, id))
        .returning()
        .get();
    }),

  move: publicProcedure
    .input(
      z.object({
        id: z.string(),
        targetId: z.string().optional(),
        placement: z.enum(["before", "after", "group", "end"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const moving = await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.id, input.id))
        .get();
      if (!moving || moving.id === input.targetId) return moving ?? null;

      const rows = (await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.spaceId, moving.spaceId))
        .orderBy(asc(tabs.order))
        .all())
        .filter((tab) => tab.id !== moving.id)
        .map((tab) => ({ ...tab }));

      const targetIndex = input.targetId
        ? rows.findIndex((tab) => tab.id === input.targetId)
        : -1;
      const target = targetIndex >= 0 ? rows[targetIndex] : undefined;

      if (input.placement === "group" && target) {
        const groupId = target.groupId ?? randomUUID();
        await ensureTabGroup(
          ctx.db,
          groupId,
          moving.spaceId,
          getFallbackGroupName([target, moving]),
        );
        rows[targetIndex] = { ...target, groupId };
        rows.splice(targetIndex + 1, 0, { ...moving, groupId });
      } else if (
        target &&
        (input.placement === "before" || input.placement === "after")
      ) {
        rows.splice(
          targetIndex + (input.placement === "after" ? 1 : 0),
          0,
          { ...moving, groupId: target.groupId ?? null },
        );
      } else {
        rows.push({ ...moving, groupId: null });
      }

      for (const [order, tab] of rows.entries()) {
        await ctx.db
          .update(tabs)
          .set({ order, groupId: tab.groupId ?? null })
          .where(eq(tabs.id, tab.id))
          .run();
      }

      await clearSingletonGroups(ctx.db, moving.spaceId);

      return await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.id, input.id))
        .get();
    }),

  renameGroup: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tab = await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.groupId, input.id))
        .get();
      if (!tab) return null;

      await ensureTabGroup(ctx.db, input.id, tab.spaceId, input.name);

      return await ctx.db
        .update(tabGroups)
        .set({ name: input.name })
        .where(eq(tabGroups.id, input.id))
        .returning()
        .get();
    }),

  moveGroup: publicProcedure
    .input(
      z.object({
        id: z.string(),
        targetId: z.string().optional(),
        placement: z.enum(["before", "after", "end"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const groupTabs = await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.groupId, input.id))
        .orderBy(asc(tabs.order))
        .all();
      const first = groupTabs[0];
      if (!first) return { id: input.id };

      const movingIds = new Set(groupTabs.map((tab) => tab.id));
      const rows = (await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.spaceId, first.spaceId))
        .orderBy(asc(tabs.order))
        .all())
        .filter((tab) => !movingIds.has(tab.id));

      const targetIndex = input.targetId
        ? rows.findIndex((tab) => tab.id === input.targetId)
        : -1;

      if (input.placement !== "end" && targetIndex >= 0) {
        const insertAt = targetIndex + (input.placement === "after" ? 1 : 0);
        rows.splice(insertAt, 0, ...groupTabs);
      } else {
        rows.push(...groupTabs);
      }

      for (const [order, tab] of rows.entries()) {
        await ctx.db
          .update(tabs)
          .set({ order })
          .where(eq(tabs.id, tab.id))
          .run();
      }

      return { id: input.id };
    }),

  setGroupCollapsed: publicProcedure
    .input(z.object({ id: z.string(), collapsed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db
        .update(tabGroups)
        .set({ collapsed: input.collapsed })
        .where(eq(tabGroups.id, input.id))
        .returning()
        .get();
    }),

  ungroup: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tabs)
        .set({ groupId: null })
        .where(eq(tabs.groupId, input.id))
        .run();
      await ctx.db.delete(tabGroups).where(eq(tabGroups.id, input.id)).run();
      return { id: input.id };
    }),

  deleteGroup: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const groupTabs = await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.groupId, input.id))
        .all();
      const first = groupTabs[0];
      if (!first) return { id: input.id };

      const spaceId = first.spaceId;
      const hadActive = groupTabs.some((tab) => tab.active);

      await ctx.db.delete(tabs).where(eq(tabs.groupId, input.id)).run();
      await ctx.db.delete(tabGroups).where(eq(tabGroups.id, input.id)).run();

      // If the active tab was in the deleted group, focus the nearest remaining
      // tab (mirrors the close procedure's focus handling).
      if (hadActive) {
        const remaining = await ctx.db
          .select()
          .from(tabs)
          .where(eq(tabs.spaceId, spaceId))
          .orderBy(asc(tabs.order))
          .all();
        const next = remaining[remaining.length - 1];
        if (next) {
          await ctx.db
            .update(tabs)
            .set({ active: true })
            .where(eq(tabs.id, next.id))
            .run();
        }
      }
      return { id: input.id };
    }),

  activate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tab = await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.id, input.id))
        .get();
      if (!tab) return null;
      await ctx.db
        .update(tabs)
        .set({ active: false })
        .where(
          and(eq(tabs.spaceId, tab.spaceId), ne(tabs.id, input.id)),
        )
        .run();
      return await ctx.db
        .update(tabs)
        .set({ active: true, lastAccessedAt: new Date() })
        .where(eq(tabs.id, input.id))
        .returning()
        .get();
    }),

  close: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tab = await ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.id, input.id))
        .get();
      await ctx.db.delete(tabs).where(eq(tabs.id, input.id)).run();

      if (tab?.groupId) await clearSingletonGroups(ctx.db, tab.spaceId);

      // If we closed the active tab, keep focus spatially nearby: next tab to
      // the right, or the previous tab when the closed tab was already last.
      if (tab?.active) {
        const remaining = await ctx.db
          .select()
          .from(tabs)
          .where(eq(tabs.spaceId, tab.spaceId))
          .orderBy(asc(tabs.order))
          .all();
        const next =
          remaining.find((candidate) => candidate.order > tab.order) ??
          remaining[remaining.length - 1];
        if (next) {
          await ctx.db
            .update(tabs)
            .set({ active: true })
            .where(eq(tabs.id, next.id))
            .run();
        }
      }
      return { id: input.id };
    }),
});
