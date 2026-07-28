import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { trpc } from '@/providers/trpc';
import { currencySymbol, formatCents, getUserLocale } from '@/lib/finance';
import { cn } from '@/lib/utils';

/** Differenz Jahr vs. Vorjahr: mehr Ausgaben = negativ (rot), weniger = positiv (grün) */
function DiffCell({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null;
  return (
    <span className={cn(
      'font-medium',
      diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-emerald-600' : 'text-muted-foreground',
    )}>
      {diff > 0 ? '+' : ''}{formatCents(diff)}
      {pct !== null && <span className="ml-1 text-xs">({pct > 0 ? '+' : ''}{pct} %)</span>}
    </span>
  );
}

/** Jahresvergleich der Ausgaben pro Oberkategorie (Jahr vs. Vorjahr) */
export default function YearReview() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const query = trpc.finance.yearComparison.useQuery({ year });
  const rows = query.data?.rows ?? [];

  const totals = rows.reduce(
    (acc, r) => ({ current: acc.current + r.current, previous: acc.previous + r.previous }),
    { current: 0, previous: 0 },
  );

  const chartData = rows
    .filter((r) => r.current > 0 || r.previous > 0)
    .map((r) => ({
      name: r.name,
      [String(year - 1)]: r.previous / 100,
      [String(year)]: r.current / 100,
    }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Auswertung</h1>
          <p className="text-sm text-muted-foreground">
            Ausgaben {year} im Vergleich zu {year - 1} — pro Oberkategorie
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="icon" title="Vorheriges Jahr"
            disabled={year <= 2000} onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-16 text-center text-lg font-semibold tabular-nums">{year}</span>
          <Button
            variant="outline" size="icon" title="Nächstes Jahr"
            disabled={year >= 2100} onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kategorien im Vergleich</CardTitle>
          <CardDescription>Unterkategorien sind in den Oberkategorien zusammengefasst</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kategorie</TableHead>
                <TableHead className="text-right">{year}</TableHead>
                <TableHead className="text-right">{year - 1}</TableHead>
                <TableHead className="text-right">Differenz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    Daten werden geladen…
                  </TableCell>
                </TableRow>
              )}
              {!query.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    Keine Ausgaben in {year} oder {year - 1}.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.categoryId ?? 'ohne'}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                      {r.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{formatCents(r.current)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCents(r.previous)}</TableCell>
                  <TableCell className="text-right"><DiffCell current={r.current} previous={r.previous} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Gesamt</TableCell>
                  <TableCell className="text-right font-semibold">{formatCents(totals.current)}</TableCell>
                  <TableCell className="text-right font-semibold text-muted-foreground">{formatCents(totals.previous)}</TableCell>
                  <TableCell className="text-right"><DiffCell current={totals.current} previous={totals.previous} /></TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jahr vs. Vorjahr</CardTitle>
          <CardDescription>Ausgaben pro Oberkategorie als Balkendiagramm</CardDescription>
        </CardHeader>
        <CardContent className="h-96">
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Daten für ein Diagramm.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v: number) => `${v} ${currencySymbol()}`}
                />
                <Tooltip
                  formatter={(value: number | string) =>
                    `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`}
                />
                <Legend />
                <Bar dataKey={String(year - 1)} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey={String(year)} fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
