import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { financeRouter } from "./financeRouter";
import { forecastRouter } from "./forecastRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  finance: financeRouter,
  forecast: forecastRouter,
});

export type AppRouter = typeof appRouter;
