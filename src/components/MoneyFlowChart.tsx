import { useMemo, useState } from 'react';
import { Banknote, CreditCard, PiggyBank, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { buildMoneyFlow, type MoneyFlowNode } from '@/lib/moneyflow';
import { useFinanceData } from '@/lib/data';
import { formatCents } from '@/lib/finance';
import { cn } from '@/lib/utils';

/** Icons für die Builtin-Typen; eigene Typen bekommen das Fallback-Icon */
const typeIcons: Record<string, typeof CreditCard> = {
  checking: CreditCard,
  cash: Banknote,
  savings: PiggyBank,
};

/** Farben der Kanten nach Art (Tailwind-Palette, hell- und dunkeltauglich) */
const EDGE_COLORS = {
  income: '#059669', // emerald-600
  expense: '#f43f5e', // rose-500
  transfer: '#0284c7', // sky-600
} as const;

/**
 * Kubische S-Kurve (Sankey-Stil): Kontrollpunkte auf halbem Weg, horizontale
 * Tangente an beiden Enden. Kanten innerhalb derselben Spalte weichen als
 * Bogen zur Seite aus (curve = seitlicher Offset). Liefert Pfad plus eine
 * Punkt-Funktion für beliebiges t (Label-Position, siehe labelT).
 */
function edgeGeometry(a: MoneyFlowNode, b: MoneyFlowNode, curve: number) {
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
  };
}

/**
 * Geldfluss-Chart: SVG-Bezier-Kurven im Hintergrund, darüber absolut
 * positionierte HTML-Karten (Positionen in Prozent, siehe buildMoneyFlow).
 * Die Höhe der Fläche kommt aus dem Spalten-Layout (flow.heightPx).
 */
export default function MoneyFlowChart() {
  const { accounts, accountTypes, banks, recurring } = useFinanceData();
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const flow = useMemo(() => buildMoneyFlow(accounts, recurring), [accounts, recurring]);
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));

  const edgeVisible = (from: string, to: string) =>
    hoverNode === null || from === hoverNode || to === hoverNode;

  return (
    <div className="relative w-full select-none" style={{ height: `${flow.heightPx}px` }}>
      {/* Kanten-Layer */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([kind, color]) => (
            <marker
              key={kind}
              id={`mf-arrow-${kind}`}
              viewBox="0 0 10 10"
              refX="7.5"
              refY="5"
              markerWidth="2.6"
              markerHeight="2.6"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill={color} />
            </marker>
          ))}
        </defs>
        {flow.edges.map((e) => {
          const a = nodeById.get(e.from);
          const b = nodeById.get(e.to);
          if (!a || !b) return null;
          const g = edgeGeometry(a, b, e.curve);
          return (
            <path
              key={e.id}
              d={g.d}
              fill="none"
              stroke={EDGE_COLORS[e.kind]}
              strokeWidth={e.width}
              strokeDasharray={e.paused ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
              markerEnd={`url(#mf-arrow-${e.kind})`}
              className="transition-opacity"
              opacity={edgeVisible(e.from, e.to) ? (e.paused ? 0.4 : 0.7) : 0.08}
            />
          );
        })}
      </svg>

      {/* Kanten-Labels (Betrag pro Monat, entlang der Kurve gestaffelt) */}
      {flow.edges.map((e) => {
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) return null;
        const p = edgeGeometry(a, b, e.curve).point(e.labelT);
        return (
          <div
            key={`label-${e.id}`}
            className={cn(
              'absolute -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-opacity',
              e.labelCompact && 'px-1 py-px text-[9px]',
              e.paused && 'text-muted-foreground',
            )}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              opacity: edgeVisible(e.from, e.to) ? 1 : 0.1,
            }}
          >
            {formatCents(e.monthlyAmount)}/Monat
          </div>
        );
      })}

      {/* Knoten-Layer */}
      {flow.nodes.map((n) => {
        if (n.kind !== 'account') {
          // Pseudo-Knoten als Block im Konto-Karten-Format (Quelle/Senke)
          const income = n.kind === 'income';
          const Icon = income ? TrendingUp : TrendingDown;
          return (
            <div
              key={n.id}
              className={cn(
                'absolute w-32 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-2.5 shadow-sm transition-all sm:w-40',
                hoverNode === n.id && 'ring-2 ring-emerald-600/50',
                hoverNode !== null && hoverNode !== n.id && 'opacity-40',
              )}
              style={{ left: `${n.x}%`, top: `${n.y}%` }}
              onMouseEnter={() => setHoverNode(n.id)}
              onMouseLeave={() => setHoverNode(null)}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                    income
                      ? 'bg-emerald-600/10 text-emerald-600'
                      : 'bg-rose-500/10 text-rose-500',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">
                    {income ? 'Einnahmen' : 'Ausgaben'}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {income ? 'Zuflüsse' : 'Abflüsse'} pro Monat
                  </div>
                </div>
              </div>
              <div className="mt-1.5 text-sm font-bold tabular-nums">
                {formatCents(income ? flow.incomeTotal : flow.expenseTotal)}
              </div>
            </div>
          );
        }
        const account = accounts.find((a) => a.id === n.accountId);
        if (!account) return null;
        const Icon = typeIcons[account.type] ?? Wallet;
        const bank = account.bankId !== null ? bankName.get(account.bankId) : undefined;
        return (
          <div
            key={n.id}
            className={cn(
              'absolute w-32 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-2.5 shadow-sm transition-all sm:w-40',
              hoverNode === n.id && 'ring-2 ring-emerald-600/50',
              hoverNode !== null && hoverNode !== n.id && 'opacity-40',
            )}
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
            onMouseEnter={() => setHoverNode(n.id)}
            onMouseLeave={() => setHoverNode(null)}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-600">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">{account.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {typeName.get(account.type) ?? account.type}
                  {bank ? ` · ${bank}` : ''}
                </div>
              </div>
            </div>
            <div className={cn('mt-1.5 text-sm font-bold tabular-nums', account.balance < 0 && 'text-destructive')}>
              {formatCents(account.balance)}
            </div>
          </div>
        );
      })}

    </div>
  );
}
