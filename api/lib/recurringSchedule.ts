/**
 * Terminrechnung der Dauerbuchungen — einzige Quelle der Wahrheit.
 *
 * `advanceDate` lag früher identisch in `recurringJob.ts` (Cron-Verbuchung)
 * und `forecastRouter.ts` (Saldo-Prognose). Ein neues Intervall wäre dort
 * leicht nur an einer Stelle ergänzt worden — die Prognose hätte dann still
 * andere Termine gerechnet als der Cron tatsächlich verbucht.
 *
 * Dasselbe galt für die Schleife darüber: `occurrencesInRange` ersetzt drei
 * Kopien, von denen zwei `endDate` nicht auswerteten — abgelaufene
 * Dauerbuchungen liefen in den Prognosen endlos weiter.
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

/** Die Felder einer Dauerbuchung, die die Terminrechnung braucht */
export interface RecurrenceWindow {
  interval: RecurringInterval;
  /** Erster noch nicht verbuchter Termin (wandert beim Verbuchen mit) */
  nextDate: string;
  /** Letztes gültiges Vorkommen (inklusiv); NULL = kein Ende */
  endDate: string | null;
}

/**
 * Notbremse gegen eine unplausible Zeile (z. B. `nextDate` Jahrzehnte in der
 * Vergangenheit): begrenzt das Vorspulen, nicht die Ergebnismenge.
 */
const MAX_STEPS = 100_000;

/**
 * Alle Fälligkeiten einer Dauerbuchung im Zeitraum [fromISO, toISO]
 * (beide inklusive), aufsteigend. `endDate` wird respektiert — Vorkommen
 * dahinter entstehen nicht.
 *
 * Ersetzt die früher an drei Stellen kopierte Schleife (Cron-Verbuchung,
 * Saldo- und Sparziel-Prognose). Je Regel läuft nur EIN Durchlauf über den
 * ganzen Horizont; `cap` begrenzt ausschließlich die Anzahl gelieferter
 * Termine (die Prognose-Kopien teilten sich einen Zähler mit dem Vorspulen
 * und kappten dadurch lange Horizonte still).
 */
export function occurrencesInRange(
  rule: RecurrenceWindow,
  fromISO: string,
  toISO: string,
  cap = 5000
): string[] {
  const last =
    rule.endDate !== null && rule.endDate < toISO ? rule.endDate : toISO;
  const out: string[] = [];
  let next = rule.nextDate;
  let steps = 0;
  // Vorspulen bis in den Zeitraum — Termine davor sind bereits verbucht
  while (next < fromISO && next <= last && steps < MAX_STEPS) {
    next = advanceDate(next, rule.interval);
    steps += 1;
  }
  while (next <= last && out.length < cap) {
    out.push(next);
    next = advanceDate(next, rule.interval);
  }
  return out;
}
