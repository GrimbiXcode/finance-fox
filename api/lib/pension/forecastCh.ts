/**
 * CH-Prognose des Vorsorge-Moduls (3-Säulen-Prinzip): monatliche Simulation
 * vom aktuellen Monat bis zum Rentenalter (max. 600 Monate).
 *
 * - Säule 2: Start = current_capital, monatlich yearly_savings/12 dazu (nur
 *   Pensionskassen; Freizügigkeitskonten werden nur verzinst), Verzinsung
 *   interest_rate_bp p.a. auf den Monat umgelegt. Jahresrente = Guthaben ×
 *   conversion_rate_bp/10000, Monatsrente = Jahresrente/12.
 * - Säule 3a: gleiche Akkumulation mit yearly_deposit; Start = Sync-Saldo des
 *   verknüpften Kontos (abzüglich in Sparzielen verplanter Anteile), sonst
 *   current_balance. Fiktive Entnahme: Endkapital über 20 Jahre (capital/240).
 * - AHV: erwartete Rente, wenn hinterlegt; sonst grobe Schätzung aus der
 *   Vollrente (CHF 2'520 = 302400 Cent) × Beitragsjahre/44 (estimated).
 *
 * Alle Beträge in Cent; Zwischenschritte werden monatlich auf Cent gerundet.
 */

export interface PensionFundInput {
  kind: "pension_fund" | "vested_benefits";
  currentCapital: number;
  yearlySavings: number;
  interestRateBp: number;
  conversionRateBp: number;
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

  // Säule 2: pro Konto akkumulieren (Freizügigkeit nur mit Zins)
  const fundCapitals = input.funds.map(f => f.currentCapital);
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
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const snapshot = (year: number) => {
    const pillar2 = sum(fundCapitals);
    const pillar3 = sum(pillar3Capitals);
    series.push({ year, pillar2, pillar3, total: pillar2 + pillar3 });
  };
  snapshot(now.getFullYear());

  for (let i = 1; i <= months; i++) {
    for (let f = 0; f < input.funds.length; f++) {
      const fund = input.funds[f];
      fundCapitals[f] = accumulateMonth(
        fundCapitals[f],
        fund.kind === "pension_fund" ? fund.yearlySavings : 0,
        fund.interestRateBp
      );
    }
    for (let p = 0; p < input.pillar3.length; p++) {
      pillar3Capitals[p] = accumulateMonth(
        pillar3Capitals[p],
        input.pillar3[p].yearlyDeposit,
        input.pillar3[p].interestRateBp
      );
    }
    const monthIndex = (now.getMonth() + i) % 12; // 0-basiert, 11 = Dezember
    const year = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
    if (monthIndex === 11 || i === months) snapshot(year);
  }

  // Säule 2: Jahresrente = Guthaben × Umwandlungssatz, Monatsrente = /12
  const pillar2Capital = sum(fundCapitals);
  const yearlyPension2 = input.funds.reduce(
    (total, f, i) => total + (fundCapitals[i] * f.conversionRateBp) / 10000,
    0
  );
  const pillar2 = {
    capital: pillar2Capital,
    monthlyPension: Math.round(yearlyPension2 / 12),
  };

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
    warnings,
  };
}
