/**
 * Zeiträume für Listen und Auswertungen (Transaktionen, Drilldowns).
 * Der Zeitraum steht in der URL — `monat=YYYY-MM`, `jahr=YYYY`,
 * `von`/`bis` (YYYY-MM-DD) oder `zeit=alle`; ohne Angabe gilt der laufende
 * Monat. Reine Funktionen, getestet in `api/period.test.ts`.
 */
import { shiftMonth } from "./planning";

export type Period =
  | { kind: "month"; month: string }
  | { kind: "year"; year: number }
  | { kind: "range"; from: string; to: string }
  | { kind: "all" };

export type PeriodPreset =
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "last12"
  | "all";

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  thisMonth: "Dieser Monat",
  lastMonth: "Letzter Monat",
  thisYear: "Dieses Jahr",
  last12: "Letzte 12 Monate",
  all: "Alle Zeiträume",
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Letzter Tag eines Monats als YYYY-MM-DD */
export function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Datum um `days` Tage verschieben (kalendarisch, ohne Zeitzonen-Effekte) */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Anzahl Tage von `from` bis `to` inklusive */
export function daysBetween(from: string, to: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000) + 1;
}

/** Zeitraum aus URL-Parametern; Standard ist der Monat von `today` */
export function parsePeriod(
  get: (key: string) => string | null,
  today: string
): Period {
  if (get("zeit") === "alle") return { kind: "all" };
  const month = get("monat");
  if (month && MONTH.test(month)) return { kind: "month", month };
  const year = Number(get("jahr"));
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
    return { kind: "year", year };
  }
  const from = get("von");
  const to = get("bis");
  if (from && to && DATE.test(from) && DATE.test(to) && from <= to) {
    return { kind: "range", from, to };
  }
  return { kind: "month", month: today.slice(0, 7) };
}

/** Zeitraum als URL-Parameter (Gegenstück zu `parsePeriod`) */
export function periodParams(period: Period): Record<string, string> {
  switch (period.kind) {
    case "month":
      return { monat: period.month };
    case "year":
      return { jahr: String(period.year) };
    case "range":
      return { von: period.from, bis: period.to };
    case "all":
      return { zeit: "alle" };
  }
}

/** Datumsgrenzen für die Suche (`undefined` = offen) */
export function periodRange(period: Period): { from?: string; to?: string } {
  switch (period.kind) {
    case "month":
      return { from: `${period.month}-01`, to: monthLastDay(period.month) };
    case "year":
      return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
    case "range":
      return { from: period.from, to: period.to };
    case "all":
      return {};
  }
}

/** Zeitraum um seine eigene Länge verschieben (Pfeile vor/zurück) */
export function shiftPeriod(period: Period, direction: 1 | -1): Period {
  switch (period.kind) {
    case "month":
      return { kind: "month", month: shiftMonth(period.month, direction) };
    case "year":
      return { kind: "year", year: period.year + direction };
    case "range": {
      const length = daysBetween(period.from, period.to);
      return {
        kind: "range",
        from: addDays(period.from, direction * length),
        to: addDays(period.to, direction * length),
      };
    }
    case "all":
      return period;
  }
}

export function presetPeriod(preset: PeriodPreset, today: string): Period {
  const month = today.slice(0, 7);
  switch (preset) {
    case "thisMonth":
      return { kind: "month", month };
    case "lastMonth":
      return { kind: "month", month: shiftMonth(month, -1) };
    case "thisYear":
      return { kind: "year", year: Number(today.slice(0, 4)) };
    case "last12":
      return { kind: "range", from: `${shiftMonth(month, -11)}-01`, to: today };
    case "all":
      return { kind: "all" };
  }
}

/** Welches Preset entspricht dem Zeitraum (für die Auswahl), sonst null */
export function matchingPreset(
  period: Period,
  today: string
): PeriodPreset | null {
  const presets: PeriodPreset[] = [
    "thisMonth",
    "lastMonth",
    "thisYear",
    "last12",
    "all",
  ];
  const key = (p: Period) => JSON.stringify(periodParams(p));
  return presets.find(p => key(presetPeriod(p, today)) === key(period)) ?? null;
}

/** Liegt der Zeitraum ganz in der Zukunft von `today`? (Pfeil „vor“ sperren) */
export function isFuturePeriod(period: Period, today: string): boolean {
  const { from } = periodRange(period);
  return from !== undefined && from > today;
}
