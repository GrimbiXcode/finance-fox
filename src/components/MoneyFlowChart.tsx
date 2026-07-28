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

const STROKE_WIDTH: Record<1 | 2 | 3, number> = { 1: 1.5, 2: 2.5, 3: 4 };

/** Kontrollpunkt der quadratischen Bezier-Kurve (senkrecht versetzter Mittelpunkt) */
function controlPoint(a: MoneyFlowNode, b: MoneyFlowNode, curve: number) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mx - (dy / len) * curve, y: my + (dx / len) * curve };
}

/** Punkt auf der Kurve bei t = 0,5 (für das Label) */
function labelPoint(a: MoneyFlowNode, b: MoneyFlowNode, curve: number) {
  const c = controlPoint(a, b, curve);
  return {
    x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x,
    y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y,
  };
}

/**
 * Geldfluss-Chart: SVG-Bezier-Kurven im Hintergrund, darüber absolut
 * positionierte HTML-Karten (Positionen in Prozent, siehe buildMoneyFlow).
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
    <div className="relative aspect-[4/5] w-full select-none sm:aspect-[4/3] lg:aspect-[16/9]">
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
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
            </marker>
          ))}
        </defs>
        {flow.edges.map((e) => {
          const a = nodeById.get(e.from);
          const b = nodeById.get(e.to);
          if (!a || !b) return null;
          const c = controlPoint(a, b, e.curve);
          return (
            <path
              key={e.id}
              d={`M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`}
              fill="none"
              stroke={EDGE_COLORS[e.kind]}
              strokeWidth={STROKE_WIDTH[e.strength]}
              strokeDasharray={e.paused ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
              markerEnd={`url(#mf-arrow-${e.kind})`}
              className="transition-opacity"
              opacity={edgeVisible(e.from, e.to) ? (e.paused ? 0.45 : 0.8) : 0.08}
            />
          );
        })}
      </svg>

      {/* Kanten-Labels (Betrag pro Monat, mittig auf der Kurve) */}
      {flow.edges.map((e) => {
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) return null;
        const p = labelPoint(a, b, e.curve);
        return (
          <div
            key={`label-${e.id}`}
            className={cn(
              'absolute -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-opacity',
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
          const income = n.kind === 'income';
          const Icon = income ? TrendingUp : TrendingDown;
          return (
            <div
              key={n.id}
              className={cn(
                'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm transition-opacity',
                income
                  ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                hoverNode !== null && hoverNode !== n.id && 'opacity-40',
              )}
              style={{ left: `${n.x}%`, top: `${n.y}%` }}
              onMouseEnter={() => setHoverNode(n.id)}
              onMouseLeave={() => setHoverNode(null)}
            >
              <Icon className="h-3.5 w-3.5" />
              {income ? 'Einnahmen' : 'Ausgaben'}
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
