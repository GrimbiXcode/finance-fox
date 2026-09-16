import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  edgeGeometry,
  layoutMoneyFlow,
  NODE_H_PX,
  NODE_W_COMPACT_PX,
  NODE_W_PX,
  type MoneyFlow,
  type MoneyFlowAccount,
  type MoneyFlowLaidEdge,
} from '@/lib/moneyflow';
import { ACCOUNT_TYPE_FALLBACK_ICON, ACCOUNT_TYPE_ICONS, EDGE_COLORS } from '@/lib/moneyflowStyle';
import { useFinanceData } from '@/lib/data';
import { formatCents } from '@/lib/finance';
import { cn } from '@/lib/utils';

/** Tastatur-Bedienung wie ein Button: Enter/Leertaste lösen onClick aus */
function activateOnKey(onClick?: () => void) {
  return (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onClick();
    }
  };
}

/**
 * Konto-Karte im Geldfluss-Design — im Diagramm absolut positioniert
 * (className/style von außen, interaktiv: Hover hebt hervor, Tipp/Klick
 * fixiert die Hervorhebung), im Areal „Ohne Geldflüsse" statisch in Reihe.
 */
export function MoneyFlowAccountCard({
  account,
  typeLabel,
  bankLabel,
  className,
  style,
  active = false,
  dimmed = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  account: MoneyFlowAccount;
  typeLabel: string;
  bankLabel?: string;
  className?: string;
  style?: CSSProperties;
  /** hervorgehoben (Hover oder fixierter Fokus) */
  active?: boolean;
  /** abgeblendet, weil ein anderer Knoten hervorgehoben ist */
  dimmed?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** macht die Karte zum Button (Tipp/Klick/Enter fixiert die Hervorhebung) */
  onClick?: () => void;
}) {
  const Icon = ACCOUNT_TYPE_ICONS[account.type] ?? ACCOUNT_TYPE_FALLBACK_ICON;
  return (
    <div
      className={cn(
        'w-32 rounded-lg border bg-card p-2.5 shadow-sm transition-[opacity,box-shadow] sm:w-40',
        onClick && 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'ring-2 ring-stamp/50',
        dimmed && 'opacity-40',
        className
      )}
      style={style}
      title={account.name}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? active : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-positive/10 text-positive">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="line-clamp-2 hyphens-auto break-words text-xs font-semibold leading-tight">
            {account.name}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {typeLabel}
            {bankLabel ? ` · ${bankLabel}` : ''}
          </div>
        </div>
      </div>
      <div
        className={cn(
          'mt-1.5 text-sm font-bold tabular-nums',
          account.balance < 0 && 'text-destructive'
        )}
      >
        {formatCents(account.balance)}
      </div>
    </div>
  );
}

/** Erste Breitenschätzung vor der Messung (Seite minus Ränder, max. 1000 px) */
function initialWidth(): number {
  if (typeof window === 'undefined') return 1000;
  return Math.max(240, Math.min(1000, window.innerWidth - 96));
}

/**
 * Geldfluss-Chart: SVG-Bezier-Kurven im Hintergrund, darüber absolut
 * positionierte HTML-Karten (Pixel-Positionen aus layoutMoneyFlow).
 *
 * Das Layout richtet sich nach der gemessenen Container-Breite
 * (ResizeObserver): so viele Konto-Spalten, wie hineinpassen; passt nicht
 * einmal eine, wird die Fläche breiter als der Container und scrollt
 * horizontal (mobil). Hover hebt die Ströme eines Knotens hervor, ein
 * Tipp/Klick fixiert das (Fokus — Touch kennt kein Hover); Klick auf die
 * freie Fläche oder Escape hebt den Fokus auf. Bei dichten Graphen
 * (flow.dense) erscheinen die Betrags-Badges nur für den hervorgehobenen
 * Knoten, sofern showAllLabels nicht gesetzt ist.
 */
export default function MoneyFlowChart({
  flow,
  focusNode,
  onFocusNodeChange,
  showAllLabels = false,
}: {
  flow: MoneyFlow;
  /** per Tipp/Klick fixierter Knoten (null = keiner) */
  focusNode: string | null;
  onFocusNodeChange: (nodeId: string | null) => void;
  /** Beträge auch im dichten Modus für alle Kanten anzeigen */
  showAllLabels?: boolean;
}) {
  const { accounts, accountTypes, banks } = useFinanceData();
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number>(initialWidth);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setAvailableWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // schmale Container (Handy) bekommen die kompakten Karten
  const nodeW = availableWidth < 560 ? NODE_W_COMPACT_PX : NODE_W_PX;
  const layout = useMemo(
    () => layoutMoneyFlow(flow, { widthPx: availableWidth, nodeWidthPx: nodeW }),
    [flow, availableWidth, nodeW]
  );

  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));

  const active = focusNode ?? hoverNode;
  const touches = (e: MoneyFlowLaidEdge) => e.from === active || e.to === active;
  const edgeVisible = (e: MoneyFlowLaidEdge) => active === null || touches(e);
  const labelsAlways = showAllLabels || !flow.dense;
  const labelShown = (e: MoneyFlowLaidEdge) =>
    labelsAlways ? edgeVisible(e) : active !== null && touches(e);

  const toggleFocus = (id: string) => {
    setHoverNode(null);
    onFocusNodeChange(focusNode === id ? null : id);
  };
  const clearOnBackground = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.target === ev.currentTarget) onFocusNodeChange(null);
  };
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === 'Escape') onFocusNodeChange(null);
  };

  return (
    <div>
      {layout.slimBars && (
        // schlanke Balken tragen keine Summen — die stehen hier
        <div className="mb-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <TrendingUp className="h-3.5 w-3.5 text-positive" />
            Einnahmen
            <span className="font-semibold tabular-nums text-foreground">
              {formatCents(flow.incomeTotal)}/Monat
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <TrendingDown className="h-3.5 w-3.5 text-negative" />
            Ausgaben
            <span className="font-semibold tabular-nums text-foreground">
              {formatCents(flow.expenseTotal)}/Monat
            </span>
          </span>
        </div>
      )}
      {/* auf kleinen Bildschirmen etwas in den Kartenrand hinein, damit die
          Fläche ohne horizontales Scrollen in die Handybreite passt */}
      <div ref={scrollRef} className="-mx-4 overflow-x-auto sm:mx-0">
        <div
          className="relative mx-auto select-none"
          style={{ width: layout.widthPx, height: layout.heightPx }}
          onClick={clearOnBackground}
          onKeyDown={onKeyDown}
        >
          {/* Kanten-Layer */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout.widthPx}
            height={layout.heightPx}
            viewBox={`0 0 ${layout.widthPx} ${layout.heightPx}`}
            aria-hidden
          >
            <defs>
              {Object.entries(EDGE_COLORS).map(([kind, color]) => (
                <marker
                  key={kind}
                  id={`mf-arrow-${kind}`}
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="12"
                  markerHeight="12"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill={color} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((e) => (
              <path
                key={e.id}
                d={edgeGeometry(e.start, e.end, e.curve, e.via).d}
                fill="none"
                stroke={EDGE_COLORS[e.kind]}
                strokeWidth={e.width}
                strokeDasharray={e.paused ? `${4 + e.width} ${3 + e.width / 2}` : undefined}
                markerEnd={`url(#mf-arrow-${e.kind})`}
                className="transition-opacity"
                opacity={edgeVisible(e) ? (e.paused ? 0.4 : 0.7) : 0.08}
              />
            ))}
          </svg>

          {/* Kanten-Labels (Betrag pro Monat, kollisionsfrei neben der Kurve) */}
          {layout.edges.filter(labelShown).map((e) => (
            <div
              key={`label-${e.id}`}
              className={cn(
                'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                e.labelCompact && 'px-1 py-px text-[9px]',
                e.paused && 'text-muted-foreground'
              )}
              style={{ left: e.labelX, top: e.labelY }}
            >
              {formatCents(e.monthlyAmount)}/Monat
            </div>
          ))}

          {/* Knoten-Layer */}
          {layout.nodes.map((n) => {
            const isActive = active === n.id;
            const dimmed = active !== null && !isActive;
            if (n.kind !== 'account') {
              // Pseudo-Knoten: Karte im Konto-Format, die über die Höhe ihrer
              // Partner-Konten zum Balken wächst (Quelle/Senke im Sankey-Stil)
              const income = n.kind === 'income';
              const Icon = income ? TrendingUp : TrendingDown;
              const label = income ? 'Einnahmen' : 'Ausgaben';
              if (layout.slimBars) {
                // schlanker Balken: nur Icon oben und Fluss-Streifen darunter
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={focusNode === n.id}
                    aria-label={label}
                    title={`${label}: ${formatCents(income ? flow.incomeTotal : flow.expenseTotal)}/Monat`}
                    className={cn(
                      'absolute flex cursor-pointer flex-col items-center rounded-lg border bg-card p-1.5 shadow-sm outline-none transition-[opacity,box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
                      isActive && 'ring-2 ring-stamp/50',
                      dimmed && 'opacity-40'
                    )}
                    style={{
                      left: n.x - n.w / 2,
                      top: n.y - n.h / 2,
                      width: n.w,
                      height: n.h,
                    }}
                    onMouseEnter={() => setHoverNode(n.id)}
                    onMouseLeave={() => setHoverNode(null)}
                    onClick={() => toggleFocus(n.id)}
                    onKeyDown={activateOnKey(() => toggleFocus(n.id))}
                  >
                    <div
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                        income
                          ? 'bg-positive/10 text-positive'
                          : 'bg-negative/10 text-negative'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div
                      className={cn(
                        'mt-1.5 w-1 flex-1 rounded-full',
                        income ? 'bg-positive/30' : 'bg-negative/30'
                      )}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={focusNode === n.id}
                  className={cn(
                    'absolute cursor-pointer rounded-lg border bg-card shadow-sm outline-none transition-[opacity,box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
                    isActive && 'ring-2 ring-stamp/50',
                    dimmed && 'opacity-40'
                  )}
                  style={{
                    left: n.x - n.w / 2,
                    top: n.y - n.h / 2,
                    width: n.w,
                    height: n.h,
                  }}
                  onMouseEnter={() => setHoverNode(n.id)}
                  onMouseLeave={() => setHoverNode(null)}
                  onClick={() => toggleFocus(n.id)}
                  onKeyDown={activateOnKey(() => toggleFocus(n.id))}
                >
                  <div className="p-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          income
                            ? 'bg-positive/10 text-positive'
                            : 'bg-negative/10 text-negative'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="line-clamp-2 hyphens-auto text-xs font-semibold leading-tight">
                          {label}
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
                  {/* Fluss-Streifen entlang der Andockseite, sobald die Karte zum Balken wird */}
                  {n.h > NODE_H_PX && (
                    <div
                      className={cn(
                        'absolute bottom-3 w-1 rounded-full',
                        income ? 'right-1 bg-positive/30' : 'left-1 bg-negative/30'
                      )}
                      style={{ top: NODE_H_PX - 8 }}
                    />
                  )}
                </div>
              );
            }
            const account = accounts.find((a) => a.id === n.accountId);
            if (!account) return null;
            const bank = account.bankId !== null ? bankName.get(account.bankId) : undefined;
            return (
              <MoneyFlowAccountCard
                key={n.id}
                account={account}
                typeLabel={typeName.get(account.type) ?? account.type}
                bankLabel={bank}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: n.x, top: n.y, width: n.w }}
                active={isActive}
                dimmed={dimmed}
                onMouseEnter={() => setHoverNode(n.id)}
                onMouseLeave={() => setHoverNode(null)}
                onClick={() => toggleFocus(n.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
