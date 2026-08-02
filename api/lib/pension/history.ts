import { pensionChanges } from "@db/schema";
import type { Db } from "../../queries/connection";
import {
  buildFieldDiff,
  type ChangeEntry,
  type FieldValue,
} from "../changeHistory";

/**
 * Änderungshistorie des Vorsorge-Moduls (Tabelle pension_changes).
 * Das Feld-Diff selbst liegt in `lib/changeHistory.ts` und wird mit dem
 * Hypotheken-Modul geteilt; hier bleibt nur der Schreibvorgang.
 */

/** @deprecated Alias — neue Aufrufer nutzen `FieldValue` aus changeHistory */
export type PensionFieldValue = FieldValue;
/** @deprecated Alias — neue Aufrufer nutzen `ChangeEntry` aus changeHistory */
export type PensionChangeEntry = ChangeEntry;

export interface RecordPensionChangeOptions {
  userId: number;
  entity: string; // profile | salary | deduction | ahv | fund | pillar3
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
 * Schreibt einen Historien-Eintrag — nur bei echter Änderung (leerer Diff =
 * kein Eintrag; ein Kommentar allein erzeugt keinen). Liefert die Anzahl
 * geschriebener Einträge (0 oder 1).
 */
export async function recordPensionChange(
  db: Db,
  opts: RecordPensionChangeOptions
): Promise<number> {
  const changes = buildFieldDiff(opts);
  if (changes.length === 0) return 0;
  await db.insert(pensionChanges).values({
    userId: opts.userId,
    entity: opts.entity,
    entityId: opts.entityId,
    comment: opts.comment?.trim() ?? "",
    changes: JSON.stringify(changes),
    createdAt: new Date(),
  });
  return 1;
}
