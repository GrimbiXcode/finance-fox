/**
 * Feld-Diff der modulweisen Änderungshistorien (pension_changes,
 * mortgage_changes) — reine Funktion ohne DB-Zugriff. Die Module bringen
 * je einen dünnen Writer mit, der das Ergebnis in ihre eigene Tabelle
 * schreibt (siehe `pension/history.ts`, `mortgage/history.ts`).
 *
 * Feldnamen werden als **deutsche Labels** gespeichert (Mapping übergibt
 * der Aufrufer), Beträge roh in Cent — das UI formatiert locale-konform.
 *
 * Bewusst NICHT genutzt von `transaction_changes` in financeRouter.ts:
 * dort werden rohe Feld-Keys gespeichert (das UI mappt selbst), Namen
 * inline aufgelöst und der Eintrag mit dem tx-Handle innerhalb einer
 * Transaktion geschrieben.
 */

export type FieldValue = string | number | boolean | null;

export interface ChangeEntry {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

export interface FieldDiffOptions {
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

function defaultFormat(value: FieldValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

/**
 * Baut die Diff-Einträge. Leeres Ergebnis = keine echte Änderung; die
 * Writer schreiben dann bewusst keinen Historien-Eintrag (ein Kommentar
 * allein erzeugt also keinen).
 */
export function buildFieldDiff(opts: FieldDiffOptions): ChangeEntry[] {
  const format = opts.format ?? ((_field, value) => defaultFormat(value));
  const changes: ChangeEntry[] = [];

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
        if (to !== null && to !== "")
          changes.push({ field: label, from: null, to });
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

  return changes;
}
