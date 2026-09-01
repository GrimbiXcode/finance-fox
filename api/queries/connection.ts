import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { createProxyDb, type Db } from "@db/sqlJsProxy";

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

  instance = createProxyDb(sqlDb, scheduleFlush);
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
  instance = createProxyDb(sqlDb, scheduleFlush);
  scheduleFlush();
}
