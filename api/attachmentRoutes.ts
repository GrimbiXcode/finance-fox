import type { Context, Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  insuranceAttachments,
  insurancePolicies,
  pensionAhv,
  pensionAttachments,
  pensionFunds,
  pensionPillar3,
  transactionAttachments,
} from "@db/schema";
import { getDb } from "./queries/connection";
import type { SessionUser } from "./context";
import {
  requireTransactionAccess,
  type AccessLevel,
} from "./lib/accountAccess";
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  deleteInsuranceAttachment,
  deletePensionAttachment,
  saveAttachment,
  saveInsuranceAttachment,
  savePensionAttachment,
} from "./lib/attachments";

/**
 * Die binären Routen für Beleg-, Vorsorge- und Versicherungs-Anhänge.
 *
 * Sie stehen bewusst außerhalb von tRPC (rohe Dateibytes) — und bewusst in
 * einer eigenen Datei statt in `boot.ts`: Dieselben Routen laufen in der
 * Offline-Replik im Service Worker, nur mit zwei anderen Zutaten. Deshalb
 * kommen die beiden plattformabhängigen Teile als Parameter herein:
 *
 * - `resolveUser` — auf dem Server aus dem Session-Cookie, in der Replik aus
 *   der gespeicherten Identität (ein Worker kann HttpOnly-Cookies nicht lesen).
 * - `readFile` — auf dem Server aus dem Dateisystem, in der Replik aus
 *   IndexedDB (und deshalb asynchron).
 *
 * Alles andere — Rechteprüfung, erlaubte Dateitypen, Größengrenze,
 * Fehlermeldungen — ist identisch und wird nur einmal gepflegt.
 */
/**
 * Bytes als Antwort-Body. Der Umweg über den ArrayBuffer ist nötig, weil
 * dieselbe Datei in zwei Umgebungen übersetzt wird (Node und Service Worker)
 * und `BodyInit` dort verschieden streng ist.
 */
function asBody(bytes: Uint8Array): ArrayBuffer {
  // Bewusst immer eine Kopie des exakten Ausschnitts: Node liefert für
  // Dateien `Buffer`, und die sind oft nur ein Fenster auf einen größeren,
  // gemeinsam genutzten Speicherblock. `bytes.buffer` wäre dann der ganze
  // Block — die Antwort enthielte fremde Bytes.
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

export type AttachmentRouteDeps = {
  resolveUser: (req: Request) => Promise<SessionUser | undefined>;
  readFile: (storedName: string) => Promise<Uint8Array | null>;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyApp = Hono<any, any, any>;

export function registerAttachmentRoutes(
  app: AnyApp,
  deps: AttachmentRouteDeps
) {
  const getSessionUser = deps.resolveUser;
  const readAttachmentFile = deps.readFile;

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
    minLevel: AccessLevel,
    notFound = "Buchung nicht gefunden."
  ) {
    const db = getDb();
    // Unsichtbare Buchungen antworten wie fehlende (requireTransactionAccess);
    // bei Beleg-IDs mit derselben Meldung wie ein fehlender Beleg
    try {
      return await requireTransactionAccess(
        db,
        user,
        transactionId,
        minLevel === "edit" ? "edit" : "view"
      );
    } catch (err) {
      if (err instanceof TRPCError && err.code === "NOT_FOUND") {
        return c.json({ error: notFound }, 404);
      }
      return accessErrorResponse(c, err);
    }
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
    const txRow = await loadAttachmentTx(
      c,
      user,
      row.transactionId,
      "view",
      "Beleg nicht gefunden."
    );
    if (!txRow) return c.json({ error: "Beleg nicht gefunden." }, 404);
    if (txRow instanceof Response) return txRow;

    const data = await readAttachmentFile(row.storedName);
    if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
    const asciiName = row.originalName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/"/g, "'");
    return new Response(asBody(data), {
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
    const txRow = await loadAttachmentTx(
      c,
      user,
      row.transactionId,
      "edit",
      "Beleg nicht gefunden."
    );
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
    const data = await readAttachmentFile(row.storedName);
    if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
    const asciiName = row.originalName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/"/g, "'");
    return new Response(asBody(data), {
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
    const data = await readAttachmentFile(row.storedName);
    if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
    const asciiName = row.originalName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/"/g, "'");
    return new Response(asBody(data), {
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
}
