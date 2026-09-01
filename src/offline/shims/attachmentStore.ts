import { idbDelete, idbGet, idbSet } from "../db/idb";
import { getDb } from "../db/connection";
import { rawClient } from "../../../api/lib/sync/store";

/**
 * Ersatz für `api/lib/attachmentStore.ts` in der lokalen Replik: Statt
 * einzelner Dateien im Dateisystem liegen die Anhänge als Bytes in IndexedDB,
 * abgelegt unter demselben `storedName`, den auch der Server vergibt. Die
 * Metadaten-Zeilen in der Datenbank passen dadurch auf beiden Seiten
 * unverändert zusammen.
 *
 * Der Haken: Das Original ist synchron, IndexedDB ist es nicht. Schreiben und
 * Löschen landen deshalb sofort in einer Map im Speicher und werden von dort
 * asynchron nachgezogen; `flushAttachmentWrites()` wartet darauf und wird vom
 * lokalen Router vor der Antwort auf eine Mutation aufgerufen. Gelesen wird
 * offline ausschließlich über `readAttachmentBlob()` — die synchrone Variante
 * bedient nur die Hono-Routen des Servers, die hier gar nicht mitlaufen.
 */

/** Zuletzt geschriebene/gelesene Bytes, damit die sync-API etwas liefern kann */
const memory = new Map<string, Uint8Array>();

/** Laufende Schreib-/Löschvorgänge nach IndexedDB */
let pending: Promise<unknown> = Promise.resolve();

function enqueue(task: () => Promise<unknown>) {
  pending = pending.then(task, task).catch(err => {
    console.error("[Finance Fox] Anhang nicht gespeichert:", err);
  });
}

/** Auf alle ausstehenden Anhang-Schreibvorgänge warten */
export async function flushAttachmentWrites(): Promise<void> {
  await pending;
}

/**
 * Zustand einer Datei vermerken. `pending-upload` heißt: Sie ist hier
 * entstanden und muss beim nächsten Abgleich zum Heimserver; `present` heißt:
 * Sie liegt hier **und** dort. Ohne diesen Vermerk wüsste der Abgleich nicht,
 * welche Dateien noch fehlen — die Metadaten-Zeile sagt darüber nichts.
 */
function noteBlob(
  storedName: string,
  state: "pending-upload" | "present",
  sizeBytes: number
) {
  try {
    rawClient(getDb())
      .prepare(
        `INSERT INTO sync_blobs (stored_name, state, size_bytes, touched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (stored_name) DO UPDATE SET
           state = excluded.state, size_bytes = excluded.size_bytes,
           touched_at = excluded.touched_at`
      )
      .run(storedName, state, sizeBytes, Date.now());
  } catch (err) {
    console.error("[Finance Fox] Anhang-Zustand nicht vermerkt:", err);
  }
}

/** Datei vom Heimserver übernehmen (kein Upload nötig) */
export function storeSyncedBlob(storedName: string, bytes: Uint8Array) {
  memory.set(storedName, bytes);
  enqueue(() => idbSet("blobs", storedName, bytes));
  noteBlob(storedName, "present", bytes.byteLength);
}

/** Datei ist beim Heimserver angekommen */
export function markBlobUploaded(storedName: string, sizeBytes: number) {
  noteBlob(storedName, "present", sizeBytes);
}

/** Bytes eines Anhangs — erst aus dem Speicher, sonst aus IndexedDB */
export async function readAttachmentBlob(
  storedName: string
): Promise<Uint8Array | null> {
  const cached = memory.get(storedName);
  if (cached) return cached;
  const stored = await idbGet<Uint8Array>("blobs", storedName);
  if (!stored) return null;
  memory.set(storedName, stored);
  return stored;
}

/** Nur der Vollständigkeit halber — offline gibt es kein Verzeichnis */
export function attachmentsDir(): string {
  return "indexeddb:blobs";
}

/** Auf dem Server legt das ein Verzeichnis an; hier gibt es nichts zu tun */
export function initAttachmentsDir() {
  // absichtlich leer
}

export function attachmentFilePath(storedName: string): string {
  return `indexeddb:blobs/${storedName}`;
}

/**
 * Synchrones Lesen kann IndexedDB nicht — offline läuft jeder Lesezugriff
 * über `readAttachmentBlob()`. Bleibt hier, damit die Signatur passt.
 */
export function readAttachmentFile(storedName: string): Uint8Array | null {
  return memory.get(storedName) ?? null;
}

export function writeAttachmentFile(storedName: string, bytes: Uint8Array) {
  memory.set(storedName, bytes);
  enqueue(() => idbSet("blobs", storedName, bytes));
  // Hier entstanden — muss beim nächsten Abgleich zum Heimserver.
  noteBlob(storedName, "pending-upload", bytes.byteLength);
}

export function deleteAttachmentFile(storedName: string) {
  memory.delete(storedName);
  enqueue(() => idbDelete("blobs", storedName));
  try {
    rawClient(getDb())
      .prepare("DELETE FROM sync_blobs WHERE stored_name = ?")
      .run(storedName);
  } catch {
    // Datenbank noch nicht bereit — der Vermerk ist dann ohnehin keiner.
  }
}

const __surfaceCheck: typeof import("../../../api/lib/attachmentStore") = {
  attachmentsDir,
  initAttachmentsDir,
  attachmentFilePath,
  readAttachmentFile,
  writeAttachmentFile,
  deleteAttachmentFile,
};
void __surfaceCheck;
