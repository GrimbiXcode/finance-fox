import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { createProxyDb, type Db } from "@db/sqlJsProxy";
import { createIdAllocator, deviceIdSpace, SERVER_ID_SPACE } from "@db/idSpace";
import { idbGet, idbSet } from "./idb";

/**
 * Die lokale Replik: dieselbe SQLite-Datenbank wie auf dem Heimserver, nur im
 * Browser.
 *
 * Dieses Modul ist der browserseitige Zwilling von
 * `api/queries/connection.ts` und wird beim Bauen des Service Workers an
 * dessen Stelle gesetzt (siehe `scripts/build-sw.mjs`). Es muss deshalb genau
 * dieselben Namen exportieren — der Compile-Time-Check am Ende der Datei hält
 * das fest, damit ein neuer Export drüben hier nicht stillschweigend fehlt.
 *
 * Unterschied zum Server: Statt einer Datei liegt das DB-Abbild in IndexedDB.
 * Geschrieben wird es gebündelt (Debounce) — und vor der Antwort auf jede
 * Mutation zusätzlich einmal hart, weil ein Service Worker jederzeit beendet
 * werden darf (`flushDatabase`).
 */

const STORAGE_KEY = "database";

/** Der Server exportiert `Db` aus derselben Datei — hier genauso. */
export type { Db };

let instance: Db | undefined;
let SQL: SqlJsStatic | undefined;
let sqlDb: Database | undefined;
let ready: Promise<Db> | undefined;

/**
 * Bis der erste Abgleich den Geräteblock geliefert hat, gilt der Zahlenraum
 * des Servers — vor dem Abgleich legt die Replik ohnehin nichts an, und ein
 * falscher Raum wäre schlimmer als ein vorläufiger (siehe `db/idSpace.ts`).
 */
const ids = createIdAllocator(() => sqlDb, SERVER_ID_SPACE);

/** Eigenen Zahlenraum übernehmen — vom Abgleich nach der Geräte-Anmeldung */
export function setIdBlock(blockStart: number) {
  ids.setSpace(deviceIdSpace(blockStart));
}

let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<void> | undefined;

async function doFlush(): Promise<void> {
  if (!sqlDb || !dirty) return;
  dirty = false;
  const data = sqlDb.export();
  try {
    await idbSet("state", STORAGE_KEY, data);
  } catch (err) {
    // Beim nächsten Versuch erneut schreiben, statt den Stand zu verlieren.
    dirty = true;
    console.error("[Finance Fox] Lokale Datenbank nicht gespeichert:", err);
    throw err;
  }
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void flushDatabase().catch(() => {
      /* bereits geloggt */
    });
  }, 1000);
}

/**
 * Ausstehende Änderungen sofort schreiben. Der lokale Router ruft das vor der
 * Antwort auf jede Mutation auf: Ein Service Worker kann unmittelbar danach
 * beendet werden, und ein verlorener Schreibvorgang wäre eine verlorene
 * Buchung.
 */
export async function flushDatabase(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  flushing = (flushing ?? Promise.resolve()).then(doFlush, doFlush);
  return flushing;
}

async function init(): Promise<Db> {
  // Die WASM-Datei liegt neben der App im Precache; ohne `locateFile` würde
  // sql.js sie relativ zum Worker-Skript suchen.
  const sqlJs = await initSqlJs({ locateFile: file => `/${file}` });
  SQL = sqlJs;

  const stored = await idbGet<Uint8Array>("state", STORAGE_KEY);
  sqlDb = stored ? new sqlJs.Database(stored) : new sqlJs.Database();
  sqlDb.run("PRAGMA foreign_keys = ON");

  instance = createProxyDb(sqlDb, scheduleFlush, ids);
  return instance;
}

/** Async-Init: einmalig awaiten, danach synchron über getDb() */
export async function initDb(): Promise<Db> {
  ready ??= init();
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

/** Hier ja — siehe die Begründung im Server-Zwilling. */
export function isReplica(): boolean {
  return true;
}

/** Nach direkten Schreibzugriffen außerhalb von Drizzle (z. B. ensureSchema) */
export function markDirty() {
  scheduleFlush();
}

/** Vollständiger binärer Export der aktuellen Datenbank */
export function exportDatabase(): Uint8Array {
  if (!sqlDb) {
    throw new Error(
      "Datenbank nicht initialisiert — initDb() zuerst aufrufen."
    );
  }
  return sqlDb.export();
}

/** Ersetzt die lokale Datenbank durch andere Bytes (Reset, Neuaufbau) */
export function replaceDatabase(bytes: Uint8Array): void {
  if (!SQL || !sqlDb) {
    throw new Error(
      "Datenbank nicht initialisiert — initDb() zuerst aufrufen."
    );
  }
  sqlDb.close();
  sqlDb = new SQL.Database(bytes);
  sqlDb.run("PRAGMA foreign_keys = ON");
  ids.reset();
  instance = createProxyDb(sqlDb, scheduleFlush, ids);
  scheduleFlush();
}

/**
 * Sicherheitsnetz: Weicht die Signatur vom Server-Modul ab, das dieser
 * Zwilling ersetzt, scheitert `npm run check` — und nicht erst der Browser.
 */
const __surfaceCheck: Pick<
  typeof import("../../../api/queries/connection"),
  | "initDb"
  | "getDb"
  | "markDirty"
  | "exportDatabase"
  | "replaceDatabase"
  | "isReplica"
> = { initDb, getDb, markDirty, exportDatabase, replaceDatabase, isReplica };
void __surfaceCheck;
