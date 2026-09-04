import { ArrowDownLeft, ArrowUpRight, ChevronDown, X } from 'lucide-react';
import {
  accountIdOf,
  EXPENSE_NODE,
  INCOME_NODE,
  nodeFlows,
  type MoneyFlow,
  type MoneyFlowEdge,
} from '@/lib/moneyflow';
import {
  ACCOUNT_TYPE_FALLBACK_ICON,
  ACCOUNT_TYPE_ICONS,
  EDGE_COLORS,
  EDGE_LABELS,
} from '@/lib/moneyflowStyle';
import { useFinanceData } from '@/lib/data';
import { formatCents } from '@/lib/finance';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Anzeigename eines Knotens (Konto, Einnahmen- oder Ausgaben-Block) */
function useNodeName() {
  const { accounts } = useFinanceData();
  const byId = new Map(accounts.map((a) => [a.id, a.name]));
  return (nodeId: string): string => {
    if (nodeId === INCOME_NODE) return 'Einnahmen';
    if (nodeId === EXPENSE_NODE) return 'Ausgaben';
    return byId.get(accountIdOf(nodeId) ?? -1) ?? 'Unbekanntes Konto';
  };
}

/** Eine Zeile pro Strom: Art-Punkt, Partner, Betrag pro Monat */
function FlowLine({ edge, partner }: { edge: MoneyFlowEdge; partner: string }) {
  return (
    <li className="flex items-center gap-2 py-1 text-xs">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: EDGE_COLORS[edge.kind] }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        {partner}
        <span className="text-muted-foreground"> · {EDGE_LABELS[edge.kind]}</span>
        {edge.paused && <span className="text-muted-foreground"> · pausiert</span>}
      </span>
      <span
        className={cn('shrink-0 tabular-nums', edge.paused && 'text-muted-foreground line-through')}
      >
        {formatCents(edge.monthlyAmount)}
      </span>
    </li>
  );
}

/** Gruppe „Zuflüsse" bzw. „Abflüsse" eines Knotens mit Monatssumme */
function FlowGroup({
  title,
  icon: Icon,
  edges,
  total,
  partnerOf,
  tone,
}: {
  title: string;
  icon: typeof ArrowDownLeft;
  edges: MoneyFlowEdge[];
  total: number;
  partnerOf: (e: MoneyFlowEdge) => string;
  tone: 'in' | 'out';
}) {
  const nodeName = useNodeName();
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Icon className={cn('h-3.5 w-3.5', tone === 'in' ? 'text-emerald-600' : 'text-rose-500')} />
        {title}
        <span className="ml-auto tabular-nums">{formatCents(total)}/Monat</span>
      </div>
      {edges.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">Keine</p>
      ) : (
        <ul className="divide-y">
          {edges.map((e) => (
            <FlowLine key={e.id} edge={e} partner={nodeName(partnerOf(e))} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Zu- und Abflüsse eines Knotens nebeneinander (Detail unter dem Chart, Listenzeile) */
export function MoneyFlowNodeFlows({ flow, nodeId }: { flow: MoneyFlow; nodeId: string }) {
  const flows = nodeFlows(flow, nodeId);
  return (
    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <FlowGroup
        title="Zuflüsse"
        icon={ArrowDownLeft}
        edges={flows.inflow}
        total={flows.inTotal}
        partnerOf={(e) => e.from}
        tone="in"
      />
      <FlowGroup
        title="Abflüsse"
        icon={ArrowUpRight}
        edges={flows.outflow}
        total={flows.outTotal}
        partnerOf={(e) => e.to}
        tone="out"
      />
    </div>
  );
}

/**
 * Detail-Panel zum fixierten Knoten unter dem Chart: listet seine Ströme,
 * damit die Beträge auch dann lesbar sind, wenn das Diagramm dicht ist oder
 * auf dem Handy scrollt.
 */
export function MoneyFlowNodeDetails({
  flow,
  nodeId,
  onClose,
}: {
  flow: MoneyFlow;
  nodeId: string;
  onClose: () => void;
}) {
  const nodeName = useNodeName();
  return (
    <div className="mt-4 rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">
          Ströme von {nodeName(nodeId)}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          title="Auswahl aufheben"
          aria-label="Auswahl aufheben"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <MoneyFlowNodeFlows flow={flow} nodeId={nodeId} />
    </div>
  );
}

/**
 * Listenansicht des Geldflusses: ein Eintrag pro verbundenem Konto
 * (alphabetisch) mit den Monatssummen der Zu- und Abflüsse; Antippen klappt
 * die einzelnen Ströme auf. Der aufgeklappte Eintrag ist derselbe Zustand
 * wie der Fokus im Diagramm (focusNode) — ein Wechsel der Ansicht behält ihn.
 */
export function MoneyFlowList({
  flow,
  focusNode,
  onFocusNodeChange,
}: {
  flow: MoneyFlow;
  focusNode: string | null;
  onFocusNodeChange: (nodeId: string | null) => void;
}) {
  const { accountTypes, banks } = useFinanceData();
  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  const sorted = [...flow.accounts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          Einnahmen{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {formatCents(flow.incomeTotal)}/Monat
          </span>
        </span>
        <span>
          Ausgaben{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {formatCents(flow.expenseTotal)}/Monat
          </span>
        </span>
      </div>
      <ul className="divide-y rounded-lg border">
        {sorted.map((a) => {
          const nodeId = `account-${a.id}`;
          const open = focusNode === nodeId;
          const flows = nodeFlows(flow, nodeId);
          const Icon = ACCOUNT_TYPE_ICONS[a.type] ?? ACCOUNT_TYPE_FALLBACK_ICON;
          const bank = a.bankId !== null ? bankName.get(a.bankId) : undefined;
          return (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                aria-expanded={open}
                onClick={() => onFocusNodeChange(open ? null : nodeId)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-600">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {typeName.get(a.type) ?? a.type}
                    {bank ? ` · ${bank}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums">
                  <div
                    className={cn(flows.inTotal > 0 ? 'text-emerald-600' : 'text-muted-foreground')}
                  >
                    +{formatCents(flows.inTotal)}
                  </div>
                  <div
                    className={cn(flows.outTotal > 0 ? 'text-rose-500' : 'text-muted-foreground')}
                  >
                    −{formatCents(flows.outTotal)}
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-180'
                  )}
                />
              </button>
              {open && (
                <div className="border-t bg-muted/30 px-3 py-3">
                  <MoneyFlowNodeFlows flow={flow} nodeId={nodeId} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
