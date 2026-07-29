import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, and, inArray } from "drizzle-orm";
import { pensionAttachments, transactionAttachments } from "@db/schema";
import type { Db } from "../queries/connection";

/**
 * Beleg-/Foto-Anhänge: Metadaten in der Tabelle transaction_attachments,
 * Dateien als einzelne Dateien mit Zufallsnamen im Attachments-Verzeichnis.
 * Speicherort: Env ATTACHMENTS_DIR, sonst <Verzeichnis der DB-Datei>/attachments
 * (bei In-Memory-DBs ./data/attachments).
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Erlaubte Upload-Typen: gängige Bildformate + PDF */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

/** Auflösung des Speicherorts (lazy, damit Tests ATTACHMENTS_DIR setzen können) */
export function attachmentsDir(): string {
  if (process.env.ATTACHMENTS_DIR) {
    return path.resolve(process.env.ATTACHMENTS_DIR);
  }
  const url = process.env.DATABASE_URL || "file:./data/finance-fox.db";
  const rawPath = url.replace(/^file:/, "");
  if (rawPath === ":memory:") return path.resolve("./data/attachments");
  return path.join(path.dirname(path.resolve(rawPath)), "attachments");
}

/** Verzeichnis beim Serverstart anlegen (idempotent) */
export function initAttachmentsDir() {
  fs.mkdirSync(attachmentsDir(), { recursive: true });
}

/** Absoluter Pfad zu einer gespeicherten Datei */
export function attachmentFilePath(storedName: string): string {
  // storedName ist serverseitig generiert; basename schützt zusätzlich vor
  // Pfad-Manipulation, falls die DB einmal von außen verändert wurde.
  return path.join(attachmentsDir(), path.basename(storedName));
}

/** Datei lesen; null, wenn sie auf der Platte fehlt */
export function readAttachmentFile(storedName: string): Buffer | null {
  try {
    return fs.readFileSync(attachmentFilePath(storedName));
  } catch {
    return null;
  }
}

function unlinkQuiet(storedName: string) {
  try {
    fs.unlinkSync(attachmentFilePath(storedName));
  } catch {
    // Datei bereits weg — nicht tragisch
  }
}

export type AttachmentMeta = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Datei unter einem Zufallsnamen (UUID) ins Attachments-Verzeichnis schreiben;
 * Endung aus dem Originalnamen (Fallback: Endung passend zum MIME-Typ).
 * Gemeinsamer Speicherschritt für Beleg- und Vorsorge-Anhänge.
 */
function storeAttachmentFile(
  bytes: Uint8Array,
  originalName: string,
  mimeType: string
): { storedName: string; cleanName: string } {
  const cleanName = path.basename(originalName).trim() || "beleg";
  let ext = path
    .extname(cleanName)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  if (!ext || ext.length > 10) ext = ALLOWED_MIME_TYPES[mimeType] ?? "";
  const storedName = `${crypto.randomUUID()}${ext}`;

  fs.mkdirSync(attachmentsDir(), { recursive: true });
  fs.writeFileSync(attachmentFilePath(storedName), Buffer.from(bytes));
  return { storedName, cleanName };
}

/**
 * Datei speichern + Metadaten-Zeile anlegen.
 * Dateiname: Zufallsname (UUID) mit Endung aus dem Originalnamen
 * (Fallback: Endung passend zum MIME-Typ).
 */
export async function saveAttachment(
  db: Db,
  transactionId: number,
  bytes: Uint8Array,
  originalName: string,
  mimeType: string
): Promise<AttachmentMeta> {
  const { storedName, cleanName } = storeAttachmentFile(
    bytes,
    originalName,
    mimeType
  );

  const inserted = await db
    .insert(transactionAttachments)
    .values({
      transactionId,
      storedName,
      originalName: cleanName,
      mimeType,
      sizeBytes: bytes.byteLength,
      createdAt: new Date(),
    })
    .returning({
      id: transactionAttachments.id,
      originalName: transactionAttachments.originalName,
      mimeType: transactionAttachments.mimeType,
      sizeBytes: transactionAttachments.sizeBytes,
    });
  return inserted[0];
}

/** Einzelnen Beleg löschen (DB-Zeile + Datei) */
export async function deleteAttachment(db: Db, id: number): Promise<void> {
  const row = await db.query.transactionAttachments.findFirst({
    where: eq(transactionAttachments.id, id),
  });
  if (!row) return;
  await db
    .delete(transactionAttachments)
    .where(eq(transactionAttachments.id, id));
  unlinkQuiet(row.storedName);
}

/**
 * Alle Belege mehrerer Buchungen löschen (DB-Zeilen + Dateien) —
 * für Kaskaden bei deleteTransaction / deleteAccount / resetFinanceData.
 */
export async function deleteAttachmentsForTransactions(
  db: Db,
  txIds: number[]
): Promise<void> {
  if (txIds.length === 0) return;
  const rows = await db
    .select({ storedName: transactionAttachments.storedName })
    .from(transactionAttachments)
    .where(inArray(transactionAttachments.transactionId, txIds));
  if (rows.length === 0) return;
  await db
    .delete(transactionAttachments)
    .where(inArray(transactionAttachments.transactionId, txIds));
  for (const row of rows) unlinkQuiet(row.storedName);
}

/* ------------------------- Vorsorge-Anhänge (pension) --------------------- */

/**
 * Datei speichern + Metadaten-Zeile in pension_attachments anlegen.
 * Die Besitz-/Existenzprüfung des Ziel-Datensatzes macht der Aufrufer
 * (Hono-Route in boot.ts).
 */
export async function savePensionAttachment(
  db: Db,
  target: {
    userId: number;
    entityType: "ahv" | "fund" | "pillar3";
    entityId: number;
  },
  bytes: Uint8Array,
  originalName: string,
  mimeType: string
): Promise<AttachmentMeta> {
  const { storedName, cleanName } = storeAttachmentFile(
    bytes,
    originalName,
    mimeType
  );

  const inserted = await db
    .insert(pensionAttachments)
    .values({
      userId: target.userId,
      entityType: target.entityType,
      entityId: target.entityId,
      storedName,
      originalName: cleanName,
      mimeType,
      sizeBytes: bytes.byteLength,
      createdAt: new Date(),
    })
    .returning({
      id: pensionAttachments.id,
      originalName: pensionAttachments.originalName,
      mimeType: pensionAttachments.mimeType,
      sizeBytes: pensionAttachments.sizeBytes,
    });
  return inserted[0];
}

/** Einzelnen Vorsorge-Anhang löschen (DB-Zeile + Datei) */
export async function deletePensionAttachment(
  db: Db,
  id: number
): Promise<void> {
  const row = await db.query.pensionAttachments.findFirst({
    where: eq(pensionAttachments.id, id),
  });
  if (!row) return;
  await db.delete(pensionAttachments).where(eq(pensionAttachments.id, id));
  unlinkQuiet(row.storedName);
}

/**
 * Alle Vorsorge-Anhänge mehrerer Datensätze eines Typs löschen
 * (DB-Zeilen + Dateien) — für Kaskaden bei deleteFund / deletePillar3.
 */
export async function deletePensionAttachmentsFor(
  db: Db,
  entityType: "ahv" | "fund" | "pillar3",
  entityIds: number[]
): Promise<void> {
  if (entityIds.length === 0) return;
  const where = and(
    eq(pensionAttachments.entityType, entityType),
    inArray(pensionAttachments.entityId, entityIds)
  );
  const rows = await db
    .select({ storedName: pensionAttachments.storedName })
    .from(pensionAttachments)
    .where(where);
  if (rows.length === 0) return;
  await db.delete(pensionAttachments).where(where);
  for (const row of rows) unlinkQuiet(row.storedName);
}
