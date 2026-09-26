/**
 * Stornos in Einnahmen-/Ausgaben-Summen.
 *
 * Ein Storno ist eine Gegenbuchung mit umgekehrter Art (Ausgabe → Einnahme)
 * und `stornoOfId` auf das Original. Für Salden ist das richtig — für
 * Summen nicht: Die stornierte Ausgabe stünde weiter in den Ausgaben, im
 * Budget und in der Auswertung, und die Gegenbuchung als „Einnahme“ in einer
 * Ausgabenkategorie. Gemeint ist aber „diese Buchung hat nicht
 * stattgefunden“.
 *
 * Deshalb zählen Original und Gegenbuchung in Summen **beide nicht**. Das
 * entspricht einer Verrechnung am Datum des Originals: Der Monat der
 * Fehlbuchung wird korrigiert, der Monat des Stornos bleibt unberührt (kein
 * negativer Betrag in einer Kategorie). Salden, Listen und die
 * Kostenaufteilung rechnen weiter mit beiden Buchungen.
 */
export function withoutReversals<
  T extends { id: number; stornoOfId: number | null },
>(txs: T[]): T[] {
  const pairs = reversalPairIds(txs);
  if (pairs.size === 0) return txs;
  return txs.filter(t => !pairs.has(t.id));
}

/**
 * IDs aller vollständigen Storno-Paare (Original und Gegenbuchung). Ist das
 * Original gelöscht, bleibt die Gegenbuchung eine gewöhnliche Buchung — sie
 * steckt ja weiter im Saldo und muss dann auch in den Summen stehen.
 */
export function reversalPairIds(
  txs: { id: number; stornoOfId: number | null }[]
): Set<number> {
  const ids = new Set(txs.map(t => t.id));
  const pairs = new Set<number>();
  for (const t of txs) {
    if (t.stornoOfId !== null && ids.has(t.stornoOfId)) {
      pairs.add(t.id);
      pairs.add(t.stornoOfId);
    }
  }
  return pairs;
}
