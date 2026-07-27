import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import cron from "node-cron";
import { appRouter } from "./router";
import { createContext, getSessionUser } from "./context";
import { env } from "./lib/env";
import { runRecurringJob } from "./lib/recurringJob";
import { ensureSchema } from "./lib/migrate";
import { exportDatabase, initDb, replaceDatabase } from "./queries/connection";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

/* ---- Backup/Restore (Admin-only, binär — bewusst außerhalb von tRPC) ---- */

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf-8");

app.get("/api/backup", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Nur für Administratoren." }, 403);
  }
  const bytes = exportDatabase();
  const today = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="finance-fox-backup-${today}.db"`,
    },
  });
});

app.post("/api/backup/restore", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Nur für Administratoren." }, 403);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const header = Buffer.from(bytes.subarray(0, SQLITE_HEADER.length));
  if (!header.equals(SQLITE_HEADER)) {
    return c.json(
      {
        error: "Die hochgeladene Datei ist keine gültige SQLite-Datenbank.",
      },
      400
    );
  }
  replaceDatabase(bytes);
  ensureSchema();
  return c.json({ ok: true });
});

app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

// Datenbank initialisieren (sql.js/WASM) + Schema sicherstellen — einmalig vor Request-Handling
await initDb();
ensureSchema();

// Tägliche Verbuchung wiederkehrender Transaktionen (03:00 Uhr Serverzeit)
// + einmalig beim Start, damit nichts liegen bleibt.
cron.schedule("0 3 * * *", () => {
  runRecurringJob().catch(err =>
    console.error("[Finance Fox] Cron-Fehler:", err)
  );
});
runRecurringJob().catch(err =>
  console.error("[Finance Fox] Cron-Startlauf-Fehler:", err)
);

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
