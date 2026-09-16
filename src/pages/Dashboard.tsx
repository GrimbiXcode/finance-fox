import { useMemo } from 'react';
import { TrendingDown, TrendingUp, Wallet, Scale } from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFinanceData } from '@/lib/data';
import {
  currencySymbol, currentMonthKey, expensesByRootCategory, formatCents, formatDate, formatMonth,
  formatMonthShort, memberBalances, monthTotals, totalBalance,
} from '@/lib/finance';
import TransactionDialog from '@/components/TransactionDialog';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { CHART } from '@/lib/chartColors';
import { AXIS_PROPS, CURSOR_LINE, GRID_PROPS, HATCH_OPACITY, SHEET, activeDotFor, dotFor, hatch, moneyLabel } from '@/lib/chartTheme';
import { PaperTooltip } from '@/components/ChartParts';
import { chartDefs } from '@/lib/chartDefs';

const PIE_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#94a3b8', '#10b981'];

export default function Dashboard() {
  const { accounts, categories, transactions, users, isLoading } = useFinanceData();
  // Liegenschaften/Hypotheken für die Zusatzzeile im Gesamtvermögen
  const mortgage = trpc.mortgage.summary.useQuery().data;
  const month = currentMonthKey();
  const totals = monthTotals(transactions, month);
  const total = totalBalance(accounts, transactions);

  const cashflow = useMemo(() => {
    const keys: string[] = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 5; i >= 0; i -= 1) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys.map((key) => {
      const t = monthTotals(transactions, key);
      return { month: formatMonthShort(key), Einnahmen: t.income / 100, Ausgaben: t.expense / 100 };
    });
  }, [transactions]);

  // Ausgaben auf Oberkategorien aggregiert (Unterkategorien zählen zur Oberkategorie)
  const categoryData = [...expensesByRootCategory(transactions, month, categories).entries()]
    .map(([catId, amount]) => {
      const cat = categories.find((c) => c.id === catId);
      return { name: cat?.name ?? 'Ohne Kategorie', value: amount / 100, color: cat?.color ?? CHART.muted };
    })
    .sort((a, b) => b.value - a.value);
  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0);

  const balances = memberBalances(transactions, users.map((u) => u.id));
  const recent = transactions.slice(0, 8);
  const savings = totals.income - totals.expense;

  if (isLoading) return <p className="text-muted-foreground">Daten werden geladen…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Überblick für {formatMonth(month)}</p>
        </div>
        <TransactionDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Gesamtvermögen</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('font-serif text-2xl font-semibold', total < 0 && 'text-destructive')}>{formatCents(total)}</div>
            <p className="text-xs text-muted-foreground">{accounts.length} Konten</p>
            {mortgage && mortgage.count > 0 && (
              <p className="text-xs text-muted-foreground" title="Kontosalden plus Verkehrswert der Liegenschaften minus Restschuld">
                inkl. Immobilie: {formatCents(total + mortgage.equity)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Einnahmen (Monat)</CardTitle>
            <TrendingUp className="h-4 w-4 text-positive" />
          </CardHeader>
          <CardContent>
            <div className="font-serif text-2xl font-semibold text-positive">{formatCents(totals.income)}</div>
            <p className="text-xs text-muted-foreground">{formatMonth(month)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Ausgaben (Monat)</CardTitle>
            <TrendingDown className="h-4 w-4 text-negative" />
          </CardHeader>
          <CardContent>
            <div className="font-serif text-2xl font-semibold text-negative">{formatCents(totals.expense)}</div>
            <p className="text-xs text-muted-foreground">{formatMonth(month)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Sparrate (Monat)</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('font-serif text-2xl font-semibold', savings >= 0 ? 'text-positive' : 'text-negative')}>
              {formatCents(savings)}
            </div>
            <p className="text-xs text-muted-foreground">
              {totals.income > 0 ? `${Math.round((savings / totals.income) * 100)} % der Einnahmen` : 'Keine Einnahmen'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Cashflow</CardTitle>
            <CardDescription>Einnahmen vs. Ausgaben der letzten 6 Monate</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashflow} margin={{ left: 0, right: 8, top: 8 }}>
                {chartDefs()}
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v: number) => `${v} ${currencySymbol()}`} width={70} />
                <Tooltip content={<PaperTooltip />} cursor={CURSOR_LINE} />
                <Legend iconType="square" iconSize={10} />
                <Area
                  type="monotone" dataKey="Einnahmen" stroke={CHART.positive} strokeWidth={2}
                  fill={hatch('positive')} fillOpacity={HATCH_OPACITY}
                  dot={dotFor(CHART.positive)} activeDot={activeDotFor(CHART.positive)}
                />
                <Area
                  type="monotone" dataKey="Ausgaben" stroke={CHART.negative} strokeWidth={2}
                  fill={hatch('negative')} fillOpacity={HATCH_OPACITY}
                  dot={dotFor(CHART.negative)} activeDot={activeDotFor(CHART.negative)}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ausgaben nach Kategorie</CardTitle>
            <CardDescription>{formatMonth(month)}</CardDescription>
          </CardHeader>
          <CardContent>
            {categoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Ausgaben in diesem Monat.</p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {/* Ring mit Papierfugen, Summe in Serife in der Mitte */}
                <div className="relative h-52 w-52 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} stroke={SHEET} strokeWidth={2}>
                        {categoryData.map((entry, idx) => (
                          <Cell key={entry.name} fill={entry.color || PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PaperTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-serif text-[15px] font-semibold">{moneyLabel(categoryTotal)}</span>
                    <span className="text-[11px] text-muted-foreground">{formatMonth(month)}</span>
                  </div>
                </div>
                {/* Legende mit Betrag und Anteil – die Farbe allein trägt nie die Identität */}
                <ul className="w-full min-w-0 flex-1 text-xs">
                  {categoryData.slice(0, 6).map((entry, idx) => (
                    <li key={entry.name} className="flex items-center gap-2 border-b py-1.5 last:border-0">
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color || PIE_COLORS[idx % PIE_COLORS.length] }} />
                      <span className="min-w-0 flex-1 truncate" title={entry.name}>{entry.name}</span>
                      <span className="font-mono tabular-nums">{moneyLabel(entry.value)}</span>
                      <span className="w-9 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                        {categoryTotal > 0 ? Math.round((entry.value / categoryTotal) * 100) : 0} %
                      </span>
                    </li>
                  ))}
                  {categoryData.length > 6 && (
                    <li className="py-1.5 text-muted-foreground">+ {categoryData.length - 6} weitere Kategorien</li>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Letzte Buchungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recent.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Noch keine Buchungen — lege mit „Neue Buchung“ los.
                </p>
              )}
              {recent.map((t) => {
                const cat = categories.find((c) => c.id === t.categoryId);
                const user = users.find((u) => u.id === t.userId);
                return (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat?.color ?? CHART.muted }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.note || cat?.name || 'Umbuchung'}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(t.date)} · {user?.name}{t.splits.length > 0 ? ' · geteilt' : ''}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      'shrink-0 font-mono text-sm font-medium tabular-nums',
                      t.type === 'income' ? 'text-positive' : t.type === 'expense' ? 'text-negative' : 'text-muted-foreground',
                    )}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{formatCents(t.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Offene Salden</CardTitle>
            <CardDescription>Aus geteilten Ausgaben</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {users.map((u) => {
                const bal = balances.get(u.id) ?? 0;
                return (
                  <div key={u.id} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: u.color }}>
                        {u.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="truncate text-sm font-medium" title={u.name}>{u.name}</span>
                    </div>
                    <span className={cn('shrink-0 font-mono text-sm font-medium tabular-nums', bal > 0 ? 'text-positive' : bal < 0 ? 'text-negative' : 'text-muted-foreground')}>
                      {bal > 0 ? '+' : ''}{formatCents(bal)}
                    </span>
                  </div>
                );
              })}
              <p className="pt-2 text-xs text-muted-foreground">
                Details und Ausgleichsvorschläge unter „Aufteilung“.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
