import { getMortgageCalculator } from "./index";
import type {
  MortgageAmortizationInput,
  MortgageTrancheInput,
  PaymentInterval,
} from "./scheduleCh";

/**
 * Bündelt mehrere Liegenschaften zu einer Haushalts-Sicht: Verkehrswert-
 * Summe und Restschuld je Monat. Genutzt von der Saldo-Prognose
 * (`forecast.balance`) für die Nettovermögens-Reihe.
 *
 * Reine Funktion — die Zeilen kommen bereits geladen herein, damit die
 * Prognose bei ihrem einen DB-Roundtrip bleibt.
 */

/** Nur die Felder, die die Berechnung braucht (Drizzle-Zeilen passen darauf) */
export interface PortfolioProperty {
  id: number;
  country: string;
  marketValue: number;
  householdIncome: number;
  firstMortgageLimitBp: number;
  maxLtvBp: number;
  calcInterestRateBp: number;
  maintenanceRateBp: number;
  amortizationYears: number;
}

/**
 * Die Intervall-Felder nehmen bewusst den rohen DB-Typ (inkl. `weekly`)
 * entgegen und werden hier normalisiert — so lassen sich Drizzle-Zeilen
 * direkt übergeben, ohne dass jeder Aufrufer mappen muss.
 */
export interface PortfolioTranche
  extends Omit<MortgageTrancheInput, "paymentInterval"> {
  propertyId: number;
  paymentInterval: string;
  interestRecurringId: number | null;
}

export interface PortfolioAmortization
  extends Omit<MortgageAmortizationInput, "interval"> {
  propertyId: number;
  interval: string;
  recurringId: number | null;
}

export interface MortgageDebtProjection {
  /** Summe der Verkehrswerte aller Liegenschaften (Cent) */
  propertyValue: number;
  /** Restschuld je Monat, Index 0 = heute; Länge = months + 1 */
  debtByMonth: number[];
  /**
   * Anzahl Zins-/Amortisations-Posten ohne (noch existierende)
   * Dauerbuchung — deren Zahlungen fehlen in der Saldo-Prognose, das
   * Nettovermögen fällt dadurch zu optimistisch aus.
   */
  missingRecurringCount: number;
}

/** Zeilen mit `weekly` sind fachlich ausgeschlossen — defensiv auf monthly */
function toPaymentInterval(interval: string): PaymentInterval {
  return interval === "weekly" ? "monthly" : (interval as PaymentInterval);
}

export function mortgageDebtProjection(
  properties: PortfolioProperty[],
  tranches: PortfolioTranche[],
  amortizations: PortfolioAmortization[],
  months: number,
  now: Date,
  /** IDs der tatsächlich noch existierenden Dauerbuchungen */
  existingRecurringIds: Set<number> = new Set()
): MortgageDebtProjection {
  const debtByMonth = new Array<number>(months + 1).fill(0);
  let propertyValue = 0;

  for (const p of properties) {
    propertyValue += p.marketValue;
    const own = tranches.filter(t => t.propertyId === p.id);
    const ownAmorts = amortizations.filter(a => a.propertyId === p.id);
    const result = getMortgageCalculator(p.country).schedule({
      property: p,
      tranches: own.map(t => ({
        ...t,
        paymentInterval: toPaymentInterval(t.paymentInterval),
      })),
      amortizations: ownAmorts.map(a => ({
        ...a,
        interval: toPaymentInterval(a.interval),
      })),
      months,
      now,
    });
    for (let i = 0; i <= months; i += 1) {
      // Der Horizont der Engine ist identisch, die Klammer schützt nur vor
      // einem künftig abweichenden MAX_MONTHS
      debtByMonth[i] +=
        result.monthlyDebt[Math.min(i, result.monthlyDebt.length - 1)];
    }
  }

  const hasRecurring = (id: number | null): boolean =>
    id !== null && existingRecurringIds.has(id);
  const missingRecurringCount =
    tranches.filter(t => !hasRecurring(t.interestRecurringId)).length +
    amortizations.filter(a => a.active && !hasRecurring(a.recurringId)).length;

  return { propertyValue, debtByMonth, missingRecurringCount };
}
