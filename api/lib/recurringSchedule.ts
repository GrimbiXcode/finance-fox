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

import type { RecurringInterval } from "@contracts/types";
import { advanceDate } from "@contracts/planning";

// `localISO` und `advanceDate` liegen in contracts/planning.ts, damit auch
// das Frontend („Wiederkehrend machen“) exakt die Termine des Crons rechnet
export { advanceDate, localISO } from "@contracts/planning";

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
