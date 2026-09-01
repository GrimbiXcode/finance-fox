import type { Database } from "sql.js";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

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
 */

export type Db = ReturnType<typeof createProxyDb>;

export function createProxyDb(db: Database, onWrite: () => void) {
  const proxy = {
    prepare(sqlText: string) {
      const stmtApi = {
        run(...params: unknown[]) {
          db.run(sqlText, params as never[]);
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
