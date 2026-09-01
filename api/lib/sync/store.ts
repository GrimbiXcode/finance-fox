import type { Db } from "../../queries/connection";
import type { SyncRow } from "./merge";

/**
 * Roher Zeilenzugriff für den Abgleich.
 *
 * Der Abgleich arbeitet bewusst unterhalb von Drizzle: Er überträgt ganze
 * Zeilen so, wie SQLite sie liefert (Spaltenname → Wert), und spielt sie
 * genauso wieder ein. Das hält ihn unabhängig von Typ-Mappings (Datum,
 * Boolean) und macht ihn für neue Tabellen offen, ohne dass hier etwas
 * angepasst werden müsste.
 *
 * Fachlogik läuft dabei **nicht** noch einmal: Kaskaden, Diff-Zeilen und
 * Audit-Einträge sind bereits auf dem schreibenden Gerät entstanden und liegen
 * als eigene Zeilenänderungen im selben Changeset.
 */

type RawStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  all(...params: unknown[]): SyncRow[];
  get(...params: unknown[]): SyncRow | undefined;
};

type RawClient = { prepare(sql: string): RawStatement };

export function rawClient(db: Db): RawClient {
  return (db as unknown as { $client: RawClient }).$client;
}

const columnCache = new Map<string, string[]>();

/** Spalten einer Tabelle laut PRAGMA — Quelle der Wahrheit beim Einspielen */
export function tableColumns(db: Db, table: string): string[] {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const rows = rawClient(db)
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as { name: string }[];
  const names = rows.map(row => row.name);
  columnCache.set(table, names);
  return names;
}

/** Alle Zeilen einer Tabelle */
export function selectAll(
  db: Db,
  table: string,
  pk: string,
  limit?: number
): SyncRow[] {
  const sql = limit
    ? `SELECT * FROM ${table} ORDER BY ${pk} DESC LIMIT ${limit}`
    : `SELECT * FROM ${table}`;
  return rawClient(db).prepare(sql).all();
}

/** Zeilen zu einer Menge von Primärschlüsseln */
export function selectByIds(
  db: Db,
  table: string,
  pk: string,
  ids: (string | number)[]
): SyncRow[] {
  if (ids.length === 0) return [];
  const rows: SyncRow[] = [];
  // In Blöcken, damit die Parameterzahl von SQLite nicht überschritten wird.
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400);
    const placeholders = slice.map(() => "?").join(",");
    rows.push(
      ...rawClient(db)
        .prepare(`SELECT * FROM ${table} WHERE ${pk} IN (${placeholders})`)
        .all(...slice)
    );
  }
  return rows;
}

export function selectById(
  db: Db,
  table: string,
  pk: string,
  id: string | number
): SyncRow | null {
  return (
    rawClient(db).prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(id) ??
    null
  );
}

/**
 * Zeile einspielen. Nur Spalten, die es in dieser Datenbank wirklich gibt —
 * so kann ein Gerät mit älterem oder manipuliertem Schema nichts einschleusen.
 */
export function upsertRow(
  db: Db,
  table: string,
  pk: string,
  row: SyncRow
): void {
  const allowed = new Set(tableColumns(db, table));
  const columns = Object.keys(row).filter(name => allowed.has(name));
  if (columns.length === 0) return;
  const id = row[pk];
  const raw = rawClient(db);

  const exists = raw
    .prepare(`SELECT 1 AS hit FROM ${table} WHERE ${pk} = ?`)
    .get(id as never);
  if (exists) {
    const assignments = columns
      .filter(name => name !== pk)
      .map(name => `${name} = ?`);
    if (assignments.length === 0) return;
    raw
      .prepare(`UPDATE ${table} SET ${assignments.join(", ")} WHERE ${pk} = ?`)
      .run(...columns.filter(name => name !== pk).map(name => row[name]), id);
    return;
  }
  raw
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map(name => row[name]));
}

export function deleteById(
  db: Db,
  table: string,
  pk: string,
  id: string | number
): void {
  rawClient(db).prepare(`DELETE FROM ${table} WHERE ${pk} = ?`).run(id);
}

/* ─────────────────────────── Merge-Basis ─────────────────────────────────── */

/**
 * `sync_base` hält je Zeile den zuletzt vom Server bekannten Stand — den
 * gemeinsamen Ausgangspunkt des Drei-Wege-Vergleichs. Die Tabelle wird nur in
 * der lokalen Replik benutzt, die Helfer stehen aber hier, weil sowohl die
 * Sync-Engine als auch die Konfliktauflösung im Router sie brauchen.
 */
export function readBaseRow(
  db: Db,
  entity: string,
  rowId: string
): SyncRow | null {
  const row = rawClient(db)
    .prepare("SELECT payload FROM sync_base WHERE entity = ? AND row_id = ?")
    .get(entity, rowId);
  const payload = row?.payload;
  return typeof payload === "string" ? (JSON.parse(payload) as SyncRow) : null;
}

export function writeBaseRow(
  db: Db,
  entity: string,
  rowId: string,
  payload: SyncRow | null
): void {
  const raw = rawClient(db);
  if (payload === null) {
    raw
      .prepare("DELETE FROM sync_base WHERE entity = ? AND row_id = ?")
      .run(entity, rowId);
    return;
  }
  raw
    .prepare(
      `INSERT INTO sync_base (entity, row_id, payload) VALUES (?, ?, ?)
       ON CONFLICT (entity, row_id) DO UPDATE SET payload = excluded.payload`
    )
    .run(entity, rowId, JSON.stringify(payload));
}

/**
 * Führt `fn` mit abgeschalteten Änderungs-Triggern aus.
 *
 * Nötig beim Einspielen fremder Zeilen: Ohne das würde jede vom Server geholte
 * Zeile als lokale Änderung gelten und beim nächsten Abgleich zurücklaufen.
 */
let suspendDepth = 0;

export function withTriggersSuspended<T>(db: Db, fn: () => T): T {
  const raw = rawClient(db);
  // Verschachtelbar: Ein innerer Aufruf darf die Trigger nicht schon wieder
  // einschalten, während der äußere noch Zeilen einspielt.
  if (suspendDepth === 0) {
    raw.prepare("UPDATE sync_guard SET suspended = 1 WHERE id = 1").run();
  }
  suspendDepth += 1;
  try {
    return fn();
  } finally {
    suspendDepth -= 1;
    if (suspendDepth === 0) {
      raw.prepare("UPDATE sync_guard SET suspended = 0 WHERE id = 1").run();
    }
  }
}
