import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
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
import { transactionAttachments, transactions } from "@db/schema";
import { requireAccountAccess, type AccessLevel } from "./lib/accountAccess";
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  initAttachmentsDir,
  readAttachmentFile,
  saveAttachment,
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

/* ---- Beleg-Anhänge (binär, Konto-Rechte statt Admin — außerhalb von tRPC) ---- */

/** TRPCError aus den Zugriffs-Helpern als HTTP-Antwort mappen */
function accessErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof TRPCError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 400;
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
      { error: "Nur Bilder (JPEG, PNG, WebP, GIF) oder PDF-Dateien sind erlaubt." },
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
  const asciiName = row.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
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
initAttachmentsDir();

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
