import { useState } from 'react';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFinanceData } from '@/lib/data';
import { formatCents, formatDate, getUserLocale } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(getUserLocale(), { weekday: 'short' });

/**
 * Fälligkeitskalender: welche Dauerbuchungen in den nächsten 30 Tagen
 * anstehen, mit Tagessummen — und eine Warnung, falls ein Konto dabei ins
 * Minus rutschen würde.
 */
export default function UpcomingCard() {
  const { accounts } = useFinanceData();
  const [days, setDays] = useState(30);
  const [showAll, setShowAll] = useState(false);
  const query = trpc.analysis.upcoming.useQuery({ days });
  const data = query.data;
  const name = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? '?';

  const byDay: { date: string; items: NonNullable<typeof data>['occurrences'] }[] = [];
  for (const o of data?.occurrences ?? []) {
    const last = byDay[byDay.length - 1];
    if (last && last.date === o.date) last.items.push(o);
    else byDay.push({ date: o.date, items: [o] });
  }
  const LIMIT = 8;
  const visible = showAll ? byDay : byDay.slice(0, LIMIT);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-muted-foreground" /> Nächste {days} Tage
            </CardTitle>
            <CardDescription>
              {data
                ? `${data.occurrences.length} ${data.occurrences.length === 1 ? 'Termin' : 'Termine'} · −${formatCents(data.expense)} Ausgaben · +${formatCents(data.income)} Einnahmen`
                : 'Was demnächst abgebucht wird'}
            </CardDescription>
          </div>
          <div className="flex rounded-lg border bg-muted/40 p-1 text-xs">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn('rounded-md px-2 py-1 text-muted-foreground hover:text-foreground', days === d && 'bg-background text-foreground shadow-sm')}
              >
                {d} Tage
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {(data?.warnings ?? []).map((w) => (
          <div key={w.accountId} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              „{w.accountName}“ fällt am {formatDate(w.date)} auf {formatCents(w.lowest)} — vorher Geld umbuchen oder eine Dauerbuchung verschieben.
            </span>
          </div>
        ))}
        {byDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">{query.isLoading ? 'Lade…' : 'Keine Fälligkeiten in diesem Zeitraum.'}</p>
        ) : (
          <ul className="divide-y">
            {visible.map((day) => {
              const net = day.items.reduce((s, o) => s + (o.type === 'income' ? o.amount : o.type === 'expense' ? -o.amount : 0), 0);
              return (
                <li key={day.date} className="py-2">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium">{weekday(day.date)}, {formatDate(day.date)}</span>
                    {/* Tagessumme nur bei mehreren Terminen — sonst steht der Betrag doppelt */}
                    {day.items.length > 1 && net !== 0 && (
                      <span className={cn('font-mono tabular-nums', net < 0 ? 'text-negative' : 'text-positive')}>
                        {net > 0 ? '+' : ''}{formatCents(net)}
                      </span>
                    )}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {day.items.map((o) => (
                      <li key={`${o.recurringId}-${o.date}`} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          {o.note || (o.type === 'transfer' ? 'Umbuchung' : 'Dauerbuchung')}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {o.type === 'transfer' ? `${name(o.accountId)} → ${name(o.toAccountId)}` : name(o.accountId)}
                          </span>
                        </span>
                        <span className={cn(
                          'shrink-0 font-mono text-sm tabular-nums',
                          o.type === 'income' ? 'text-positive' : o.type === 'expense' ? 'text-negative' : 'text-muted-foreground',
                        )}>
                          {o.type === 'income' ? '+' : o.type === 'expense' ? '−' : ''}{formatCents(o.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
        {byDay.length > LIMIT && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Weniger anzeigen' : `Alle ${byDay.length} Tage anzeigen`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
