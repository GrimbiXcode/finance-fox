/**
 * Aufteilungs-Salden zwischen Personen — geteilt von Server (Dashboard-
 * Aggregat) und Frontend (Seite „Aufteilung“), damit beide dieselbe Zahl
 * zeigen. Beträge in Cent.
 */

export interface SplitTxLike {
  type: "income" | "expense" | "transfer";
  amount: number;
  userId: number;
  splits: { userId: number; amount: number }[];
}

/**
 * Netto-Salden zwischen Personen aus geteilten Buchungen.
 * Geteilte Ausgaben: Zahler +Betrag, Split-Partner −Anteil.
 * Einnahmen MIT Splits zählen umgekehrt (Zahler −Betrag, Split-Partner
 * +Anteil) — so hebt eine Storno-Buchung (Ausgabe → Einnahme mit denselben
 * Splits, siehe finance.reverseTransaction) die ursprüngliche
 * Aufteilungs-Wirkung exakt auf.
 */
export function memberBalances(
  txs: SplitTxLike[],
  userIds: number[]
): Map<number, number> {
  const net = new Map<number, number>();
  for (const id of userIds) net.set(id, 0);
  for (const t of txs) {
    if (t.splits.length === 0) continue;
    if (t.type !== "expense" && t.type !== "income") continue;
    const sign = t.type === "expense" ? 1 : -1;
    net.set(t.userId, (net.get(t.userId) ?? 0) + sign * t.amount);
    for (const s of t.splits) {
      net.set(s.userId, (net.get(s.userId) ?? 0) - sign * s.amount);
    }
  }
  return net;
}

export interface Settlement {
  fromId: number;
  toId: number;
  amount: number;
}

/** Greedy-Ausgleich: minimale Anzahl an Überweisungen */
export function computeSettlements(
  txs: SplitTxLike[],
  userIds: number[]
): Settlement[] {
  const net = memberBalances(txs, userIds);
  const debtors = userIds
    .filter(id => (net.get(id) ?? 0) < -0.5)
    .map(id => ({ id, amount: -(net.get(id) ?? 0) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = userIds
    .filter(id => (net.get(id) ?? 0) > 0.5)
    .map(id => ({ id, amount: net.get(id) ?? 0 }))
    .sort((a, b) => b.amount - a.amount);

  const result: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    result.push({
      fromId: debtors[i].id,
      toId: creditors[j].id,
      amount: Math.round(pay),
    });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.5) i += 1;
    if (creditors[j].amount < 0.5) j += 1;
  }
  return result;
}

/**
 * Erkennt eine verbuchte Ausgleichszahlung an ihrer Form (so legt sie
 * „Verbuchen“ auf der Aufteilung an): eine Ausgabe, deren Betrag vollständig
 * eine andere Person trägt. Sie verschiebt Schulden zwischen Personen und
 * ist keine Ausgabe des Haushalts oder eines Projekts. Heuristik — wer für
 * jemanden etwas vollständig auslegt, erzeugt dieselbe Form; auf der
 * Aufteilung ist das gewollt dasselbe (eine Person begleicht für die andere).
 */
export function isSettlementShape(t: {
  type: "income" | "expense" | "transfer";
  amount: number;
  userId: number;
  splits: { userId: number; amount: number }[];
}): boolean {
  return (
    t.type === "expense" &&
    t.splits.length === 1 &&
    t.splits[0].userId !== t.userId &&
    t.splits[0].amount === t.amount
  );
}
