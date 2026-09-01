import type { Database } from "sql.js";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { assignInsertIds, type IdAllocator } from "./idSpace";

/**
 * better-sqlite3-kompatibler Proxy um eine sql.js-Database.
 *
 * Drizzle spricht die synchrone better-sqlite3-API; sql.js (WASM) bietet eine
 * ähnliche, aber nicht identische. Dieser Proxy übersetzt dazwischen.
 *
 * Er steht bewusst in `db/` und nicht im Server: Dieselbe Datenbank läuft in
 * der Offline-Replik im Browser (`src/offline/db/connection.ts`). Nur wo die
 * Bytes am Ende landen — Datei oder IndexedDB — unterscheiden sich die beiden
 * Seiten; deshalb bekommt der Proxy den Schreib-Hinweis als `onWrite` herein
 * statt ihn selbst zu kennen.
 *
 * Zweite Aufgabe: die Vergabe der Primärschlüssel. Server und Geräte schreiben
 * beide, dürfen sich dabei aber niemals dieselbe ID geben — warum SQLites
 * AUTOINCREMENT das nicht leisten kann und wie es stattdessen läuft, steht in
 * `db/idSpace.ts`.
 */

/** Anweisungen, die den Datenbestand ändern — unabhängig vom Ausführungsweg */
const IS_WRITE = /^\s*(insert|update|delete|replace)\b/i;

export type Db = ReturnType<typeof createProxyDb>;

export function createProxyDb(
  db: Database,
  onWrite: () => void,
  ids?: IdAllocator
) {
  const proxy = {
    prepare(sqlText: string) {
      /**
       * Erst zum Ausführungszeitpunkt: Ein INSERT ohne gesetzte `id` bekommt
       * hier frische Schlüssel aus dem eigenen Zahlenraum. Nicht schon beim
       * `prepare`, damit dieselbe Anweisung zweimal ausgeführt nicht zweimal
       * dieselbe ID vergibt — und in jedem Ausführungspfad, denn Drizzle
       * benutzt für `insert … returning` nicht `run`, sondern `all`.
       */
      const sql = () => (ids ? assignInsertIds(sqlText, ids) : sqlText);
      // Drizzle führt `insert … returning` über `all()` aus, nicht über
      // `run()`. Ohne diese Erkennung bliebe eine solche Mutation ungemeldet:
      // Auf dem Server verzögerte sich das Speichern bis zum nächsten
      // Schreibzugriff, in der Replik ginge sie beim Beenden des Service
      // Workers verloren.
      const writes = IS_WRITE.test(sqlText);
      const stmtApi = {
        run(...params: unknown[]) {
          db.run(sql(), params as never[]);
          onWrite();
          return {
            changes: db.getRowsModified(),
            lastInsertRowid: Number(
              db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] ??
                0
            ),
          };
        },
        all(...params: unknown[]) {
          const stmt = db.prepare(sql());
          try {
            stmt.bind(params as never[]);
            const rows: Record<string, unknown>[] = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
            if (writes) onWrite();
          }
        },
        get(...params: unknown[]) {
          const stmt = db.prepare(sql());
          try {
            stmt.bind(params as never[]);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
            if (writes) onWrite();
          }
        },
        raw() {
          return {
            all(...params: unknown[]) {
              const stmt = db.prepare(sql());
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
              const stmt = db.prepare(sql());
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
