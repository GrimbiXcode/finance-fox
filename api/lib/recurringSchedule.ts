/**
 * Terminrechnung der Dauerbuchungen — einzige Quelle der Wahrheit.
 *
 * `advanceDate` lag früher identisch in `recurringJob.ts` (Cron-Verbuchung)
 * und `forecastRouter.ts` (Saldo-Prognose). Ein neues Intervall wäre dort
 * leicht nur an einer Stelle ergänzt worden — die Prognose hätte dann still
 * andere Termine gerechnet als der Cron tatsächlich verbucht.
 */

import { MONTHS_PER_INTERVAL, type RecurringInterval } from "@contracts/types";

/** Datum als lokales `YYYY-MM-DD` (kein UTC-Versatz wie bei toISOString) */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Nächster Termin einer Dauerbuchung. Monatsschritte laufen über
 * `setMonth` — der 31. eines Monats rutscht dadurch in kürzeren Monaten
 * in den Folgemonat (bestehendes Verhalten, bewusst unverändert).
 */
export function advanceDate(
  dateISO: string,
  interval: RecurringInterval
): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (interval === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + MONTHS_PER_INTERVAL[interval]);
  return localISO(d);
}
