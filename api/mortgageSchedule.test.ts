import { describe, expect, it } from "vitest";
import { getMortgageCalculator } from "./lib/mortgage";
import { mortgageDebtProjection } from "./lib/mortgage/portfolio";
import {
  computeChSchedule,
  MAX_COST_RATIO_BP,
  type MortgageAmortizationInput,
  type MortgageScheduleInput,
  type MortgageTrancheInput,
} from "./lib/mortgage/scheduleCh";

/**
 * Reine Engine-Tests: fixer „heute"-Zeitpunkt, exakte Cent-Erwartungen.
 * Die beiden Invarianten (indirekte Amortisation senkt die Schuld nicht /
 * direkte senkt sie exakt auf ihrem Raster) sind das Regressionsnetz gegen
 * doppelt gezähltes Vermögen — siehe forecastRouter.
 */

/** Januar 2026 als deterministisches „heute" */
const NOW = new Date(2026, 0, 15);

const tranche = (
  over: Partial<MortgageTrancheInput> = {}
): MortgageTrancheInput => ({
  id: 1,
  name: "Festhypothek",
  kind: "fixed",
  principal: 60_000_000, // 600'000.00
  balanceDate: null,
  interestRateBp: 150, // 1,50 %
  marginBp: null,
  maturityDate: "2031-03-31",
  paymentInterval: "quarterly",
  ...over,
});

const BASE: MortgageScheduleInput = {
  property: {
    marketValue: 100_000_000, // 1'000'000.00
    householdIncome: 18_000_000, // 180'000.00
    firstMortgageLimitBp: 6667,
    maxLtvBp: 8000,
    calcInterestRateBp: 500, // 5,00 % (Basispunkte: 500 = 5 %)
    maintenanceRateBp: 100, // 1,00 %
    amortizationYears: 15,
  },
  tranches: [tranche()],
  amortizations: [],
  months: 12,
  now: NOW,
};

const amort = (
  over: Partial<MortgageAmortizationInput> = {}
): MortgageAmortizationInput => ({
  id: 1,
  trancheId: 1,
  kind: "direct",
  amount: 500_000, // 5'000.00
  interval: "yearly",
  startDate: "2026-02-01",
  endDate: null,
  active: true,
  ...over,
});

describe("Zins und Kennzahlen", () => {
  it("rechnet Jahres- und Quartalszins auf Cent genau", () => {
    const r = computeChSchedule(BASE);
    // 600'000 × 1,50 % = 9'000.00 pro Jahr → 2'250.00 pro Quartal
    expect(r.tranches[0].yearlyInterest).toBe(900_000);
    expect(r.tranches[0].interestPerPayment).toBe(225_000);
    expect(r.totals.monthlyInterest).toBe(75_000);
    expect(r.totals.avgRateBp).toBe(150);
  });

  it("addiert bei SARON die Marge zum Basissatz", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [
        tranche({ kind: "saron", interestRateBp: 50, marginBp: 80 }),
      ],
    });
    expect(r.tranches[0].effectiveRateBp).toBe(130);
    expect(r.tranches[0].yearlyInterest).toBe(780_000);
  });

  it("gewichtet den Durchschnittszins nach Restschuld", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [
        tranche({ id: 1, principal: 40_000_000, interestRateBp: 100 }),
        tranche({ id: 2, principal: 20_000_000, interestRateBp: 250 }),
      ],
    });
    // (400'000×1 % + 200'000×2,5 %) / 600'000 = 1,50 %
    expect(r.totals.debt).toBe(60_000_000);
    expect(r.totals.avgRateBp).toBe(150);
  });

  it("teilt die Schuld in 1. und 2. Hypothek und rechnet die Belehnung", () => {
    const r = computeChSchedule(BASE);
    expect(r.ltv.bp).toBe(6000); // 600'000 / 1'000'000 = 60 %
    expect(r.ltv.firstMortgage).toBe(60_000_000);
    expect(r.ltv.secondMortgage).toBe(0);
    expect(r.ltv.headroom).toBe(20_000_000); // bis 80 % = 800'000
  });

  it("weist eine 2. Hypothek über der Grenze aus", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ principal: 75_000_000 })],
    });
    expect(r.ltv.bp).toBe(7500);
    expect(r.ltv.firstMortgage).toBe(66_670_000);
    expect(r.ltv.secondMortgage).toBe(8_330_000);
  });
});

describe("Tragbarkeit", () => {
  it("rechnet mit der ERFORDERLICHEN, nicht der geleisteten Amortisation", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ principal: 75_000_000 })],
      amortizations: [], // gar keine Amortisation erfasst
    });
    // kalk. Zins 750'000 × 5 % = 37'500; Unterhalt 1'000'000 × 1 % = 10'000
    // Pflicht: 2. Hypothek 83'300 / 15 Jahre = 5'553.33 → 5'553.33
    expect(r.affordability.calcInterest).toBe(3_750_000);
    expect(r.affordability.maintenance).toBe(1_000_000);
    expect(r.affordability.requiredAmortization).toBe(555_333);
    expect(r.affordability.actualAmortization).toBe(0);
    expect(r.affordability.totalCost).toBe(5_305_333);
    // 53'053.33 / 180'000 = 29,47 %
    expect(r.affordability.ratioBp).toBe(2947);
    expect(r.affordability.affordable).toBe(true);
  });

  it("meldet Untragbarkeit über 33 %", () => {
    const r = computeChSchedule({
      ...BASE,
      property: { ...BASE.property, householdIncome: 10_000_000 },
    });
    // 30'000 + 10'000 = 40'000 / 100'000 = 40 %
    expect(r.affordability.ratioBp).toBe(4000);
    expect(r.affordability.affordable).toBe(false);
    expect(r.warnings).toContainEqual({
      kind: "affordability_exceeded",
      ratioBp: 4000,
    });
  });

  it("liefert ohne Einkommen null statt einer Scheinzahl", () => {
    const r = computeChSchedule({
      ...BASE,
      property: { ...BASE.property, householdIncome: 0 },
    });
    expect(r.affordability.ratioBp).toBeNull();
    expect(r.affordability.affordable).toBeNull();
    expect(r.warnings).toContainEqual({ kind: "no_income" });
  });

  it("bleibt exakt an der 33-Prozent-Grenze tragbar", () => {
    expect(MAX_COST_RATIO_BP).toBe(3333);
    const r = computeChSchedule({
      ...BASE,
      // Kosten 40'000 → Einkommen so wählen, dass die Quote 33,33 % ergibt
      property: { ...BASE.property, householdIncome: 12_001_200 },
    });
    expect(r.affordability.ratioBp).toBe(3333);
    expect(r.affordability.affordable).toBe(true);
  });
});

describe("Invariante A — indirekte Amortisation senkt die Schuld NICHT", () => {
  it("lässt monthlyDebt flach und lässt nur das Kapital wachsen", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 24,
      amortizations: [
        amort({ kind: "indirect", trancheId: null, amount: 708_800 }),
      ],
    });

    // Schuld über den ganzen Horizont unverändert
    expect(new Set(r.monthlyDebt)).toEqual(new Set([60_000_000]));
    // Kapital wächst einmal pro Jahr (Feb 2026, Feb 2027)
    expect(r.monthlyIndirect[0]).toBe(0);
    expect(r.monthlyIndirect[1]).toBe(708_800); // Februar 2026
    expect(r.monthlyIndirect[12]).toBe(708_800); // bis Januar 2027
    expect(r.monthlyIndirect[13]).toBe(1_417_600); // Februar 2027
    expect(r.monthlyIndirect[24]).toBe(1_417_600);
    // und zählt nicht als getilgt
    expect(r.series[r.series.length - 1].cumAmortized).toBe(0);
  });

  it("hält das Eigenkapital der Serie konstant", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 24,
      amortizations: [
        amort({ kind: "indirect", trancheId: null, amount: 708_800 }),
      ],
    });
    const equities = r.series.map(s => s.equity);
    expect(new Set(equities)).toEqual(new Set([40_000_000]));
  });
});

describe("Invariante B — direkte Amortisation senkt die Schuld exakt", () => {
  it("bucht jährlich genau einmal auf dem Startmonats-Raster", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 24,
      amortizations: [amort({ amount: 500_000 })], // ab 2026-02, jährlich
    });
    expect(r.monthlyDebt[0]).toBe(60_000_000);
    expect(r.monthlyDebt[1]).toBe(59_500_000); // Februar 2026
    expect(r.monthlyDebt[12]).toBe(59_500_000); // Januar 2027 unverändert
    expect(r.monthlyDebt[13]).toBe(59_000_000); // Februar 2027
    expect(r.monthlyDebt[24]).toBe(59_000_000);
    expect(r.monthlyIndirect.every(v => v === 0)).toBe(true);
  });

  it("bucht vierteljährlich viermal pro Jahr", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 12,
      amortizations: [
        amort({ amount: 250_000, interval: "quarterly", startDate: "2026-02-01" }),
      ],
    });
    // Februar, Mai, August, November 2026 = 4 × 2'500.00
    expect(r.monthlyDebt[12]).toBe(60_000_000 - 4 * 250_000);
  });

  it("tilgt nie unter null", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 12,
      tranches: [tranche({ principal: 300_000 })],
      amortizations: [
        amort({ amount: 250_000, interval: "monthly", startDate: "2026-02-01" }),
      ],
    });
    expect(r.monthlyDebt[12]).toBe(0);
    expect(r.monthlyDebt.every(v => v >= 0)).toBe(true);
  });

  it("hält sich an das Enddatum", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 12,
      amortizations: [
        amort({
          amount: 100_000,
          interval: "monthly",
          startDate: "2026-02-01",
          endDate: "2026-04-30",
        }),
      ],
    });
    // Februar, März, April = 3 Zahlungen
    expect(r.monthlyDebt[12]).toBe(60_000_000 - 3 * 100_000);
  });

  it("ignoriert pausierte Amortisationen", () => {
    const r = computeChSchedule({
      ...BASE,
      months: 12,
      amortizations: [amort({ active: false })],
    });
    expect(r.monthlyDebt[12]).toBe(60_000_000);
  });
});

describe("Warnungen", () => {
  /** Warnungen sind strukturiert — Datum/Beträge formatiert erst das UI */
  const kinds = (r: { warnings: { kind: string }[] }) =>
    r.warnings.map(w => w.kind);

  it("warnt vor ablaufender Zinsbindung innert 12 Monaten", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ name: "Tranche A", maturityDate: "2026-09-30" })],
    });
    expect(r.warnings).toContainEqual({
      kind: "maturity_due",
      tranche: "Tranche A",
      date: "2026-09-30",
    });
  });

  it("meldet eine bereits abgelaufene Zinsbindung getrennt", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ name: "Tranche A", maturityDate: "2025-09-30" })],
    });
    expect(r.warnings).toContainEqual({
      kind: "maturity_passed",
      tranche: "Tranche A",
      date: "2025-09-30",
    });
  });

  it("schweigt bei einer Zinsbindung weit in der Zukunft", () => {
    const r = computeChSchedule(BASE); // Ablauf 2031
    expect(kinds(r)).not.toContain("maturity_due");
    expect(kinds(r)).not.toContain("maturity_passed");
  });

  it("warnt vor überschrittener Belehnung", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ principal: 85_000_000 })],
    });
    expect(r.warnings).toContainEqual({
      kind: "ltv_exceeded",
      ltvBp: 8500,
      maxLtvBp: 8000,
    });
  });

  it("warnt bei ungedeckter Amortisationspflicht mit Zahlen", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ principal: 75_000_000 })],
      amortizations: [],
    });
    expect(r.warnings).toContainEqual({
      kind: "amortization_uncovered",
      required: 555_333,
      actual: 0,
    });
  });

  it("schweigt, wenn die Amortisationspflicht gedeckt ist", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ principal: 75_000_000 })],
      amortizations: [amort({ amount: 600_000 })], // 6'000 > 5'553.33
    });
    expect(kinds(r)).not.toContain("amortization_uncovered");
  });

  it("warnt bei veraltetem Restschuld-Stichtag", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ name: "Alt", balanceDate: "2025-01-31" })],
    });
    expect(r.warnings).toContainEqual({
      kind: "stale_balance",
      tranche: "Alt",
      date: "2025-01-31",
    });
  });

  it("akzeptiert einen frischen Stichtag ohne Hinweis", () => {
    const r = computeChSchedule({
      ...BASE,
      tranches: [tranche({ balanceDate: "2025-12-31" })],
    });
    expect(kinds(r)).not.toContain("stale_balance");
  });

  it("meldet fehlenden Verkehrswert statt einer Schein-Belehnung", () => {
    const r = computeChSchedule({
      ...BASE,
      property: { ...BASE.property, marketValue: 0 },
    });
    expect(r.warnings).toContainEqual({ kind: "no_market_value" });
    expect(r.ltv.bp).toBeNull();
  });
});

describe("Serie", () => {
  it("liefert einen Startpunkt und danach Jahres-Snapshots", () => {
    const r = computeChSchedule({ ...BASE, months: 24 });
    expect(r.series.map(s => s.year)).toEqual([2026, 2026, 2027, 2028]);
    // Zinslast kumuliert: 600'000 × 1,5 % = 9'000/Jahr → 750/Monat
    expect(r.series[r.series.length - 1].cumInterest).toBe(24 * 75_000);
  });

  it("kappt den Horizont bei 600 Monaten", () => {
    const r = computeChSchedule({ ...BASE, months: 1200 });
    expect(r.monthlyDebt).toHaveLength(601);
  });
});

describe("Factory", () => {
  it("liefert für CH eine Berechnung", () => {
    expect(typeof getMortgageCalculator("CH").schedule).toBe("function");
  });

  it("wirft für ein unbekanntes Land", () => {
    expect(() => getMortgageCalculator("DE")).toThrow(
      "Für das Land „DE“ ist keine Hypotheken-Berechnung verfügbar."
    );
  });
});

describe("Portfolio-Sicht", () => {
  it("summiert Verkehrswerte und Restschulden über Liegenschaften", () => {
    const prop = (id: number, marketValue: number) => ({
      id,
      country: "CH",
      marketValue,
      householdIncome: 18_000_000,
      firstMortgageLimitBp: 6667,
      maxLtvBp: 8000,
      calcInterestRateBp: 500,
      maintenanceRateBp: 100,
      amortizationYears: 15,
    });
    const r = mortgageDebtProjection(
      [prop(1, 100_000_000), prop(2, 50_000_000)],
      [
        { ...tranche({ id: 1 }), propertyId: 1, interestRecurringId: 7 },
        {
          ...tranche({ id: 2, principal: 20_000_000 }),
          propertyId: 2,
          interestRecurringId: null,
        },
      ],
      [],
      12,
      NOW,
      new Set([7])
    );
    expect(r.propertyValue).toBe(150_000_000);
    expect(r.debtByMonth[0]).toBe(80_000_000);
    expect(r.debtByMonth).toHaveLength(13);
    // Tranche 2 hat keine Dauerbuchung
    expect(r.missingRecurringCount).toBe(1);
  });

  it("zählt eine gelöschte Dauerbuchung als fehlend", () => {
    const r = mortgageDebtProjection(
      [
        {
          id: 1,
          country: "CH",
          marketValue: 100_000_000,
          householdIncome: 0,
          firstMortgageLimitBp: 6667,
          maxLtvBp: 8000,
          calcInterestRateBp: 500,
          maintenanceRateBp: 100,
          amortizationYears: 15,
        },
      ],
      [{ ...tranche(), propertyId: 1, interestRecurringId: 99 }],
      [],
      6,
      NOW,
      new Set() // Dauerbuchung 99 existiert nicht mehr
    );
    expect(r.missingRecurringCount).toBe(1);
  });
});
