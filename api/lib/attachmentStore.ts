import fs from "node:fs";
import path from "node:path";

/**
 * Ablage der Anhangs-Dateien (Belege, Vorsorge- und Versicherungs-Dokumente).
 *
 * Bewusst als eigenes, sehr kleines Modul: Es ist der **einzige** Teil der
 * Anhang-Logik, der das Dateisystem braucht. `lib/attachments.ts` daneben
 * arbeitet nur noch auf der Datenbank und läuft damit unverändert auch im
 * Browser — dort wird allein dieses Modul beim Bauen gegen einen
 * IndexedDB-Speicher getauscht (siehe `src/offline/shims/attachmentStore.ts`).
 *
 * Speicherort: Env ATTACHMENTS_DIR, sonst <Verzeichnis der DB-Datei>/attachments
 * (bei In-Memory-DBs ./data/attachments).
 */

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
export function readAttachmentFile(storedName: string): Uint8Array | null {
  try {
    return fs.readFileSync(attachmentFilePath(storedName));
  } catch {
    return null;
  }
}

/** Datei unter dem generierten Namen ablegen */
export function writeAttachmentFile(storedName: string, bytes: Uint8Array) {
  fs.mkdirSync(attachmentsDir(), { recursive: true });
  fs.writeFileSync(attachmentFilePath(storedName), Buffer.from(bytes));
}

/** Datei löschen; ein fehlender Eintrag ist kein Fehler */
export function deleteAttachmentFile(storedName: string) {
  try {
    fs.unlinkSync(attachmentFilePath(storedName));
  } catch {
    // Datei bereits weg — nicht tragisch
  }
}
