/**
 * Netto-Lohnberechnung des Vorsorge-Moduls: gültiger Bruttolohn aus der
 * Lohn-Timeline (pension_salaries) minus der aktiven Abzüge
 * (pension_deductions). Alle Beträge in Cent.
 */

export interface SalaryRow {
  validFrom: string; // YYYY-MM
  grossMonthly: number; // Cent
}

export interface DeductionRow {
  mode: "percent" | "absolute";
  value: number; // percent: Basispunkte (530 = 5,30 %); absolute: Cent
  active: boolean;
}

/** Abzug mit Gültigkeits-Scope: salaryId null = global, sonst nur dieser Lohn */
export interface DeductionWithSalary extends DeductionRow {
  salaryId: number | null;
}

/**
 * Gültiger Bruttolohn für einen Monat (YYYY-MM): der letzte Eintrag mit
 * validFrom ≤ Monat. null, wenn noch kein Eintrag greift.
 */
export function salaryForMonth(
  salaries: SalaryRow[],
  month: string
): number | null {
  return salaryEntryForMonth(salaries, month)?.grossMonthly ?? null;
}

/**
 * Wie salaryForMonth, liefert aber den ganzen Lohneintrag (inkl. id für
 * eintragsbezogene Abzüge) statt nur dem Betrag.
 */
export function salaryEntryForMonth<T extends SalaryRow>(
  salaries: T[],
  month: string
): T | null {
  let best: T | null = null;
  for (const s of salaries) {
    if (s.validFrom <= month && (!best || s.validFrom > best.validFrom)) {
      best = s;
    }
  }
  return best;
}

/**
 * Abzüge, die für einen Lohneintrag gelten: die aktiven globalen
 * (salaryId null) plus die aktiven eintragsbezogenen dieses Eintrags.
 */
export function deductionsForSalary<T extends DeductionWithSalary>(
  allDeductions: T[],
  salaryId: number
): T[] {
  return allDeductions.filter(
    d => d.active && (d.salaryId === null || d.salaryId === salaryId)
  );
}

/**
 * Netto = Brutto − Summe der aktiven Abzüge. Prozent-Abzüge in Basispunkten
 * (round(gross × bp / 10000)), absolute Abzüge direkt in Cent.
 */
export function computeNet(
  grossMonthly: number,
  deductions: DeductionRow[]
): number {
  let net = grossMonthly;
  for (const d of deductions) {
    if (!d.active) continue;
    net -=
      d.mode === "percent"
        ? Math.round((grossMonthly * d.value) / 10000)
        : d.value;
  }
  return net;
}
