import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
import { useScope } from '@/providers/scope';
import { formatCents, getUserLocale, todayISO } from '@/lib/finance';
import { cn } from '@/lib/utils';
import { CHART } from '@/lib/chartColors';
import { AXIS_MONEY_WIDTH, CURSOR_BAR, GRID_PROPS, axisMoney } from '@/lib/chartTheme';
import { PaperTooltip } from '@/components/ChartParts';
import { pencil } from '@/lib/pencil';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TrendCharts from '@/components/TrendCharts';
import CategoryMatrix from '@/components/CategoryMatrix';
import BreakdownView from '@/components/BreakdownView';
import FixedCostsCard from '@/components/FixedCostsCard';

const VIEWS = ['verlauf', 'kategorien', 'aufschluesselung', 'jahr'] as const;
type View = (typeof VIEWS)[number];

/** Differenz Jahr vs. Vorjahr: mehr Ausgaben = negativ (rot), weniger = positiv (grün) */
function DiffCell({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null;
  return (
    <span className={cn(
      'font-medium',
      diff > 0 ? 'text-negative' : diff < 0 ? 'text-positive' : 'text-muted-foreground',
    )}>
      {diff > 0 ? '+' : ''}{formatCents(diff)}
      {pct !== null && <span className="ml-1 text-xs">({pct > 0 ? '+' : ''}{pct} %)</span>}
    </span>
  );
}

/**
 * Auswertung in drei Ansichten: Verlauf (Einnahmen/Ausgaben/Sparquote),
 * Kategorien × Monate und der Jahresvergleich. Die Ansicht steht in der
 * URL (`?ansicht=kategorien`), damit Links und „Zurück“ sie behalten.
 */
export default function YearReview() {
  const [params, setParams] = useSearchParams();
  const { userId: scopeUserId } = useScope();
  const requested = params.get('ansicht');
  const view: View = VIEWS.find((v) => v === requested) ?? 'verlauf';
  const setView = (value: string) =>
    // Beim Reiterwechsel nur die Ansicht behalten — Zeitraum und Filter der
    // Aufschlüsselung gehören nicht in die anderen Reiter
    setParams(value === 'verlauf' ? {} : { ansicht: value }, { replace: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Auswertung</h1>
        <p className="text-sm text-muted-foreground">
          Wohin das Geld geht — über die Monate, je Kategorie und im Vergleich zum Vorjahr.
          Ein Klick auf einen Wert zeigt die Buchungen dahinter.
        </p>
        {scopeUserId !== undefined && (
          <p className="pt-1 text-xs text-stamp">
            Meine Sicht: Verlauf, Kategorien und Aufschlüsselung zählen nur deine Buchungen; der
            Jahresvergleich und die Fixkosten bleiben haushaltsweit.
          </p>
        )}
      </div>
      <Tabs value={view} onValueChange={setView} className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="verlauf">Verlauf</TabsTrigger>
          <TabsTrigger value="kategorien">Kategorien × Monate</TabsTrigger>
          <TabsTrigger value="aufschluesselung">Aufschlüsselung</TabsTrigger>
          <TabsTrigger value="jahr">Jahresvergleich</TabsTrigger>
        </TabsList>
        <TabsContent value="verlauf" className="space-y-6">
          <TrendCharts />
          <FixedCostsCard />
        </TabsContent>
        <TabsContent value="kategorien" className="space-y-6">
          <CategoryMatrix />
        </TabsContent>
        <TabsContent value="aufschluesselung" className="space-y-6">
          <BreakdownView />
        </TabsContent>
        <TabsContent value="jahr" className="space-y-6">
          <YearComparison />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Jahresvergleich der Ausgaben pro Oberkategorie (Jahr vs. Vorjahr) */
function YearComparison() {
  const today = todayISO();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  // Im laufenden Jahr standardmäßig „bis heute“ — sonst vergleicht man im
  // September neun gegen zwölf Monate und jede Kategorie wirkt teurer
  const [fullYear, setFullYear] = useState(false);
  const ytd = year === currentYear && !fullYear;
  const upTo = ytd ? today.slice(5) : undefined;
  const query = trpc.finance.yearComparison.useQuery({ year, upTo });
  const upToLabel = new Date(`${today}T12:00:00`).toLocaleDateString(getUserLocale(), { day: 'numeric', month: 'long' });
  const rows = query.data?.rows ?? [];

  const totals = rows.reduce(
    (acc, r) => ({ current: acc.current + r.current, previous: acc.previous + r.previous }),
    { current: 0, previous: 0 },
  );

  const navigate = useNavigate();
  const chartData = rows
    .filter((r) => r.current > 0 || r.previous > 0)
    .map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      [String(year - 1)]: r.previous / 100,
      [String(year)]: r.current / 100,
    }));

  // Klick auf eine Zeile: die Ausgaben dieser Kategorie im selben Zeitraum
  const linkFor = (categoryId: number | null) => {
    const range: Record<string, string> = ytd ? { von: `${year}-01-01`, bis: today } : { jahr: String(year) };
    return `/transaktionen?${new URLSearchParams({ ...range, typ: 'expense', kategorie: String(categoryId ?? -1), sicht: 'haushalt' })}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {ytd
              ? `Ausgaben vom 1. Januar bis ${upToLabel} ${year} im Vergleich zum selben Zeitraum ${year - 1} — pro Oberkategorie`
              : `Ausgaben ${year} im Vergleich zu ${year - 1} — pro Oberkategorie`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {year === currentYear && (
            <div className="flex rounded-lg border bg-muted/40 p-1 text-sm">
              {([['ytd', 'Bis heute'], ['full', 'Ganzes Jahr']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    'rounded-md px-3 py-1 text-muted-foreground transition-colors hover:text-foreground',
                    (value === 'full') === fullYear && 'bg-background text-foreground shadow-sm',
                  )}
                  onClick={() => setFullYear(value === 'full')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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
            disabled={year >= currentYear} onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
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
                    <Link to={linkFor(r.categoryId)} className="flex items-center gap-2 hover:underline" title="Buchungen anzeigen">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pencil(r.color) }} />
                      {r.name}
                    </Link>
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
              <BarChart
                data={chartData} margin={{ left: 0, right: 8, top: 8 }} barGap={2} className="cursor-pointer"
                // Klick auf eine Kategorie zeigt ihre Buchungen im gewählten Jahr
                onClick={(state: { activeTooltipIndex?: number | null } | null) => {
                  const index = state?.activeTooltipIndex;
                  const row = typeof index === 'number' ? chartData[index] : undefined;
                  if (row) navigate(linkFor(row.categoryId));
                }}
              >
                <CartesianGrid {...GRID_PROPS} />
                {/* Schräg und gekürzt: waagrecht liefen lange Kategorienamen
                    ineinander („LebensmittelFreizeit…“) */}
                <XAxis
                  dataKey="name" tickLine={false} axisLine={false}
                  interval={0} angle={-35} textAnchor="end" height={72} fontSize={11}
                  tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                />
                <YAxis
                  tickLine={false} axisLine={false} width={AXIS_MONEY_WIDTH}
                  tickFormatter={axisMoney}
                />
                <Tooltip content={<PaperTooltip />} cursor={CURSOR_BAR} />
                <Legend iconType="square" iconSize={10} />
                <Bar dataKey={String(year - 1)} fill={CHART.muted} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey={String(year)} fill={CHART.positive} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
