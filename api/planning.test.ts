import { describe, expect, it } from "vitest";
import {
  budgetPace,
  monthsUntilDeadline,
  nextOccurrenceAfter,
  percentChange,
  periodElapsed,
  requiredMonthlyRate,
  shiftMonth,
} from "@contracts/planning";

describe("shiftMonth", () => {
  it("verschiebt über Jahresgrenzen", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
    expect(shiftMonth("2026-09", 0)).toBe("2026-09");
  });
});

describe("monthsUntilDeadline / requiredMonthlyRate", () => {
  it("zählt eine Rate je Monat vor dem Stichtag", () => {
    expect(monthsUntilDeadline("2027-02-01", "2026-09-25")).toBe(5);
    expect(requiredMonthlyRate(230_000, "2027-02-01", "2026-09-25")).toBe(
      46_000
    );
  });

  it("rundet auf volle Cent auf", () => {
    expect(requiredMonthlyRate(1_000, "2026-12-01", "2026-09-10")).toBe(334);
  });

  it("liefert null ohne verbleibende Monate oder ohne Rest", () => {
    expect(monthsUntilDeadline("2026-09-30", "2026-09-25")).toBe(0);
    expect(monthsUntilDeadline("2026-05-01", "2026-09-25")).toBe(0);
    expect(requiredMonthlyRate(5_000, "2026-09-30", "2026-09-25")).toBeNull();
    expect(requiredMonthlyRate(0, "2027-09-30", "2026-09-25")).toBeNull();
  });
});

describe("periodElapsed / budgetPace", () => {
  it("berechnet den verstrichenen Anteil von Monat und Jahr", () => {
    expect(periodElapsed("monthly", "2026-09-15")).toBeCloseTo(0.5);
    expect(periodElapsed("monthly", "2026-02-28")).toBe(1);
    expect(periodElapsed("yearly", "2026-12-31")).toBeCloseTo(1);
    expect(periodElapsed("yearly", "2026-01-01")).toBeCloseTo(1 / 365);
  });

  it("unterscheidet im Plan, zu schnell und überschritten", () => {
    expect(budgetPace(40_00, 100_00, 0.5)).toBe("ok");
    expect(budgetPace(54_00, 100_00, 0.5)).toBe("ok");
    expect(budgetPace(60_00, 100_00, 0.5)).toBe("fast");
    expect(budgetPace(100_01, 100_00, 0.9)).toBe("over");
    expect(budgetPace(0, 0, 0.5)).toBe("ok");
  });
});

describe("percentChange", () => {
  it("rechnet relativ zum Vergleichswert", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("nextOccurrenceAfter", () => {
  it("liefert den ersten Termin nach dem Stichtag, nie einen vergangenen", () => {
    expect(nextOccurrenceAfter("2026-09-25", "monthly", "2026-09-26")).toBe("2026-10-25");
    expect(nextOccurrenceAfter("2026-03-25", "monthly", "2026-09-26")).toBe("2026-10-25");
    expect(nextOccurrenceAfter("2026-09-26", "monthly", "2026-09-26")).toBe("2026-10-26");
    expect(nextOccurrenceAfter("2025-01-15", "yearly", "2026-09-26")).toBe("2027-01-15");
    expect(nextOccurrenceAfter("2026-09-20", "weekly", "2026-09-26")).toBe("2026-09-27");
    expect(nextOccurrenceAfter("2026-08-01", "quarterly", "2026-09-26")).toBe("2026-11-01");
    // Monatsende: am Tag der Buchung bleiben, nie über den Überlauf wandern
    expect(nextOccurrenceAfter("2026-08-31", "monthly", "2026-09-26")).toBe("2026-09-30");
    expect(nextOccurrenceAfter("2026-01-31", "monthly", "2026-09-26")).toBe("2026-09-30");
    expect(nextOccurrenceAfter("2026-03-15", "yearly", "2026-09-26")).toBe("2027-03-15");
  });
});
