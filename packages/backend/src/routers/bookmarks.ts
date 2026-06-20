import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { bookmarks } from "@netnyahoo/db";
import { publicProcedure, router } from "../trpc";

export const bookmarksRouter = router({
  list: publicProcedure.query(async ({ ctx }) =>
    await ctx.db.select().from(bookmarks).orderBy(asc(bookmarks.order)).all(),
  ),

  create: publicProcedure
    .input(
      z.object({
        url: z.string(),
        title: z.string().default(""),
        favicon: z.string().nullish(),
        folder: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      await ctx.db.insert(bookmarks).values(input).returning().get(),
    ),

  remove: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(bookmarks).where(eq(bookmarks.id, input.id)).run();
      return { id: input.id };
    }),
});
