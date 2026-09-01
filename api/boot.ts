import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import cron from "node-cron";
import { appRouter } from "./router";
import { registerAttachmentRoutes } from "./attachmentRoutes";
import { registerSyncBlobRoutes } from "./syncBlobRoutes";
import { createContext, getSessionUser, type SessionUser } from "./context";
import { env } from "./lib/env";
import { runRecurringJob } from "./lib/recurringJob";
import { ensureSchema } from "./lib/migrate";
import {
  exportDatabase,
  getDb,
  initDb,
  replaceDatabase,
} from "./queries/connection";
import { appSettings } from "@db/schema";
import { buildSessionCookie } from "./lib/session";
import { REPORT_MONTHS, parseReportSections } from "@contracts/report";
import { TRPC_LIVE_PATH } from "@contracts/offline";
import { collectReport } from "./lib/report/data";
import { renderReportPdf } from "./lib/report/pdf";
import { renderReportXlsx } from "./lib/report/xlsx";
import {
  ensureDevHousehold,
  isEnabled as devLoginEnabled,
  logDevLoginBanner,
  resolveDevUser,
  type DevPersona,
} from "./lib/devLogin";
import { initAttachmentsDir, readAttachmentFile } from "./lib/attachmentStore";

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
  // Nach einem Restore stimmen die Änderungsstände aller Geräte nicht mehr:
  // Die wiederhergestellte Datei bringt ihr eigenes Protokoll mit. Eine neue
  // Epoche zwingt jedes Gerät beim nächsten Abgleich zu einem vollständigen
  // Neuaufbau, statt Deltas gegen eine fremde Zeitlinie zu rechnen.
  await getDb()
    .insert(appSettings)
    .values({ key: "sync_epoch", value: crypto.randomUUID() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: crypto.randomUUID() },
    });
  return c.json({ ok: true });
});

/* ---- Berichts-Export (binär, für jedes Mitglied — außerhalb von tRPC) ---- */

/**
 * PDF- und Excel-Bericht über Konten und ihre Verwendung (Sparziele,
 * Hypotheken, Vorsorge, Versicherungen, Cashflow, Fixkosten,
 * Nettovermögen) — gedacht als Gesprächsgrundlage, etwa bei der Bank.
 *
 * Anders als `/api/backup` **nicht** Admin-only: Der Bericht enthält
 * ausschließlich die Sicht des anfragenden Nutzers. Die Datensammlung ruft
 * dafür dieselben tRPC-Endpunkte auf wie die Oberfläche
 * (`lib/report/data.ts`), damit die Zahlen im Dokument und auf dem
 * Bildschirm nicht auseinanderlaufen können.
 */
async function reportFor(c: Context, user: SessionUser) {
  const url = new URL(c.req.url);
  const sections = parseReportSections(url.searchParams.get("sections"));
  if (sections.length === 0) {
    return {
      error: c.json(
        { error: "Bitte mindestens einen Abschnitt auswählen." },
        400
      ),
    };
  }
  const months = Number(url.searchParams.get("months"));
  const locale = (url.searchParams.get("locale") ?? "de-DE").slice(0, 35);
  const data = await collectReport(
    { req: c.req.raw, resHeaders: new Headers(), user },
    {
      sections,
      months: (REPORT_MONTHS as readonly number[]).includes(months)
        ? months
        : 12,
    }
  );
  return { data, locale };
}

/** Content-Disposition mit Datum im Dateinamen (Muster: /api/backup) */
function downloadHeaders(extension: string, contentType: string) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="finance-fox-bericht-${today}.${extension}"`,
  };
}

app.get("/api/export/bericht.pdf", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const result = await reportFor(c, user);
  if (result.error) return result.error;
  const pdf = renderReportPdf(result.data, result.locale);
  return new Response(pdf, {
    headers: downloadHeaders("pdf", "application/pdf"),
  });
});

app.get("/api/export/bericht.xlsx", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const result = await reportFor(c, user);
  if (result.error) return result.error;
  const xlsx = renderReportXlsx(result.data);
  return new Response(xlsx, {
    headers: downloadHeaders(
      "xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
  });
});

/* ---- Beleg-, Vorsorge- und Versicherungs-Anhänge (binär, außerhalb
       von tRPC) — dieselben Routen laufen in der Offline-Replik, siehe
       api/attachmentRoutes.ts ---- */
registerAttachmentRoutes(app, {
  resolveUser: getSessionUser,
  readFile: async storedName => readAttachmentFile(storedName),
});

// Übertragung der Anhang-Dateien beim Abgleich (siehe api/syncBlobRoutes.ts)
registerSyncBlobRoutes(app, getSessionUser);

/**
 * Derselbe Router unter zwei Pfaden.
 *
 * `/api/trpc/live` ist die Leitung, die **immer** ans Netz geht: Anmeldung,
 * Verwaltung und der Abgleich selbst (`ONLINE_ONLY_PROCEDURES` in
 * `contracts/offline.ts`). `/api/trpc` beantwortet auf Geräten mit
 * Offline-Betrieb der Service Worker aus der lokalen Replik — der Server
 * bedient ihn weiterhin für alle anderen Fälle unverändert.
 *
 * Reihenfolge beachten: Der spezifischere Pfad muss zuerst stehen.
 */
app.use(`${TRPC_LIVE_PATH}/*`, async c =>
  fetchRequestHandler({
    endpoint: TRPC_LIVE_PATH,
    req: c.req.raw,
    router: appRouter,
    createContext,
  })
);

app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
/* ------------------------- Entwicklungs-Login (dev) ----------------------- */

/**
 * Nur montiert, wenn NODE_ENV != production UND DEV_LOGIN=1 (siehe
 * `lib/devLogin.ts`). Stellt ein reguläres, signiertes Session-Cookie aus —
 * der Auth-Pfad bleibt unverändert. In Produktion existiert die Route nicht.
 */
if (devLoginEnabled()) {
  app.get("/api/dev/login", async c => {
    const persona: DevPersona =
      c.req.query("as") === "member" ? "member" : "admin";
    const user = await resolveDevUser(getDb(), persona);
    if (!user) {
      return c.json(
        { error: "Dev-Benutzer konnte nicht angelegt werden." },
        500
      );
    }
    console.warn(
      `[Finance Fox] DEV_LOGIN: Session für „${user.name}" ausgestellt.`
    );
    // Redirect auf die SPA, damit ein Aufruf im Browser direkt in der App landet
    return new Response(null, {
      status: 302,
      headers: {
        Location: c.req.query("to") ?? "/",
        "Set-Cookie": buildSessionCookie(user.id, env.cookieSecure),
      },
    });
  });
}

app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

// Datenbank initialisieren (sql.js/WASM) + Schema sicherstellen — einmalig vor Request-Handling
await initDb();
ensureSchema();
initAttachmentsDir();

// Dev-Login: Identitäten vorbereiten und laut warnen, damit der Modus nie
// unbemerkt läuft.
if (devLoginEnabled()) {
  logDevLoginBanner();
  await ensureDevHousehold(getDb());
}

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
