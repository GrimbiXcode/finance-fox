/**
 * Geldfluss-Berechnung: baut aus den sichtbaren Konten und den
 * Dauerbuchungen einen Graphen (Knoten + Kanten) für die Geldfluss-Seite.
 * Reine Funktion ohne React/Date-Abhängigkeiten — deterministisch testbar.
 */

export interface MoneyFlowAccount {
  id: number;
  name: string;
  type: string;
  bankId: number | null;
  balance: number;
}

export interface MoneyFlowRecurring {
  id: number;
  type: 'income' | 'expense' | 'transfer';
  accountId: number;
  toAccountId: number | null;
  amount: number;
  interval: 'weekly' | 'monthly' | 'yearly';
  active: boolean;
}

export type MoneyFlowNodeKind = 'account' | 'income' | 'expense';

export interface MoneyFlowNode {
  /** 'account-<id>' für Konten, sonst 'income' bzw. 'expense' */
  id: string;
  kind: MoneyFlowNodeKind;
  accountId: number | null;
  /** Position in Prozent der Chart-Fläche (0–100, Mittelpunkt des Knotens) */
  x: number;
  y: number;
}

export interface MoneyFlowEdge {
  id: string;
  from: string;
  to: string;
  /** Betrag normalisiert auf einen Monat (Cent, gerundet) */
  monthlyAmount: number;
  paused: boolean;
  /** Kantenstärke 1 (klein) bis 3 (groß), relativ zum größten Fluss */
  strength: 1 | 2 | 3;
  /** Kurven-Offset: Betrag der senkrechten Auslenkung (Vorzeichen = Seite) */
  curve: number;
  kind: 'income' | 'expense' | 'transfer';
}

export interface MoneyFlow {
  nodes: MoneyFlowNode[];
  edges: MoneyFlowEdge[];
}

/** Pseudo-Knoten für externe Zu-/Abflüsse */
export const INCOME_NODE = 'income';
export const EXPENSE_NODE = 'expense';

/** Betrag einer Dauerbuchung auf Monatsbasis umrechnen (Cent, gerundet) */
export function monthlyAmount(amount: number, interval: MoneyFlowRecurring['interval']): number {
  if (interval === 'weekly') return Math.round((amount * 52) / 12);
  if (interval === 'yearly') return Math.round(amount / 12);
  return amount;
}

/** Positionen der Konto-Knoten: Ellipse um die Mitte, ab 3 Konten */
function accountPositions(count: number): { x: number; y: number }[] {
  if (count <= 2) {
    // Wenige Konten: einfache Horizontalanordnung auf der Mittellinie
    const xs = count === 1 ? [50] : [34, 66];
    return xs.map((x) => ({ x, y: 50 }));
  }
  const cx = 50;
  const cy = 50;
  const rx = 31;
  const ry = 34;
  // Bei count % 4 === 0 läge je ein Konto exakt auf der 9-Uhr- bzw.
  // 3-Uhr-Position und verdeckte die Pseudo-Knoten Einnahmen/Ausgaben —
  // dann den Startwinkel um einen halben Schritt versetzen.
  const offset = count % 4 === 0 ? Math.PI / count : 0;
  return Array.from({ length: count }, (_, i) => {
    // Start oben (-90°), dann gleichmäßig im Uhrzeigersinn
    const angle = -Math.PI / 2 + offset + (i * 2 * Math.PI) / count;
    return {
      x: Math.round((cx + rx * Math.cos(angle)) * 10) / 10,
      y: Math.round((cy + ry * Math.sin(angle)) * 10) / 10,
    };
  });
}

/**
 * Kurven-Offsets vergeben: Kanten zwischen demselben Knotenpaar werden
 * aufgefächert, gegenläufige Richtungen auf entgegengesetzte Seiten gelegt.
 */
function assignCurves(edges: MoneyFlowEdge[]): void {
  const pairs = new Map<string, MoneyFlowEdge[]>();
  for (const e of edges) {
    const key = [e.from, e.to].sort().join('|');
    const list = pairs.get(key) ?? [];
    list.push(e);
    pairs.set(key, list);
  }
  for (const list of pairs.values()) {
    const bothDirections = list.some((e) => e.from < e.to) && list.some((e) => e.from > e.to);
    const perDirection = new Map<boolean, number>();
    for (const e of list) {
      const forward = e.from < e.to;
      const i = perDirection.get(forward) ?? 0;
      perDirection.set(forward, i + 1);
      if (bothDirections) {
        // Gegenläufige Paare: je Seite eine Kurvenrichtung, weitere auffächern
        e.curve = (forward ? 1 : -1) * (14 + 12 * i);
      } else {
        // Gleichgerichtete Mehrfachkanten: symmetrisch um die Gerade fächern
        e.curve = list.length === 1 ? 10 : (i - (list.length - 1) / 2) * 14;
      }
    }
  }
}

/** Geldfluss-Graph aus Konten und Dauerbuchungen aufbauen */
export function buildMoneyFlow(
  accounts: MoneyFlowAccount[],
  recurring: MoneyFlowRecurring[],
): MoneyFlow {
  const sorted = [...accounts].sort((a, b) => a.id - b.id);
  const positions = accountPositions(sorted.length);

  const nodes: MoneyFlowNode[] = [
    { id: INCOME_NODE, kind: 'income', accountId: null, x: 7, y: 50 },
    { id: EXPENSE_NODE, kind: 'expense', accountId: null, x: 93, y: 50 },
    ...sorted.map((a, i) => ({
      id: `account-${a.id}`,
      kind: 'account' as const,
      accountId: a.id,
      x: positions[i].x,
      y: positions[i].y,
    })),
  ];

  const accountIds = new Set(sorted.map((a) => a.id));
  const edges: MoneyFlowEdge[] = [];
  for (const r of recurring) {
    const from =
      r.type === 'income' ? INCOME_NODE : `account-${r.accountId}`;
    const to =
      r.type === 'expense'
        ? EXPENSE_NODE
        : r.type === 'income'
          ? `account-${r.accountId}`
          : `account-${r.toAccountId ?? 0}`;
    // Dauerbuchungen auf nicht sichtbare Konten (z. B. fremde private) auslassen
    if (from.startsWith('account-') && !accountIds.has(Number(from.slice(8)))) continue;
    if (to.startsWith('account-') && !accountIds.has(Number(to.slice(8)))) continue;
    edges.push({
      id: `rec-${r.id}`,
      from,
      to,
      monthlyAmount: monthlyAmount(r.amount, r.interval),
      paused: !r.active,
      strength: 1,
      curve: 0,
      kind: r.type,
    });
  }

  // Kantenstärke in 3 Stufen relativ zum größten Monatsbetrag
  const max = Math.max(0, ...edges.map((e) => e.monthlyAmount));
  for (const e of edges) {
    e.strength = max === 0 ? 1 : e.monthlyAmount >= (max * 2) / 3 ? 3 : e.monthlyAmount >= max / 3 ? 2 : 1;
  }

  assignCurves(edges);
  return { nodes, edges };
}
