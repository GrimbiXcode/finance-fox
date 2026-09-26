import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatCents, formatMonth, formatMonthYearShort } from '@/lib/finance';
import { CHART } from '@/lib/chartColors';
import {
  AXIS_MONEY_WIDTH, AXIS_PROPS, CURSOR_BAR, CURSOR_LINE, GRID_PROPS, axisMoney, dotFor, activeDotFor,
} from '@/lib/chartTheme';
import { PaperTooltip } from '@/components/ChartParts';
import { trpc } from '@/providers/trpc';
import { useScope } from '@/providers/scope';

/**
 * Verlauf über 12/24 Monate: oben Einnahmen und Ausgaben (Balken, Geld),
 * darunter die Sparquote (Linie, Prozent) — bewusst zwei Diagramme statt
 * einer zweiten y-Achse, die zwei Maßstäbe ineinander mischt. Ein Klick auf
 * einen Monat zeigt dessen Buchungen.
 */
export default function TrendCharts() {
  const [months, setMonths] = useState(12);
  const navigate = useNavigate();
  const { userId } = useScope();
  const query = trpc.analysis.monthlyTrend.useQuery({ months, userId });
  const data = query.data;
  const rows = (data?.rows ?? []).map((r) => ({
    key: r.month,
    month: formatMonthYearShort(r.month),
    Einnahmen: r.income / 100,
    Ausgaben: r.expense / 100,
    Sparquote: r.rate,
  }));
  const open = (state: { activeTooltipIndex?: number | null } | null) => {
    const index = state?.activeTooltipIndex;
    const key = typeof index === 'number' ? rows[index]?.key : undefined;
    if (key) navigate(`/transaktionen?monat=${key}`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>Einnahmen, Ausgaben, Sparquote</CardTitle>
            <CardDescription>
              {data
                ? `Ø ${formatCents(data.averageIncome)} Einnahmen und ${formatCents(data.averageExpense)} Ausgaben pro Monat${data.averageRate !== null ? ` · Sparquote ${data.averageRate} %` : ''}`
                : 'Verlauf je Monat'}
            </CardDescription>
            {data?.best && data.worst && data.best !== data.worst && (
              <p className="pt-1 text-xs text-muted-foreground">
                Beste Sparquote im {formatMonth(data.best)}, schwächste im {formatMonth(data.worst)}.
              </p>
            )}
          </div>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger className="w-36" title="Zeitraum"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6 Monate</SelectItem>
              <SelectItem value="12">12 Monate</SelectItem>
              <SelectItem value="24">24 Monate</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.every((r) => r.Einnahmen === 0 && r.Ausgaben === 0) ? (
          <p className="text-sm text-muted-foreground">{query.isLoading ? 'Wird berechnet…' : 'Keine Buchungen in diesem Zeitraum.'}</p>
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ left: 0, right: 16, top: 8 }} barGap={2} onClick={open} className="cursor-pointer">
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...AXIS_PROPS} fontSize={11} minTickGap={8} />
                  <YAxis {...AXIS_PROPS} tickFormatter={axisMoney} width={AXIS_MONEY_WIDTH} />
                  <Tooltip content={<PaperTooltip />} cursor={CURSOR_BAR} />
                  <Legend iconType="square" iconSize={10} />
                  <Bar dataKey="Einnahmen" fill={CHART.positive} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Ausgaben" fill={CHART.negative} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ left: 0, right: 16, top: 8, bottom: 4 }} onClick={open} className="cursor-pointer">
                  <CartesianGrid {...GRID_PROPS} />
                  {/* Innenabstand: sonst klebt der erste Monat an der Prozent-Achse und der letzte wird abgeschnitten */}
                  <XAxis dataKey="month" {...AXIS_PROPS} fontSize={11} minTickGap={8} padding={{ left: 20, right: 20 }} />
                  <YAxis {...AXIS_PROPS} width={AXIS_MONEY_WIDTH} tickCount={4} tickFormatter={(v: number) => `${v} %`} />
                  <Tooltip
                    content={
                      <PaperTooltip
                        // Monate ohne Einnahmen haben keine Sparquote — nicht „0 %“ zeigen
                        formatter={(v, _name, item) =>
                          (item as { payload?: { Sparquote: number | null } }).payload?.Sparquote == null ? '—' : `${v} %`}
                      />
                    }
                    cursor={CURSOR_LINE}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--rule-strong))" />
                  <Line
                    type="monotone" dataKey="Sparquote" stroke={CHART.ink} strokeWidth={2}
                    dot={dotFor(CHART.ink)} activeDot={activeDotFor(CHART.ink)} connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">Sparquote = (Einnahmen − Ausgaben) / Einnahmen; Umbuchungen zählen nicht.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
