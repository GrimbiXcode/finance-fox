/**
 * Hilfen für die Dauerbuchungen-Seite: Archiv-Status und Sortierung.
 * „Archiviert" = Enddatum gesetzt UND vor heute (abgelaufen).
 */

/** true, wenn die Dauerbuchung ein abgelaufenes Enddatum hat */
export const isRecurringArchived = (
  r: { endDate: string | null },
  today: string,
): boolean => !!r.endDate && r.endDate < today;

/**
 * Laufende Dauerbuchungen (nach nächster Fälligkeit aufsteigend) zuerst,
 * archivierte ans Ende — gilt für Karten- und Tabellenansicht.
 */
export const sortRecurring = <
  T extends { endDate: string | null; nextDate: string },
>(
  rows: T[],
  today: string,
): T[] =>
  [...rows].sort((a, b) => {
    const archA = isRecurringArchived(a, today) ? 1 : 0;
    const archB = isRecurringArchived(b, today) ? 1 : 0;
    if (archA !== archB) return archA - archB;
    return a.nextDate.localeCompare(b.nextDate);
  });
