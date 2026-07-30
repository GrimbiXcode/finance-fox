/**
 * CH-Prognose des Vorsorge-Moduls (3-Säulen-Prinzip): monatliche Simulation
 * vom aktuellen Monat bis zum Rentenalter (max. 600 Monate).
 *
 * - Säule 2: Start = current_capital, monatlich yearly_savings/12 dazu (nur
 *   Pensionskassen; Freizügigkeitskonten werden nur verzinst), Verzinsung
 *   interest_rate_bp p.a. auf den Monat umgelegt. Jahresrente = Guthaben ×
 *   conversion_rate_bp/10000, Monatsrente = Jahresrente/12. Hat eine Kasse
 *   einen Stichtag (value_date), gilt das Guthaben per diesem Datum und die
 *   Akkumulation beginnt erst ab dessen Folgemonat (rückwirkend, wenn der
 *   Stichtag in der Vergangenheit liegt).
 *   Hat eine Pensionskasse Abstufungen (tiers) UND einen versicherten
 *   Jahreslohn, ersetzt der Stufensatz × Lohn das flache yearly_savings —
 *   die Stufe richtet sich nach dem Alter des Benutzers im jeweiligen
 *   Simulationsmonat (Geburtsmonat zählt bereits zum neuen Alter).
 * - Säule 3a: gleiche Akkumulation mit yearly_deposit; Start = Sync-Saldo des
 *   verknüpften Kontos (abzüglich in Sparzielen verplanter Anteile), sonst
 *   current_balance. Fiktive Entnahme: Endkapital über 20 Jahre (capital/240).
 * - AHV: erwartete Rente, wenn hinterlegt; sonst grobe Schätzung aus der
 *   Vollrente (CHF 2'520 = 302400 Cent) × Beitragsjahre/44 (estimated).
 *
 * Alle Beträge in Cent; Zwischenschritte werden monatlich auf Cent gerundet.
 */

export interface PensionFundTierInput {
  ageFrom: number;
  /** Sparbeitragssatz der Stufe (AN+AG vorsummiert), in Basispunkten */
  rateBp: number;
}

export interface PensionFundInput {
  kind: "pension_fund" | "vested_benefits";
  name: string;
  currentCapital: number;
  yearlySavings: number;
  interestRateBp: number;
  conversionRateBp: number;
  /** Versicherter Jahreslohn (Cent) — Basis der Abstufungs-Beiträge */
  insuredSalary: number | null;
  /** Abstufungen nach Alter, aufsteigend nach ageFrom (leer = flaches Sparen) */
  tiers: PensionFundTierInput[];
  /**
   * Stichtag der Angaben (YYYY-MM-DD, z. B. 31.12. des Ausweises) — das
   * Guthaben gilt per diesem Datum; die Simulation akkumuliert ab dem
   * Folgemonat des Stichtags (rückwirkend, wenn er in der Vergangenheit
   * liegt, verzögert, wenn er in der Zukunft liegt). null/undefined = ab
   * aktuellem Monat.
   */
  valueDate?: string | null;
}

export interface PensionPillar3Input {
  name: string;
  currentBalance: number;
  yearlyDeposit: number;
  interestRateBp: number;
  accountId: number | null;
  /** Saldo des verknüpften Kontos (Logik wie listAccounts), sonst null */
  syncedBalance?: number | null;
  /** In Sparzielen verplante Anteile des verknüpften Kontos (Cent) */
  goalCommitment?: number;
  /** Namen der Sparziele mit verplanten Anteilen (für die Warnung) */
  goalNames?: string[];
}

export interface PensionAhvInput {
  contributionYears: number | null;
  expectedMonthlyPension: number | null;
}

export interface ChForecastInput {
  birthDate: string; // YYYY-MM-DD
  retirementAge: number;
  funds: PensionFundInput[];
  pillar3: PensionPillar3Input[];
  ahv: PensionAhvInput | null;
  /** Aktuelles Netto (Cent) für die Ersatzrate; null ohne Lohnangaben */
  currentNet: number | null;
  /** Testbarer „heute"-Zeitpunkt (Default: jetzt) */
  now?: Date;
}

export interface PensionForecastResult {
  retirementDate: string; // YYYY-MM-DD
  series: { year: number; pillar2: number; pillar3: number; total: number }[];
  pillar2: { capital: number; monthlyPension: number };
  pillar3: { capital: number; monthlyWithdrawal: number };
  ahv: { monthlyPension: number; estimated: boolean };
  monthlyRetirementIncome: number;
  currentNet: number | null;
  /** Ersatzrate in Prozent (gerundet); null ohne Lohnangaben */
  replacementRate: number | null;
  /** Aufschlüsselung der Säule 2 pro Kasse (Endkapital, Monatsrente, Stufen) */
  funds: {
    name: string;
    capital: number;
    monthlyPension: number;
    /** Im Simulationsfenster wirksame Abstufungen (jede Stufe einmal) */
    phases: {
      ageFrom: number;
      fromYear: number;
      rateBp: number;
      yearlyContribution: number;
    }[];
  }[];
  /** Jahres-Snapshots pro Kasse — gleiche Jahre wie series */
  fundSeries: { name: string; points: { year: number; capital: number }[] }[];
  warnings: string[];
}

/** Maximale Simulationsdauer: 50 Jahre */
const MAX_MONTHS = 600;

/** Grobe AHV-Vollrente bei 44 Beitragsjahren (CHF 2'520/Monat, Stand 2025) */
const AHV_FULL_PENSION = 302400;
const AHV_FULL_YEARS = 44;

/** Monatsschritt der Akkumulation: Einzahlung + Monatszins, auf Cent gerundet */
function accumulateMonth(capital: number, yearlyAdd: number, rateBp: number) {
  return Math.round(capital + yearlyAdd / 12 + (capital * rateBp) / 10000 / 12);
}

/** Nutzt die Kasse Abstufungen statt des flachen yearly_savings? */
function usesTiers(fund: PensionFundInput) {
  return (
    fund.kind === "pension_fund" &&
    fund.tiers.length > 0 &&
    fund.insuredSalary != null &&
    fund.insuredSalary > 0
  );
}

/** Index der wirksamen Stufe: grösstes ageFrom ≤ Alter (-1 = noch keine) */
function tierIndexAt(tiers: PensionFundTierInput[], age: number) {
  let idx = -1;
  for (let t = 0; t < tiers.length; t++) {
    if (tiers[t].ageFrom <= age) idx = t;
    else break;
  }
  return idx;
}

/** Jahresbeitrag (Cent) einer Kasse im Simulationsmonat mit gegebenem Alter */
function yearlyContributionFor(fund: PensionFundInput, age: number) {
  if (fund.kind !== "pension_fund") return 0; // Freizügigkeit: nur Zins
  if (usesTiers(fund)) {
    const idx = tierIndexAt(fund.tiers, age);
    if (idx < 0) return 0; // alle Stufen liegen in der Zukunft
    return Math.round((fund.tiers[idx].rateBp * fund.insuredSalary!) / 10000);
  }
  return fund.yearlySavings;
}

export function computeChForecast(
  input: ChForecastInput
): PensionForecastResult {
  const warnings: string[] = [];
  const now = input.now ?? new Date();

  const [birthYear, birthMonth, birthDay] = input.birthDate
    .split("-")
    .map(Number);
  const retirementDate = `${birthYear + input.retirementAge}-${String(
    birthMonth
  ).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;

  // Simulationsdauer: aktueller Monat → Rentenmonat (0..600)
  const months = Math.min(
    MAX_MONTHS,
    Math.max(
      0,
      (birthYear + input.retirementAge - now.getFullYear()) * 12 +
        (birthMonth - (now.getMonth() + 1))
    )
  );

  // Säule 2: pro Konto akkumulieren (Freizügigkeit nur mit Zins).
  // Abstufungen defensiv sortieren (Vertrag: aufsteigend nach ageFrom).
  const funds = input.funds.map(f => ({
    ...f,
    tiers: [...f.tiers].sort((a, b) => a.ageFrom - b.ageFrom),
  }));
  const fundCapitals = funds.map(f => f.currentCapital);

  // Alter in einem Simulationsmonat (0 = aktueller Monat, negative Werte =
  // Monate davor) — der Geburtsmonat zählt bereits zum neuen Alter.
  const floorMod = (a: number, b: number) => ((a % b) + b) % b;
  const ageAt = (i: number) => {
    const simYear = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
    const simMonth = floorMod(now.getMonth() + i, 12) + 1; // 1-basiert
    return simYear - birthYear - (simMonth < birthMonth ? 1 : 0);
  };
  const yearAt = (i: number) =>
    now.getFullYear() + Math.floor((now.getMonth() + i) / 12);

  // Stichtag der Angaben: Monatsindex, ab dem die Kasse akkumuliert
  // (i < startI = vor dem Folgemonat des Stichtags → keine Akkumulation;
  // startI <= 0 = Rückwirkung vor dem aktuellen Monat).
  const fundStartI = funds.map(f => {
    if (!f.valueDate) return 1;
    const [vy, vm] = f.valueDate.split("-").map(Number);
    if (!vy || !vm) return 1;
    const off =
      (now.getFullYear() - vy) * 12 + (now.getMonth() + 1 - vm); // vd → now
    return 1 - off;
  });
  // Rückwirkende Akkumulation vom Stichtag bis zum aktuellen Monat
  for (let f = 0; f < funds.length; f++) {
    for (let k = fundStartI[f]; k <= 0; k++) {
      fundCapitals[f] = accumulateMonth(
        fundCapitals[f],
        yearlyContributionFor(funds[f], ageAt(k)),
        funds[f].interestRateBp
      );
    }
  }

  // Wirksame Stufen pro Kasse mitverfolgen (für die phases-Aufschlüsselung)
  const fundPhases = funds.map(
    (): PensionForecastResult["funds"][number]["phases"] => []
  );
  const lastTierIdx = funds.map((f, fi) => {
    if (!usesTiers(f)) return -2; // kein Stufen-Modus
    const idx = tierIndexAt(f.tiers, ageAt(0));
    if (idx >= 0) {
      fundPhases[fi].push({
        ageFrom: f.tiers[idx].ageFrom,
        fromYear: yearAt(0),
        rateBp: f.tiers[idx].rateBp,
        yearlyContribution: Math.round(
          (f.tiers[idx].rateBp * f.insuredSalary!) / 10000
        ),
      });
    }
    return idx;
  });
  // Säule 3a: Start = Sync-Saldo (abzügl. verplanter Anteile) oder Saldo
  const pillar3Capitals = input.pillar3.map(p => {
    let start = p.currentBalance;
    if (p.accountId !== null && p.syncedBalance != null) {
      const commitment = p.goalCommitment ?? 0;
      start = Math.max(0, p.syncedBalance - commitment);
      if (commitment > 0 && (p.goalNames?.length ?? 0) > 0) {
        warnings.push(
          `Bei „${p.name}“ sind Anteile im Sparziel „${p.goalNames!.join(
            "“, „"
          )}“ verplant — verplante Anteile zählen nicht als 3a-Guthaben.`
        );
      }
    }
    return start;
  });

  const series: PensionForecastResult["series"] = [];
  const fundSeries: PensionForecastResult["fundSeries"] = funds.map(f => ({
    name: f.name,
    points: [],
  }));
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const snapshot = (year: number) => {
    const pillar2 = sum(fundCapitals);
    const pillar3 = sum(pillar3Capitals);
    series.push({ year, pillar2, pillar3, total: pillar2 + pillar3 });
    for (let f = 0; f < fundCapitals.length; f++) {
      fundSeries[f].points.push({ year, capital: fundCapitals[f] });
    }
  };
  snapshot(now.getFullYear());

  for (let i = 1; i <= months; i++) {
    const age = ageAt(i);
    for (let f = 0; f < funds.length; f++) {
      const fund = funds[f];
      // vor dem Folgemonat des Stichtags wird nicht akkumuliert
      if (i >= fundStartI[f]) {
        fundCapitals[f] = accumulateMonth(
          fundCapitals[f],
          yearlyContributionFor(fund, age),
          fund.interestRateBp
        );
      }
      // Stufenwechsel protokollieren (jede neu wirksame Stufe einmal)
      if (usesTiers(fund)) {
        const idx = tierIndexAt(fund.tiers, age);
        if (idx > lastTierIdx[f]) {
          for (let t = Math.max(0, lastTierIdx[f] + 1); t <= idx; t++) {
            fundPhases[f].push({
              ageFrom: fund.tiers[t].ageFrom,
              fromYear: yearAt(i),
              rateBp: fund.tiers[t].rateBp,
              yearlyContribution: Math.round(
                (fund.tiers[t].rateBp * fund.insuredSalary!) / 10000
              ),
            });
          }
          lastTierIdx[f] = idx;
        }
      }
    }
    for (let p = 0; p < input.pillar3.length; p++) {
      pillar3Capitals[p] = accumulateMonth(
        pillar3Capitals[p],
        input.pillar3[p].yearlyDeposit,
        input.pillar3[p].interestRateBp
      );
    }
    const monthIndex = (now.getMonth() + i) % 12; // 0-basiert, 11 = Dezember
    const year = yearAt(i);
    if (monthIndex === 11 || i === months) snapshot(year);
  }

  // Säule 2: Jahresrente = Guthaben × Umwandlungssatz, Monatsrente = /12
  const pillar2Capital = sum(fundCapitals);
  const yearlyPension2 = funds.reduce(
    (total, f, i) => total + (fundCapitals[i] * f.conversionRateBp) / 10000,
    0
  );
  const pillar2 = {
    capital: pillar2Capital,
    monthlyPension: Math.round(yearlyPension2 / 12),
  };
  // Aufschlüsselung pro Kasse: Endkapital, eigene Monatsrente, wirksame Stufen
  const fundsResult: PensionForecastResult["funds"] = funds.map((f, i) => ({
    name: f.name,
    capital: fundCapitals[i],
    monthlyPension: Math.round(
      (fundCapitals[i] * f.conversionRateBp) / 10000 / 12
    ),
    phases: fundPhases[i],
  }));

  // Säule 3a: Endkapital + fiktive Entnahme über 20 Jahre
  const pillar3Capital = sum(pillar3Capitals);
  const pillar3 = {
    capital: pillar3Capital,
    monthlyWithdrawal: Math.round(pillar3Capital / 240),
  };

  // Säule 1 (AHV): hinterlegte Rente oder grobe Schätzung aus Beitragsjahren
  let ahv: PensionForecastResult["ahv"];
  if (input.ahv?.expectedMonthlyPension != null) {
    ahv = {
      monthlyPension: input.ahv.expectedMonthlyPension,
      estimated: false,
    };
  } else if (input.ahv?.contributionYears != null) {
    ahv = {
      monthlyPension: Math.round(
        (AHV_FULL_PENSION * input.ahv.contributionYears) / AHV_FULL_YEARS
      ),
      estimated: true,
    };
  } else {
    ahv = { monthlyPension: 0, estimated: true };
    warnings.push(
      "Keine AHV-Angaben hinterlegt — die Prognose enthält keine AHV-Rente."
    );
  }

  const monthlyRetirementIncome =
    pillar2.monthlyPension + pillar3.monthlyWithdrawal + ahv.monthlyPension;
  const replacementRate =
    input.currentNet != null && input.currentNet > 0
      ? Math.round((monthlyRetirementIncome / input.currentNet) * 100)
      : null;

  return {
    retirementDate,
    series,
    pillar2,
    pillar3,
    ahv,
    monthlyRetirementIncome,
    currentNet: input.currentNet,
    replacementRate,
    funds: fundsResult,
    fundSeries,
    warnings,
  };
}
