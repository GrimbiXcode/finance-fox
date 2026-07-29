import { pensionChanges } from "@db/schema";
import type { Db } from "../../queries/connection";

/**
 * Änderungshistorie des Vorsorge-Moduls (Tabelle pension_changes) —
 * Muster: das serverseitige Feld-Diff von updateTransaction in
 * financeRouter.ts (transaction_changes). Feldnamen werden als deutsche
 * Labels gespeichert (Mapping übergibt der Aufrufer), Beträge roh in Cent.
 */

export type PensionFieldValue = string | number | boolean | null;

export interface PensionChangeEntry {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

export interface RecordPensionChangeOptions {
  userId: number;
  entity: string; // profile | salary | deduction | ahv | fund | pillar3
  entityId: number;
  comment?: string;
  /** null = Datensatz wird neu angelegt (after enthält die Werte) */
  before: Record<string, PensionFieldValue> | null;
  /** null = Datensatz wird gelöscht */
  after: Record<string, PensionFieldValue> | null;
  /** Deutsche Feldnamen fürs Diff (Key = Feldname in before/after) */
  fieldLabels: Record<string, string>;
  /** Optionaler Wert-Formatter (Default: Wert roh; Booleans → „ja"/„nein") */
  format?: (field: string, value: PensionFieldValue) => string | number | null;
  /** Kurzbeschreibung für Anlage-/Lösch-Einträge */
  summary?: string;
}

function defaultFormat(value: PensionFieldValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
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
  const format = opts.format ?? ((_field, value) => defaultFormat(value));
  const changes: PensionChangeEntry[] = [];

  if (opts.before && opts.after) {
    // Update: Feld-Diff über die gemappten Felder
    for (const [key, label] of Object.entries(opts.fieldLabels)) {
      const from = format(key, opts.before[key] ?? null);
      const to = format(key, opts.after[key] ?? null);
      if (from !== to) changes.push({ field: label, from, to });
    }
  } else if (opts.after) {
    // Neuanlage: mit summary ein einzelner „Eintrag", sonst pro Feld ein
    // strukturierter Eintrag (→ im UI locale-konform formatiert)
    if (opts.summary) {
      changes.push({ field: "Eintrag", from: null, to: opts.summary });
    } else {
      for (const [key, label] of Object.entries(opts.fieldLabels)) {
        const to = format(key, opts.after[key] ?? null);
        if (to !== null && to !== "") changes.push({ field: label, from: null, to });
      }
    }
  } else if (opts.before) {
    // Löschung: mit summary ein einzelner „Eintrag", sonst pro Feld
    if (opts.summary) {
      changes.push({ field: "Eintrag", from: opts.summary, to: "gelöscht" });
    } else {
      for (const [key, label] of Object.entries(opts.fieldLabels)) {
        const from = format(key, opts.before[key] ?? null);
        if (from !== null && from !== "")
          changes.push({ field: label, from, to: "gelöscht" });
      }
    }
  }

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
