import { asc } from "drizzle-orm";
import { z } from "zod";
import { spaces } from "@netnyahoo/db";
import { publicProcedure, router } from "../trpc";

export const spacesRouter = router({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(spaces).orderBy(asc(spaces.order)).all(),
  ),

  create: publicProcedure
    .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db.insert(spaces).values(input).returning().get(),
    ),
});
