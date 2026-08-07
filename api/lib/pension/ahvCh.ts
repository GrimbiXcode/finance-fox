/**
 * Berechnung der schweizerischen AHV-Altersrente — reine Funktionen, keine
 * Datenbank (die Zeilen kommen geladen herein, Muster `mortgage/portfolio.ts`
 * und `forecastEngine.ts`).
 *
 * Bis hierher war die AHV in der Prognose eine lineare Schätzung
 * (`Vollrente × Beitragsjahre / 44`). Das ist fachlich falsch und irrt nach
 * oben: Die Rente hängt am **massgebenden durchschnittlichen Jahreseinkommen**
 * (mdJE) und ist stark degressiv — zwischen CHF 15'120 und 90'720 mdJE
 * verdoppelt sie sich gerade einmal.
 *
 * Umgesetzt ist die Rentenformel nach Art. 34 AHVG, wie sie Merkblatt 3.01
 * beschreibt. Mit `MIN` = monatliche Mindestrente:
 *
 *   mdJE ≤ 36 × MIN   →  0.74 × MIN + (13/600) × mdJE
 *   mdJE > 36 × MIN   →  1.04 × MIN + ( 8/600) × mdJE
 *
 * gedeckelt bei 2 × MIN, Untergrenze MIN. Das mdJE wird vorher auf den
 * nächsten Wert der amtlichen Rententabelle **aufgerundet**.
 *
 * Die Rundungsschritte folgen den Rechenbeispielen des Merkblatts (Ziffern 30
 * und 31): Durchschnitte, Gutschriften und Renten stehen dort auf **ganzen
 * Franken**. `api/ahvCh.test.ts` rechnet beide Beispiele nach — weicht eine
 * Rundung ab, fällt das dort auf.
 *
 * Alle Beträge in Cent, alle Sätze in Basispunkten.
 */

import {
  AHV_FULL_SCALE,
  AHV_RATIOS_BP,
  DEFERRAL_INCREASE_BP,
  EARLY_REDUCTION_BP,
  MAX_DEFERRAL_MONTHS,
  PARTIAL_SHARE_MAX_PCT,
  PARTIAL_SHARE_MIN_PCT,
  ahvParametersFor,
  earliestWithdrawalAgeMonths,
  formulaBreakpoint,
  isTransitionGeneration,
  referenceAgeMonths,
  type AhvGender,
  type AhvParameters,
} from "./ahvParameters";

/* --------------------------------- Eingabe -------------------------------- */

/** Status eines Kalenderjahres in der Beitragsdauer */
export type AhvYearStatus = "employed" | "non_employed" | "gap" | "youth";

/** Anteil einer Gutschrift: ganz, halb (verheiratet) oder keine */
export type AhvCreditShare = "none" | "full" | "half";

export interface AhvYearInput {
  year: number;
  /** Gemeldetes Erwerbseinkommen des Jahres (Cent) */
  income: number;
  status: AhvYearStatus;
  parentingCredit: AhvCreditShare;
  careCredit: AhvCreditShare;
}

export interface AhvSplittingInput {
  /** Kalenderjahre der Ehe, deren Einkommen geteilt werden */
  marriageYears: number[];
  /** Erwerbseinkommen des Ehepartners je Jahr (Cent) */
  partnerIncomes: Record<number, number>;
}

export interface AhvWithdrawalInput {
  mode: "none" | "early" | "deferral";
  /** Volle Monate Vorbezug bzw. Aufschub */
  months: number;
  /** Bezogener bzw. aufgeschobener Anteil in Prozent (20–80; 100 = ganz) */
  sharePct: number;
}

export interface AhvComputeInput {
  birthDate: string; // YYYY-MM-DD
  gender: AhvGender;
  /** Jahreszeilen der Beitragsdauer (IK-Auszug) */
  years: AhvYearInput[];
  /** Erstes Jahr mit IK-Eintrag — bestimmt den Aufwertungsfaktor */
  firstIkYear: number | null;
  withdrawal?: AhvWithdrawalInput;
  /** Einkommensteilung; null = verheiratet-ohne-Daten bzw. nicht verheiratet */
  splitting?: AhvSplittingInput | null;
  /**
   * Monatliche Altersrente des Ehepartners (Cent) für die Plafonierung.
   * null = keine wirksame Verknüpfung, es wird nicht plafoniert.
   */
  partnerPensionMonthly?: number | null;
}

/* -------------------------------- Warnungen ------------------------------- */

/**
 * Strukturierte Hinweise — die deutschen Sätze baut erst das Frontend
 * (`ahvWarningText`), damit Beträge und Prozente locale-konform formatiert
 * werden. Gleiche Begründung wie bei `MortgageWarning` und `InsuranceGap`.
 */
export type AhvWarning =
  | { kind: "contributionGaps"; missingYears: number; lostShareBp: number }
  | { kind: "noYears" }
  | { kind: "noFirstIkYear" }
  | { kind: "transitionGeneration"; birthYear: number }
  | { kind: "cappedByCouple"; uncapped: number; capped: number }
  | { kind: "belowMinimum" }
  | { kind: "noSplittingData" }
  | { kind: "earlyWithdrawalNoChildPension" };

/* -------------------------------- Ergebnis -------------------------------- */

export interface AhvResult {
  /** Referenzalter in Monaten und das Datum, an dem es erreicht wird */
  referenceAgeMonths: number;
  referenceDate: string; // YYYY-MM-DD
  /** Tatsächlicher Rentenbeginn nach Vorbezug/Aufschub */
  pensionStartDate: string; // YYYY-MM-DD

  /** Aufschlüsselung des massgebenden durchschnittlichen Jahreseinkommens */
  income: {
    /** Summe der (ggf. gesplitteten) Erwerbseinkommen */
    rawSum: number;
    revaluationFactorBp: number;
    revaluedSum: number;
    averageIncome: number;
    averageParentingCredit: number;
    averageCareCredit: number;
    /** mdJE vor dem Aufrunden auf das Tabellenraster */
    relevantIncomeRaw: number;
    /** mdJE, auf den Tabellenwert aufgerundet */
    relevantIncome: number;
  };

  /** Beitragsdauer und Rentenskala */
  duration: {
    contributionYears: number;
    /** Beitragsjahre, die der Jahrgang aufweisen müsste */
    cohortYears: number;
    missingYears: number;
    /** Rentenskala 1–44 */
    scale: number;
  };

  /** Monatliche Vollrente (Skala 44) beim ermittelten mdJE */
  fullPensionMonthly: number;
  /** Monatsrente nach Rentenskala, vor Vorbezug/Aufschub */
  scaledPensionMonthly: number;
  /** Monatsrente nach Vorbezug/Aufschub */
  adjustedPensionMonthly: number;
  /** Monatsrente nach Plafonierung — der auszuzahlende Betrag */
  monthlyPension: number;
  /** Wirksame Kürzung/Erhöhung in Basispunkten (negativ = Kürzung) */
  withdrawalAdjustmentBp: number;
  /** 13. Altersrente ab 2026: ein Zwölftel der Jahresrente */
  thirteenthPension: number;
  /** Jahresrente inklusive 13. Altersrente */
  yearlyPension: number;

  /** Abgeleitete Renten beim selben mdJE (Merkblatt 3.03) */
  derived: {
    survivorSpouse: number;
    orphan: number;
    widowedOwnPension: number;
    childPension: number;
  };

  warnings: AhvWarning[];
}

/* --------------------------------- Helfer --------------------------------- */

/** Auf ganze Franken runden (die Merkblätter rechnen in Franken) */
function toWholeFrancs(cents: number): number {
  return Math.round(cents / 100) * 100;
}

/** Jahr aus einem ISO-Datum */
function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Datum um n Monate verschieben, Tag auf 1 (Rentenbeginn ist immer monatlich) */
function shiftMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Anteil einer Gutschrift als Faktor. „half" ist der Regelfall bei
 * Verheirateten: Die Gutschrift wird für die Kalenderjahre der Ehe je zur
 * Hälfte auf beide Ehepartner verteilt (Merkblatt 3.01 Ziffer 19).
 */
function creditFactor(share: AhvCreditShare): number {
  if (share === "full") return 1;
  if (share === "half") return 0.5;
  return 0;
}

/* ------------------------------ Rentenformel ------------------------------ */

/**
 * mdJE auf den nächsten Wert der amtlichen Rententabelle aufrunden.
 * Das Raster beginnt bei der jährlichen Mindestrente und steigt in Schritten
 * von einem Zehntel davon (Merkblatt 3.01, Tabelle „Skala 44").
 */
export function roundToTableStep(
  relevantIncome: number,
  params: AhvParameters
): number {
  const base = params.minPensionMonthly * 12;
  if (relevantIncome <= base) return base;
  const steps = Math.ceil((relevantIncome - base) / params.incomeStep);
  return base + steps * params.incomeStep;
}

/**
 * Monatliche Vollrente (Rentenskala 44) aus dem massgebenden
 * durchschnittlichen Jahreseinkommen — die Rentenformel nach Art. 34 AHVG.
 */
export function fullPension(
  relevantIncome: number,
  params: AhvParameters
): number {
  const mdJE = roundToTableStep(relevantIncome, params);
  const min = params.minPensionMonthly;
  const monthly =
    mdJE <= formulaBreakpoint(params)
      ? 0.74 * min + (13 / 600) * mdJE
      : 1.04 * min + (8 / 600) * mdJE;
  const rounded = toWholeFrancs(monthly);
  return Math.min(Math.max(rounded, min), params.maxPensionMonthly);
}

/**
 * Teilrente nach Rentenskala: Ein fehlendes Beitragsjahr kostet in der Regel
 * 1/44 der Rente (Merkblatt 3.01 Ziffer 13). Die amtlichen Skalen 1–43 können
 * im Detail leicht abweichen; diese Näherung ist die im Merkblatt selbst
 * genannte Regel.
 */
export function applyScale(full: number, scale: number): number {
  if (scale >= AHV_FULL_SCALE) return full;
  return toWholeFrancs((full * scale) / AHV_FULL_SCALE);
}

/** Kürzungssatz beim Vorbezug in Basispunkten (Merkblatt 3.04 Ziffer 4) */
export function earlyReductionBp(months: number): number {
  const clamped = Math.max(0, Math.min(months, EARLY_REDUCTION_BP.length - 1));
  return EARLY_REDUCTION_BP[clamped];
}

/** Erhöhungssatz beim Aufschub in Basispunkten (Merkblatt 3.04 Ziffer 14) */
export function deferralIncreaseBp(months: number): number {
  if (months < 12) return 0;
  const capped = Math.min(months, MAX_DEFERRAL_MONTHS);
  const yearIndex = Math.min(Math.floor(capped / 12), 5) - 1;
  const band = Math.min(Math.floor((capped % 12) / 3), 3);
  return DEFERRAL_INCREASE_BP[yearIndex][band];
}

/**
 * Plafonierung der Renten eines Ehepaars auf 150 % der Maximalrente.
 * Formel aus Merkblatt 3.01 Ziffer 23:
 *
 *   eigene Rente × Plafonierungsgrenze ÷ (eigene Rente + Rente des Partners)
 */
export function applyCouplesCap(
  own: number,
  partner: number,
  params: AhvParameters
): number {
  const total = own + partner;
  if (total <= params.couplesCapMonthly || total === 0) return own;
  return toWholeFrancs((own * params.couplesCapMonthly) / total);
}

/* ------------------------------ Hauptrechnung ----------------------------- */

export function computeAhv(input: AhvComputeInput): AhvResult {
  const warnings: AhvWarning[] = [];
  const birthYear = yearOf(input.birthDate);
  const refMonths = referenceAgeMonths(birthYear, input.gender);
  const referenceDate = shiftMonths(input.birthDate, refMonths);
  const params = ahvParametersFor(yearOf(referenceDate));

  if (isTransitionGeneration(birthYear, input.gender)) {
    warnings.push({ kind: "transitionGeneration", birthYear });
  }

  /* --- Beitragsdauer: 1. Januar nach dem 20. Geburtstag bis Referenzalter -- */

  const firstMandatoryYear = birthYear + 21;
  const lastMandatoryYear = yearOf(referenceDate) - 1;
  const cohortYears = Math.max(0, lastMandatoryYear - firstMandatoryYear + 1);

  const mandatory = input.years.filter(
    y => y.year >= firstMandatoryYear && y.year <= lastMandatoryYear
  );
  const contributing = mandatory.filter(y => y.status !== "gap");
  // Jugendjahre (18–20) füllen später entstandene Lücken auf (Ziffer 15)
  const youthYears = input.years.filter(
    y => y.year < firstMandatoryYear && y.status !== "gap"
  ).length;

  const rawMissing = Math.max(0, cohortYears - contributing.length);
  const missingYears = Math.max(0, rawMissing - youthYears);
  const contributionYears = cohortYears - missingYears;
  const scale = Math.max(1, AHV_FULL_SCALE - missingYears);

  if (input.years.length === 0) warnings.push({ kind: "noYears" });
  if (missingYears > 0) {
    warnings.push({
      kind: "contributionGaps",
      missingYears,
      lostShareBp: Math.round((missingYears / AHV_FULL_SCALE) * 10000),
    });
  }

  /* ------------------------- Durchschnittseinkommen ----------------------- */

  const splitYears = new Set(input.splitting?.marriageYears ?? []);
  const partnerIncomes = input.splitting?.partnerIncomes ?? {};
  const rawSum = contributing.reduce((sum, y) => {
    // Einkommensteilung: In den Kalenderjahren der Ehe zählt für beide
    // Ehepartner der halbe gemeinsame Betrag (Merkblatt 3.01 Ziffer 18)
    if (splitYears.has(y.year)) {
      return sum + Math.round((y.income + (partnerIncomes[y.year] ?? 0)) / 2);
    }
    return sum + y.income;
  }, 0);

  const revaluationFactorBp = input.firstIkYear
    ? (params.revaluationFactorsBp[input.firstIkYear] ?? 10000)
    : 10000;
  if (input.firstIkYear === null && input.years.length > 0) {
    warnings.push({ kind: "noFirstIkYear" });
  }

  const revaluedSum = toWholeFrancs((rawSum * revaluationFactorBp) / 10000);
  const duration = contributionYears > 0 ? contributionYears : 1;
  const averageIncome = toWholeFrancs(revaluedSum / duration);

  const creditSum = (pick: (y: AhvYearInput) => AhvCreditShare) =>
    mandatory.reduce(
      (sum, y) => sum + params.creditAnnual * creditFactor(pick(y)),
      0
    );
  const averageParentingCredit = toWholeFrancs(
    creditSum(y => y.parentingCredit) / duration
  );
  const averageCareCredit = toWholeFrancs(
    creditSum(y => y.careCredit) / duration
  );

  const relevantIncomeRaw =
    averageIncome + averageParentingCredit + averageCareCredit;
  const relevantIncome = roundToTableStep(relevantIncomeRaw, params);

  if (relevantIncomeRaw < params.minPensionMonthly * 12) {
    warnings.push({ kind: "belowMinimum" });
  }
  if (splitYears.size === 0 && input.partnerPensionMonthly != null) {
    warnings.push({ kind: "noSplittingData" });
  }

  /* ------------------------------- Rentenhöhe ----------------------------- */

  const fullPensionMonthly = fullPension(relevantIncome, params);
  const scaledPensionMonthly = applyScale(fullPensionMonthly, scale);

  const withdrawal = input.withdrawal ?? {
    mode: "none" as const,
    months: 0,
    sharePct: 100,
  };
  /**
   * Man kann **entweder die ganze Rente** vorbeziehen bzw. aufschieben
   * **oder einen Anteil von 20–80 %** (Merkblatt 3.04 Ziffern 2 und 12).
   * Die Spanne gilt also nur für den Teilbezug — 100 % ist zulässig und darf
   * nicht auf 80 % geklemmt werden.
   */
  const effectiveShare =
    withdrawal.mode === "none" || withdrawal.sharePct >= 100
      ? 100
      : Math.min(
          PARTIAL_SHARE_MAX_PCT,
          Math.max(PARTIAL_SHARE_MIN_PCT, withdrawal.sharePct)
        );

  let withdrawalAdjustmentBp = 0;
  let adjustedPensionMonthly = scaledPensionMonthly;
  if (withdrawal.mode === "early" && withdrawal.months > 0) {
    withdrawalAdjustmentBp = -earlyReductionBp(withdrawal.months);
    warnings.push({ kind: "earlyWithdrawalNoChildPension" });
  } else if (withdrawal.mode === "deferral" && withdrawal.months >= 12) {
    withdrawalAdjustmentBp = deferralIncreaseBp(withdrawal.months);
  }
  if (withdrawalAdjustmentBp !== 0) {
    // Bei einem Teilbezug wirkt der Satz nur auf den betroffenen Anteil
    // (Merkblatt 3.04 Ziffer 4): der Rest bleibt unverändert.
    const affected = (scaledPensionMonthly * effectiveShare) / 100;
    const untouched = scaledPensionMonthly - affected;
    adjustedPensionMonthly = toWholeFrancs(
      untouched + affected * (1 + withdrawalAdjustmentBp / 10000)
    );
  }

  const monthlyPension =
    input.partnerPensionMonthly != null
      ? applyCouplesCap(
          adjustedPensionMonthly,
          input.partnerPensionMonthly,
          params
        )
      : adjustedPensionMonthly;

  if (monthlyPension < adjustedPensionMonthly) {
    warnings.push({
      kind: "cappedByCouple",
      uncapped: adjustedPensionMonthly,
      capped: monthlyPension,
    });
  }

  // 13. Altersrente ab 2026: ein Zwölftel der Jahresrente, auf ganze Franken
  // (Merkblatt 3.01 Ziffer 4)
  const thirteenthPension = toWholeFrancs(monthlyPension);

  // Der Anspruch entsteht am ersten Tag des Monats, welcher der Vollendung
  // des Referenzalters folgt (Merkblatt 3.01 Ziffer 1) — deshalb +1 Monat.
  const ordinaryStart = shiftMonths(referenceDate, 1);
  const pensionStartDate =
    withdrawal.mode === "early"
      ? shiftMonths(ordinaryStart, -withdrawal.months)
      : withdrawal.mode === "deferral"
        ? shiftMonths(ordinaryStart, withdrawal.months)
        : ordinaryStart;

  return {
    referenceAgeMonths: refMonths,
    referenceDate,
    pensionStartDate,
    income: {
      rawSum,
      revaluationFactorBp,
      revaluedSum,
      averageIncome,
      averageParentingCredit,
      averageCareCredit,
      relevantIncomeRaw,
      relevantIncome,
    },
    duration: {
      contributionYears,
      cohortYears,
      missingYears,
      scale,
    },
    fullPensionMonthly,
    scaledPensionMonthly,
    adjustedPensionMonthly,
    monthlyPension,
    withdrawalAdjustmentBp,
    thirteenthPension,
    yearlyPension: monthlyPension * 12 + thirteenthPension,
    derived: derivedPensions(fullPensionMonthly, scale, params),
    warnings,
  };
}

/**
 * Abgeleitete Renten beim selben massgebenden Einkommen (Merkblatt 3.03):
 * Witwen-/Witwerrente 80 %, Waisen- und Kinderrente 40 %, eigene Altersrente
 * für Verwitwete 120 % — Letztere gedeckelt bei der Maximalrente.
 */
function derivedPensions(
  full: number,
  scale: number,
  params: AhvParameters
): AhvResult["derived"] {
  const scaled = (bp: number) =>
    applyScale(toWholeFrancs((full * bp) / 10000), scale);
  return {
    survivorSpouse: scaled(AHV_RATIOS_BP.survivorSpouse),
    orphan: scaled(AHV_RATIOS_BP.orphan),
    widowedOwnPension: Math.min(
      scaled(AHV_RATIOS_BP.widowedSupplement),
      applyScale(params.maxPensionMonthly, scale)
    ),
    childPension: scaled(AHV_RATIOS_BP.orphan),
  };
}

/* ------------------------------- Varianten -------------------------------- */

export interface AhvVariant {
  key: string;
  mode: "early" | "reference" | "deferral";
  months: number;
  startDate: string;
  monthlyPension: number;
  yearlyPension: number;
  adjustmentBp: number;
}

/**
 * Vergleich der Bezugsvarianten: Vorbezug, Bezug ab Referenzalter, Aufschub.
 * Genau diese Gegenüberstellung ist die Entscheidungsgrundlage — die
 * Monatsrente allein sagt nichts darüber, ob sich ein Aufschub lohnt.
 */
export function computeAhvVariants(input: AhvComputeInput): AhvVariant[] {
  const birthYear = yearOf(input.birthDate);
  const refMonths = referenceAgeMonths(birthYear, input.gender);
  const earliest = earliestWithdrawalAgeMonths(birthYear, input.gender);
  const maxEarlyMonths = Math.min(refMonths - earliest, 24);

  const variants: AhvVariant[] = [];
  const build = (
    key: string,
    mode: AhvVariant["mode"],
    months: number,
    withdrawal: AhvWithdrawalInput
  ) => {
    const result = computeAhv({ ...input, withdrawal });
    variants.push({
      key,
      mode,
      months,
      startDate: result.pensionStartDate,
      monthlyPension: result.monthlyPension,
      yearlyPension: result.yearlyPension,
      adjustmentBp: result.withdrawalAdjustmentBp,
    });
  };

  for (let months = maxEarlyMonths; months >= 12; months -= 12) {
    build(`early-${months}`, "early", months, {
      mode: "early",
      months,
      sharePct: 100,
    });
  }
  build("reference", "reference", 0, {
    mode: "none",
    months: 0,
    sharePct: 100,
  });
  for (let months = 12; months <= MAX_DEFERRAL_MONTHS; months += 12) {
    build(`deferral-${months}`, "deferral", months, {
      mode: "deferral",
      months,
      sharePct: 100,
    });
  }
  return variants;
}
