/**
 * Geldfluss-Berechnung: baut aus den sichtbaren Konten und den
 * Dauerbuchungen einen Graphen (Knoten + Kanten) für die Geldfluss-Seite.
 * Reine Funktionen ohne React/Date-Abhängigkeiten — deterministisch testbar.
 *
 * Zwei Schritte, damit das Chart sich an seine tatsächliche Breite anpassen
 * kann, ohne den Graphen neu zu bauen:
 *
 * 1. `buildMoneyFlow` — Kanten aus den Dauerbuchungen, Monatsbeträge,
 *    unverbundene Konten aussortieren, Konten kreuzungsarm ordnen.
 * 2. `layoutMoneyFlow` — Sankey-artiges Spalten-Layout in **Pixeln**:
 *    links der Einnahmen-Balken, mittig die Konten in 1–4 Spalten (so viele,
 *    wie in die verfügbare Breite passen; passt nicht einmal eine, scrollt
 *    das Chart horizontal), rechts der Ausgaben-Balken. Kanten docken an
 *    Ports auf den Kartenrändern an (statt in der Kartenmitte), die
 *    Pseudo-Knoten Einnahmen/Ausgaben wachsen zu Balken über die Höhe ihrer
 *    Partner-Konten, damit ihre Kanten annähernd waagrecht verlaufen. Auf
 *    schmalen Flächen (Handy) werden die Balken schlank (nur Icon, Summen
 *    zeigt das Chart darüber) und Umbuchungen innerhalb der einzigen Spalte
 *    laufen orthogonal über senkrechte Schienen (eine pro Quellkonto) statt
 *    als geschachtelte Bögen.
 */

import { MONTHS_PER_INTERVAL, type RecurringInterval } from '@contracts/types';

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
  interval: RecurringInterval;
  active: boolean;
  /** Notiz/Verwendungszweck der Dauerbuchung (Listenansicht), optional */
  note?: string;
}

export type MoneyFlowNodeKind = 'account' | 'income' | 'expense';
export type MoneyFlowEdgeKind = 'income' | 'expense' | 'transfer';

export interface MoneyFlowEdge {
  id: string;
  /** Knoten-IDs: 'account-<id>' für Konten, sonst 'income' bzw. 'expense' */
  from: string;
  to: string;
  /** Betrag normalisiert auf einen Monat (Cent, gerundet) */
  monthlyAmount: number;
  paused: boolean;
  kind: MoneyFlowEdgeKind;
  /** Notiz der Dauerbuchung ('' wenn keine) */
  note: string;
}

export interface MoneyFlow {
  /** verbundene Konten (Reihenfolge und Spalten vergibt erst layoutMoneyFlow) */
  accounts: MoneyFlowAccount[];
  edges: MoneyFlowEdge[];
  /** Summe der aktiven Einnahmen-Flüsse pro Monat (Cent, Einnahmen-Block) */
  incomeTotal: number;
  /** Summe der aktiven Ausgaben-Flüsse pro Monat (Cent, Ausgaben-Block) */
  expenseTotal: number;
  /**
   * Konten ohne jede Kante (weder Einnahme/Ausgabe noch Umbuchung — pausierte
   * Flüsse zählen als Verbindung); die Seite zeigt sie unterhalb der Grafik.
   */
  unconnected: MoneyFlowAccount[];
  /**
   * true bei vielen Kanten (ab DENSE_EDGES): das Chart blendet die Betrags-
   * Badges dann erst ein, wenn ein Konto per Hover/Tipp hervorgehoben ist.
   */
  dense: boolean;
}

/** Knoten im Layout — Mittelpunkt und Box in Pixeln der Chart-Fläche */
export interface MoneyFlowNode {
  id: string;
  kind: MoneyFlowNodeKind;
  accountId: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MoneyFlowPort {
  x: number;
  y: number;
}

/** Kante mit Geometrie (alle Maße in Pixeln der Chart-Fläche) */
export interface MoneyFlowLaidEdge extends MoneyFlowEdge {
  /** Linienstärke in px, kontinuierlich proportional zum Monatsbetrag */
  width: number;
  /** Andockpunkte auf dem Kartenrand von Quelle bzw. Ziel */
  start: MoneyFlowPort;
  end: MoneyFlowPort;
  /** seitliches Ausbiegen (px) für Bögen innerhalb derselben Spalte, sonst 0 */
  curve: number;
  /**
   * X-Position (px) der senkrechten Schiene bei orthogonaler Führung
   * (Einspalten-Layout: Quelle → waagrecht zur Schiene → senkrecht → Ziel),
   * sonst null (Bezier-Kurve).
   */
  via: number | null;
  /**
   * Position des Labels auf der Kurve (Parameter t, 0 = Quelle, 1 = Ziel).
   * Parallele Kanten (gleiche Quelle bzw. gleiches Ziel) werden entlang der
   * Kurve gestaffelt, damit sich die Badges nicht überdecken; Default 0,5.
   */
  labelT: number;
  /** true, wenn die Kante viele parallele Geschwister hat (Badge kompakter) */
  labelCompact: boolean;
  /** endgültige Label-Position (Mittelpunkt des Badges, px) — kollisionsfrei */
  labelX: number;
  labelY: number;
}

export interface MoneyFlowLayout {
  nodes: MoneyFlowNode[];
  edges: MoneyFlowLaidEdge[];
  /** Breite der Chart-Fläche (px) — mindestens die nötige, sonst die verfügbare */
  widthPx: number;
  /** Höhe der Chart-Fläche (px), wächst mit der Zeilenzahl */
  heightPx: number;
  /** Anzahl der Konto-Spalten */
  columns: number;
  /**
   * true, wenn die Balken Einnahmen/Ausgaben schlank sind (schmale Fläche):
   * das Chart zeigt die Monatssummen dann in einer Zeile über dem Diagramm.
   */
  slimBars: boolean;
}

export interface MoneyFlowLayoutOptions {
  /** verfügbare Breite des Containers (px); Default 1000 */
  widthPx?: number;
  /** Breite der Konto-Karten (px); Default NODE_W_PX, mobil NODE_W_COMPACT_PX */
  nodeWidthPx?: number;
}

/** Pseudo-Knoten für externe Zu-/Abflüsse */
export const INCOME_NODE = 'income';
export const EXPENSE_NODE = 'expense';

/** Linienstärke-Skala (px): linear auf den größten sichtbaren Fluss */
export const WIDTH_MIN = 2;
export const WIDTH_MAX = 18;

/** Kartenmaße (px): Breite regulär/kompakt (schmale Container), Höhe */
export const NODE_W_PX = 160;
export const NODE_W_COMPACT_PX = 140;
export const NODE_H_PX = 92;
/** Vertikaler Rhythmus: Zeilenhöhe pro Konto-Karte und Mindesthöhe (px) */
export const ROW_HEIGHT_PX = 112;
export const MIN_HEIGHT_PX = 280;
/** Maximale Breite der Chart-Fläche — darüber wird sie zentriert */
export const MAX_WIDTH_PX = 1280;
/** Seitlicher Rand der Chart-Fläche (px) */
const PAD_X = 8;
/** Breite der schlanken Einnahmen-/Ausgaben-Balken (px, schmale Flächen) */
export const BAR_W_SLIM_PX = 44;
/** Abstand der senkrechten Schienen (px) und Linienstärke-Deckel im Schienen-Modus */
const LANE_SPACING_PX = 12;
const WIDTH_MAX_LANES = 10;
/** Lücke neben schlanken Balken auf der Seite ohne Schienen (px) */
const SLIM_GAP_PX = 36;

/** Badge-Maße für das Kollisionsmodell (px) */
export const LABEL_W_PX = 84;
export const LABEL_H_PX = 20;
const LABEL_COMPACT_W_PX = 64;
const LABEL_COMPACT_H_PX = 17;

/** Ports: Mindestabstand benachbarter Andockpunkte und Rand zur Kartenkante (px) */
const PORT_SPACING_PX = 22;
const PORT_MARGIN_PX = 12;

/** Ab so vielen Kanten gilt der Graph als dicht (Beträge nur bei Hover/Fokus) */
export const DENSE_EDGES = 24;

/** Betrag einer Dauerbuchung auf Monatsbasis umrechnen (Cent, gerundet) */
export function monthlyAmount(amount: number, interval: MoneyFlowRecurring['interval']): number {
  if (interval === 'weekly') return Math.round((amount * 52) / 12);
  return Math.round(amount / MONTHS_PER_INTERVAL[interval]);
}

/** Mindestabstand zwischen den Kartenkanten benachbarter Spalten (px) */
function minGap(nodeW: number): number {
  return Math.round(nodeW * 0.45);
}

/**
 * Nötige Breite für `cols` Konto-Spalten plus Einnahmen-/Ausgaben-Balken
 * (Balkenbreite barW, Zwischenraum gap — Defaults: Kartenbreite, Mindestlücke)
 */
export function requiredWidth(
  cols: number,
  nodeW: number = NODE_W_PX,
  barW: number = nodeW,
  gap: number = minGap(nodeW)
): number {
  return 2 * barW + cols * nodeW + (cols + 1) * gap + 2 * PAD_X;
}

/** Anzahl der Konto-Spalten nach Kontenzahl: bis 6 eine, ab 7 zwei, ab 15 drei, ab 28 vier */
export function columnCount(count: number): number {
  if (count <= 6) return 1;
  if (count <= 14) return 2;
  if (count <= 27) return 3;
  return 4;
}

/**
 * Spaltenzahl, die in die verfügbare Breite passt (höchstens columnCount).
 * Passt nicht einmal eine Spalte, bleibt es bei einer — das Chart wird dann
 * breiter als der Container und scrollt horizontal.
 */
export function fitColumns(count: number, widthPx: number, nodeW: number = NODE_W_PX): number {
  let cols = columnCount(count);
  while (cols > 1 && requiredWidth(cols, nodeW) > widthPx) cols -= 1;
  return cols;
}

export interface EdgeGeometry {
  /** SVG-Pfad */
  d: string;
  /** Punkt auf der Kante bei Parameter t (0 = Quelle, 1 = Ziel) */
  point: (t: number) => MoneyFlowPort;
  /** Richtung der Kante bei t (nicht normiert) */
  tangent: (t: number) => MoneyFlowPort;
}

/**
 * Orthogonale Führung über eine senkrechte Schiene bei x = via: waagrecht
 * von der Quelle zur Schiene, senkrecht bis auf Zielhöhe, waagrecht ins
 * Ziel — mit abgerundeten Ecken. point/tangent laufen längenproportional
 * über den (eckigen) Polygonzug.
 */
function laneGeometry(a: MoneyFlowPort, b: MoneyFlowPort, via: number): EdgeGeometry {
  const r = (v: number) => Math.round(v * 10) / 10;
  const dx1 = Math.sign(via - a.x) || 1;
  const dy = Math.sign(b.y - a.y) || 1;
  const dx2 = Math.sign(b.x - via) || 1;
  const rad = Math.max(
    0,
    Math.min(12, Math.abs(via - a.x) / 2, Math.abs(b.y - a.y) / 2, Math.abs(b.x - via) / 2)
  );
  const d = [
    `M ${r(a.x)} ${r(a.y)}`,
    `L ${r(via - dx1 * rad)} ${r(a.y)}`,
    `Q ${r(via)} ${r(a.y)} ${r(via)} ${r(a.y + dy * rad)}`,
    `L ${r(via)} ${r(b.y - dy * rad)}`,
    `Q ${r(via)} ${r(b.y)} ${r(via + dx2 * rad)} ${r(b.y)}`,
    `L ${r(b.x)} ${r(b.y)}`,
  ].join(' ');
  const p1 = { x: via, y: a.y };
  const p2 = { x: via, y: b.y };
  const segs: [MoneyFlowPort, MoneyFlowPort][] = [
    [a, p1],
    [p1, p2],
    [p2, b],
  ];
  const lens = segs.map(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y));
  const total = lens.reduce((sum, l) => sum + l, 0) || 1;
  const locate = (t: number) => {
    let dist = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < segs.length; i++) {
      if (dist <= lens[i] || i === segs.length - 1) {
        const [p, q] = segs[i];
        const f = lens[i] > 0 ? dist / lens[i] : 0;
        return { p, q, f };
      }
      dist -= lens[i];
    }
    return { p: a, q: b, f: 0 };
  };
  return {
    d,
    point: (t) => {
      const { p, q, f } = locate(t);
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
    },
    tangent: (t) => {
      const { p, q } = locate(t);
      return { x: q.x - p.x, y: q.y - p.y };
    },
  };
}

/**
 * Kubische S-Kurve (Sankey-Stil): Kontrollpunkte auf halbem Weg, horizontale
 * Tangente an beiden Enden. Kanten mit gleicher X-Position (Ports auf
 * derselben Seite in derselben Spalte) weichen als Bogen zur Seite aus
 * (curve = seitlicher Offset in px) — oder laufen, wenn `via` gesetzt ist,
 * orthogonal über die Schiene bei x = via (laneGeometry). Liefert Pfad plus
 * Punkt- und Tangenten-Funktion für beliebiges t (Label-Position/-Verschiebung).
 */
export function edgeGeometry(
  a: MoneyFlowPort,
  b: MoneyFlowPort,
  curve: number,
  via: number | null = null
): EdgeGeometry {
  if (via !== null) return laneGeometry(a, b, via);
  let c1: MoneyFlowPort;
  let c2: MoneyFlowPort;
  if (Math.abs(a.x - b.x) < 1) {
    const cx = a.x + curve;
    c1 = { x: cx, y: a.y };
    c2 = { x: cx, y: b.y };
  } else {
    const mx = (a.x + b.x) / 2;
    c1 = { x: mx, y: a.y };
    c2 = { x: mx, y: b.y };
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    d: `M ${r(a.x)} ${r(a.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(b.x)} ${r(b.y)}`,
    /** Punkt auf der kubischen Bezier-Kurve bei Parameter t (0–1) */
    point: (t: number): MoneyFlowPort => {
      const u = 1 - t;
      return {
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      };
    },
    /** Tangenten-Richtung der Kurve bei t (Ableitung, nicht normiert) */
    tangent: (t: number): MoneyFlowPort => {
      const u = 1 - t;
      return {
        x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
        y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y),
      };
    },
  };
}

/** Konto-ID aus einer Knoten-ID ('account-<id>'), sonst null */
export function accountIdOf(nodeId: string): number | null {
  return nodeId.startsWith('account-') ? Number(nodeId.slice(8)) : null;
}

/** Netto-Hauptfluss pro Konto (Einnahmen positiv, Ausgaben negativ) */
function netFlows(edges: MoneyFlowEdge[]): Map<number, number> {
  const net = new Map<number, number>();
  const add = (id: number | null, v: number) => {
    if (id !== null) net.set(id, (net.get(id) ?? 0) + v);
  };
  for (const e of edges) {
    if (e.kind === 'income') add(accountIdOf(e.to), e.monthlyAmount);
    else if (e.kind === 'expense') add(accountIdOf(e.from), -e.monthlyAmount);
  }
  return net;
}

/** Umbuchungs-Nachbarn pro Konto: Vorgänger (Geld kommt von) und Nachfolger */
function transferNeighbours(edges: MoneyFlowEdge[]) {
  const preds = new Map<number, Set<number>>();
  const succs = new Map<number, Set<number>>();
  const link = (m: Map<number, Set<number>>, a: number, b: number) =>
    m.set(a, (m.get(a) ?? new Set()).add(b));
  for (const e of edges) {
    if (e.kind !== 'transfer') continue;
    const a = accountIdOf(e.from);
    const b = accountIdOf(e.to);
    if (a === null || b === null) continue;
    link(succs, a, b);
    link(preds, b, a);
  }
  return { preds, succs };
}

/**
 * Konten einer einzelnen Spalte so ordnen, dass Kanten sich möglichst wenig
 * kreuzen (Heuristik): zuerst nach Hauptfluss sortieren (Einnahmen-Empfänger
 * nach oben, Ausgaben-Zahler nach unten), dann ein einzelner Barycenter-Pass,
 * der Transfer-Partner benachbart zieht.
 */
function orderAccounts(accounts: MoneyFlowAccount[], edges: MoneyFlowEdge[]): MoneyFlowAccount[] {
  const net = netFlows(edges);
  const { preds, succs } = transferNeighbours(edges);
  const partners = new Map<number, Set<number>>();
  for (const a of accounts) {
    partners.set(a.id, new Set([...(preds.get(a.id) ?? []), ...(succs.get(a.id) ?? [])]));
  }
  // Erste Ordnung: hoher Einnahmen-Anteil oben, Ausgaben-lastig unten
  const order = [...accounts].sort(
    (a, b) => (net.get(b.id) ?? 0) - (net.get(a.id) ?? 0) || a.id - b.id
  );
  // Barycenter-Pass (sequenziell): jedes Konto an die Position des Mittels
  // seiner Transfer-Partner verschieben — so landen Partner benachbart.
  for (const a of [...order]) {
    const ps = partners.get(a.id);
    if (!ps || ps.size === 0) continue;
    const target = [...ps].reduce((s, p) => s + order.findIndex((b) => b.id === p), 0) / ps.size;
    order.splice(order.indexOf(a), 1);
    order.splice(Math.max(0, Math.min(order.length, Math.round(target))), 0, a);
  }
  return order;
}

/**
 * Konten auf `cols` Spalten verteilen — als Schichtung entlang der
 * Umbuchungen, damit das Diagramm von links nach rechts lesbar bleibt:
 * Konten, die Geld nur weitergeben (Gehaltskonto), links; Konten, die es
 * empfangen (Rücklagen), rechts. Für jedes Konto gibt der längste
 * Umbuchungspfad von einer Quelle die früheste Spalte vor (minRank), der
 * längste Pfad zu einer Senke die späteste (Zyklen werden dabei ignoriert).
 * Innerhalb dieses Spielraums werden die Spalten ausgeglichen gefüllt
 * (am wenigsten belegte erlaubte Spalte), wobei bereits zugewiesene
 * Vorgänger die früheste Spalte anheben — so laufen Umbuchungen möglichst als
 * S-Kurve zwischen Spalten statt als Bogen innerhalb einer Spalte.
 *
 * Reihenfolge innerhalb der Spalten: erst nach Hauptfluss (Einnahmen-
 * Empfänger oben, Ausgaben-Zahler unten), dann Barycenter-Sweeps über die
 * relativen Höhen der Umbuchungs-Partner (links→rechts, rechts→links).
 * Bei einer Spalte greift die einfachere orderAccounts-Heuristik.
 */
export function assignColumns(
  accounts: MoneyFlowAccount[],
  edges: MoneyFlowEdge[],
  cols: number
): MoneyFlowAccount[][] {
  if (cols <= 1) return [orderAccounts(accounts, edges)];
  const ids = new Set(accounts.map((a) => a.id));
  const net = netFlows(edges);
  const { preds, succs } = transferNeighbours(edges);

  /** längster Pfad entlang `next` (memoisiert; Kanten auf den DFS-Pfad = Zyklus → ignoriert) */
  const longest = (next: Map<number, Set<number>>) => {
    const memo = new Map<number, number>();
    const stack = new Set<number>();
    const walk = (id: number): number => {
      const known = memo.get(id);
      if (known !== undefined) return known;
      stack.add(id);
      let best = 0;
      for (const n of next.get(id) ?? []) {
        if (!ids.has(n) || stack.has(n)) continue;
        best = Math.max(best, walk(n) + 1);
      }
      stack.delete(id);
      memo.set(id, best);
      return best;
    };
    return (id: number) => walk(id);
  };
  const fromSource = longest(preds);
  const toSink = longest(succs);

  const last = cols - 1;
  const range = new Map<number, { lo: number; hi: number }>();
  for (const a of accounts) {
    const lo = Math.min(last, fromSource(a.id));
    const hi = Math.max(lo, last - Math.min(last, toSink(a.id)));
    range.set(a.id, { lo, hi });
  }

  // Zuweisung: erst die fest gebundenen Konten (lo = hi), dann die flexiblen
  // nach frühester Spalte und Spielraum — jeweils in die am wenigsten belegte
  // erlaubte Spalte, damit die Spalten möglichst gleich lang werden
  const layer = new Map<number, number>();
  const fill = Array.from({ length: cols }, () => 0);
  const order = [...accounts].sort((a, b) => {
    const ra = range.get(a.id)!;
    const rb = range.get(b.id)!;
    return (
      ra.hi - ra.lo - (rb.hi - rb.lo) ||
      ra.lo - rb.lo ||
      (net.get(b.id) ?? 0) - (net.get(a.id) ?? 0) ||
      a.id - b.id
    );
  });
  for (const a of order) {
    const r = range.get(a.id)!;
    let lo = r.lo;
    for (const p of preds.get(a.id) ?? []) {
      const lp = layer.get(p);
      if (lp !== undefined) lo = Math.max(lo, lp + 1);
    }
    lo = Math.min(lo, r.hi);
    let best = lo;
    for (let c = lo; c <= r.hi; c++) if (fill[c] < fill[best]) best = c;
    layer.set(a.id, best);
    fill[best] += 1;
  }

  const columns: MoneyFlowAccount[][] = Array.from({ length: cols }, () => []);
  for (const a of accounts) columns[layer.get(a.id) ?? 0].push(a);
  for (const col of columns) {
    col.sort((a, b) => (net.get(b.id) ?? 0) - (net.get(a.id) ?? 0) || a.id - b.id);
  }

  // Barycenter-Sweeps: relative Höhe (0–1) der Umbuchungs-Partner mitteln
  const relative = new Map<number, number>();
  const refresh = (col: MoneyFlowAccount[]) =>
    col.forEach((a, i) => relative.set(a.id, (i + 0.5) / col.length));
  columns.forEach(refresh);
  const sweep = (col: MoneyFlowAccount[]) => {
    const bary = new Map<number, number>();
    for (const a of col) {
      const partners = [...(preds.get(a.id) ?? []), ...(succs.get(a.id) ?? [])].filter(
        (p) => ids.has(p) && layer.get(p) !== layer.get(a.id)
      );
      bary.set(
        a.id,
        partners.length === 0
          ? relative.get(a.id)!
          : partners.reduce((s, p) => s + relative.get(p)!, 0) / partners.length
      );
    }
    col.sort((a, b) => bary.get(a.id)! - bary.get(b.id)!);
    refresh(col);
  };
  for (let round = 0; round < 2; round++) {
    for (let c = 1; c < cols; c++) sweep(columns[c]);
    for (let c = cols - 2; c >= 0; c--) sweep(columns[c]);
  }
  return columns;
}

/** Geldfluss-Graph aus Konten und Dauerbuchungen aufbauen */
export function buildMoneyFlow(
  accounts: MoneyFlowAccount[],
  recurring: MoneyFlowRecurring[]
): MoneyFlow {
  const accountIds = new Set(accounts.map((a) => a.id));
  const edges: MoneyFlowEdge[] = [];
  for (const r of recurring) {
    const from = r.type === 'income' ? INCOME_NODE : `account-${r.accountId}`;
    const to =
      r.type === 'expense'
        ? EXPENSE_NODE
        : r.type === 'income'
          ? `account-${r.accountId}`
          : `account-${r.toAccountId ?? 0}`;
    // Dauerbuchungen auf nicht sichtbare Konten (z. B. fremde private) auslassen
    const fromId = accountIdOf(from);
    const toId = accountIdOf(to);
    if (fromId !== null && !accountIds.has(fromId)) continue;
    if (toId !== null && !accountIds.has(toId)) continue;
    edges.push({
      id: `rec-${r.id}`,
      from,
      to,
      monthlyAmount: monthlyAmount(r.amount, r.interval),
      paused: !r.active,
      kind: r.type,
      note: r.note?.trim() ?? '',
    });
  }

  // Konten ohne jede Kante fliegen aus dem Diagramm in ein eigenes Areal —
  // pausierte Dauerbuchungen erzeugen Kanten und zählen als Verbindung.
  const connectedIds = new Set<number>();
  for (const e of edges) {
    const f = accountIdOf(e.from);
    const t = accountIdOf(e.to);
    if (f !== null) connectedIds.add(f);
    if (t !== null) connectedIds.add(t);
  }
  const connected = accounts.filter((a) => connectedIds.has(a.id));
  const unconnected = accounts.filter((a) => !connectedIds.has(a.id));

  const sum = (kind: MoneyFlowEdgeKind) =>
    edges.filter((e) => e.kind === kind && !e.paused).reduce((s, e) => s + e.monthlyAmount, 0);

  return {
    accounts: connected,
    edges,
    incomeTotal: sum('income'),
    expenseTotal: sum('expense'),
    unconnected,
    dense: edges.length >= DENSE_EDGES,
  };
}

/** Zu- und Abflüsse eines Knotens (für Fokus-Detail und Listenansicht) */
export interface MoneyFlowNodeFlows {
  inflow: MoneyFlowEdge[];
  outflow: MoneyFlowEdge[];
  /** Summen der aktiven (nicht pausierten) Flüsse pro Monat (Cent) */
  inTotal: number;
  outTotal: number;
}

export function nodeFlows(flow: MoneyFlow, nodeId: string): MoneyFlowNodeFlows {
  const byAmount = (a: MoneyFlowEdge, b: MoneyFlowEdge) =>
    b.monthlyAmount - a.monthlyAmount || a.id.localeCompare(b.id);
  const inflow = flow.edges.filter((e) => e.to === nodeId).sort(byAmount);
  const outflow = flow.edges.filter((e) => e.from === nodeId).sort(byAmount);
  const active = (list: MoneyFlowEdge[]) =>
    list.filter((e) => !e.paused).reduce((s, e) => s + e.monthlyAmount, 0);
  return {
    inflow,
    outflow,
    inTotal: active(inflow),
    outTotal: active(outflow),
  };
}

// ─── Layout ────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Wunschpositionen in einen Bereich legen und dabei einen Mindestabstand
 * einhalten (1D): Vorwärts-Pass schiebt Nachbarn auseinander, die mittlere
 * Verschiebung wird herausgerechnet (Gruppe bleibt um die Wunschlagen
 * zentriert), zuletzt wird die Gruppe als Ganzes in den Bereich geschoben.
 * Ist der Bereich zu klein, schrumpft der Abstand, bis alles hineinpasst.
 */
function spreadPositions(desired: number[], lo: number, hi: number, spacing: number): number[] {
  const k = desired.length;
  if (k === 0) return [];
  const sp = k > 1 ? Math.min(spacing, (hi - lo) / (k - 1)) : spacing;
  const ys = [...desired];
  for (let i = 1; i < k; i++) ys[i] = Math.max(ys[i], ys[i - 1] + sp);
  const shift = ys.reduce((s, y, i) => s + (y - desired[i]), 0) / k;
  for (let i = 0; i < k; i++) ys[i] -= shift;
  const over = Math.max(0, ys[k - 1] - hi);
  const under = Math.max(0, lo - ys[0]);
  for (let i = 0; i < k; i++) ys[i] = clamp(ys[i] - over + under, lo, hi);
  return ys;
}

/**
 * Kurven-Offsets vergeben: Kanten zwischen Knoten derselben Spalte biegen
 * seitlich aus (erste rechts, dann alternierend, wachsender Bogen), Bögen
 * über mehrere Zeilen etwas weiter, damit sie den kürzeren nicht schneiden —
 * gedeckelt, sodass sie im Zwischenraum zur Nachbarspalte bleiben.
 * Kanten zwischen verschiedenen Spalten laufen als S-Kurve (curve 0) —
 * parallele Kanten trennen die Ports.
 */
function assignCurves(
  edges: MoneyFlowLaidEdge[],
  nodeById: Map<string, MoneyFlowNode>,
  bowPx: number
): void {
  const pairs = new Map<string, MoneyFlowLaidEdge[]>();
  for (const e of edges) {
    const key = [e.from, e.to].sort().join('|');
    const list = pairs.get(key) ?? [];
    list.push(e);
    pairs.set(key, list);
  }
  for (const list of pairs.values()) {
    const a = nodeById.get(list[0].from);
    const b = nodeById.get(list[0].to);
    if (!a || !b) continue;
    const sameColumn = Math.abs(a.x - b.x) < 1;
    if (!sameColumn || list[0].via !== null) {
      for (const e of list) e.curve = 0;
      continue;
    }
    const rowsApart = Math.max(1, Math.abs(a.y - b.y) / ROW_HEIGHT_PX);
    const reach = Math.min(1.15, 0.75 + 0.15 * rowsApart);
    list.forEach((e, i) => {
      e.curve = (i % 2 === 0 ? 1 : -1) * Math.round(bowPx * reach + 12 * Math.floor(i / 2));
    });
  }
}

/**
 * Schienen für Umbuchungen innerhalb der einzigen Spalte: jedes Quellkonto
 * bekommt eine eigene senkrechte Schiene (Reihenfolge nach Kartenhöhe,
 * innerste Schiene für das oberste Konto) auf der Seite mit weniger
 * geraden Kanten (Einnahmen links vs. Ausgaben rechts), sodass die Schienen
 * möglichst wenige kreuzen. Liefert die Anzahl der Schienen.
 */
function assignLanes(
  edges: MoneyFlowLaidEdge[],
  nodeById: Map<string, MoneyFlowNode>,
  side: 'left' | 'right'
): number {
  const sameColumn = edges.filter((e) => {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    return a && b && a.kind === 'account' && b.kind === 'account' && Math.abs(a.x - b.x) < 1;
  });
  const sources = [...new Set(sameColumn.map((e) => e.from))].sort(
    (p, q) => (nodeById.get(p)?.y ?? 0) - (nodeById.get(q)?.y ?? 0)
  );
  const lane = new Map(sources.map((id, i) => [id, i]));
  const dir = side === 'right' ? 1 : -1;
  for (const e of sameColumn) {
    const a = nodeById.get(e.from)!;
    const portX = a.x + (dir * a.w) / 2;
    e.via = portX + dir * ((lane.get(e.from) ?? 0) + 1) * LANE_SPACING_PX;
  }
  return sources.length;
}

/**
 * Ports vergeben: jede Kante dockt auf der dem Partner zugewandten Seite an
 * (Bögen in derselben Spalte auf der Seite, zu der sie ausbiegen). Pro
 * Kartenseite werden die Andockpunkte nach der Höhe des Partners sortiert
 * (keine Kreuzungen direkt am Knoten) und mit Mindestabstand verteilt —
 * Konto-Karten zentriert um die Kartenmitte, die Balken Einnahmen/Ausgaben
 * auf Höhe des jeweiligen Partners (Kanten so waagrecht wie möglich).
 */
function assignPorts(edges: MoneyFlowLaidEdge[], nodeById: Map<string, MoneyFlowNode>): void {
  interface Slot {
    edge: MoneyFlowLaidEdge;
    end: 'start' | 'end';
    partnerY: number;
    partnerX: number;
  }
  const slots = new Map<string, Slot[]>();
  const add = (nodeId: string, side: 'left' | 'right', slot: Slot) => {
    const key = `${nodeId}|${side}`;
    const list = slots.get(key) ?? [];
    list.push(slot);
    slots.set(key, list);
  };
  for (const e of edges) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue;
    let aSide: 'left' | 'right';
    let bSide: 'left' | 'right';
    if (e.via !== null) {
      aSide = bSide = e.via < a.x ? 'left' : 'right';
    } else if (Math.abs(a.x - b.x) < 1) {
      aSide = bSide = e.curve >= 0 ? 'right' : 'left';
    } else if (b.x > a.x) {
      aSide = 'right';
      bSide = 'left';
    } else {
      aSide = 'left';
      bSide = 'right';
    }
    add(e.from, aSide, { edge: e, end: 'start', partnerY: b.y, partnerX: b.x });
    add(e.to, bSide, { edge: e, end: 'end', partnerY: a.y, partnerX: a.x });
  }
  for (const [key, list] of slots) {
    const [nodeId, side] = key.split('|');
    const node = nodeById.get(nodeId);
    if (!node) continue;
    list.sort(
      (p, q) =>
        p.partnerY - q.partnerY ||
        p.partnerX - q.partnerX ||
        q.edge.monthlyAmount - p.edge.monthlyAmount ||
        p.edge.id.localeCompare(q.edge.id)
    );
    const x = side === 'right' ? node.x + node.w / 2 : node.x - node.w / 2;
    const lo = node.y - node.h / 2 + PORT_MARGIN_PX;
    const hi = node.y + node.h / 2 - PORT_MARGIN_PX;
    const follow = node.kind !== 'account';
    const desired = list.map((s) => (follow ? clamp(s.partnerY, lo, hi) : node.y));
    const ys = spreadPositions(desired, lo, hi, PORT_SPACING_PX);
    list.forEach((s, i) => {
      const port = { x, y: Math.round(ys[i] * 10) / 10 };
      if (s.end === 'start') s.edge.start = port;
      else s.edge.end = port;
    });
  }
}

/**
 * Label-Staffelung für parallele Kanten: Kanten mit gleicher Quelle laufen
 * vom selben Knoten auseinander — ihre Labels wandern Richtung Ziel (t > 0,5,
 * dort liegen sie weiter auseinander); Kanten mit gleichem Ziel laufen zusammen
 * — ihre Labels wandern Richtung Quelle (t < 0,5). Pro Gruppe nach Betrag
 * absteigend vergeben (dicke Kanten bleiben zentraler). Ab 5 parallelen
 * Geschwistern wird das Badge kompakt gerendert (labelCompact).
 */
function assignLabelT(edges: MoneyFlowLaidEdge[]): void {
  /** Anzahl paralleler Geschwister (größere der beiden Gruppen) */
  const peers = new Map<MoneyFlowLaidEdge, number>();
  const count = (keyOf: (e: MoneyFlowLaidEdge) => string) => {
    const groups = new Map<string, MoneyFlowLaidEdge[]>();
    for (const e of edges) {
      const list = groups.get(keyOf(e)) ?? [];
      list.push(e);
      groups.set(keyOf(e), list);
    }
    for (const list of groups.values()) {
      for (const e of list) peers.set(e, Math.max(peers.get(e) ?? 1, list.length));
    }
    return groups;
  };
  const bySource = count((e) => e.from);
  const byTarget = count((e) => e.to);

  for (const e of edges) e.labelCompact = (peers.get(e) ?? 1) >= 5;

  // Richtung: Quell-Gruppen Richtung Ziel staffeln, Ziel-Gruppen Richtung Quelle
  const stagger = (groups: Map<string, MoneyFlowLaidEdge[]>, dir: 1 | -1) => {
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => b.monthlyAmount - a.monthlyAmount);
      sorted.forEach((e, i) => {
        // große Beträge zuerst = kleinste Auslenkung (zentralster Platz)
        const t = Math.max(0.15, Math.min(0.85, 0.5 + dir * ((i + 0.5) / sorted.length) * 0.35));
        if (Math.abs(t - 0.5) > Math.abs(e.labelT - 0.5)) e.labelT = t;
      });
    }
  };
  stagger(bySource, 1);
  stagger(byTarget, -1);
}

export interface RectPx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function rectCentered(cx: number, cy: number, w: number, h: number): RectPx {
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

/** Überlappungsfläche zweier Rechtecke in px² (0 bei Berührung/Nichtschnitt) */
function overlapArea(a: RectPx, b: RectPx): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Knoten-Karte als Rechteck (px) für das Kollisionsmodell */
export function nodeRectPx(node: MoneyFlowNode): RectPx {
  return rectCentered(node.x, node.y, node.w, node.h);
}

/** Badge-Maße (px) einer Kante */
function labelSize(edge: MoneyFlowLaidEdge): { w: number; h: number } {
  return edge.labelCompact
    ? { w: LABEL_COMPACT_W_PX, h: LABEL_COMPACT_H_PX }
    : { w: LABEL_W_PX, h: LABEL_H_PX };
}

/** Label-Badge als Rechteck (px) für das Kollisionsmodell */
export function labelRectPx(edge: MoneyFlowLaidEdge): RectPx {
  const { w, h } = labelSize(edge);
  return rectCentered(edge.labelX, edge.labelY, w, h);
}

/**
 * Label-Kollisionen auflösen (läuft nach assignLabelT): jedes Badge startet
 * auf der Kurve bei labelT. Schneidet seine Box eine Knoten-Box oder ein
 * bereits platziertes Badge, wandert es iterativ senkrecht zur Kurventangente
 * in den freien Raum — beide Seiten (zuerst weg vom näheren Endknoten),
 * ergänzt um rein horizontale Schritte (an den Kurvenenden ist die Tangente
 * waagrecht, der freie Raum liegt zwischen den Spalten), wachsender Offset,
 * t lokal ±0,05 variierbar, geclamppt auf den Container.
 * Überlappung mit Karten zählt vierfach. Fallback ist die Position mit der
 * geringsten Überlappung — nie schlechter als die Startposition.
 *
 * Im dichten Modus (flow.dense) sind immer nur die Badges eines Knotens
 * gleichzeitig sichtbar — dann zählen nur Kollisionen mit Badges, die einen
 * Endknoten teilen; so bleiben die Badges nah an ihrer Kurve.
 */
function assignLabelPositions(
  nodes: MoneyFlowNode[],
  edges: MoneyFlowLaidEdge[],
  widthPx: number,
  heightPx: number,
  dense: boolean
): void {
  const nodeRects = nodes.map(nodeRectPx);
  const placed: { rect: RectPx; edge: MoneyFlowLaidEdge }[] = [];
  /** Seitlicher Schritt und maximale Auslenkung der Verschiebung (px) */
  const STEP_PX = 14;
  const MAX_STEPS = 8;

  // große Flüsse zuerst platzieren — ihre Badges bekommen die freien Plätze
  const ordered = [...edges].sort(
    (a, b) => b.monthlyAmount - a.monthlyAmount || a.id.localeCompare(b.id)
  );

  for (const e of ordered) {
    const g = edgeGeometry(e.start, e.end, e.curve, e.via);
    const { w, h } = labelSize(e);
    const centerA = e.start;
    const centerB = e.end;
    const related = (o: MoneyFlowLaidEdge) =>
      !dense || o.from === e.from || o.to === e.to || o.from === e.to || o.to === e.from;

    const scoreAt = (rect: RectPx) => {
      let s = 0;
      for (const nr of nodeRects) s += 4 * overlapArea(rect, nr);
      for (const p of placed) if (related(p.edge)) s += overlapArea(rect, p.rect);
      return s;
    };

    const findSpot = (): RectPx => {
      let best: RectPx | null = null;
      let bestScore = Infinity;
      for (const dt of [0, -0.05, 0.05]) {
        const t = Math.max(0.05, Math.min(0.95, e.labelT + dt));
        const base = g.point(t);
        const tan = g.tangent(t);
        const len = Math.hypot(tan.x, tan.y) || 1;
        const nx = -tan.y / len;
        const ny = tan.x / len;
        // bevorzugte Seite: weg vom näheren Endpunkt
        const near =
          Math.hypot(base.x - centerA.x, base.y - centerA.y) <=
          Math.hypot(base.x - centerB.x, base.y - centerB.y)
            ? centerA
            : centerB;
        const pref = (base.x - near.x) * nx + (base.y - near.y) * ny >= 0 ? 1 : -1;
        // Fluchtrichtungen: senkrecht zur Tangente (beide Seiten) — plus rein
        // horizontal, denn an den Kurvenenden ist die Tangente waagrecht und
        // der freie Raum liegt seitlich (zwischen den Spalten), nicht darüber.
        const dirs: [number, number][] = [
          [pref * nx, pref * ny],
          [-pref * nx, -pref * ny],
          [pref, 0],
          [-pref, 0],
        ];
        for (let k = 0; k <= MAX_STEPS; k++) {
          for (const [dx, dy] of dirs) {
            const cx = clamp(base.x + k * STEP_PX * dx, w / 2, widthPx - w / 2);
            const cy = clamp(base.y + k * STEP_PX * dy, h / 2, heightPx - h / 2);
            const rect = rectCentered(cx, cy, w, h);
            const s = scoreAt(rect);
            if (s < bestScore) {
              best = rect;
              bestScore = s;
            }
            if (s === 0) return rect;
          }
        }
      }
      return best ?? rectCentered(centerA.x, centerA.y, w, h);
    };

    const rect = findSpot();
    placed.push({ rect, edge: e });
    e.labelX = Math.round((rect.x1 + rect.x2) / 2);
    e.labelY = Math.round((rect.y1 + rect.y2) / 2);
  }
}

/**
 * Spalten-Layout in Pixeln: Konten spaltenweise gefüllt (so viele Spalten,
 * wie in die Breite passen, höchstens columnCount), Y-Positionen gleichmäßig
 * über die Höhe; Einnahmen-/Ausgaben-Balken links/rechts über die Höhe
 * ihrer Partner-Konten; danach Kurven, Ports, Label-Staffelung und
 * Kollisionsauflösung.
 */
export function layoutMoneyFlow(
  flow: MoneyFlow,
  options: MoneyFlowLayoutOptions = {}
): MoneyFlowLayout {
  const available = options.widthPx ?? 1000;
  const n = flow.accounts.length;
  // Kartenbreite: gewünscht, oder kompakt, wenn so eine Spalte mehr hineinpasst
  let nodeW = options.nodeWidthPx ?? NODE_W_PX;
  if (
    nodeW > NODE_W_COMPACT_PX &&
    fitColumns(n, available, NODE_W_COMPACT_PX) > fitColumns(n, available, nodeW)
  ) {
    nodeW = NODE_W_COMPACT_PX;
  }
  const columns = fitColumns(n, available, nodeW);
  // Einspalten-Layout: Umbuchungen laufen über Schienen — auf der Seite mit
  // weniger geraden Kanten; der Zwischenraum muss die Schienen fassen
  const lanes = columns === 1;
  const laneSide: 'left' | 'right' =
    flow.edges.filter((e) => e.kind === 'income').length <=
    flow.edges.filter((e) => e.kind === 'expense').length
      ? 'left'
      : 'right';
  const laneCount = lanes
    ? new Set(flow.edges.filter((e) => e.kind === 'transfer').map((e) => e.from)).size
    : 0;
  const baseGap = minGap(nodeW);
  const laneGap =
    lanes && laneCount > 0 ? Math.max(baseGap, (laneCount + 1) * LANE_SPACING_PX) : baseGap;
  let leftGap = lanes && laneSide === 'left' ? laneGap : baseGap;
  let rightGap = lanes && laneSide === 'right' ? laneGap : baseGap;
  const need = (bw: number) =>
    2 * bw + columns * nodeW + leftGap + rightGap + (columns - 1) * baseGap + 2 * PAD_X;
  // passt nicht einmal eine Spalte mit vollen Balken, werden die Balken
  // schlank und die Lücke ohne Schienen eng
  const slimBars = columns === 1 && need(nodeW) > available;
  if (slimBars) {
    if (leftGap === baseGap) leftGap = SLIM_GAP_PX;
    if (rightGap === baseGap) rightGap = SLIM_GAP_PX;
  }
  const barW = slimBars ? BAR_W_SLIM_PX : nodeW;
  const widthPx = Math.round(Math.min(MAX_WIDTH_PX, Math.max(available, need(barW))));
  const columnAccounts = assignColumns(flow.accounts, flow.edges, columns);
  const rows = Math.max(1, ...columnAccounts.map((c) => c.length));
  const heightPx = Math.max(MIN_HEIGHT_PX, rows * ROW_HEIGHT_PX);

  const incomeX = PAD_X + barW / 2;
  const expenseX = widthPx - PAD_X - barW / 2;
  // Konto-Spalten gleichmäßig zwischen den Lücken neben den Balken
  const firstX = PAD_X + barW + leftGap + nodeW / 2;
  const lastX = widthPx - PAD_X - barW - rightGap - nodeW / 2;
  const columnX = (col: number) =>
    Math.round(
      columns > 1 ? firstX + ((lastX - firstX) * col) / (columns - 1) : (firstX + lastX) / 2
    );

  // Y gleichmäßig über die Höhe — kürzere Spalten bekommen mehr Luft
  const accountNodes: MoneyFlowNode[] = columnAccounts.flatMap((col, c) =>
    col.map((a, i) => ({
      id: `account-${a.id}`,
      kind: 'account' as const,
      accountId: a.id,
      x: columnX(c),
      y: Math.round(((i + 0.5) / col.length) * heightPx),
      w: nodeW,
      h: NODE_H_PX,
    }))
  );
  const accountY = new Map(accountNodes.map((node) => [node.id, node.y]));

  // Balken Einnahmen/Ausgaben: von der obersten bis zur untersten Partner-Karte
  const bar = (
    id: string,
    kind: MoneyFlowNodeKind,
    x: number,
    partner: (e: MoneyFlowEdge) => string
  ) => {
    const ys = flow.edges
      .filter((e) => e.from === id || e.to === id)
      .map((e) => accountY.get(partner(e)))
      .filter((y): y is number => y !== undefined);
    let y = heightPx / 2;
    let h = NODE_H_PX;
    if (ys.length > 0) {
      const top = Math.max(0, Math.min(...ys) - NODE_H_PX / 2);
      const bottom = Math.min(heightPx, Math.max(...ys) + NODE_H_PX / 2);
      h = Math.max(NODE_H_PX, bottom - top);
      y = Math.round((top + bottom) / 2);
    }
    return {
      id,
      kind,
      accountId: null,
      x,
      y,
      w: barW,
      h,
    } satisfies MoneyFlowNode;
  };
  const nodes: MoneyFlowNode[] = [
    bar(INCOME_NODE, 'income', incomeX, (e) => e.to),
    bar(EXPENSE_NODE, 'expense', expenseX, (e) => e.from),
    ...accountNodes,
  ];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  // Linienstärke kontinuierlich, linear auf den größten Monatsbetrag skaliert
  // (im Schienen-Modus gedeckelt, damit Nachbar-Schienen sich nicht überdecken)
  const max = Math.max(0, ...flow.edges.map((e) => e.monthlyAmount));
  const widthMax = lanes ? WIDTH_MAX_LANES : WIDTH_MAX;
  const edges: MoneyFlowLaidEdge[] = flow.edges.map((e) => ({
    ...e,
    width:
      max <= 0
        ? WIDTH_MIN
        : Math.round((WIDTH_MIN + ((widthMax - WIDTH_MIN) * e.monthlyAmount) / max) * 10) / 10,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    curve: 0,
    via: null,
    labelT: 0.5,
    labelCompact: false,
    labelX: 0,
    labelY: 0,
  }));

  if (lanes) assignLanes(edges, nodeById, laneSide);
  // freier Raum zwischen zwei Spalten — Bögen bleiben innerhalb davon
  const columnGap = columns > 1 ? columnX(1) - columnX(0) - nodeW : Math.min(leftGap, rightGap);
  assignCurves(edges, nodeById, Math.round(Math.max(24, columnGap) * 0.55));
  assignPorts(edges, nodeById);
  assignLabelT(edges);
  assignLabelPositions(nodes, edges, widthPx, heightPx, flow.dense);

  return { nodes, edges, widthPx, heightPx, columns, slimBars };
}
