import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@db/schema";

/**
 * SQLite über sql.js (WebAssembly) — kein natives Modul, kein Compile-Step,
 * funktioniert in jeder Build-Umgebung (Docker, Preview, Heimserver).
 *
 * Drizzle wird über einen better-sqlite3-API-kompatiblen Proxy angebunden.
 * Persistenz: nach Schreiboperationen wird die DB als Datei exportiert
 * (DATABASE_URL, Default ./data/finance-fox.db).
 */

export type Db = ReturnType<typeof createProxyDb>;

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

/** better-sqlite3-kompatibler Proxy um eine sql.js-Database */
function createProxyDb(db: Database) {
  const proxy = {
    prepare(sqlText: string) {
      const stmtApi = {
        run(...params: unknown[]) {
          db.run(sqlText, params as never[]);
          scheduleFlush();
          return {
            changes: db.getRowsModified(),
            lastInsertRowid: Number(
              db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] ??
                0
            ),
          };
        },
        all(...params: unknown[]) {
          const stmt = db.prepare(sqlText);
          try {
            stmt.bind(params as never[]);
            const rows: Record<string, unknown>[] = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
        get(...params: unknown[]) {
          const stmt = db.prepare(sqlText);
          try {
            stmt.bind(params as never[]);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        raw() {
          return {
            all(...params: unknown[]) {
              const stmt = db.prepare(sqlText);
              try {
                stmt.bind(params as never[]);
                const rows: unknown[][] = [];
                while (stmt.step()) rows.push(stmt.get() as unknown[]);
                return rows;
              } finally {
                stmt.free();
              }
            },
            get(...params: unknown[]) {
              const stmt = db.prepare(sqlText);
              try {
                stmt.bind(params as never[]);
                return stmt.step() ? (stmt.get() as unknown[]) : undefined;
              } finally {
                stmt.free();
              }
            },
          };
        },
      };
      return stmtApi;
    },
    transaction(fn: (...args: unknown[]) => unknown) {
      const wrapped = (...args: unknown[]) => {
        db.run("BEGIN");
        try {
          const result = fn(...args);
          db.run("COMMIT");
          return result;
        } catch (err) {
          db.run("ROLLBACK");
          throw err;
        }
      };
      return Object.assign(wrapped, {
        deferred: wrapped,
        immediate: wrapped,
        exclusive: wrapped,
      });
    },
  };
  return drizzle(proxy as never, { schema });
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

  instance = createProxyDb(sqlDb);
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
  instance = createProxyDb(sqlDb);
  scheduleFlush();
}
