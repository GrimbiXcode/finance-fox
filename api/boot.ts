import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import cron from "node-cron";
import { appRouter } from "./router";
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
import {
  insuranceAttachments,
  insurancePolicies,
  pensionAhv,
  pensionAttachments,
  pensionFunds,
  pensionPillar3,
  transactionAttachments,
  transactions,
} from "@db/schema";
import { requireAccountAccess, type AccessLevel } from "./lib/accountAccess";
import { buildSessionCookie } from "./lib/session";
import { REPORT_MONTHS, parseReportSections } from "@contracts/report";
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
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  deleteInsuranceAttachment,
  deletePensionAttachment,
  initAttachmentsDir,
  readAttachmentFile,
  saveAttachment,
  saveInsuranceAttachment,
  savePensionAttachment,
} from "./lib/attachments";

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

/* ---- Beleg-Anhänge (binär, Konto-Rechte statt Admin — außerhalb von tRPC) ---- */

/** TRPCError aus den Zugriffs-Helpern als HTTP-Antwort mappen */
function accessErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof TRPCError) {
    const status =
      err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: err.message }, status);
  }
  throw err;
}

/**
 * Buchung + Konto des Belegs laden und die Zugriffsstufe prüfen.
 * Gibt null zurück (Antwort bereits gesendet), wenn etwas fehlt.
 */
async function loadAttachmentTx(
  c: Context,
  user: SessionUser,
  transactionId: number,
  minLevel: AccessLevel
) {
  const db = getDb();
  const txRow = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
  });
  if (!txRow) return null;
  try {
    await requireAccountAccess(db, user, txRow.accountId, minLevel);
  } catch (err) {
    return accessErrorResponse(c, err);
  }
  return txRow;
}

// Upload: rohe Dateibytes; Originalname URL-kodiert im X-Filename-Header,
// MIME-Typ im Content-Type-Header.
app.post("/api/attachments", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const transactionId = Number(c.req.query("transactionId"));
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return c.json({ error: "Ungültige transactionId." }, 400);
  }
  const txRow = await loadAttachmentTx(c, user, transactionId, "edit");
  if (!txRow) return c.json({ error: "Buchung nicht gefunden." }, 404);
  if (txRow instanceof Response) return txRow;

  const mimeType = (c.req.header("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!(mimeType in ALLOWED_MIME_TYPES)) {
    return c.json(
      {
        error:
          "Nur Bilder (JPEG, PNG, WebP, GIF) oder PDF-Dateien sind erlaubt.",
      },
      400
    );
  }
  let originalName = "beleg";
  const filenameHeader = c.req.header("x-filename");
  if (filenameHeader) {
    try {
      originalName = decodeURIComponent(filenameHeader);
    } catch {
      // fehlerhafte Kodierung → Fallback-Name
    }
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return c.json({ error: "Die Datei ist leer." }, 400);
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "Die Datei ist zu groß (maximal 10 MB)." }, 413);
  }
  const meta = await saveAttachment(
    getDb(),
    transactionId,
    bytes,
    originalName,
    mimeType
  );
  return c.json(meta, 201);
});

// Download/Anzeige: „view" auf dem Konto der zugehörigen Buchung reicht.
app.get("/api/attachments/:id", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Ungültige Beleg-ID." }, 400);
  }
  const row = await getDb().query.transactionAttachments.findFirst({
    where: eq(transactionAttachments.id, id),
  });
  if (!row) return c.json({ error: "Beleg nicht gefunden." }, 404);
  const txRow = await loadAttachmentTx(c, user, row.transactionId, "view");
  if (!txRow) return c.json({ error: "Beleg nicht gefunden." }, 404);
  if (txRow instanceof Response) return txRow;

  const data = readAttachmentFile(row.storedName);
  if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
  const asciiName = row.originalName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "'");
  return new Response(data, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      "Content-Length": String(data.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// Löschen: erfordert „edit" auf dem Konto der zugehörigen Buchung.
app.delete("/api/attachments/:id", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Ungültige Beleg-ID." }, 400);
  }
  const row = await getDb().query.transactionAttachments.findFirst({
    where: eq(transactionAttachments.id, id),
  });
  if (!row) return c.json({ error: "Beleg nicht gefunden." }, 404);
  const txRow = await loadAttachmentTx(c, user, row.transactionId, "edit");
  if (!txRow) return c.json({ error: "Beleg nicht gefunden." }, 404);
  if (txRow instanceof Response) return txRow;

  await deleteAttachment(getDb(), id);
  return c.json({ ok: true });
});

/* ---- Vorsorge-Anhänge (binär, strikt privat pro Benutzer — außerhalb von tRPC) ---- */

/**
 * Ziel-Datensatz eines Vorsorge-Anhangs laden; er muss existieren und dem
 * angemeldeten Benutzer gehören (sonst null → 404, kein Existenz-Leak).
 */
async function loadPensionEntity(
  user: SessionUser,
  entityType: "ahv" | "fund" | "pillar3",
  entityId: number
): Promise<boolean> {
  const db = getDb();
  if (entityType === "ahv") {
    const row = await db.query.pensionAhv.findFirst({
      where: and(eq(pensionAhv.id, entityId), eq(pensionAhv.userId, user.id)),
    });
    return !!row;
  }
  if (entityType === "fund") {
    const row = await db.query.pensionFunds.findFirst({
      where: and(
        eq(pensionFunds.id, entityId),
        eq(pensionFunds.userId, user.id)
      ),
    });
    return !!row;
  }
  const row = await db.query.pensionPillar3.findFirst({
    where: and(
      eq(pensionPillar3.id, entityId),
      eq(pensionPillar3.userId, user.id)
    ),
  });
  return !!row;
}

// Upload: rohe Dateibytes; Originalname URL-kodiert im X-Filename-Header,
// MIME-Typ im Content-Type-Header. Gleiche Constraints wie bei Belegen.
app.post("/api/pension-attachments", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const entityType = c.req.query("entityType");
  if (
    entityType !== "ahv" &&
    entityType !== "fund" &&
    entityType !== "pillar3"
  ) {
    return c.json({ error: "Ungültiger entityType." }, 400);
  }
  const entityId = Number(c.req.query("entityId"));
  if (!Number.isInteger(entityId) || entityId <= 0) {
    return c.json({ error: "Ungültige entityId." }, 400);
  }
  if (!(await loadPensionEntity(user, entityType, entityId))) {
    return c.json({ error: "Datensatz nicht gefunden." }, 404);
  }

  const mimeType = (c.req.header("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!(mimeType in ALLOWED_MIME_TYPES)) {
    return c.json(
      {
        error:
          "Nur Bilder (JPEG, PNG, WebP, GIF) oder PDF-Dateien sind erlaubt.",
      },
      400
    );
  }
  let originalName = "beleg";
  const filenameHeader = c.req.header("x-filename");
  if (filenameHeader) {
    try {
      originalName = decodeURIComponent(filenameHeader);
    } catch {
      // fehlerhafte Kodierung → Fallback-Name
    }
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return c.json({ error: "Die Datei ist leer." }, 400);
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "Die Datei ist zu groß (maximal 10 MB)." }, 413);
  }
  const meta = await savePensionAttachment(
    getDb(),
    { userId: user.id, entityType, entityId },
    bytes,
    originalName,
    mimeType
  );
  return c.json(meta, 201);
});

// Download/Anzeige: nur der Besitzer des Anhangs.
app.get("/api/pension-attachments/:id", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Ungültige Anhang-ID." }, 400);
  }
  const row = await getDb().query.pensionAttachments.findFirst({
    where: eq(pensionAttachments.id, id),
  });
  if (!row || row.userId !== user.id) {
    return c.json({ error: "Anhang nicht gefunden." }, 404);
  }
  const data = readAttachmentFile(row.storedName);
  if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
  const asciiName = row.originalName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "'");
  return new Response(data, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      "Content-Length": String(data.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// Löschen: nur der Besitzer des Anhangs.
app.delete("/api/pension-attachments/:id", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Ungültige Anhang-ID." }, 400);
  }
  const row = await getDb().query.pensionAttachments.findFirst({
    where: eq(pensionAttachments.id, id),
  });
  if (!row || row.userId !== user.id) {
    return c.json({ error: "Anhang nicht gefunden." }, 404);
  }
  await deletePensionAttachment(getDb(), id);
  return c.json({ ok: true });
});

/* --------------------- Versicherungs-Dokumente (binär) -------------------- */

/**
 * Anders als bei der Vorsorge gibt es hier **keinen** Besitzcheck: Das
 * Versicherungs-Modul ist haushaltsweit, jedes angemeldete Mitglied darf die
 * Dokumente einer Police hoch- und herunterladen (siehe db/schema.ts).
 */
app.post("/api/insurance-attachments", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const policyId = Number(c.req.query("policyId"));
  if (!Number.isInteger(policyId) || policyId <= 0) {
    return c.json({ error: "Ungültige policyId." }, 400);
  }
  const policy = await getDb().query.insurancePolicies.findFirst({
    where: eq(insurancePolicies.id, policyId),
  });
  if (!policy) return c.json({ error: "Police nicht gefunden." }, 404);

  const mimeType = (c.req.header("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!(mimeType in ALLOWED_MIME_TYPES)) {
    return c.json(
      {
        error:
          "Nur Bilder (JPEG, PNG, WebP, GIF) oder PDF-Dateien sind erlaubt.",
      },
      400
    );
  }
  let originalName = "police";
  const filenameHeader = c.req.header("x-filename");
  if (filenameHeader) {
    try {
      originalName = decodeURIComponent(filenameHeader);
    } catch {
      // fehlerhafte Kodierung → Fallback-Name
    }
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return c.json({ error: "Die Datei ist leer." }, 400);
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "Die Datei ist zu groß (maximal 10 MB)." }, 413);
  }
  const meta = await saveInsuranceAttachment(
    getDb(),
    policyId,
    bytes,
    originalName,
    mimeType
  );
  return c.json(meta, 201);
});

app.get("/api/insurance-attachments/:id", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Ungültige Anhang-ID." }, 400);
  }
  const row = await getDb().query.insuranceAttachments.findFirst({
    where: eq(insuranceAttachments.id, id),
  });
  if (!row) return c.json({ error: "Anhang nicht gefunden." }, 404);
  const data = readAttachmentFile(row.storedName);
  if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
  const asciiName = row.originalName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "'");
  return new Response(data, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      "Content-Length": String(data.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.delete("/api/insurance-attachments/:id", async c => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Ungültige Anhang-ID." }, 400);
  }
  const row = await getDb().query.insuranceAttachments.findFirst({
    where: eq(insuranceAttachments.id, id),
  });
  if (!row) return c.json({ error: "Anhang nicht gefunden." }, 404);
  await deleteInsuranceAttachment(getDb(), id);
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
      return c.json({ error: "Dev-Benutzer konnte nicht angelegt werden." }, 500);
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
