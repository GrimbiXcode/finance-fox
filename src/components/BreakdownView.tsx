import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import PeriodPicker from '@/components/PeriodPicker';
import { formatCents, formatDate, todayISO } from '@/lib/finance';
import { periodLabel } from '@/lib/period';
import { pencil } from '@/lib/pencil';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useScope } from '@/providers/scope';
import { percentChange } from '@contracts/planning';
import { parsePeriod, periodParams, periodRange, type Period } from '@contracts/period';

const DIMENSIONS = {
  kategorie: { key: 'category', label: 'Kategorie', param: 'kategorie' },
  person: { key: 'person', label: 'Person (bezahlt von)', param: 'person' },
  konto: { key: 'account', label: 'Konto', param: 'konto' },
  tag: { key: 'tag', label: 'Tag', param: 'tag' },
  projekt: { key: 'project', label: 'Projekt', param: 'projekt' },
  notiz: { key: 'note', label: 'Empfänger / Notiz', param: 'q' },
} as const;
type DimensionParam = keyof typeof DIMENSIONS;
const PERIOD_KEYS = ['monat', 'jahr', 'von', 'bis', 'zeit'] as const;

/**
 * Auswertung nach frei wählbarer Dimension (F6) und freiem Zeitraum (F8):
 * Summe je Kategorie, Person, Konto, Tag oder Projekt, daneben derselbe
 * Wert im Vergleichszeitraum — gleich lang direkt davor oder dieselben Tage
 * ein Jahr früher. Ein Zeitraum, der in die Zukunft reicht, wird für den
 * Vergleich auf „bis heute“ gekürzt, sonst verglichen wir einen halben
 * Monat mit einem ganzen. Jede Zeile führt zu ihren Buchungen.
 */
export default function BreakdownView() {
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const period = parsePeriod((k) => params.get(k), today);
  const requested = params.get('nach') as DimensionParam | null;
  const dimension: DimensionParam = requested && requested in DIMENSIONS ? requested : 'kategorie';
  const type = params.get('art') === 'einnahmen' ? 'income' : 'expense';
  const compare = params.get('vergleich') === 'vorjahr' ? 'yearAgo' : 'previous';
  const update = (changes: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  const setPeriod = (p: Period) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of PERIOD_KEYS) next.delete(k);
      for (const [k, v] of Object.entries(periodParams(p))) next.set(k, v);
      return next;
    }, { replace: true });

  const range = periodRange(period);
  // Für den Vergleich nicht über heute hinaus
  const to = range.to && range.to > today ? today : range.to;
  const { userId } = useScope();
  const query = trpc.analysis.breakdown.useQuery({
    dimension: DIMENSIONS[dimension].key,
    type,
    from: range.from,
    to,
    compare,
    // „Meine Sicht“ — nur, wenn nicht ohnehin nach Person aufgeschlüsselt
    userId: dimension === 'person' ? undefined : userId,
  });
  const d = query.data;
  // Top-Empfänger (F7): wahlweise nach Anzahl statt Betrag
  const [byCount, setByCount] = useState(false);
  const rows = dimension === 'notiz' && byCount
    ? [...(d?.rows ?? [])].sort((a, b) => b.count - a.count || b.amount - a.amount)
    : (d?.rows ?? []);
  const max = Math.max(1, ...rows.map((r) => r.amount));

  const linkFor = (row: { key: number; name: string }) => {
    const search = new URLSearchParams({
      ...(range.from && to ? { von: range.from, bis: to } : { zeit: 'alle' }),
      typ: type,
    });
    const param = DIMENSIONS[dimension].param;
    // Notizen: über die Suche (findet alle Schreibweisen)
    if (dimension === 'notiz') search.set('q', row.name);
    // -1 = „ohne“: Transaktionen kennen das für Kategorie (-1) und Projekt (0)
    else if (row.key !== -1) search.set(param, String(row.key));
    else if (dimension === 'kategorie') search.set(param, '-1');
    else if (dimension === 'projekt') search.set(param, '0');
    return `/transaktionen?${search}`;
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>Aufschlüsselung</CardTitle>
          <CardDescription>
            {type === 'expense' ? 'Ausgaben' : 'Einnahmen'} {periodLabel(period)}
            {d?.previousRange && ` · verglichen mit ${formatDate(d.previousRange.from)} – ${formatDate(d.previousRange.to)}`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker period={period} onChange={setPeriod} today={today} />
          <Select value={dimension} onValueChange={(v) => update({ nach: v === 'kategorie' ? null : v })}>
            <SelectTrigger className="w-56 min-w-0 [&>span]:truncate" title="Aufschlüsseln nach">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DIMENSIONS) as DimensionParam[]).map((k) => (
                <SelectItem key={k} value={k}>nach {DIMENSIONS[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => update({ art: v === 'income' ? 'einnahmen' : null })}>
            <SelectTrigger className="w-32 min-w-0 [&>span]:truncate" title="Art">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Ausgaben</SelectItem>
              <SelectItem value="income">Einnahmen</SelectItem>
            </SelectContent>
          </Select>
          {period.kind !== 'all' && (
            <Select value={compare} onValueChange={(v) => update({ vergleich: v === 'yearAgo' ? 'vorjahr' : null })}>
              <SelectTrigger className="w-52 min-w-0 [&>span]:truncate" title="Vergleich">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="previous">Vergleich: Zeitraum davor</SelectItem>
                <SelectItem value="yearAgo">Vergleich: Vorjahr</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {dimension === 'notiz' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Groß-/Kleinschreibung und Leerzeichen zählen nicht — höchstens 50 Einträge.
            <div role="radiogroup" aria-label="Sortierung" className="ml-auto flex rounded-md border bg-muted/40 p-0.5">
              {([false, true] as const).map((c) => (
                <button
                  key={String(c)}
                  type="button"
                  role="radio"
                  aria-checked={byCount === c}
                  onClick={() => setByCount(c)}
                  className={cn('rounded px-2 py-0.5', byCount === c && 'bg-background text-foreground shadow-sm')}
                >
                  {c ? 'nach Anzahl' : 'nach Betrag'}
                </button>
              ))}
            </div>
          </div>
        )}
        {dimension === 'tag' && (
          <p className="text-xs text-muted-foreground">
            Eine Buchung mit mehreren Tags zählt bei jedem Tag — die Zeilen ergeben zusammen mehr als die Summe.
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{DIMENSIONS[dimension].label}</TableHead>
              <TableHead className="hidden w-1/3 sm:table-cell" />
              <TableHead className="text-right">Betrag</TableHead>
              {d?.previousRange && <TableHead className="text-right">Vergleich</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!d || rows.length === 0) && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  {query.isLoading ? 'Wird berechnet…' : 'Keine Buchungen in diesem Zeitraum.'}
                </TableCell>
              </TableRow>
            )}
            {d && rows.map((r) => {
              const change = percentChange(r.amount, r.previous);
              // Mehr Ausgaben = schlecht, mehr Einnahmen = gut
              const good = type === 'expense' ? r.amount < r.previous : r.amount > r.previous;
              return (
                <TableRow key={r.key}>
                  <TableCell className="whitespace-normal">
                    {/* „Ohne Tag“/„Ohne Notiz“ lassen sich nicht filtern — kein Link */}
                    {r.key === -1 && (dimension === 'tag' || dimension === 'notiz') ? (
                      <span className="inline-flex items-center gap-2">{r.name}</span>
                    ) : (
                      <Link to={linkFor(r)} className="inline-flex items-center gap-2 hover:underline" title="Buchungen anzeigen">
                        {r.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pencil(r.color) }} />}
                        {r.name}
                      </Link>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">{r.count}×</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground/70"
                        style={{ width: `${(r.amount / max) * 100}%` }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCents(r.amount)}
                    {d.total > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">{Math.round((r.amount / d.total) * 100)} %</span>
                    )}
                  </TableCell>
                  {d.previousRange && (
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCents(r.previous)}
                      {change !== null && change !== 0 && (
                        <span className={cn('ml-1.5', good ? 'text-positive' : 'text-negative')}>
                          {change > 0 ? '+' : ''}{change} %
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          {d && d.rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Gesamt</TableCell>
                <TableCell className="hidden sm:table-cell" />
                <TableCell className="text-right font-mono font-semibold tabular-nums">{formatCents(d.total)}</TableCell>
                {d.previousRange && (
                  <TableCell className="text-right font-mono text-xs tabular-nums">{formatCents(d.previousTotal)}</TableCell>
                )}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}
