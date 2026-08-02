import { mortgageChanges } from "@db/schema";
import type { Db } from "../../queries/connection";
import { buildFieldDiff, type FieldValue } from "../changeHistory";

/**
 * Änderungshistorie des Hypotheken-Moduls (Tabelle mortgage_changes).
 * Das Feld-Diff liegt geteilt in `lib/changeHistory.ts`.
 *
 * Anders als bei der Vorsorge ist `userId` hier **wer** geändert hat — die
 * Historie gehört dem Haushalt und wird chronologisch über alle Mitglieder
 * gelesen.
 */
export interface RecordMortgageChangeOptions {
  userId: number;
  entity: "property" | "tranche" | "amortization";
  entityId: number;
  comment?: string;
  /** null = Datensatz wird neu angelegt (after enthält die Werte) */
  before: Record<string, FieldValue> | null;
  /** null = Datensatz wird gelöscht */
  after: Record<string, FieldValue> | null;
  /** Deutsche Feldnamen fürs Diff (Key = Feldname in before/after) */
  fieldLabels: Record<string, string>;
  /** Optionaler Wert-Formatter (Default: Wert roh; Booleans → „ja"/„nein") */
  format?: (field: string, value: FieldValue) => string | number | null;
  /** Kurzbeschreibung für Anlage-/Lösch-Einträge */
  summary?: string;
}

/**
 * Schreibt einen Historien-Eintrag — nur bei echter Änderung. Liefert die
 * Anzahl geschriebener Einträge (0 oder 1); die Router-Mutationen nutzen
 * den Rückgabewert als „hat sich etwas geändert"-Signal.
 */
export async function recordMortgageChange(
  db: Db,
  opts: RecordMortgageChangeOptions
): Promise<number> {
  const changes = buildFieldDiff(opts);
  if (changes.length === 0) return 0;
  await db.insert(mortgageChanges).values({
    userId: opts.userId,
    entity: opts.entity,
    entityId: opts.entityId,
    comment: opts.comment?.trim() ?? "",
    changes: JSON.stringify(changes),
    createdAt: new Date(),
  });
  return 1;
}
