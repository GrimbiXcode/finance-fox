import { idbDelete, idbGet, idbSet } from "../db/idb";

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
}

export function deleteAttachmentFile(storedName: string) {
  memory.delete(storedName);
  enqueue(() => idbDelete("blobs", storedName));
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
