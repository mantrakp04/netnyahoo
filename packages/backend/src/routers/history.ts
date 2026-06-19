import { desc, like } from "drizzle-orm";
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
    .query(({ ctx, input }) => {
      const base = ctx.db.select().from(history);
      const rows = input?.search
        ? base.where(like(history.url, `%${input.search}%`))
        : base;
      return rows.orderBy(desc(history.visitedAt)).limit(input?.limit ?? 200).all();
    }),

  record: publicProcedure
    .input(
      z.object({
        url: z.string(),
        title: z.string().default(""),
        favicon: z.string().nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!input.url || input.url === "about:blank") return null;
      return ctx.db.insert(history).values(input).returning().get();
    }),

  clear: publicProcedure.mutation(({ ctx }) => {
    ctx.db.delete(history).run();
    return { ok: true };
  }),
});
