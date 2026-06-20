import { asc } from "drizzle-orm";
import { z } from "zod";
import { spaces } from "@netnyahoo/db";
import { publicProcedure, router } from "../trpc";

export const spacesRouter = router({
  list: publicProcedure.query(async ({ ctx }) =>
    await ctx.db.select().from(spaces).orderBy(asc(spaces.order)).all(),
  ),

  create: publicProcedure
    .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
    .mutation(async ({ ctx, input }) =>
      await ctx.db.insert(spaces).values(input).returning().get(),
    ),
});
