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

/**
 * Gültiger Bruttolohn für einen Monat (YYYY-MM): der letzte Eintrag mit
 * validFrom ≤ Monat. null, wenn noch kein Eintrag greift.
 */
export function salaryForMonth(
  salaries: SalaryRow[],
  month: string
): number | null {
  let best: SalaryRow | null = null;
  for (const s of salaries) {
    if (s.validFrom <= month && (!best || s.validFrom > best.validFrom)) {
      best = s;
    }
  }
  return best ? best.grossMonthly : null;
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
