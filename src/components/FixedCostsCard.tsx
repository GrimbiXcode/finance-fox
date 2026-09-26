import { Link } from 'react-router';
import InfoTip from '@/components/InfoTip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFinanceData } from '@/lib/data';
import { formatCents, formatMonth } from '@/lib/finance';
import { pencil } from '@/lib/pencil';
import { trpc } from '@/providers/trpc';

/**
 * Fixkosten-Quote (F4): Wie viel der Ausgaben ist durch Dauerbuchungen
 * gebunden — und wo schwankt der Rest? Sparen wirkt nur beim variablen
 * Teil oder durch Kündigen eines Fixpostens.
 */
export default function FixedCostsCard() {
  const { categories } = useFinanceData();
  const d = trpc.analysis.fixedCosts.useQuery().data;
  if (!d || (d.fixedExpense === 0 && d.averageExpense === 0)) return null;
  const variable = Math.max(0, d.averageExpense - d.fixedExpense);
  const fixedShare = d.averageExpense > 0 ? Math.min(100, (d.fixedExpense / d.averageExpense) * 100) : 0;
  const maxTop = Math.max(1, ...d.top.map((t) => t.monthly));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fixkosten und variable Ausgaben</CardTitle>
        <CardDescription>
          Dauerbuchungen auf den Monat umgerechnet, verglichen mit dem Durchschnitt {formatMonth(d.from)} – {formatMonth(d.to)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Fixkosten pro Monat <InfoTip term="fixkosten" />
              </div>
              <div className="font-serif text-xl font-semibold tabular-nums">{formatCents(d.fixedExpense)}</div>
              <div className="text-xs text-muted-foreground">
                {d.shareOfIncome !== null ? `${d.shareOfIncome} % der Ø-Einnahmen` : 'ohne Einnahmen im Zeitraum'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Ø variabel pro Monat</div>
              <div className="font-serif text-xl font-semibold tabular-nums">{formatCents(variable)}</div>
              <div className="text-xs text-muted-foreground">Ø Ausgaben gesamt {formatCents(d.averageExpense)}</div>
            </div>
          </div>
          {/* Anteil fix/variabel an den Ø-Ausgaben: ein Balken, zwei Töne */}
          <div
            className="flex h-3 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${Math.round(fixedShare)} % der Ausgaben sind fix`}
          >
            <div className="h-full bg-foreground/70" style={{ width: `${fixedShare}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>fix {Math.round(fixedShare)} %</span>
            <span>variabel {100 - Math.round(fixedShare)} %</span>
          </div>
          {d.top.length > 0 && (
            <ul className="space-y-1.5 pt-1 text-sm">
              {d.top.map((t) => {
                const cat = categories.find((c) => c.id === t.categoryId);
                return (
                  <li key={t.recurringId}>
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0 truncate" title={t.note}>{t.note || cat?.name || 'Dauerbuchung'}</span>
                      <span className="shrink-0 font-mono tabular-nums">{formatCents(t.monthly)}</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-foreground/50" style={{ width: `${(t.monthly / maxTop) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
              {d.fixedCount > d.top.length && (
                <li className="text-xs text-muted-foreground">
                  + {d.fixedCount - d.top.length} weitere — <Link to="/wiederkehrend" className="text-stamp hover:underline">alle Dauerbuchungen</Link>
                </li>
              )}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">Wo die variablen Ausgaben schwanken</div>
          <p className="mb-2 text-xs text-muted-foreground">Kleinster und größter Monat je Kategorie, ohne Dauerbuchungen</p>
          {d.variable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine variablen Ausgaben im Zeitraum.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.variable.map((v) => (
                <li key={v.categoryId} className="flex items-center gap-2">
                  {v.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(v.color) }} />}
                  <span className="min-w-0 flex-1 truncate" title={v.name}>{v.name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatCents(v.min)} – {formatCents(v.max)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
