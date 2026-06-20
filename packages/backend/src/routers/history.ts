import { and, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { history } from "@netnyahoo/db";
import { publicProcedure, router } from "../trpc";

export const historyRouter = router({
  list: publicProcedure
    .input(
      z
        .object({ search: z.string().optional(), limit: z.number().default(200) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.db
        .select()
        .from(history)
        .where(
          and(
            or(like(history.url, "http://%"), like(history.url, "https://%")),
            input?.search ? like(history.url, `%${input.search}%`) : undefined,
          ),
        )
        .orderBy(desc(history.visitedAt))
        .limit(input?.limit ?? 200)
        .all();
    }),

  record: publicProcedure
    .input(
      z.object({
        url: z.string(),
        title: z.string().default(""),
        favicon: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isWebHistoryUrl(input.url)) return null;
      return await ctx.db.insert(history).values(input).returning().get();
    }),

  updateFavicon: publicProcedure
    .input(
      z.object({
        url: z.string(),
        favicon: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isWebHistoryUrl(input.url)) return { ok: false };

      await ctx.db
        .update(history)
        .set({ favicon: input.favicon })
        .where(eq(history.url, input.url))
        .run();
      return { ok: true };
    }),

  clear: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(history).run();
    return { ok: true };
  }),
});

function isWebHistoryUrl(url: string) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
