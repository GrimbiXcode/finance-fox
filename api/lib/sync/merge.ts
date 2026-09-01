/**
 * Drei-Wege-Vergleich für den Abgleich — die Stelle, an der entschieden wird,
 * ob eine Änderung glatt durchläuft, automatisch zusammengeführt wird oder den
 * Benutzer fragen muss.
 *
 * Bewusst reine Funktionen ohne Datenbank: Genau hier sitzen die Fehler, die
 * man in einer Finanz-App nicht haben will, und nur so sind sie mit dem
 * vorhandenen vitest-Setup vollständig prüfbar.
 *
 * Die drei Stände:
 * - `base`   — was das Gerät beim letzten Abgleich vom Server bekommen hat
 * - `mine`   — der Stand auf dem Gerät (offline geändert)
 * - `theirs` — der aktuelle Stand auf dem Server
 */

/** Eine Datenbankzeile, wie SQLite sie liefert: Spaltenname → Wert */
export type SyncRow = Record<string, unknown>;

/** Fehlende Spalten und NULL sind dasselbe — SQLite liefert beides gemischt */
function value(row: SyncRow | null, field: string): unknown {
  if (!row) return null;
  const v = row[field];
  return v === undefined ? null : v;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // SQLite gibt je nach Weg (Trigger-Text vs. Spaltenwert) mal 1/0, mal
  // "1"/"0" zurück; Zahl und Ziffernfolge sind hier derselbe Wert.
  if (
    (typeof a === "number" && typeof b === "string") ||
    (typeof a === "string" && typeof b === "number")
  ) {
    return String(a) === String(b);
  }
  return false;
}

/** Alle Spaltennamen, die in einer der beiden Zeilen vorkommen */
function allFields(a: SyncRow | null, b: SyncRow | null): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(a ?? {})) names.add(key);
  for (const key of Object.keys(b ?? {})) names.add(key);
  return [...names];
}

/** Spalten, in denen sich `next` von `base` unterscheidet */
export function changedFields(
  base: SyncRow | null,
  next: SyncRow | null
): string[] {
  return allFields(base, next).filter(
    field => !sameValue(value(base, field), value(next, field))
  );
}

export type MergeOutcome =
  /** Auf dem Server hat sich nichts geändert — die Zeile kann direkt landen */
  | { kind: "apply"; row: SyncRow }
  /**
   * Beide Seiten haben geändert, aber verschiedene Felder (oder dasselbe Feld
   * auf denselben Wert): automatisch zusammengeführt.
   */
  | { kind: "merge"; row: SyncRow; mine: string[]; theirs: string[] }
  /** Dasselbe Feld, unterschiedliche Werte — das entscheidet der Benutzer */
  | { kind: "conflict"; fields: string[] };

/**
 * Führt die eigene Änderung mit dem Serverstand zusammen.
 *
 * Grundgedanke: Übernommen wird der Serverstand, und darauf werden genau die
 * Felder gelegt, die auf dem Gerät geändert wurden. Wer die Notiz ändert,
 * während zuhause der Betrag korrigiert wird, bekommt beides — und nicht die
 * Frage, welche der zwei Versionen „gewinnt".
 */
export function merge3(
  base: SyncRow | null,
  mine: SyncRow,
  theirs: SyncRow
): MergeOutcome {
  const myChanges = changedFields(base, mine);
  const theirChanges = changedFields(base, theirs);

  if (theirChanges.length === 0) return { kind: "apply", row: mine };
  if (myChanges.length === 0) return { kind: "apply", row: theirs };

  const contested = myChanges.filter(
    field =>
      theirChanges.includes(field) &&
      !sameValue(value(mine, field), value(theirs, field))
  );
  if (contested.length > 0) return { kind: "conflict", fields: contested };

  // Felder, die der Server ohnehin schon so hat, sind kein Zusammenführen —
  // sonst stünden im Merge-Protokoll lauter Einträge ohne Ereignis.
  const effective = myChanges.filter(
    field => !sameValue(value(mine, field), value(theirs, field))
  );
  if (effective.length === 0) return { kind: "apply", row: theirs };

  const row: SyncRow = { ...theirs };
  for (const field of effective) row[field] = value(mine, field);
  return { kind: "merge", row, mine: effective, theirs: theirChanges };
}

/** Art eines Konflikts, wie ihn die Oberfläche erklärt */
export type ConflictKind =
  /** Beide Seiten haben dasselbe Feld unterschiedlich geändert */
  | "fields"
  /** Auf dem Gerät geändert, im Heimnetz gelöscht */
  | "deleted-remote"
  /** Auf dem Gerät gelöscht, im Heimnetz geändert */
  | "deleted-local"
  /** Das Schreibrecht fehlt inzwischen (Konto wurde privat gestellt o. Ä.) */
  | "forbidden";

/**
 * Entscheidet über eine gelöschte Zeile: Löschen ist nur dann unstrittig, wenn
 * der Server denselben Stand hat, den das Gerät gelöscht hat. Wurde die Zeile
 * inzwischen geändert, würde das Löschen fremde Arbeit verwerfen.
 */
export function classifyDelete(
  base: SyncRow | null,
  theirs: SyncRow | null
): { kind: "apply" } | { kind: "conflict"; conflict: ConflictKind } {
  // Schon weg — dann ist nichts mehr zu tun.
  if (!theirs) return { kind: "apply" };
  if (changedFields(base, theirs).length === 0) return { kind: "apply" };
  return { kind: "conflict", conflict: "deleted-local" };
}
