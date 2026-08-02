import {
  MONTHS_PER_INTERVAL,
  type RecurringInterval,
} from "@contracts/types";

/**
 * Hypotheken-Berechnung nach Schweizer Praxis — reine Funktion ohne
 * DB-Zugriff, damit sie direkt und deterministisch testbar ist.
 *
 * Modell in Kürze:
 * - Eine Hypothek besteht aus Tranchen (Festhypothek, SARON, variabel) mit
 *   je eigenem Zinssatz. Der Zins wird **gezahlt, nicht kapitalisiert** —
 *   die Restschuld sinkt also ausschließlich durch Amortisation.
 * - **Direkte** Amortisation senkt die Restschuld einer Tranche.
 *   **Indirekte** Amortisation zahlt auf ein Konto (meist Säule 3a) ein und
 *   lässt die Schuld unverändert.
 * - Belehnung = Schuld / Verkehrswert. Bis `firstMortgageLimitBp` gilt sie
 *   als 1. Hypothek, der Teil darüber als 2. Hypothek — dieser muss innert
 *   `amortizationYears` abgetragen werden.
 * - Tragbarkeit = (kalkulatorischer Zins + Unterhalt + **erforderliche**
 *   Amortisation) / Bruttojahreseinkommen, Richtwert max. 33 %.
 *
 * WICHTIG (Nettovermögen, siehe forecastRouter): Bei indirekter
 * Amortisation bleibt die Restschuld bewusst konstant. Würde sie hier
 * ebenfalls sinken, während das verknüpfte Konto wächst, zählte dasselbe
 * Geld doppelt ins Vermögen.
 */

/** Intervalle, die für Zins- und Amortisationstermine sinnvoll sind */
export type PaymentInterval = Exclude<RecurringInterval, "weekly">;

export interface MortgageTrancheInput {
  id: number;
  name: string;
  kind: "fixed" | "saron" | "variable";
  /** Restschuld in Cent per `balanceDate` */
  principal: number;
  /** Stichtag der Restschuld (YYYY-MM-DD); null = per heute */
  balanceDate: string | null;
  interestRateBp: number;
  /** Nur bei SARON: Marge auf den Basissatz */
  marginBp: number | null;
  /** Ablauf der Zinsbindung (YYYY-MM-DD); null bei saron/variable */
  maturityDate: string | null;
  paymentInterval: PaymentInterval;
}

export interface MortgageAmortizationInput {
  id: number;
  /** Nur bei kind "direct" gesetzt — indirekte gilt der ganzen Hypothek */
  trancheId: number | null;
  kind: "direct" | "indirect";
  /** Betrag in Cent pro Intervall */
  amount: number;
  interval: PaymentInterval;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  active: boolean;
}

export interface MortgagePropertyInput {
  marketValue: number;
  householdIncome: number;
  firstMortgageLimitBp: number;
  maxLtvBp: number;
  calcInterestRateBp: number;
  maintenanceRateBp: number;
  amortizationYears: number;
}

export interface MortgageScheduleInput {
  property: MortgagePropertyInput;
  tranches: MortgageTrancheInput[];
  amortizations: MortgageAmortizationInput[];
  /** Simulationshorizont in Monaten (Default 360 = 30 Jahre) */
  months?: number;
  /** Testbarer „heute"-Zeitpunkt (Default: jetzt) */
  now?: Date;
}

export interface MortgageTrancheResult {
  id: number;
  name: string;
  kind: MortgageTrancheInput["kind"];
  principal: number;
  /** interestRateBp + marginBp (SARON) */
  effectiveRateBp: number;
  yearlyInterest: number;
  interestPerPayment: number;
  paymentInterval: PaymentInterval;
  maturityDate: string | null;
  /** Monate bis zum Ablauf der Zinsbindung; null ohne Ablaufdatum */
  monthsToMaturity: number | null;
}

export interface MortgageSeriesPoint {
  year: number;
  debt: number;
  cumInterest: number;
  cumAmortized: number;
  /** Nur Anzeige — steckt bereits im Saldo des verknüpften Kontos */
  indirectCapital: number;
  /** Verkehrswert − Restschuld (Eigenkapital im Objekt) */
  equity: number;
}

/**
 * Hinweise als **strukturierte Daten**, nicht als fertige Sätze: Beträge,
 * Prozente und Datumsangaben müssen im Frontend locale-konform formatiert
 * werden (`formatCents`/`formatBp`/`formatDate`) — ein serverseitig
 * zusammengebauter Text könnte das nicht.
 */
export type MortgageWarning =
  | { kind: "no_market_value" }
  | { kind: "ltv_exceeded"; ltvBp: number; maxLtvBp: number }
  | { kind: "no_income" }
  | { kind: "affordability_exceeded"; ratioBp: number }
  | { kind: "amortization_uncovered"; required: number; actual: number }
  | { kind: "maturity_due"; tranche: string; date: string }
  | { kind: "maturity_passed"; tranche: string; date: string }
  | { kind: "stale_balance"; tranche: string; date: string };

export interface MortgageScheduleResult {
  /** Restschuld je Monat, Index 0 = heute */
  monthlyDebt: number[];
  /** Indirekt angespartes Kapital je Monat, Index 0 = heute (Anzeige) */
  monthlyIndirect: number[];
  series: MortgageSeriesPoint[];
  tranches: MortgageTrancheResult[];
  totals: {
    debt: number;
    /** Nach Restschuld gewichteter Durchschnittszins */
    avgRateBp: number;
    yearlyInterest: number;
    monthlyInterest: number;
    monthlyDirectAmortization: number;
    monthlyIndirectAmortization: number;
    /** Zins + Amortisation pro Monat (tatsächliche Belastung) */
    monthlyBurden: number;
  };
  ltv: {
    /** Belehnung in Basispunkten; null ohne Verkehrswert */
    bp: number | null;
    firstMortgage: number;
    secondMortgage: number;
    /** Freier Betrag bis zur maximalen Belehnung */
    headroom: number;
  };
  affordability: {
    householdIncome: number;
    calcInterest: number;
    maintenance: number;
    /** Pflicht-Amortisation pro Jahr (2. Hypothek / amortizationYears) */
    requiredAmortization: number;
    /** Tatsächlich erfasste Amortisation pro Jahr */
    actualAmortization: number;
    totalCost: number;
    /** Kostenquote in Basispunkten; null ohne Einkommen */
    ratioBp: number | null;
    affordable: boolean | null;
  };
  warnings: MortgageWarning[];
}

/** Simulationsgrenze (50 Jahre) */
const MAX_MONTHS = 600;
/** Richtwert der Tragbarkeit: max. 33 % des Bruttoeinkommens */
export const MAX_COST_RATIO_BP = 3333;
/** Ab dieser Restlaufzeit wird auf den Ablauf der Zinsbindung hingewiesen */
const MATURITY_WARN_MONTHS = 12;
/** Ab diesem Alter gilt ein Restschuld-Stichtag als veraltet */
const STALE_BALANCE_MONTHS = 6;

/** `YYYY-MM` eines Datums */
function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Monate von `from` bis `to` (beide `YYYY-MM`), negativ wenn to < from */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Prozentsatz in Basispunkten auf einen Cent-Betrag anwenden */
function applyBp(amount: number, bp: number): number {
  return Math.round((amount * bp) / 10000);
}

function effectiveRate(t: MortgageTrancheInput): number {
  return t.interestRateBp + (t.kind === "saron" ? (t.marginBp ?? 0) : 0);
}

/**
 * Fällt der Monat mit Abstand `offset` zum Startmonat auf das Raster des
 * Intervalls? (offset 0 = Startmonat selbst)
 */
function firesInMonth(offset: number, interval: PaymentInterval): boolean {
  if (offset < 0) return false;
  return offset % MONTHS_PER_INTERVAL[interval] === 0;
}

/** Jahresbetrag einer Amortisation (Betrag pro Intervall hochgerechnet) */
function yearlyAmount(a: MortgageAmortizationInput): number {
  return Math.round((a.amount * 12) / MONTHS_PER_INTERVAL[a.interval]);
}

export function computeChSchedule(
  input: MortgageScheduleInput
): MortgageScheduleResult {
  const now = input.now ?? new Date();
  const months = Math.min(MAX_MONTHS, Math.max(0, input.months ?? 360));
  const startKey = monthKeyOf(now);
  const todayISO = `${startKey}-${String(now.getDate()).padStart(2, "0")}`;
  const warnings: MortgageWarning[] = [];
  const prop = input.property;

  /* ------------------------------ Ist-Zustand ----------------------------- */

  const trancheResults: MortgageTrancheResult[] = input.tranches.map(t => {
    const rate = effectiveRate(t);
    const yearlyInterest = applyBp(t.principal, rate);
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      principal: t.principal,
      effectiveRateBp: rate,
      yearlyInterest,
      interestPerPayment: Math.round(
        (yearlyInterest * MONTHS_PER_INTERVAL[t.paymentInterval]) / 12
      ),
      paymentInterval: t.paymentInterval,
      maturityDate: t.maturityDate,
      monthsToMaturity:
        t.maturityDate === null
          ? null
          : monthsBetween(startKey, t.maturityDate.slice(0, 7)),
    };
  });

  const totalDebt = input.tranches.reduce((s, t) => s + t.principal, 0);
  const yearlyInterestTotal = trancheResults.reduce(
    (s, t) => s + t.yearlyInterest,
    0
  );
  // Gewichteter Durchschnittszins: aus der Jahres-Zinslast zurückgerechnet,
  // damit er zu den angezeigten Beträgen passt
  const avgRateBp =
    totalDebt > 0 ? Math.round((yearlyInterestTotal * 10000) / totalDebt) : 0;

  const activeAmorts = input.amortizations.filter(
    a => a.active && (a.endDate === null || a.endDate >= todayISO)
  );
  const yearlyDirect = activeAmorts
    .filter(a => a.kind === "direct")
    .reduce((s, a) => s + yearlyAmount(a), 0);
  const yearlyIndirect = activeAmorts
    .filter(a => a.kind === "indirect")
    .reduce((s, a) => s + yearlyAmount(a), 0);

  /* ----------------------------- Belehnung -------------------------------- */

  const firstMortgageCap = applyBp(prop.marketValue, prop.firstMortgageLimitBp);
  const firstMortgage = Math.min(totalDebt, firstMortgageCap);
  const secondMortgage = Math.max(0, totalDebt - firstMortgageCap);
  const ltvBp =
    prop.marketValue > 0
      ? Math.round((totalDebt * 10000) / prop.marketValue)
      : null;
  const headroom = Math.max(
    0,
    applyBp(prop.marketValue, prop.maxLtvBp) - totalDebt
  );

  /* ---------------------------- Tragbarkeit ------------------------------- */

  // Pflicht ist die 2. Hypothek über die vorgegebene Frist — bewusst NICHT
  // die tatsächlich geleistete Amortisation, sonst wirkte ein Haushalt ohne
  // jede Amortisation rechnerisch tragbar.
  const requiredAmortization =
    prop.amortizationYears > 0
      ? Math.round(secondMortgage / prop.amortizationYears)
      : 0;
  const calcInterest = applyBp(totalDebt, prop.calcInterestRateBp);
  const maintenance = applyBp(prop.marketValue, prop.maintenanceRateBp);
  const totalCost = calcInterest + maintenance + requiredAmortization;
  const ratioBp =
    prop.householdIncome > 0
      ? Math.round((totalCost * 10000) / prop.householdIncome)
      : null;

  /* ---------------------------- Simulation -------------------------------- */

  const balances = input.tranches.map(t => t.principal);
  const trancheIndexById = new Map(input.tranches.map((t, i) => [t.id, i]));
  const rates = input.tranches.map(effectiveRate);

  const monthlyDebt: number[] = [totalDebt];
  const monthlyIndirect: number[] = [0];
  const series: MortgageSeriesPoint[] = [];
  let cumInterest = 0;
  let cumAmortized = 0;
  let indirectCapital = 0;

  const snapshot = (year: number) => {
    series.push({
      year,
      debt: balances.reduce((s, b) => s + b, 0),
      cumInterest,
      cumAmortized,
      indirectCapital,
      equity: prop.marketValue - balances.reduce((s, b) => s + b, 0),
    });
  };
  snapshot(now.getFullYear());

  for (let i = 1; i <= months; i += 1) {
    const key = addMonths(startKey, i);

    // Zins des Monats auf den jeweils aktuellen Stand (wird gezahlt, nicht
    // dem Kapital zugeschlagen — deshalb kein Zinseszins auf der Schuld)
    for (let t = 0; t < balances.length; t += 1) {
      cumInterest += Math.round((balances[t] * rates[t]) / 10000 / 12);
    }

    for (const a of input.amortizations) {
      if (!a.active) continue;
      const offset = monthsBetween(a.startDate.slice(0, 7), key);
      if (!firesInMonth(offset, a.interval)) continue;
      if (a.endDate !== null && key > a.endDate.slice(0, 7)) continue;

      if (a.kind === "indirect") {
        // Invariante: senkt die Schuld NICHT (siehe Modul-Kommentar oben)
        indirectCapital += a.amount;
        continue;
      }
      const idx =
        a.trancheId !== null ? trancheIndexById.get(a.trancheId) : undefined;
      if (idx === undefined) continue;
      const paid = Math.min(a.amount, balances[idx]);
      balances[idx] -= paid;
      cumAmortized += paid;
    }

    monthlyDebt.push(balances.reduce((s, b) => s + b, 0));
    monthlyIndirect.push(indirectCapital);

    const [year, month] = key.split("-").map(Number);
    if (month === 12 || i === months) snapshot(year);
  }

  /* ----------------------------- Hinweise --------------------------------- */

  if (prop.marketValue <= 0) {
    warnings.push({ kind: "no_market_value" });
  } else if (ltvBp !== null && ltvBp > prop.maxLtvBp) {
    warnings.push({ kind: "ltv_exceeded", ltvBp, maxLtvBp: prop.maxLtvBp });
  }

  if (prop.householdIncome <= 0) {
    warnings.push({ kind: "no_income" });
  } else if (ratioBp !== null && ratioBp > MAX_COST_RATIO_BP) {
    warnings.push({ kind: "affordability_exceeded", ratioBp });
  }

  const actualAmortization = yearlyDirect + yearlyIndirect;
  if (requiredAmortization > actualAmortization) {
    warnings.push({
      kind: "amortization_uncovered",
      required: requiredAmortization,
      actual: actualAmortization,
    });
  }

  for (const t of trancheResults) {
    if (
      t.maturityDate !== null &&
      t.monthsToMaturity !== null &&
      t.monthsToMaturity <= MATURITY_WARN_MONTHS
    ) {
      warnings.push({
        kind: t.monthsToMaturity < 0 ? "maturity_passed" : "maturity_due",
        tranche: t.name,
        date: t.maturityDate,
      });
    }
  }

  for (const t of input.tranches) {
    if (
      t.balanceDate !== null &&
      monthsBetween(t.balanceDate.slice(0, 7), startKey) >= STALE_BALANCE_MONTHS
    ) {
      warnings.push({
        kind: "stale_balance",
        tranche: t.name,
        date: t.balanceDate,
      });
    }
  }

  return {
    monthlyDebt,
    monthlyIndirect,
    series,
    tranches: trancheResults,
    totals: {
      debt: totalDebt,
      avgRateBp,
      yearlyInterest: yearlyInterestTotal,
      monthlyInterest: Math.round(yearlyInterestTotal / 12),
      monthlyDirectAmortization: Math.round(yearlyDirect / 12),
      monthlyIndirectAmortization: Math.round(yearlyIndirect / 12),
      monthlyBurden: Math.round(
        (yearlyInterestTotal + yearlyDirect + yearlyIndirect) / 12
      ),
    },
    ltv: { bp: ltvBp, firstMortgage, secondMortgage, headroom },
    affordability: {
      householdIncome: prop.householdIncome,
      calcInterest,
      maintenance,
      requiredAmortization,
      actualAmortization,
      totalCost,
      ratioBp,
      affordable: ratioBp === null ? null : ratioBp <= MAX_COST_RATIO_BP,
    },
    warnings,
  };
}

/** `YYYY-MM` um n Monate verschieben */
function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKeyOf(d);
}
