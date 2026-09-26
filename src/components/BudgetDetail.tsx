import { Link } from 'react-router';
import { formatCents, formatMonthShort } from '@/lib/finance';
import { pencil } from '@/lib/pencil';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';

/**
 * Aufgeklappter Teil einer Budget-Karte: Verlauf der letzten Perioden
 * (eingehalten?), Durchschnitt, Aufschlüsselung der laufenden Periode auf
 * Unterkategorien und der Weg zu den Buchungen dahinter.
 */
export default function BudgetDetail({ budgetId, categoryId }: { budgetId: number; categoryId: number }) {
  const query = trpc.analysis.budgetDetail.useQuery({ budgetId, periods: 6 });
  const d = query.data;
  if (!d) {
    return <p className="text-xs text-muted-foreground">{query.isLoading ? 'Lade Verlauf…' : 'Kein Verlauf.'}</p>;
  }
  const max = Math.max(...d.history.map((h) => Math.max(h.spent, h.limit)), 1);
  const yearly = d.budget.period === 'yearly';
  const linkFor = (h: (typeof d.history)[number]) =>
    `/transaktionen?${new URLSearchParams({
      ...(yearly ? { jahr: h.key } : { monat: h.key }),
      typ: 'expense',
      kategorie: String(categoryId),
    })}`;
  const breakdownTotal = d.breakdown.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="space-y-3 border-t pt-3">
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">Verlauf</span>
          <span className="text-muted-foreground">
            {d.closedCount > 0
              ? `${d.keptCount} von ${d.closedCount} ${yearly ? 'Jahren' : 'Monaten'} eingehalten · Ø ${formatCents(d.average ?? 0)}`
              : 'Noch keine abgeschlossene Periode'}
          </span>
        </div>
        {/* Mini-Balken je Periode; der Strich markiert das Limit */}
        <div className="flex h-20 items-end gap-1.5">
          {d.history.map((h) => {
            const over = h.spent > h.limit;
            return (
              <Link
                key={h.key}
                to={linkFor(h)}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${yearly ? h.key : formatMonthShort(h.key)}: ${formatCents(h.spent)} von ${formatCents(h.limit)}`}
              >
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 border-t border-dashed border-foreground/70"
                  style={{ bottom: `${(h.limit / max) * 100}%` }}
                />
                <div
                  className={cn(
                    'rounded-t-[3px] transition-opacity group-hover:opacity-80',
                    over ? 'bg-destructive' : 'bg-foreground/70',
                    h.current && 'opacity-60',
                  )}
                  style={{ height: `${Math.max(2, (h.spent / max) * 100)}%` }}
                />
              </Link>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1.5 text-center text-[10px] text-muted-foreground">
          {d.history.map((h) => (
            <span key={h.key} className="flex-1 truncate">{yearly ? h.key : formatMonthShort(h.key)}</span>
          ))}
        </div>
      </div>

      {d.breakdown.length > 1 && (
        <div>
          <div className="mb-1 text-xs font-medium">Diese Periode nach Kategorie</div>
          <ul className="space-y-1 text-xs">
            {d.breakdown.map((b) => (
              <li key={b.categoryId} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(b.color) }} />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span className="font-mono tabular-nums">{formatCents(b.amount)}</span>
                <span className="w-9 text-right font-mono tabular-nums text-muted-foreground">
                  {breakdownTotal > 0 ? Math.round((b.amount / breakdownTotal) * 100) : 0} %
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link to={linkFor(d.history[d.history.length - 1])} className="inline-block text-xs text-stamp hover:underline">
        Buchungen dieser Periode anzeigen
      </Link>
    </div>
  );
}
