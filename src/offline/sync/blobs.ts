import { getDb } from "../db/connection";
import { rawClient } from "../../../api/lib/sync/store";
import {
  markBlobUploaded,
  readAttachmentBlob,
  storeSyncedBlob,
} from "../shims/attachmentStore";
import { loadBlobBudget } from "../state";

/**
 * Anhang-Dateien abgleichen.
 *
 * Die Metadaten der Belege reisen mit dem normalen Zeilen-Abgleich; die
 * Dateien selbst liegen außerhalb der Datenbank und werden hier nachgezogen —
 * über die schmalen Routen aus `api/syncBlobRoutes.ts`, adressiert über den
 * `stored_name`, der auf beiden Seiten derselbe ist.
 *
 * Zwei Richtungen mit unterschiedlicher Dringlichkeit:
 * - **Hoch** muss alles, was offline entstanden ist — sonst wäre der Beleg auf
 *   Dauer nur auf diesem Gerät. Kein Budget, keine Auswahl.
 * - **Runter** kommt so viel, wie das Speicher-Budget hergibt, neueste zuerst.
 *   Ein Haushalt mit Jahren an Belegen soll ein Telefon nicht vollschreiben.
 */

const BLOB_PATH = "/api/sync/blob";

/** Bytes als Anfrage-Body (siehe api/attachmentRoutes.ts) */
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

/** Anhänge aus allen drei Modulen, neueste zuerst */
type AttachmentRow = { stored_name: string; size_bytes: number };

function pendingUploads(): AttachmentRow[] {
  return rawClient(getDb())
    .prepare(
      `SELECT stored_name, size_bytes FROM sync_blobs
        WHERE state = 'pending-upload' ORDER BY touched_at`
    )
    .all() as unknown as AttachmentRow[];
}

/** Dateien, die es hier noch nicht gibt — neueste zuerst */
function missingBlobs(): AttachmentRow[] {
  return rawClient(getDb())
    .prepare(
      `SELECT stored_name, size_bytes FROM (
         SELECT stored_name, size_bytes, created_at FROM transaction_attachments
         UNION ALL
         SELECT stored_name, size_bytes, created_at FROM pension_attachments
         UNION ALL
         SELECT stored_name, size_bytes, created_at FROM insurance_attachments
       )
       WHERE stored_name NOT IN (SELECT stored_name FROM sync_blobs)
       ORDER BY created_at DESC`
    )
    .all() as unknown as AttachmentRow[];
}

/** Belegter Speicher der bereits vorhandenen Dateien */
export function blobBytesStored(): number {
  return Number(
    rawClient(getDb())
      .prepare(
        // `lost` zählt nicht mit: Diese Dateien liegen hier gerade nicht mehr.
        "SELECT IFNULL(SUM(size_bytes), 0) AS n FROM sync_blobs WHERE state <> 'lost'"
      )
      .get()?.n ?? 0
  );
}

export function blobCount(): number {
  return Number(
    rawClient(getDb())
      .prepare("SELECT COUNT(*) AS n FROM sync_blobs WHERE state <> 'lost'")
      .get()?.n ?? 0
  );
}

/**
 * Belege, deren Datei auf diesem Gerät verloren ging, bevor sie beim
 * Heimserver ankam. Sie sind nicht mehr zu retten — aber der Haushalt muss
 * davon erfahren, statt eine Liste mit leeren Belegen vorzufinden.
 */
export function lostBlobCount(): number {
  return Number(
    rawClient(getDb())
      .prepare("SELECT COUNT(*) AS n FROM sync_blobs WHERE state = 'lost'")
      .get()?.n ?? 0
  );
}

/**
 * Dateien in beide Richtungen abgleichen. Liefert true, wenn sich lokal etwas
 * geändert hat.
 */
export async function syncBlobs(): Promise<boolean> {
  let changed = false;

  for (const row of pendingUploads()) {
    const bytes = await readAttachmentBlob(row.stored_name);
    if (!bytes) {
      // Die Datei ist hier verschwunden, bevor sie je beim Heimserver ankam
      // (Speicher geräumt, Schreibvorgang fehlgeschlagen). Den Vermerk dafür
      // einfach zu löschen wäre das Schlimmste: Die Metadaten-Zeile reist
      // trotzdem hinüber, der Beleg stünde überall in der Liste — und niemand
      // erführe je, dass hinter ihm keine Datei mehr steckt. Also als `lost`
      // festhalten; `lostBlobCount()` bringt es in die Abgleich-Anzeige.
      rawClient(getDb())
        .prepare("UPDATE sync_blobs SET state = 'lost' WHERE stored_name = ?")
        .run(row.stored_name);
      changed = true;
      continue;
    }
    const res = await fetch(
      `${BLOB_PATH}?name=${encodeURIComponent(row.stored_name)}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: asBody(bytes),
      }
    );
    // 404 heißt: Die Metadaten-Zeile ist noch nicht angekommen oder der Beleg
    // wurde inzwischen gelöscht. Beim nächsten Durchgang erneut versuchen.
    if (res.ok) {
      markBlobUploaded(row.stored_name, bytes.byteLength);
      changed = true;
    }
  }

  const budget = await loadBlobBudget();
  if (budget > 0) {
    let used = blobBytesStored();
    for (const row of missingBlobs()) {
      // `continue`, nicht `break`: Eine große Datei, die nicht mehr ins
      // Budget passt, darf nicht alle kleineren dahinter blockieren.
      if (used + row.size_bytes > budget) continue;
      const res = await fetch(
        `${BLOB_PATH}?name=${encodeURIComponent(row.stored_name)}`,
        { credentials: "include" }
      );
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      storeSyncedBlob(row.stored_name, bytes);
      used += bytes.byteLength;
      changed = true;
    }
  }

  return changed;
}
