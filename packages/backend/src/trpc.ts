import { initTRPC } from "@trpc/server";
import type { DB } from "@netnyahoo/db";

export interface Context {
  db: DB;
}

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
