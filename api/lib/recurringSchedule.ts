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

/** Tage im Monat (`month` 1-basiert) */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Der Stichtag einer Dauerbuchung: der Tag im Monat, an dem sie gemeint ist.
 * Steht in `recurring.anchor_day`; für Zeilen aus der Zeit vor der Spalte
 * (NULL) gilt der Tag des aktuellen Termins.
 */
export function anchorDayOf(dateISO: string): number {
  return Number(dateISO.slice(8, 10));
}

/**
 * Nächster Termin einer Dauerbuchung.
 *
 * Monatsschritte rechnen auf den Zahlen y/m/d statt über `Date.setMonth`
 * (Muster: `lib/insurance/notice.ts`). `setMonth` lässt einen nicht
 * existierenden Tag still in den Folgemonat überlaufen — aus dem 31.08.
 * wurde vierteljährlich der 01.12. statt des 30.11., und weil der
 * übergelaufene Termin zum Ausgangspunkt des nächsten Schritts wurde, blieb
 * die Buchung für immer auf dem Monatsersten. Genau die Fälle, für die das
 * Modul gebaut ist (Miete, Hypothekarzins am Monatsende), traf das.
 *
 * Stattdessen wird auf den Monatsletzten geklemmt. Damit die Reihe danach
 * wieder auf ihren Stichtag zurückfindet — 31.08. → 30.11. → 28.02. →
 * 31.05. — zählt `anchorDay` und nicht der Tag des zuletzt gerechneten
 * Termins. Ohne `anchorDay` (Bestandszeilen) gilt der Tag von `dateISO`;
 * die Reihe klemmt dann zwar sauber, wandert aber wie bisher auf den
 * kürzesten Monat zu.
 */
export function advanceDate(
  dateISO: string,
  interval: RecurringInterval,
  anchorDay?: number | null
): string {
  if (interval === "weekly") {
    const d = new Date(`${dateISO}T12:00:00`);
    d.setDate(d.getDate() + 7);
    return localISO(d);
  }
  const [y, m, d] = dateISO.split("-").map(Number);
  const total = y * 12 + (m - 1) + MONTHS_PER_INTERVAL[interval];
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  // Unplausible Werte aus der DB fangen: der Stichtag bleibt im Monat.
  const anchor = Math.min(Math.max(anchorDay ?? d, 1), 31);
  const day = Math.min(anchor, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Die Felder einer Dauerbuchung, die die Terminrechnung braucht */
export interface RecurrenceWindow {
  interval: RecurringInterval;
  /** Erster noch nicht verbuchter Termin (wandert beim Verbuchen mit) */
  nextDate: string;
  /** Letztes gültiges Vorkommen (inklusiv); NULL = kein Ende */
  endDate: string | null;
  /** Tag im Monat, an dem die Buchung gemeint ist; NULL = Tag aus nextDate */
  anchorDay?: number | null;
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
    next = advanceDate(next, rule.interval, rule.anchorDay);
    steps += 1;
  }
  while (next <= last && out.length < cap) {
    out.push(next);
    next = advanceDate(next, rule.interval, rule.anchorDay);
  }
  return out;
}
