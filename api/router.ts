import { createRouter, publicQuery } from "./middleware";
import { analysisRouter } from "./analysisRouter";
import { authRouter } from "./authRouter";
import { dashboardRouter } from "./dashboardRouter";
import { financeRouter } from "./financeRouter";
import { forecastRouter } from "./forecastRouter";
import { insuranceRouter } from "./insuranceRouter";
import { mortgageRouter } from "./mortgageRouter";
import { pensionRouter } from "./pensionRouter";
import { syncRouter } from "./syncRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  analysis: analysisRouter,
  auth: authRouter,
  dashboard: dashboardRouter,
  finance: financeRouter,
  forecast: forecastRouter,
  insurance: insuranceRouter,
  mortgage: mortgageRouter,
  pension: pensionRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
