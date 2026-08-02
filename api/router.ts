import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { financeRouter } from "./financeRouter";
import { forecastRouter } from "./forecastRouter";
import { insuranceRouter } from "./insuranceRouter";
import { mortgageRouter } from "./mortgageRouter";
import { pensionRouter } from "./pensionRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  finance: financeRouter,
  forecast: forecastRouter,
  insurance: insuranceRouter,
  mortgage: mortgageRouter,
  pension: pensionRouter,
});

export type AppRouter = typeof appRouter;
