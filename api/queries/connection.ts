import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { createProxyDb, type Db } from "@db/sqlJsProxy";
import { createIdAllocator, SERVER_ID_SPACE } from "@db/idSpace";

/**
 * SQLite über sql.js (WebAssembly) — kein natives Modul, kein Compile-Step,
 * funktioniert in jeder Build-Umgebung (Docker, Preview, Heimserver).
 *
 * Drizzle wird über einen better-sqlite3-API-kompatiblen Proxy angebunden.
 * Persistenz: nach Schreiboperationen wird die DB als Datei exportiert
 * (DATABASE_URL, Default ./data/finance-fox.db).
 */

/** Re-Export, damit `import type { Db } from "../queries/connection"` bleibt */
export type { Db };

let instance: Db | undefined;
let SQL: SqlJsStatic | undefined;
let sqlDb: Database | undefined;
let dbFilePath: string | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let flushing = false;

/**
 * Der Server vergibt seine IDs aus dem Bereich unterhalb aller Geräteblöcke.
 * Ohne das würden von Geräten gepushte Zeilen den AUTOINCREMENT-Zähler
 * mitziehen und der Server begänne, IDs mitten aus einem Geräteblock zu
 * vergeben (siehe `db/idSpace.ts`).
 */
const ids = createIdAllocator(() => sqlDb, SERVER_ID_SPACE);

function doFlush() {
  if (flushing || !sqlDb || !dbFilePath) return;
  flushing = true;
  try {
    const data = sqlDb.export();
    const tmp = `${dbFilePath}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, dbFilePath);
  } catch (err) {
    console.error("[Finance Fox] Fehler beim Speichern der Datenbank:", err);
  } finally {
    flushing = false;
  }
}

function scheduleFlush() {
  setImmediate(doFlush);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(doFlush, 2000);
}

function registerShutdownHandlers() {
  const shutdown = () => {
    doFlush();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL || "file:./data/finance-fox.db";
  const rawPath = url.replace(/^file:/, "");
  dbFilePath = rawPath === ":memory:" ? undefined : path.resolve(rawPath);

  const sqlJs = await initSqlJs();
  SQL = sqlJs;
  if (dbFilePath) {
    fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    sqlDb = fs.existsSync(dbFilePath)
      ? new sqlJs.Database(fs.readFileSync(dbFilePath))
      : new sqlJs.Database();
  } else {
    sqlDb = new sqlJs.Database();
  }
  sqlDb.run("PRAGMA foreign_keys = ON");

  instance = createProxyDb(sqlDb, scheduleFlush, ids);
  registerShutdownHandlers();
  return instance;
}

const ready = init();

/** Async-Init: einmalig beim Serverstart awaiten */
export async function initDb(): Promise<Db> {
  return ready;
}

/** Synchroner Zugriff nach erfolgtem initDb() */
export function getDb(): Db {
  if (!instance) {
    throw new Error(
      "Datenbank nicht initialisiert — initDb() zuerst aufrufen."
    );
  }
  return instance;
}

/**
 * Läuft diese Datenbank als Offline-Replik auf einem Gerät?
 *
 * Fachlogik soll das normalerweise nicht wissen müssen — genau eine Stelle
 * braucht es doch: Die AHV-Rechnung greift auf die Vorsorgedaten der
 * verknüpften Person zu, und die bleiben bewusst auf dem Server (sie sind
 * privat, der Abgleich überträgt sie nicht). Ohne diese Unterscheidung sähe
 * das auf dem Gerät aus wie „Verknüpfung noch nicht bestätigt" — und die
 * angezeigte Rente wäre stillschweigend zu hoch.
 */
export function isReplica(): boolean {
  return false;
}

/** Nach direkten Schreibzugriffen außerhalb von Drizzle (z. B. ensureSchema) */
export function markDirty() {
  scheduleFlush();
}

/** Vollständiger binärer Export der aktuellen Datenbank (Backup) */
export function exportDatabase(): Uint8Array {
  if (!sqlDb) {
    throw new Error(
      "Datenbank nicht initialisiert — initDb() zuerst aufrufen."
    );
  }
  return sqlDb.export();
}

/**
 * Ersetzt die In-Memory-Datenbank durch hochgeladene Bytes (Restore).
 * Alle getDb()-Nutzer sehen danach die neue DB. Der Aufrufer muss danach
 * ensureSchema() aufrufen (hier bewusst nicht importiert — Zirkelimport mit
 * api/lib/migrate.ts); der Flush wird bereits angestoßen.
 */
export function replaceDatabase(bytes: Uint8Array): void {
  if (!SQL || !sqlDb) {
    throw new Error(
      "Datenbank nicht initialisiert — initDb() zuerst aufrufen."
    );
  }
  sqlDb.close();
  sqlDb = new SQL.Database(bytes);
  sqlDb.run("PRAGMA foreign_keys = ON");
  // Die eingespielte Datei bringt eigene Höchststände mit.
  ids.reset();
  instance = createProxyDb(sqlDb, scheduleFlush, ids);
  scheduleFlush();
}
