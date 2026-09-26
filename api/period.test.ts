import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  isFuturePeriod,
  matchingPreset,
  monthLastDay,
  parsePeriod,
  periodParams,
  periodRange,
  presetPeriod,
  shiftPeriod,
} from "@contracts/period";

const params = (p: Record<string, string>) => (k: string) => p[k] ?? null;
const today = "2026-09-26";

describe("Zeiträume", () => {
  it("liest Monat, Jahr, Spanne und „alle“ aus der URL", () => {
    expect(parsePeriod(params({}), today)).toEqual({ kind: "month", month: "2026-09" });
    expect(parsePeriod(params({ monat: "2026-02" }), today)).toEqual({ kind: "month", month: "2026-02" });
    expect(parsePeriod(params({ jahr: "2025" }), today)).toEqual({ kind: "year", year: 2025 });
    expect(parsePeriod(params({ von: "2026-01-10", bis: "2026-02-09" }), today)).toEqual({
      kind: "range", from: "2026-01-10", to: "2026-02-09",
    });
    expect(parsePeriod(params({ zeit: "alle" }), today)).toEqual({ kind: "all" });
    // Ungültiges fällt auf den laufenden Monat zurück
    expect(parsePeriod(params({ monat: "2026-13" }), today).kind).toBe("month");
    expect(parsePeriod(params({ von: "2026-03-01", bis: "2026-02-01" }), today)).toEqual({
      kind: "month", month: "2026-09",
    });
  });

  it("baut Parameter und Grenzen", () => {
    expect(periodParams({ kind: "year", year: 2026 })).toEqual({ jahr: "2026" });
    expect(periodRange({ kind: "month", month: "2024-02" })).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange({ kind: "all" })).toEqual({});
    expect(monthLastDay("2026-04")).toBe("2026-04-30");
  });

  it("verschiebt um die eigene Länge", () => {
    expect(shiftPeriod({ kind: "month", month: "2026-01" }, -1)).toEqual({ kind: "month", month: "2025-12" });
    expect(shiftPeriod({ kind: "year", year: 2026 }, 1)).toEqual({ kind: "year", year: 2027 });
    expect(shiftPeriod({ kind: "range", from: "2026-01-01", to: "2026-01-10" }, 1)).toEqual({
      kind: "range", from: "2026-01-11", to: "2026-01-20",
    });
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(4);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("erkennt Presets und Zukunft", () => {
    expect(presetPeriod("last12", today)).toEqual({ kind: "range", from: "2025-10-01", to: today });
    expect(matchingPreset({ kind: "month", month: "2026-08" }, today)).toBe("lastMonth");
    expect(matchingPreset({ kind: "month", month: "2026-05" }, today)).toBeNull();
    expect(isFuturePeriod({ kind: "month", month: "2026-10" }, today)).toBe(true);
    expect(isFuturePeriod({ kind: "month", month: "2026-09" }, today)).toBe(false);
  });
});
