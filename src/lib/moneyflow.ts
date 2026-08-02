/**
 * Geldfluss-Berechnung: baut aus den sichtbaren Konten und den
 * Dauerbuchungen einen Graphen (Knoten + Kanten) für die Geldfluss-Seite.
 * Reine Funktion ohne React/Date-Abhängigkeiten — deterministisch testbar.
 *
 * Layout: Sankey-artiges Spalten-Layout (layoutColumns) — links der
 * Einnahmen-Block, mittig die Konten in 1–3 Spalten, rechts der
 * Ausgaben-Block. Die Linienstärke der Kanten ist proportional zum
 * Monatsbetrag (kontinuierlich, siehe width).
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
  /** Linienstärke in px, kontinuierlich proportional zum Monatsbetrag */
  width: number;
  /** Kurven-Offset: seitliches Ausbiegen (gleiche Spalte) bzw. Auffächern */
  curve: number;
  /**
   * Position des Labels auf der Kurve (Parameter t, 0 = Quelle, 1 = Ziel).
   * Parallele Kanten (gleiche Quelle bzw. gleiches Ziel) werden entlang der
   * Kurve gestaffelt, damit sich die Badges nicht überdecken; Default 0,5.
   */
  labelT: number;
  /** true, wenn die Kante viele parallele Geschwister hat (Badge kompakter) */
  labelCompact: boolean;
  /**
   * Endgültige Label-Position in Prozent der Chart-Fläche (Mittelpunkt des
   * Badges) — von assignLabelPositions kollisionsfrei neben die Kurve gelegt.
   */
  labelX: number;
  labelY: number;
  kind: 'income' | 'expense' | 'transfer';
}

export interface MoneyFlow {
  nodes: MoneyFlowNode[];
  edges: MoneyFlowEdge[];
  /** Summe aller Einnahmen-Flüsse pro Monat (Cent, für den Einnahmen-Block) */
  incomeTotal: number;
  /** Summe aller Ausgaben-Flüsse pro Monat (Cent, für den Ausgaben-Block) */
  expenseTotal: number;
  /** berechnete Mindesthöhe der Chart-Fläche in px (wächst mit der Kontenzahl) */
  heightPx: number;
  /**
   * Konten ohne jede Kante (weder Einnahme/Ausgabe noch Umbuchung — pausierte
   * Flüsse zählen als Verbindung); die Seite zeigt sie unterhalb der Grafik.
   */
  unconnected: MoneyFlowAccount[];
}

/** Pseudo-Knoten für externe Zu-/Abflüsse */
export const INCOME_NODE = 'income';
export const EXPENSE_NODE = 'expense';

/** Linienstärke-Skala (px): linear auf den größten sichtbaren Fluss */
export const WIDTH_MIN = 2;
export const WIDTH_MAX = 18;

/** X-Positionen der Spalten (Prozent): Einnahmen links, Ausgaben rechts */
export const INCOME_X = 8;
export const EXPENSE_X = 92;
const COLUMN_X: Record<number, number[]> = {
  1: [50],
  2: [36, 64],
  3: [29, 50, 71],
};

/** Vertikaler Rhythmus: Zeilenhöhe pro Konto-Karte und Mindesthöhe (px) */
export const ROW_HEIGHT_PX = 104;
export const MIN_HEIGHT_PX = 280;

/** Betrag einer Dauerbuchung auf Monatsbasis umrechnen (Cent, gerundet) */
export function monthlyAmount(amount: number, interval: MoneyFlowRecurring['interval']): number {
  if (interval === 'weekly') return Math.round((amount * 52) / 12);
  return Math.round(amount / MONTHS_PER_INTERVAL[interval]);
}

/**
 * Kubische S-Kurve (Sankey-Stil): Kontrollpunkte auf halbem Weg, horizontale
 * Tangente an beiden Enden. Kanten innerhalb derselben Spalte weichen als
 * Bogen zur Seite aus (curve = seitlicher Offset). Liefert Pfad plus Punkt-
 * und Tangenten-Funktion für beliebiges t (Label-Position/-Verschiebung).
 * Koordinaten in denselben Einheiten wie die übergebenen Knoten (Prozent).
 */
export function edgeGeometry(
  a: { x: number; y: number },
  b: { x: number; y: number },
  curve: number,
) {
  let c1: { x: number; y: number };
  let c2: { x: number; y: number };
  if (Math.abs(a.x - b.x) < 5) {
    const cx = a.x + curve;
    c1 = { x: cx, y: a.y };
    c2 = { x: cx, y: b.y };
  } else {
    const mx = (a.x + b.x) / 2;
    c1 = { x: mx, y: a.y + curve };
    c2 = { x: mx, y: b.y + curve };
  }
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    /** Punkt auf der kubischen Bezier-Kurve bei Parameter t (0–1) */
    point: (t: number) => {
      const u = 1 - t;
      return {
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      };
    },
    /** Tangenten-Richtung der Kurve bei t (Ableitung, nicht normiert) */
    tangent: (t: number) => {
      const u = 1 - t;
      return {
        x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
        y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y),
      };
    },
  };
}

/** Anzahl der Konto-Spalten: bis 6 Konten eine, ab 7 zwei, ab 15 drei */
export function columnCount(count: number): number {
  if (count <= 6) return 1;
  if (count <= 14) return 2;
  return 3;
}

export interface ColumnLayout {
  /** Knoten der Konten (ohne Pseudo-Knoten), spaltenweise positioniert */
  accountNodes: MoneyFlowNode[];
  /** berechnete Mindesthöhe der Chart-Fläche in px */
  heightPx: number;
}

/**
 * Spalten-Layout: Konten gleichmäßig auf 1–3 Spalten verteilt (spaltenweise
 * gefüllt), Y-Positionen gleichmäßig über die Höhe. Die Höhe wächst mit der
 * Zeilenzahl, die Seite scrollt nativ.
 */
export function layoutColumns(accounts: MoneyFlowAccount[]): ColumnLayout {
  const cols = columnCount(accounts.length);
  const rows = Math.max(1, Math.ceil(accounts.length / cols));
  const xs = COLUMN_X[cols];
  const accountNodes = accounts.map((a, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    return {
      id: `account-${a.id}`,
      kind: 'account' as const,
      accountId: a.id,
      x: xs[col],
      // gleichmäßig: Zeilenmittelpunkte über die volle Höhe
      y: Math.round((((row + 0.5) / rows) * 1000)) / 10,
    };
  });
  return {
    accountNodes,
    heightPx: Math.max(MIN_HEIGHT_PX, rows * ROW_HEIGHT_PX),
  };
}

/**
 * Konten so ordnen, dass Kanten sich möglichst wenig kreuzen (Heuristik):
 * zuerst nach Hauptfluss sortieren (Einnahmen-Empfänger nach oben,
 * Ausgaben-Zahler nach unten), dann ein einzelner Barycenter-Pass, der
 * Transfer-Partner benachbart zieht. Kein kompletter Layering-Algorithmus.
 */
function orderAccounts(
  accounts: MoneyFlowAccount[],
  edges: MoneyFlowEdge[],
): MoneyFlowAccount[] {
  const accId = (nodeId: string) => Number(nodeId.slice(8));
  // Netto-Hauptfluss pro Konto: Einnahmen positiv, Ausgaben negativ
  const net = new Map<number, number>();
  const partners = new Map<number, Set<number>>();
  const addNet = (id: number, v: number) => net.set(id, (net.get(id) ?? 0) + v);
  for (const e of edges) {
    if (e.kind === 'income') addNet(accId(e.to), e.monthlyAmount);
    else if (e.kind === 'expense') addNet(accId(e.from), -e.monthlyAmount);
    else {
      const a = accId(e.from);
      const b = accId(e.to);
      partners.set(a, (partners.get(a) ?? new Set()).add(b));
      partners.set(b, (partners.get(b) ?? new Set()).add(a));
    }
  }
  // Erste Ordnung: hoher Einnahmen-Anteil oben, Ausgaben-lastig unten
  const order = [...accounts].sort(
    (a, b) => (net.get(b.id) ?? 0) - (net.get(a.id) ?? 0) || a.id - b.id,
  );
  // Barycenter-Pass (sequenziell): jedes Konto an die Position des Mittels
  // seiner Transfer-Partner verschieben — so landen Partner benachbart.
  for (const a of [...order]) {
    const ps = partners.get(a.id);
    if (!ps || ps.size === 0) continue;
    const target =
      [...ps].reduce((s, p) => s + order.findIndex((b) => b.id === p), 0) / ps.size;
    order.splice(order.indexOf(a), 1);
    order.splice(Math.max(0, Math.min(order.length, Math.round(target))), 0, a);
  }
  return order;
}

/**
 * Kurven-Offsets vergeben: Kanten innerhalb derselben Spalte biegen seitlich
 * aus (alternierend links/rechts), Mehrfachkanten desselben Knotenpaars
 * werden senkrecht aufgefächert.
 */
function assignCurves(edges: MoneyFlowEdge[], nodeX: Map<string, number>): void {
  const pairs = new Map<string, MoneyFlowEdge[]>();
  for (const e of edges) {
    const key = [e.from, e.to].sort().join('|');
    const list = pairs.get(key) ?? [];
    list.push(e);
    pairs.set(key, list);
  }
  for (const list of pairs.values()) {
    const sameColumn =
      Math.abs((nodeX.get(list[0].from) ?? 0) - (nodeX.get(list[0].to) ?? 0)) < 5;
    list.forEach((e, i) => {
      if (sameColumn) {
        // gleiche Spalte: Bogen zur Seite, Richtung alternierend
        e.curve = (i % 2 === 0 ? 1 : -1) * (10 + 6 * Math.floor(i / 2));
      } else if (list.length === 1) {
        e.curve = 0;
      } else {
        // parallele Kanten: symmetrisch um die S-Kurve fächern
        e.curve = (i - (list.length - 1) / 2) * 5;
      }
    });
  }
}

/**
 * Label-Staffelung für parallele Kanten: Kanten mit gleicher Quelle laufen
 * vom selben Punkt auseinander — ihre Labels wandern Richtung Ziel (t > 0,5,
 * dort liegen sie weiter auseinander); Kanten mit gleichem Ziel laufen zusammen
 * — ihre Labels wandern Richtung Quelle (t < 0,5). Pro Gruppe nach Betrag
 * absteigend vergeben (dicke Kanten bleiben zentraler). Ab 5 parallelen
 * Geschwistern wird das Badge kompakt gerendert (labelCompact).
 */
function assignLabelT(edges: MoneyFlowEdge[]): void {
  /** Anzahl paralleler Geschwister (größere der beiden Gruppen) */
  const peers = new Map<MoneyFlowEdge, number>();
  const count = (keyOf: (e: MoneyFlowEdge) => string) => {
    const groups = new Map<string, MoneyFlowEdge[]>();
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
  const stagger = (groups: Map<string, MoneyFlowEdge[]>, dir: 1 | -1) => {
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => b.monthlyAmount - a.monthlyAmount);
      sorted.forEach((e, i) => {
        // große Beträge zuerst = kleinste Auslenkung (zentralster Platz)
        const t = Math.max(
          0.15,
          Math.min(0.85, 0.5 + dir * ((i + 0.5) / sorted.length) * 0.35),
        );
        if (Math.abs(t - 0.5) > Math.abs(e.labelT - 0.5)) e.labelT = t;
      });
    }
  };
  stagger(bySource, 1);
  stagger(byTarget, -1);
}

/**
 * Kollisionsmodell für die Label-Platzierung: Knoten-Karten und Label-Badges
 * als achsenparallele Rechtecke in geschätzten Pixeln. Die Karten sind w-32
 * (sm:w-40) mit Icon, Name und Saldo-Zeile, Badges eine kurze Textzeile —
 * bewusst etwas großzügig angesetzt, damit kein Label unter eine Karte rutscht.
 */
export const NODE_W_PX = 172;
export const NODE_H_PX = 88;
export const LABEL_W_PX = 80;
export const LABEL_H_PX = 20;
/** Angenommene Container-Breite für das Kollisionsmodell (px) */
const ASSUMED_WIDTH_PX = 1000;

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

/** Knoten-Karte als Rechteck in geschätzten Pixeln (Kollisionsmodell) */
export function nodeRectPx(node: MoneyFlowNode, heightPx: number): RectPx {
  return rectCentered(
    (node.x / 100) * ASSUMED_WIDTH_PX,
    (node.y / 100) * heightPx,
    NODE_W_PX,
    NODE_H_PX,
  );
}

/** Label-Badge als Rechteck in geschätzten Pixeln (Kollisionsmodell) */
export function labelRectPx(edge: MoneyFlowEdge, heightPx: number): RectPx {
  const w = edge.labelCompact ? 64 : LABEL_W_PX;
  const h = edge.labelCompact ? 17 : LABEL_H_PX;
  return rectCentered(
    (edge.labelX / 100) * ASSUMED_WIDTH_PX,
    (edge.labelY / 100) * heightPx,
    w,
    h,
  );
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
 */
function assignLabelPositions(
  nodes: MoneyFlowNode[],
  edges: MoneyFlowEdge[],
  heightPx: number,
): void {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeRects = nodes.map((n) => nodeRectPx(n, heightPx));
  const placed: RectPx[] = [];
  /** Seitlicher Schritt und maximale Auslenkung der Verschiebung (px) */
  const STEP_PX = 14;
  const MAX_STEPS = 8;
  const W = ASSUMED_WIDTH_PX;

  // große Flüsse zuerst platzieren — ihre Badges bekommen die freien Plätze
  const ordered = [...edges].sort(
    (a, b) => b.monthlyAmount - a.monthlyAmount || a.id.localeCompare(b.id),
  );

  for (const e of ordered) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue;
    const g = edgeGeometry(a, b, e.curve);
    const w = e.labelCompact ? 64 : LABEL_W_PX;
    const h = e.labelCompact ? 17 : LABEL_H_PX;
    // Geometrie komponentenweise in Pixel umrechnen, damit die Normale maßstäblich ist
    const toPx = (p: { x: number; y: number }) => ({
      x: (p.x / 100) * W,
      y: (p.y / 100) * heightPx,
    });
    const centerA = toPx(a);
    const centerB = toPx(b);

    const scoreAt = (rect: RectPx) => {
      let s = 0;
      for (const nr of nodeRects) s += 4 * overlapArea(rect, nr);
      for (const pr of placed) s += overlapArea(rect, pr);
      return s;
    };

    const findSpot = (): RectPx => {
      let best: RectPx | null = null;
      let bestScore = Infinity;
      for (const dt of [0, -0.05, 0.05]) {
        const t = Math.max(0.05, Math.min(0.95, e.labelT + dt));
        const base = toPx(g.point(t));
        const tan = toPx(g.tangent(t));
        const len = Math.hypot(tan.x, tan.y) || 1;
        const nx = -tan.y / len;
        const ny = tan.x / len;
        // bevorzugte Seite: weg vom Zentrum des näheren Endknotens
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
            const cx = Math.max(
              w / 2,
              Math.min(W - w / 2, base.x + k * STEP_PX * dx),
            );
            const cy = Math.max(
              h / 2,
              Math.min(heightPx - h / 2, base.y + k * STEP_PX * dy),
            );
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
    placed.push(rect);
    e.labelX = (((rect.x1 + rect.x2) / 2) / W) * 100;
    e.labelY = (((rect.y1 + rect.y2) / 2) / heightPx) * 100;
  }
}

/** Geldfluss-Graph aus Konten und Dauerbuchungen aufbauen */
export function buildMoneyFlow(
  accounts: MoneyFlowAccount[],
  recurring: MoneyFlowRecurring[],
): MoneyFlow {
  const accountIds = new Set(accounts.map((a) => a.id));
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
      width: WIDTH_MIN,
      curve: 0,
      labelT: 0.5,
      labelCompact: false,
      labelX: 0,
      labelY: 0,
      kind: r.type,
    });
  }

  // Konten ohne jede Kante fliegen aus dem Diagramm in ein eigenes Areal —
  // pausierte Dauerbuchungen erzeugen Kanten und zählen als Verbindung.
  const connectedIds = new Set<number>();
  for (const e of edges) {
    if (e.from.startsWith('account-')) connectedIds.add(Number(e.from.slice(8)));
    if (e.to.startsWith('account-')) connectedIds.add(Number(e.to.slice(8)));
  }
  const connected = accounts.filter((a) => connectedIds.has(a.id));
  const unconnected = accounts.filter((a) => !connectedIds.has(a.id));

  const ordered = orderAccounts(connected, edges);
  const { accountNodes, heightPx } = layoutColumns(ordered);

  const nodes: MoneyFlowNode[] = [
    { id: INCOME_NODE, kind: 'income', accountId: null, x: INCOME_X, y: 50 },
    { id: EXPENSE_NODE, kind: 'expense', accountId: null, x: EXPENSE_X, y: 50 },
    ...accountNodes,
  ];

  // Linienstärke kontinuierlich, linear auf den größten Monatsbetrag skaliert
  const max = Math.max(0, ...edges.map((e) => e.monthlyAmount));
  for (const e of edges) {
    e.width =
      max <= 0
        ? WIDTH_MIN
        : Math.round((WIDTH_MIN + ((WIDTH_MAX - WIDTH_MIN) * e.monthlyAmount) / max) * 10) / 10;
  }

  const nodeX = new Map(nodes.map((n) => [n.id, n.x]));
  assignCurves(edges, nodeX);
  assignLabelT(edges);
  assignLabelPositions(nodes, edges, heightPx);

  const incomeTotal = edges
    .filter((e) => e.kind === 'income')
    .reduce((s, e) => s + e.monthlyAmount, 0);
  const expenseTotal = edges
    .filter((e) => e.kind === 'expense')
    .reduce((s, e) => s + e.monthlyAmount, 0);

  return { nodes, edges, incomeTotal, expenseTotal, heightPx, unconnected };
}
