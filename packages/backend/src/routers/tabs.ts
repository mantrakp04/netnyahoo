import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { tabs } from "@netnyahoo/db";
import { publicProcedure, router } from "../trpc";

export const tabsRouter = router({
  list: publicProcedure
    .input(z.object({ spaceId: z.string() }).optional())
    .query(({ ctx, input }) => {
      const base = ctx.db.select().from(tabs);
      const rows = input?.spaceId
        ? base.where(eq(tabs.spaceId, input.spaceId))
        : base;
      return rows.orderBy(asc(tabs.order)).all();
    }),

  create: publicProcedure
    .input(
      z.object({
        spaceId: z.string(),
        url: z.string().default("about:blank"),
        title: z.string().default("New Tab"),
        activate: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      const max = ctx.db
        .select({ order: tabs.order })
        .from(tabs)
        .where(eq(tabs.spaceId, input.spaceId))
        .orderBy(asc(tabs.order))
        .all();
      const order = max.length ? Math.max(...max.map((t) => t.order)) + 1 : 0;

      if (input.activate) {
        ctx.db
          .update(tabs)
          .set({ active: false })
          .where(eq(tabs.spaceId, input.spaceId))
          .run();
      }

      return ctx.db
        .insert(tabs)
        .values({
          spaceId: input.spaceId,
          url: input.url,
          title: input.title,
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
        pinned: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      return ctx.db
        .update(tabs)
        .set({ ...rest, lastAccessedAt: new Date() })
        .where(eq(tabs.id, id))
        .returning()
        .get();
    }),

  activate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const tab = ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.id, input.id))
        .get();
      if (!tab) return null;
      ctx.db
        .update(tabs)
        .set({ active: false })
        .where(
          and(eq(tabs.spaceId, tab.spaceId), ne(tabs.id, input.id)),
        )
        .run();
      return ctx.db
        .update(tabs)
        .set({ active: true, lastAccessedAt: new Date() })
        .where(eq(tabs.id, input.id))
        .returning()
        .get();
    }),

  close: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const tab = ctx.db
        .select()
        .from(tabs)
        .where(eq(tabs.id, input.id))
        .get();
      ctx.db.delete(tabs).where(eq(tabs.id, input.id)).run();

      // If we closed the active tab, activate the most recent remaining one.
      if (tab?.active) {
        const next = ctx.db
          .select()
          .from(tabs)
          .where(eq(tabs.spaceId, tab.spaceId))
          .orderBy(asc(tabs.order))
          .all();
        if (next.length) {
          ctx.db
            .update(tabs)
            .set({ active: true })
            .where(eq(tabs.id, next[next.length - 1]!.id))
            .run();
        }
      }
      return { id: input.id };
    }),
});
