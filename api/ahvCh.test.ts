import { describe, expect, it } from "vitest";
import {
  applyCouplesCap,
  applyScale,
  computeAhv,
  computeAhvVariants,
  deferralIncreaseBp,
  earlyReductionBp,
  fullPension,
  roundToTableStep,
  type AhvComputeInput,
  type AhvYearInput,
} from "./lib/pension/ahvCh";
import {
  AHV_RATIOS_BP,
  ahvParametersFor,
  referenceAgeMonths,
} from "./lib/pension/ahvParameters";

/**
 * Alle Erwartungswerte stammen aus den Merkblättern der Informationsstelle
 * AHV/IV, Stand 1. Januar 2026. Dieser Test ist der Prüfstein des Moduls:
 * Die Engine muss die amtlich publizierten Zahlen auf den Franken treffen —
 * sonst rechnet die App jemandem seine Pensionierung falsch.
 */

const params = ahvParametersFor(2026);
const CHF = (francs: number) => francs * 100;

/** Jahreszeilen mit gleichmässig verteiltem Einkommen erzeugen */
function years(
  from: number,
  to: number,
  totalIncome: number,
  over: Partial<AhvYearInput> = {}
): AhvYearInput[] {
  const count = to - from + 1;
  const per = Math.round(totalIncome / count);
  const rows: AhvYearInput[] = [];
  for (let year = from; year <= to; year++) {
    rows.push({
      year,
      income: per,
      status: "employed",
      parentingCredit: "none",
      careCredit: "none",
      ...over,
    });
  }
  // Rundungsdifferenz auf das erste Jahr legen, damit die Summe exakt stimmt
  rows[0].income += totalIncome - per * count;
  return rows;
}

describe("Rentenformel (Art. 34 AHVG)", () => {
  it("rundet das massgebende Einkommen auf den Tabellenwert auf", () => {
    // Raster: 15'120 + n × 1'512
    expect(roundToTableStep(CHF(10_000), params)).toBe(CHF(15_120));
    expect(roundToTableStep(CHF(15_120), params)).toBe(CHF(15_120));
    expect(roundToTableStep(CHF(15_121), params)).toBe(CHF(16_632));
    expect(roundToTableStep(CHF(35_477), params)).toBe(CHF(36_288));
    expect(roundToTableStep(CHF(44_713), params)).toBe(CHF(45_360));
    expect(roundToTableStep(CHF(46_268), params)).toBe(CHF(46_872));
  });

  /**
   * Stützstellen aus der amtlichen Tabelle „Skala 44: Monatliche Vollrenten"
   * (Merkblatt 3.01, Anhang) — über beide Formelbereiche und beide Ränder.
   */
  it.each([
    [15_120, 1_260],
    [16_632, 1_293],
    [22_680, 1_424],
    [30_240, 1_588],
    [36_288, 1_719],
    [45_360, 1_915],
    [46_872, 1_935],
    [60_480, 2_117],
    [75_600, 2_318],
    [89_208, 2_500],
    [90_720, 2_520],
  ])("mdJE %i → Vollrente CHF %i", (mdJE, expected) => {
    expect(fullPension(CHF(mdJE), params)).toBe(CHF(expected));
  });

  it("hält Mindest- und Maximalrente ein", () => {
    expect(fullPension(CHF(0), params)).toBe(CHF(1_260));
    expect(fullPension(CHF(500_000), params)).toBe(CHF(2_520));
  });

  it("kürzt je fehlendem Beitragsjahr um 1/44", () => {
    const full = CHF(2_520);
    expect(applyScale(full, 44)).toBe(full);
    expect(applyScale(full, 43)).toBe(CHF(2_463)); // 2520 × 43/44 = 2462,7
    expect(applyScale(full, 22)).toBe(CHF(1_260)); // die halbe Rente
  });
});

describe("Rechenbeispiel Merkblatt 3.01, Ziffer 30", () => {
  /**
   * Frau, geboren 17.02.1962, Referenzalter 64 + 6 Monate → Rentenbeginn
   * 1. September 2026. Beitragsjahre 1983–2025 (43), Einkommenssumme
   * CHF 1'090'000, erster IK-Eintrag 1983 (Aufwertungsfaktor 1,025),
   * 18 Jahre Erziehungsgutschriften (während der Ehe hälftig geteilt).
   */
  const input: AhvComputeInput = {
    birthDate: "1962-02-17",
    gender: "female",
    firstIkYear: 1983,
    years: years(1983, 2025, CHF(1_090_000)).map(y =>
      y.year >= 1986 && y.year <= 2003
        ? { ...y, parentingCredit: "half" as const }
        : y
    ),
  };

  it("trifft Referenzalter und Rentenbeginn", () => {
    const result = computeAhv(input);
    expect(result.referenceAgeMonths).toBe(64 * 12 + 6);
    expect(result.pensionStartDate).toBe("2026-09-01");
  });

  it("reproduziert die publizierte Rechnung Schritt für Schritt", () => {
    const result = computeAhv(input);
    expect(result.duration).toMatchObject({
      cohortYears: 43,
      contributionYears: 43,
      missingYears: 0,
      scale: 44,
    });
    expect(result.income.revaluationFactorBp).toBe(10_250);
    expect(result.income.revaluedSum).toBe(CHF(1_117_250));
    expect(result.income.averageIncome).toBe(CHF(25_983));
    expect(result.income.averageParentingCredit).toBe(CHF(9_494));
    expect(result.income.relevantIncome).toBe(CHF(36_288));
    // Die Zahl, die im Merkblatt steht
    expect(result.monthlyPension).toBe(CHF(1_719));
  });

  it("weist die Übergangsgeneration aus, statt Genauigkeit vorzutäuschen", () => {
    // Für Frauen 1961–1969 gelten eigene Kürzungssätze und ein Rentenzuschlag,
    // beide sind nicht publiziert (Merkblatt 3.04 verweist auf einen Rechner)
    expect(computeAhv(input).warnings).toContainEqual({
      kind: "transitionGeneration",
      birthYear: 1962,
    });
  });
});

describe("Rechenbeispiel Merkblatt 3.01, Ziffer 31 (Ehepaar)", () => {
  /**
   * Dieselbe Frau plus Ehemann, geboren 02.09.1961, Beitragsjahre 1982–2025
   * (44). Ehe seit 1984, also Splitting der Einkommen ab 1985. Ergebnis laut
   * Merkblatt: 1'915 / 1'935 ungekürzt, nach Plafonierung 1'880 / 1'900.
   */
  const marriageYears = Array.from({ length: 41 }, (_, i) => 1985 + i);
  const wifeMarriageIncome = CHF(1_065_000); // Hälfte davon = 532'500
  const husbandMarriageIncome = CHF(1_840_000); // Hälfte davon = 920'000

  const wifeYears = [
    ...years(1983, 1984, CHF(25_000)),
    // Kinder 1986 und 1988 → Erziehungsgutschriften 1986–2003 (18 Jahre),
    // während der Ehe hälftig geteilt
    ...years(1985, 2025, wifeMarriageIncome).map(y =>
      y.year >= 1986 && y.year <= 2003
        ? { ...y, parentingCredit: "half" as const }
        : y
    ),
  ];
  const husbandYears = [
    ...years(1982, 1984, CHF(120_000)),
    ...years(1985, 2025, husbandMarriageIncome).map(y =>
      y.year >= 1986 && y.year <= 2003
        ? { ...y, parentingCredit: "half" as const }
        : y
    ),
  ];
  const perYear = (rows: AhvYearInput[]) =>
    Object.fromEntries(rows.map(y => [y.year, y.income]));

  const wife: AhvComputeInput = {
    birthDate: "1962-02-17",
    gender: "female",
    firstIkYear: 1983,
    years: wifeYears,
    splitting: { marriageYears, partnerIncomes: perYear(husbandYears) },
  };
  const husband: AhvComputeInput = {
    birthDate: "1961-09-02",
    gender: "male",
    firstIkYear: 1982,
    years: husbandYears,
    splitting: { marriageYears, partnerIncomes: perYear(wifeYears) },
  };

  it("teilt die Einkommen der Ehejahre hälftig", () => {
    // 25'000 ungeteilt + (1'065'000 + 1'840'000)/2 = 1'477'500
    expect(computeAhv(wife).income.rawSum).toBe(CHF(1_477_500));
    // 120'000 ungeteilt + 1'452'500 = 1'572'500
    expect(computeAhv(husband).income.rawSum).toBe(CHF(1_572_500));
  });

  it("kommt auf die publizierten Einzelrenten", () => {
    const w = computeAhv(wife);
    const h = computeAhv(husband);
    expect(w.income.relevantIncome).toBe(CHF(45_360));
    expect(h.income.relevantIncome).toBe(CHF(46_872));
    expect(w.monthlyPension).toBe(CHF(1_915));
    expect(h.monthlyPension).toBe(CHF(1_935));
    expect(h.pensionStartDate).toBe("2026-10-01");
  });

  it("plafoniert das Ehepaar auf 150 % der Maximalrente", () => {
    const w = computeAhv({ ...wife, partnerPensionMonthly: CHF(1_935) });
    const h = computeAhv({ ...husband, partnerPensionMonthly: CHF(1_915) });
    expect(w.monthlyPension).toBe(CHF(1_880));
    expect(h.monthlyPension).toBe(CHF(1_900));
    expect(w.monthlyPension + h.monthlyPension).toBeLessThanOrEqual(
      params.couplesCapMonthly
    );
    expect(w.warnings).toContainEqual({
      kind: "cappedByCouple",
      uncapped: CHF(1_915),
      capped: CHF(1_880),
    });
  });

  it("plafoniert nicht, solange die Summe unter der Grenze bleibt", () => {
    expect(applyCouplesCap(CHF(1_500), CHF(1_500), params)).toBe(CHF(1_500));
  });
});

describe("Flexibler Rentenbezug (Merkblatt 3.04)", () => {
  it("kürzt beim Vorbezug nach der amtlichen Tabelle", () => {
    expect(earlyReductionBp(0)).toBe(0);
    expect(earlyReductionBp(1)).toBe(60); // 0,6 %
    expect(earlyReductionBp(6)).toBe(340); // 3,4 %
    expect(earlyReductionBp(12)).toBe(680); // 1 Jahr: 6,8 %
    expect(earlyReductionBp(18)).toBe(1020); // 1 Jahr 6 Mt.: 10,2 %
    expect(earlyReductionBp(24)).toBe(1360); // 2 Jahre: 13,6 %
  });

  it("erhöht beim Aufschub nach der amtlichen Tabelle", () => {
    expect(deferralIncreaseBp(11)).toBe(0); // unter der Minimaldauer
    expect(deferralIncreaseBp(12)).toBe(520); // 1 Jahr: 5,2 %
    expect(deferralIncreaseBp(15)).toBe(660); // 1 Jahr 3–5 Mt.: 6,6 %
    expect(deferralIncreaseBp(24)).toBe(1080); // 2 Jahre: 10,8 %
    expect(deferralIncreaseBp(60)).toBe(3150); // 5 Jahre: 31,5 %
    expect(deferralIncreaseBp(72)).toBe(3150); // gedeckelt
  });

  const base: AhvComputeInput = {
    birthDate: "1970-06-15",
    gender: "male",
    firstIkYear: 1991,
    years: years(1991, 2034, CHF(3_500_000)),
  };

  it("wendet Kürzung und Erhöhung auf die ganze Rente an", () => {
    const reference = computeAhv(base).monthlyPension;
    const early = computeAhv({
      ...base,
      withdrawal: { mode: "early", months: 12, sharePct: 100 },
    });
    const deferred = computeAhv({
      ...base,
      withdrawal: { mode: "deferral", months: 24, sharePct: 100 },
    });
    expect(early.monthlyPension).toBe(
      Math.round((reference * 0.932) / 100) * 100
    );
    expect(deferred.monthlyPension).toBe(
      Math.round((reference * 1.108) / 100) * 100
    );
    expect(early.pensionStartDate < deferred.pensionStartDate).toBe(true);
  });

  it("kürzt bei einer Teilrente nur den vorbezogenen Anteil", () => {
    const reference = computeAhv(base).monthlyPension;
    const partial = computeAhv({
      ...base,
      withdrawal: { mode: "early", months: 12, sharePct: 50 },
    });
    // Halbe Rente gekürzt, halbe unverändert → halber Kürzungseffekt
    const expected = Math.round((reference * (0.5 + 0.5 * 0.932)) / 100) * 100;
    expect(partial.monthlyPension).toBe(expected);
    expect(partial.monthlyPension).toBeGreaterThan(
      computeAhv({
        ...base,
        withdrawal: { mode: "early", months: 12, sharePct: 100 },
      }).monthlyPension
    );
  });

  it("klemmt den Teilrenten-Anteil auf 20–80 %", () => {
    const tooLow = computeAhv({
      ...base,
      withdrawal: { mode: "early", months: 12, sharePct: 5 },
    });
    const atMin = computeAhv({
      ...base,
      withdrawal: { mode: "early", months: 12, sharePct: 20 },
    });
    expect(tooLow.monthlyPension).toBe(atMin.monthlyPension);
  });

  it("stellt die Varianten von Vorbezug bis Aufschub gegenüber", () => {
    const variants = computeAhvVariants(base);
    expect(variants.map(v => v.key)).toEqual([
      "early-24",
      "early-12",
      "reference",
      "deferral-12",
      "deferral-24",
      "deferral-36",
      "deferral-48",
      "deferral-60",
    ]);
    // Monoton steigend: je später der Bezug, desto höher die Monatsrente
    const amounts = variants.map(v => v.monthlyPension);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
  });

  it("weist darauf hin, dass der Vorbezug die Kinderrenten kostet", () => {
    const early = computeAhv({
      ...base,
      withdrawal: { mode: "early", months: 12, sharePct: 100 },
    });
    expect(early.warnings).toContainEqual({
      kind: "earlyWithdrawalNoChildPension",
    });
  });
});

describe("Beitragslücken", () => {
  const withGaps = (gapYears: number[]): AhvComputeInput => ({
    birthDate: "1970-06-15",
    gender: "male",
    firstIkYear: 1991,
    years: years(1991, 2034, CHF(3_500_000)).map(y =>
      gapYears.includes(y.year)
        ? { ...y, income: 0, status: "gap" as const }
        : y
    ),
  });

  it("senkt die Rentenskala je fehlendem Jahr", () => {
    const clean = computeAhv(withGaps([]));
    const oneGap = computeAhv(withGaps([2000]));
    expect(clean.duration.scale).toBe(44);
    expect(oneGap.duration.scale).toBe(43);
    expect(oneGap.duration.missingYears).toBe(1);
    expect(oneGap.monthlyPension).toBeLessThan(clean.monthlyPension);
    expect(oneGap.warnings).toContainEqual({
      kind: "contributionGaps",
      missingYears: 1,
      lostShareBp: 227, // 1/44 = 2,27 %
    });
  });

  it("füllt Lücken mit Jugendjahren auf (Merkblatt 3.01 Ziffer 15)", () => {
    const input = withGaps([2000]);
    const withYouth = computeAhv({
      ...input,
      years: [
        {
          year: 1989,
          income: CHF(20_000),
          status: "youth",
          parentingCredit: "none",
          careCredit: "none",
        },
        ...input.years,
      ],
    });
    expect(withYouth.duration.missingYears).toBe(0);
    expect(withYouth.duration.scale).toBe(44);
  });

  it("meldet fehlende Angaben, statt still null zu rechnen", () => {
    const empty = computeAhv({
      birthDate: "1970-06-15",
      gender: "male",
      firstIkYear: null,
      years: [],
    });
    expect(empty.warnings).toContainEqual({ kind: "noYears" });
    expect(empty.monthlyPension).toBeGreaterThan(0); // Mindestrente greift
  });
});

describe("Abgeleitete Renten (Merkblatt 3.03)", () => {
  it("rechnet Hinterlassenen- und Kinderrenten aus derselben Grundlage", () => {
    const result = computeAhv({
      birthDate: "1970-06-15",
      gender: "male",
      firstIkYear: 1991,
      // Genug Einkommen für die Maximalrente
      years: years(1991, 2034, CHF(6_000_000)),
    });
    expect(result.fullPensionMonthly).toBe(CHF(2_520));
    // Witwe/Witwer 80 %, Waise 40 % — die Werte der amtlichen Tabelle
    expect(result.derived.survivorSpouse).toBe(CHF(2_016));
    expect(result.derived.orphan).toBe(CHF(1_008));
    // Verwitwetenzuschlag 20 %, aber höchstens die Maximalrente
    expect(result.derived.widowedOwnPension).toBe(CHF(2_520));
    expect(AHV_RATIOS_BP.survivorSpouse).toBe(8000);
  });
});

describe("Referenzalter der Übergangsgeneration", () => {
  it.each([
    [1960, "female", 64 * 12],
    [1961, "female", 64 * 12 + 3],
    [1962, "female", 64 * 12 + 6],
    [1963, "female", 64 * 12 + 9],
    [1964, "female", 65 * 12],
    [1970, "female", 65 * 12],
    [1962, "male", 65 * 12],
  ] as const)("Jahrgang %i (%s) → %i Monate", (year, gender, expected) => {
    expect(referenceAgeMonths(year, gender)).toBe(expected);
  });
});

describe("13. Altersrente (ab 2026)", () => {
  it("entspricht einem Zwölftel der Jahresrente", () => {
    const result = computeAhv({
      birthDate: "1970-06-15",
      gender: "male",
      firstIkYear: 1991,
      years: years(1991, 2034, CHF(3_500_000)),
    });
    expect(result.thirteenthPension).toBe(result.monthlyPension);
    expect(result.yearlyPension).toBe(result.monthlyPension * 13);
  });
});
