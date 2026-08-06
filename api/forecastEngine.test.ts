import { describe, expect, it } from "vitest";
import { occurrencesInRange } from "./lib/recurringSchedule";
import {
  addMonths,
  aggregatePeriods,
  monthDelta,
  monthEndISO,
  monthsPerPeriod,
  simulateMonths,
  startBalancesFromRows,
  type ForecastRule,
} from "./lib/forecastEngine";

/**
 * Reine Prognose-Engine — feste Daten, keine DB. Die Terminrechnung
 * (`occurrencesInRange`) ersetzt drei kopierte Schleifen; zwei davon
 * ignorierten `endDate` und kappten lange Horizonte, deshalb liegt genau
 * darauf hier der Schwerpunkt.
 */

function rule(partial: Partial<ForecastRule> = {}): ForecastRule {
  return {
    type: "expense",
    accountId: 1,
    toAccountId: null,
    amount: 10_000,
    categoryId: null,
    interval: "monthly",
    nextDate: "2026-02-01",
    endDate: null,
    active: true,
    ...partial,
  };
}

describe("occurrencesInRange", () => {
  it("liefert die Termine im Zeitraum inklusive der Grenzen", () => {
    expect(
      occurrencesInRange(
        { interval: "monthly", nextDate: "2026-02-01", endDate: null },
        "2026-02-01",
        "2026-04-01"
      )
    ).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("endet mit dem Enddatum (inklusiv)", () => {
    expect(
      occurrencesInRange(
        { interval: "monthly", nextDate: "2026-02-01", endDate: "2026-03-01" },
        "2026-02-01",
        "2026-12-31"
      )
    ).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("liefert nichts, wenn das Enddatum vor dem Zeitraum liegt", () => {
    expect(
      occurrencesInRange(
        { interval: "monthly", nextDate: "2025-01-01", endDate: "2025-06-01" },
        "2026-01-01",
        "2026-12-31"
      )
    ).toEqual([]);
  });

  it("spult von einem alten nextDate in den Zeitraum vor", () => {
    expect(
      occurrencesInRange(
        { interval: "monthly", nextDate: "2020-01-15", endDate: null },
        "2026-02-01",
        "2026-04-30"
      )
    ).toEqual(["2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("kappt einen 10-Jahres-Horizont bei wöchentlichem Intervall nicht", () => {
    const dates = occurrencesInRange(
      { interval: "weekly", nextDate: "2026-01-01", endDate: null },
      "2026-01-01",
      "2035-12-31"
    );
    // 10 Jahre sind ~521 Wochen — die alten Prognose-Schleifen brachen bei
    // einem gemeinsamen Zähler von 1000 mitten im Horizont ab
    expect(dates.length).toBeGreaterThan(500);
    expect(dates[dates.length - 1] <= "2035-12-31").toBe(true);
  });

  it("liefert nichts bei umgekehrtem Zeitraum", () => {
    expect(
      occurrencesInRange(
        { interval: "monthly", nextDate: "2026-01-01", endDate: null },
        "2026-06-01",
        "2026-01-01"
      )
    ).toEqual([]);
  });
});

describe("Monats-Hilfsfunktionen", () => {
  it("liefert den letzten Tag eines Monats inkl. Schaltjahr", () => {
    expect(monthEndISO("2026-02")).toBe("2026-02-28");
    expect(monthEndISO("2028-02")).toBe("2028-02-29");
    expect(monthEndISO("2026-12")).toBe("2026-12-31");
  });

  it("verschiebt Monatsschlüssel über Jahresgrenzen", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("bildet die Aggregationsgröße auf Monate ab", () => {
    expect(monthsPerPeriod("monthly")).toBe(1);
    expect(monthsPerPeriod("quarterly")).toBe(3);
    expect(monthsPerPeriod("semiannual")).toBe(6);
    expect(monthsPerPeriod("yearly")).toBe(12);
  });
});

describe("startBalancesFromRows", () => {
  it("verrechnet Einnahmen, Ausgaben und Umbuchungen der verfolgten Konten", () => {
    const balances = startBalancesFromRows(
      [
        { id: 1, initialBalance: 100_000 },
        { id: 2, initialBalance: 0 },
      ],
      [
        { type: "income", accountId: 1, toAccountId: null, amount: 5_000 },
        { type: "expense", accountId: 1, toAccountId: null, amount: 2_000 },
        { type: "transfer", accountId: 1, toAccountId: 2, amount: 10_000 },
        // Fremdes Konto: wirkt nicht
        { type: "income", accountId: 9, toAccountId: null, amount: 999_000 },
      ]
    );
    expect(balances.get(1)).toBe(93_000);
    expect(balances.get(2)).toBe(10_000);
    expect(balances.has(9)).toBe(false);
  });
});

describe("simulateMonths", () => {
  it("schreibt eine monatliche Ausgabe Monat für Monat fort", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 100_000]]),
      rules: [rule()],
      fromMonth: "2026-01",
      months: 3,
    });
    expect(months.map(m => m.month)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(months.map(m => m.balances.get(1))).toEqual([
      90_000, 80_000, 70_000,
    ]);
    expect(months.map(m => m.recurringExpense)).toEqual([
      10_000, 10_000, 10_000,
    ]);
  });

  it("beendet die Wirkung mit dem Enddatum", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 100_000]]),
      rules: [rule({ endDate: "2026-03-31" })],
      fromMonth: "2026-01",
      months: 3,
    });
    expect(months.map(m => m.balances.get(1))).toEqual([
      90_000, 80_000, 80_000,
    ]);
    expect(months[2].recurringExpense).toBe(0);
  });

  it("zählt eine vierteljährliche Ausgabe in 12 Monaten viermal", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 0]]),
      rules: [rule({ interval: "quarterly" })],
      fromMonth: "2026-01",
      months: 12,
    });
    const firing = months.filter(m => m.recurringExpense > 0);
    expect(firing).toHaveLength(4);
    expect(months[11].balances.get(1)).toBe(-40_000);
  });

  it("ignoriert pausierte Dauerbuchungen", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 100_000]]),
      rules: [rule({ active: false })],
      fromMonth: "2026-01",
      months: 3,
    });
    expect(months[2].balances.get(1)).toBe(100_000);
  });

  it("behandelt eine Umbuchung zwischen zwei verfolgten Konten saldo-neutral", () => {
    const months = simulateMonths({
      startBalances: new Map([
        [1, 100_000],
        [2, 0],
      ]),
      rules: [rule({ type: "transfer", toAccountId: 2, amount: 25_000 })],
      fromMonth: "2026-01",
      months: 1,
    });
    expect(months[0].balances.get(1)).toBe(75_000);
    expect(months[0].balances.get(2)).toBe(25_000);
    expect(months[0].transferNet).toBe(0);
    // Umbuchungen sind keine Einnahmen/Ausgaben
    expect(months[0].recurringExpense).toBe(0);
    expect(months[0].recurringIncome).toBe(0);
  });

  it("meldet eine Umbuchung mit nur einer verfolgten Seite als transferNet", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 100_000]]),
      rules: [rule({ type: "transfer", toAccountId: 2, amount: 25_000 })],
      fromMonth: "2026-01",
      months: 1,
    });
    expect(months[0].balances.get(1)).toBe(75_000);
    expect(months[0].transferNet).toBe(-25_000);
  });

  it("skaliert wiederkehrende Einnahmen im Szenario", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 0]]),
      rules: [rule({ type: "income", amount: 100_000 })],
      fromMonth: "2026-01",
      months: 1,
      scenario: { incomePct: 110 },
    });
    expect(months[0].recurringIncome).toBe(110_000);
    expect(months[0].balances.get(1)).toBe(110_000);
  });

  it("lässt Ausgaben ausgeschlossener Kategorien entfallen", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 100_000]]),
      rules: [rule({ categoryId: 7 })],
      fromMonth: "2026-01",
      months: 1,
      scenario: { excludedCategoryIds: new Set([7]) },
    });
    expect(months[0].recurringExpense).toBe(0);
    expect(months[0].balances.get(1)).toBe(100_000);
  });

  it("führt den Ø variabler Buchungen als Monatswert, nicht als Kontobewegung", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 100_000]]),
      rules: [],
      fromMonth: "2026-01",
      months: 2,
      scenario: { avgVariableIncome: 5_000, avgVariableExpense: 2_000 },
    });
    // Ein Durchschnitt über alle Buchungen ist keinem Konto zuordenbar
    expect(months[0].balances.get(1)).toBe(100_000);
    expect(months[0].variableIncome).toBe(5_000);
    expect(monthDelta(months[0])).toBe(3_000);
  });
});

describe("aggregatePeriods", () => {
  it("nimmt Salden vom Periodenende und summiert die Flüsse", () => {
    const periods = aggregatePeriods(
      simulateMonths({
        startBalances: new Map([[1, 100_000]]),
        rules: [rule()],
        fromMonth: "2026-01",
        months: 12,
      }),
      3
    );
    expect(periods).toHaveLength(4);
    expect(periods[0].startMonth).toBe("2026-02");
    expect(periods[0].endMonth).toBe("2026-04");
    // Bestandsgröße: Stand am Periodenende, nicht die Summe der Monate
    expect(periods[0].balances.get(1)).toBe(70_000);
    expect(periods[3].balances.get(1)).toBe(-20_000);
    // Bewegungsgröße: Summe über die Periode
    expect(periods[0].recurringExpense).toBe(30_000);
  });

  it("liefert bei unzulässiger Periodengröße nichts statt endlos zu laufen", () => {
    const months = simulateMonths({
      startBalances: new Map([[1, 0]]),
      rules: [],
      fromMonth: "2026-01",
      months: 3,
    });
    expect(aggregatePeriods(months, 0)).toEqual([]);
    expect(aggregatePeriods(months, -1)).toEqual([]);
  });

  it("ergibt bei 60 Monaten und Halbjahren 10 Perioden", () => {
    const periods = aggregatePeriods(
      simulateMonths({
        startBalances: new Map([[1, 0]]),
        rules: [],
        fromMonth: "2026-01",
        months: 60,
      }),
      6
    );
    expect(periods).toHaveLength(10);
    expect(periods[9].endMonth).toBe("2031-01");
  });
});
