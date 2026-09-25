/**
 * Kleine Planungsrechnungen, die das Frontend anzeigt und die Tests unter
 * `api/planning.test.ts` absichern (Frontend-Tests gibt es nicht — deshalb
 * liegen die reinen Funktionen hier statt in `src/lib`).
 *
 * Monatsschlüssel sind `YYYY-MM`, Daten `YYYY-MM-DD`, Beträge Cent.
 */

/** Monatsschlüssel um `delta` Monate verschieben („2026-01“, −1 → „2025-12“) */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Anzahl Monatsraten bis zum Stichtag: eine Rate pro angebrochenem Monat ab
 * dem aktuellen, ohne den Monat des Stichtags selbst (bis zum 1. Februar
 * zahlt man im September noch für Sep, Okt, Nov, Dez, Jan = 5 Raten).
 * 0, wenn der Stichtag im laufenden Monat liegt oder vorbei ist.
 */
export function monthsUntilDeadline(deadline: string, today: string): number {
  const [dy, dm] = deadline.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  return Math.max(0, dy * 12 + dm - (ty * 12 + tm));
}

/**
 * Nötige Monatsrate, um `remaining` bis zum Stichtag zu erreichen — auf
 * volle Cent aufgerundet. `null`, wenn keine Rate mehr möglich ist
 * (Stichtag in diesem Monat oder vorbei) oder nichts mehr fehlt.
 */
export function requiredMonthlyRate(
  remaining: number,
  deadline: string,
  today: string
): number | null {
  if (remaining <= 0) return null;
  const months = monthsUntilDeadline(deadline, today);
  if (months === 0) return null;
  return Math.ceil(remaining / months);
}

/** Anteil des Budget-Zeitraums, der heute verstrichen ist (0–1) */
export function periodElapsed(
  period: "monthly" | "yearly",
  today: string
): number {
  const [y, m, d] = today.split("-").map(Number);
  if (period === "monthly") {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d / days;
  }
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return (Date.UTC(y, m - 1, d) - start + 86_400_000) / (end - start);
}

export type BudgetPace = "ok" | "fast" | "over";

/**
 * Liegt ein Budget im Plan? „fast“, wenn mehr verbraucht ist, als dem
 * verstrichenen Zeitanteil entspricht (mit 5 Prozentpunkten Toleranz, damit
 * der Wocheneinkauf am Monatsanfang nicht sofort alarmiert), „over“ bei
 * überschrittenem Limit.
 */
export function budgetPace(
  spent: number,
  limit: number,
  elapsed: number
): BudgetPace {
  if (limit <= 0 || spent > limit) return spent > 0 ? "over" : "ok";
  return spent / limit > elapsed + 0.05 ? "fast" : "ok";
}

/** Relative Veränderung in ganzen Prozent; `null` ohne Vergleichswert */
export function percentChange(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
