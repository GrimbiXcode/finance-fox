import { eq, and, inArray } from "drizzle-orm";
import {
  insuranceAttachments,
  pensionAttachments,
  transactionAttachments,
} from "@db/schema";
import type { Db } from "../queries/connection";
import {
  deleteAttachmentFile,
  writeAttachmentFile,
} from "./attachmentStore";

/**
 * Beleg-/Foto-Anhänge: Metadaten in den *_attachments-Tabellen, die Dateien
 * selbst unter einem Zufallsnamen im Anhang-Speicher (`./attachmentStore.ts`).
 *
 * Dieses Modul spricht ausschließlich die Datenbank an — jeder Dateizugriff
 * läuft über den Speicher daneben. Nur dadurch läuft die komplette
 * Anhang-Logik inklusive der Lösch-Kaskaden unverändert auch in der lokalen
 * Replik im Browser.
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
  // Bewusst ohne node:path: der Originalname kommt vom Client und ist kein
  // Pfad, sondern eine Zeichenkette, aus der nur der letzte Abschnitt und die
  // Endung interessieren. So bleibt das Modul frei von Node-APIs.
  const cleanName = originalName.split(/[\\/]/).pop()?.trim() || "beleg";
  const dot = cleanName.lastIndexOf(".");
  let ext =
    dot > 0 ? cleanName.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  if (!ext || ext.length > 10) ext = ALLOWED_MIME_TYPES[mimeType] ?? "";
  const storedName = `${crypto.randomUUID()}${ext}`;

  writeAttachmentFile(storedName, bytes);
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
  deleteAttachmentFile(row.storedName);
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
  for (const row of rows) deleteAttachmentFile(row.storedName);
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

/* ---------------------- Versicherungs-Anhänge (insurance) ------------------ */

/**
 * Datei speichern + Metadaten-Zeile in insurance_attachments anlegen.
 * Die Existenzprüfung der Police macht der Aufrufer (Hono-Route in boot.ts);
 * einen Besitzcheck gibt es bewusst nicht — das Modul ist haushaltsweit.
 */
export async function saveInsuranceAttachment(
  db: Db,
  policyId: number,
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
    .insert(insuranceAttachments)
    .values({
      policyId,
      storedName,
      originalName: cleanName,
      mimeType,
      sizeBytes: bytes.byteLength,
      createdAt: new Date(),
    })
    .returning({
      id: insuranceAttachments.id,
      originalName: insuranceAttachments.originalName,
      mimeType: insuranceAttachments.mimeType,
      sizeBytes: insuranceAttachments.sizeBytes,
    });
  return inserted[0];
}

/** Einzelnes Versicherungs-Dokument löschen (DB-Zeile + Datei) */
export async function deleteInsuranceAttachment(
  db: Db,
  id: number
): Promise<void> {
  const row = await db.query.insuranceAttachments.findFirst({
    where: eq(insuranceAttachments.id, id),
  });
  if (!row) return;
  await db.delete(insuranceAttachments).where(eq(insuranceAttachments.id, id));
  deleteAttachmentFile(row.storedName);
}

/**
 * Alle Dokumente mehrerer Policen löschen (DB-Zeilen + Dateien) —
 * für Kaskaden bei deletePolicy / resetFinanceData.
 */
export async function deleteInsuranceAttachmentsFor(
  db: Db,
  policyIds: number[]
): Promise<void> {
  if (policyIds.length === 0) return;
  const where = inArray(insuranceAttachments.policyId, policyIds);
  const rows = await db
    .select({ storedName: insuranceAttachments.storedName })
    .from(insuranceAttachments)
    .where(where);
  if (rows.length === 0) return;
  await db.delete(insuranceAttachments).where(where);
  for (const row of rows) deleteAttachmentFile(row.storedName);
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
  deleteAttachmentFile(row.storedName);
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
  for (const row of rows) deleteAttachmentFile(row.storedName);
}
