/** Gewicht eines Aufteilungs-Anteils (positive Zahl, z. B. 60/40) */
export interface ShareWeight {
  userId: number;
  weight: number;
}

/**
 * Verteilt einen Cent-Betrag gewichtet auf Anteile. Jeder Anteil wird auf
 * volle Cent gerundet; die dadurch entstehende Restdifferenz landet auf dem
 * ersten Anteil, damit die Summe exakt dem Gesamtbetrag entspricht.
 */
export function sharesFromWeights(
  totalCents: number,
  weights: ShareWeight[],
): { userId: number; amount: number }[] {
  const sumWeight = weights.reduce((s, w) => s + w.weight, 0);
  if (weights.length === 0 || sumWeight <= 0) return [];
  const shares = weights.map((w) => ({
    userId: w.userId,
    amount: Math.round((totalCents * w.weight) / sumWeight),
  }));
  const diff = totalCents - shares.reduce((s, x) => s + x.amount, 0);
  shares[0].amount += diff;
  return shares;
}
