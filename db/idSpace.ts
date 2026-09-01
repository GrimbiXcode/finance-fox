import type { Database } from "sql.js";

/**
 * Vergabe der Primärschlüssel — die Voraussetzung dafür, dass mehrere Geräte
 * gleichzeitig schreiben dürfen.
 *
 * Alle Tabellen benutzen `INTEGER PRIMARY KEY AUTOINCREMENT`. SQLite vergibt
 * damit `max(rowid) + 1` — und genau das trägt beim Abgleich nicht: Sobald
 * eine Seite Zeilen der anderen speichert, richtet sich ihr Zähler nach deren
 * IDs. Der Server begänne dann, IDs aus dem Zahlenraum eines Geräts zu
 * vergeben, das Gerät aus dem eines anderen — und zwei verschiedene Buchungen
 * bekämen dieselbe ID. Zurückdrehen lässt sich der Zähler nicht: SQLite nimmt
 * immer das Maximum aus `sqlite_sequence` und der größten vorhandenen ID.
 *
 * Deshalb vergibt jede Seite ihre IDs selbst, aus einem eigenen Zahlenraum:
 *
 *     [ 1 … ID_BLOCK_BASE )                       der Heimserver
 *     [ BASE + n·SIZE … BASE + (n+1)·SIZE )       Gerät n
 *
 * Der Zugriffspunkt dafür ist der sql.js-Proxy (`db/sqlJsProxy.ts`): Drizzle
 * schreibt die `id`-Spalte immer mit — als `null`, wenn kein Wert gesetzt ist
 * (`insert into "banks" ("id", "name") values (null, ?)`). Genau dieses `null`
 * wird durch die nächste ID aus dem eigenen Raum ersetzt. Kein Router, kein
 * Query und kein Schema müssen davon wissen.
 */

/** Erste ID des ersten Geräteblocks — alles darunter gehört dem Heimserver */
export const ID_BLOCK_BASE = 1_000_000_000_000;

/** Größe eines Geräteblocks (bleibt mit der Basis im sicheren Zahlenraum) */
export const ID_BLOCK_SIZE = 1_000_000_000;

/** Zahlenraum des Servers */
export const SERVER_ID_SPACE: IdSpace = { from: 1, to: ID_BLOCK_BASE };

/** Zahlenraum des Geräts mit diesem Blockanfang */
export function deviceIdSpace(blockStart: number): IdSpace {
  return { from: blockStart, to: blockStart + ID_BLOCK_SIZE };
}

export type IdSpace = { from: number; to: number };

export type IdAllocator = {
  /** Nächste freie ID dieser Tabelle im eigenen Zahlenraum */
  next(table: string): number;
  /** Zahlenraum wechseln (Gerät bekommt seinen Block erst beim ersten Abgleich) */
  setSpace(space: IdSpace): void;
  /** Gemerkte Stände verwerfen — nach einem Austausch der Datenbank */
  reset(): void;
};

/** Größte bereits vergebene ID dieser Tabelle im eigenen Zahlenraum */
function highestOwnId(
  sqlDb: Database | undefined,
  table: string,
  space: IdSpace
): number {
  try {
    // Fremde IDs zählen bewusst nicht mit — sie liegen außerhalb des Raums.
    const result = sqlDb?.exec(
      `SELECT IFNULL(MAX(id), 0) FROM "${table}"
        WHERE id >= ${space.from} AND id < ${space.to}`
    );
    return Number(result?.[0]?.values[0]?.[0] ?? 0);
  } catch {
    // Tabelle ohne id-Spalte oder noch nicht angelegt.
    return 0;
  }
}

export function createIdAllocator(
  db: () => Database | undefined,
  initial: IdSpace
): IdAllocator {
  let space = initial;
  const nextByTable = new Map<string, number>();

  return {
    reset() {
      nextByTable.clear();
    },
    setSpace(next: IdSpace) {
      if (next.from === space.from && next.to === space.to) return;
      space = next;
      nextByTable.clear();
    },
    next(table: string): number {
      let value = nextByTable.get(table);
      if (value === undefined) {
        value = Math.max(space.from - 1, highestOwnId(db(), table, space));
      }
      value += 1;
      nextByTable.set(table, value);
      return value;
    },
  };
}

/**
 * Setzt in einem INSERT die `id`-Platzhalter (`null`) auf frische IDs.
 * Greift nur bei Drizzle-Inserts, die `"id"` als erste Spalte führen — der
 * Abgleich selbst schreibt IDs ausdrücklich und bleibt unberührt.
 */
const INSERT_WITH_ID =
  /^\s*insert\s+(?:or\s+\w+\s+)?into\s+"([^"]+)"\s*\(\s*"id"\s*,/i;

/** Ersetzt das erste `null` jeder Werte-Gruppe durch eine neue ID */
export function assignInsertIds(sql: string, allocator: IdAllocator): string {
  const match = INSERT_WITH_ID.exec(sql);
  if (!match) return sql;
  const table = match[1];
  return sql.replace(
    /(values\s*\(|\)\s*,\s*\()\s*null\s*(?=[,)])/gi,
    (_full, opening: string) => `${opening}${allocator.next(table)}`
  );
}
