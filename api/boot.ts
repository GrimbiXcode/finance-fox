import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import cron from "node-cron";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { runRecurringJob } from "./lib/recurringJob";
import { ensureSchema } from "./lib/migrate";
import { initDb } from "./queries/connection";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Datenbank initialisieren (sql.js/WASM) + Schema sicherstellen — einmalig vor Request-Handling
await initDb();
ensureSchema();

// Tägliche Verbuchung wiederkehrender Transaktionen (03:00 Uhr Serverzeit)
// + einmalig beim Start, damit nichts liegen bleibt.
cron.schedule("0 3 * * *", () => {
  runRecurringJob().catch((err) => console.error("[Finance Fox] Cron-Fehler:", err));
});
runRecurringJob().catch((err) => console.error("[Finance Fox] Cron-Startlauf-Fehler:", err));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
