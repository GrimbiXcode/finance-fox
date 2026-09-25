import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, Wallet, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { percentChange, shiftMonth } from '@contracts/planning';
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFinanceData } from '@/lib/data';
import {
  currentMonthKey, expensesByRootCategory, formatCents, formatDate, formatMonth,
  formatMonthShort, memberBalances, monthTotals, totalBalance,
} from '@/lib/finance';
import TransactionDialog from '@/components/TransactionDialog';
import GettingStarted from '@/components/GettingStarted';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { CHART } from '@/lib/chartColors';
import { AXIS_MONEY_WIDTH, AXIS_PROPS, axisMoney, CURSOR_LINE, GRID_PROPS, HATCH_OPACITY, SHEET, activeDotFor, dotFor, hatch, moneyLabel } from '@/lib/chartTheme';
import { PaperTooltip } from '@/components/ChartParts';
import { chartDefs } from '@/lib/chartDefs';
import { pencil, pencilSlot } from '@/lib/pencil';


/**
 * Veränderung gegenüber Vormonat und Vorjahresmonat als kleine Zeile unter
 * einer Kennzahl. `higherIsGood` bestimmt die Farbe: mehr Ausgaben sind
 * schlecht, mehr Einnahmen gut. `asAmount` zeigt die Differenz als Betrag —
 * für Werte, die das Vorzeichen wechseln können (Sparrate), sind Prozente
 * nicht lesbar („−190 %“).
 */
function Change({
  current, previous, previousYear, higherIsGood, month, asAmount = false,
}: {
  current: number;
  previous: number;
  previousYear: number;
  higherIsGood: boolean;
  month: string;
  asAmount?: boolean;
}) {
  const part = (value: number, label: string) => {
    const diff = current - value;
    const pct = percentChange(current, value);
    // Ohne Vergleichswert oder ohne Veränderung gibt es nichts zu sagen
    if (diff === 0 || (!asAmount && pct === null)) return null;
    const good = diff === 0 ? null : (diff > 0) === higherIsGood;
    return (
      <span className={cn('whitespace-nowrap tabular-nums', good === true && 'text-positive', good === false && 'text-negative')}>
        {diff > 0 ? '+' : ''}
        {asAmount ? formatCents(diff) : `${pct} %`} {label}
      </span>
    );
  };
  const vsPrev = part(previous, `ggü. ${formatMonthShort(shiftMonth(month, -1))}`);
  const vsYear = part(previousYear, 'ggü. Vorjahr');
  if (!vsPrev && !vsYear) return null;
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      {vsPrev}
      {vsYear}
    </p>
  );
}

export default function Dashboard() {
  const { accounts, categories, transactions, users, isLoading } = useFinanceData();
  // Liegenschaften/Hypotheken für die Zusatzzeile im Gesamtvermögen
  const mortgage = trpc.mortgage.summary.useQuery().data;
  // Gewählter Monat steht in der URL (`#/?monat=2026-08`) — Standard: aktueller
  const [params, setParams] = useSearchParams();
  const thisMonth = currentMonthKey();
  const requested = params.get('monat');
  const month = requested && /^\d{4}-\d{2}$/.test(requested) && requested <= thisMonth ? requested : thisMonth;
  const isCurrent = month === thisMonth;
  const setMonth = (key: string) =>
    setParams(key === thisMonth ? {} : { monat: key }, { replace: true });
  const prevMonth = shiftMonth(month, -1);
  const prevYearMonth = shiftMonth(month, -12);

  const totals = monthTotals(transactions, month);
  const totalsPrev = monthTotals(transactions, prevMonth);
  const totalsYear = monthTotals(transactions, prevYearMonth);
  // Vermögen am Monatsende (für vergangene Monate) bzw. heute
  const balanceAt = (key: string) =>
    totalBalance(accounts, transactions.filter((t) => t.date.slice(0, 7) <= key));
  const total = isCurrent ? totalBalance(accounts, transactions) : balanceAt(month);

  // Sechs Monate bis zum gewählten Monat (günstig genug ohne useMemo)
  const cashflow = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((key) => {
    const t = monthTotals(transactions, key);
    return { month: formatMonthShort(key), Einnahmen: t.income / 100, Ausgaben: t.expense / 100 };
  });

  // Ausgaben auf Oberkategorien aggregiert (Unterkategorien zählen zur Oberkategorie)
  const categoryData = [...expensesByRootCategory(transactions, month, categories).entries()]
    .map(([catId, amount]) => {
      const cat = categories.find((c) => c.id === catId);
      return { id: catId, name: cat?.name ?? 'Ohne Kategorie', value: amount / 100, color: cat?.color ?? CHART.muted };
    })
    .sort((a, b) => b.value - a.value);
  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0);

  const balances = memberBalances(transactions, users.map((u) => u.id));
  // Aktueller Monat: die neuesten Buchungen überhaupt; vergangener Monat:
  // die letzten Buchungen dieses Monats
  const recent = (isCurrent ? transactions : transactions.filter((t) => t.date.startsWith(month))).slice(0, 8);
  const savings = totals.income - totals.expense;
  const savingsPrev = totalsPrev.income - totalsPrev.expense;
  const savingsYear = totalsYear.income - totalsYear.expense;
  const txLink = (extra: Record<string, string> = {}) =>
    `/transaktionen?${new URLSearchParams({ monat: month, ...extra })}`;
  const kpiLink = (to: string, children: ReactNode) => (
    <Link to={to} className="block rounded-md hover:underline hover:decoration-dotted hover:underline-offset-4">
      {children}
    </Link>
  );

  if (isLoading) return <p className="text-muted-foreground">Daten werden geladen…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <div className="mt-1 flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Vorheriger Monat" onClick={() => setMonth(prevMonth)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-32 text-center text-sm text-muted-foreground tabular-nums">
              {isCurrent ? `Überblick für ${formatMonth(month)}` : formatMonth(month)}
            </span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Nächster Monat"
              disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isCurrent && (
              <Button variant="link" size="sm" className="h-7 px-1" onClick={() => setMonth(thisMonth)}>
                Zum aktuellen Monat
              </Button>
            )}
          </div>
        </div>
        <TransactionDialog />
      </div>

      <GettingStarted />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Gesamtvermögen</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('font-serif text-2xl font-semibold tabular-nums', total < 0 && 'text-destructive')}>{formatCents(total)}</div>
            <p className="text-xs text-muted-foreground">
              {isCurrent ? `${accounts.length} Konten` : `Stand Ende ${formatMonth(month)}`}
            </p>
            <Change
              current={total} previous={balanceAt(prevMonth)} previousYear={balanceAt(prevYearMonth)}
              higherIsGood month={month}
            />
            {isCurrent && mortgage && mortgage.count > 0 && (
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
            {kpiLink(txLink({ typ: 'income' }), (
              <div className="font-serif text-2xl font-semibold tabular-nums text-positive">{formatCents(totals.income)}</div>
            ))}
            <Change
              current={totals.income} previous={totalsPrev.income} previousYear={totalsYear.income}
              higherIsGood month={month}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Ausgaben (Monat)</CardTitle>
            <TrendingDown className="h-4 w-4 text-negative" />
          </CardHeader>
          <CardContent>
            {kpiLink(txLink({ typ: 'expense' }), (
              <div className="font-serif text-2xl font-semibold tabular-nums text-negative">{formatCents(totals.expense)}</div>
            ))}
            <Change
              current={totals.expense} previous={totalsPrev.expense} previousYear={totalsYear.expense}
              higherIsGood={false} month={month}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-sans text-sm font-medium text-muted-foreground">Sparrate (Monat)</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('font-serif text-2xl font-semibold tabular-nums', savings >= 0 ? 'text-positive' : 'text-negative')}>
              {formatCents(savings)}
            </div>
            <p className="text-xs text-muted-foreground">
              {totals.income > 0 ? `${Math.round((savings / totals.income) * 100)} % der Einnahmen` : 'Keine Einnahmen'}
            </p>
            <Change
              current={savings} previous={savingsPrev} previousYear={savingsYear}
              higherIsGood month={month} asAmount
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Cashflow</CardTitle>
            <CardDescription>
              Einnahmen vs. Ausgaben der letzten 6 Monate{isCurrent ? '' : ` bis ${formatMonth(month)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {cashflow.every((c) => c.Einnahmen === 0 && c.Ausgaben === 0) ? (
              // Leere Achsen („0 EUR … 4 EUR“) sagen nichts — lieber ein Hinweis
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <p>Noch keine Einnahmen oder Ausgaben in diesem Zeitraum.</p>
                <TransactionDialog
                  trigger={<Button variant="outline" size="sm">Erste Buchung erfassen</Button>}
                />
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashflow} margin={{ left: 0, right: 8, top: 8 }}>
                {chartDefs()}
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={axisMoney} width={AXIS_MONEY_WIDTH} />
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
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ausgaben nach Kategorie</CardTitle>
            <CardDescription>{formatMonth(month)}</CardDescription>
          </CardHeader>
          <CardContent>
            {categoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground">{isCurrent ? 'Noch keine Ausgaben in diesem Monat.' : `Keine Ausgaben im ${formatMonth(month)}.`}</p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {/* Ring mit Papierfugen, Summe in Serife in der Mitte */}
                <div className="relative h-52 w-52 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} stroke={SHEET} strokeWidth={2}>
                        {categoryData.map((entry, idx) => (
                          <Cell key={entry.name} fill={entry.color ? pencil(entry.color) : pencilSlot(idx + 1)} />
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
                    <li key={entry.name} className="border-b last:border-0">
                      {/* Klick führt zu den Buchungen der Kategorie in diesem Monat */}
                      <Link
                        to={txLink(entry.id > 0 ? { typ: 'expense', kategorie: String(entry.id) } : { typ: 'expense' })}
                        className="flex items-center gap-2 py-1.5 hover:bg-muted/50"
                        title={`Buchungen „${entry.name}“ im ${formatMonth(month)} anzeigen`}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color ? pencil(entry.color) : pencilSlot(idx + 1) }} />
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        <span className="font-mono tabular-nums">{moneyLabel(entry.value)}</span>
                        <span className="w-9 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                          {categoryTotal > 0 ? Math.round((entry.value / categoryTotal) * 100) : 0} %
                        </span>
                      </Link>
                    </li>
                  ))}
                  {categoryData.length > 6 && (
                    <li className="py-1.5">
                      <Link to={txLink({ typ: 'expense' })} className="text-muted-foreground hover:text-foreground hover:underline">
                        + {categoryData.length - 6} weitere Kategorien
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{isCurrent ? 'Letzte Buchungen' : `Buchungen im ${formatMonth(month)}`}</CardTitle>
            <Link to={isCurrent ? '/transaktionen' : txLink()} className="shrink-0 text-sm text-stamp hover:underline">
              Alle anzeigen
            </Link>
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
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pencil(cat?.color) ?? CHART.muted }} />
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
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: pencil(u.color) }}>
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
