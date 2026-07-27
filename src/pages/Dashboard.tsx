import { useMemo } from 'react';
import { TrendingDown, TrendingUp, Wallet, Scale } from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFinanceData } from '@/lib/data';
import {
  currencySymbol, currentMonthKey, expensesByCategory, formatCents, formatDate, formatMonth,
  getUserLocale, memberBalances, monthTotals, totalBalance,
} from '@/lib/finance';
import TransactionDialog from '@/components/TransactionDialog';
import { cn } from '@/lib/utils';

const PIE_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#94a3b8', '#10b981'];

export default function Dashboard() {
  const { accounts, categories, transactions, users, isLoading } = useFinanceData();
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
      return { month: formatMonth(key).slice(0, 3), Einnahmen: t.income / 100, Ausgaben: t.expense / 100 };
    });
  }, [transactions]);

  const categoryData = [...expensesByCategory(transactions, month).entries()]
    .map(([catId, amount]) => {
      const cat = categories.find((c) => c.id === catId);
      return { name: cat?.name ?? 'Ohne Kategorie', value: amount / 100, color: cat?.color ?? '#94a3b8' };
    })
    .sort((a, b) => b.value - a.value);

  const balances = memberBalances(transactions, users.map((u) => u.id));
  const recent = transactions.slice(0, 8);
  const savings = totals.income - totals.expense;

  if (isLoading) return <p className="text-muted-foreground">Daten werden geladen…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Überblick für {formatMonth(month)}</p>
        </div>
        <TransactionDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gesamtvermögen</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-bold', total < 0 && 'text-destructive')}>{formatCents(total)}</div>
            <p className="text-xs text-muted-foreground">{accounts.length} Konten</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Einnahmen (Monat)</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{formatCents(totals.income)}</div>
            <p className="text-xs text-muted-foreground">{formatMonth(month)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ausgaben (Monat)</CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{formatCents(totals.expense)}</div>
            <p className="text-xs text-muted-foreground">{formatMonth(month)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sparrate (Monat)</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-bold', savings >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
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
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v} ${currencySymbol()}`} width={70} />
                <Tooltip formatter={(value: number | string) => `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`} />
                <Area type="monotone" dataKey="Einnahmen" stroke="#10b981" fill="url(#gIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="Ausgaben" stroke="#f43f5e" fill="url(#gOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ausgaben nach Kategorie</CardTitle>
            <CardDescription>{formatMonth(month)}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {categoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Ausgaben in diesem Monat.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {categoryData.map((entry, idx) => (
                      <Cell key={entry.name} fill={entry.color || PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number | string) => `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`} />
                </PieChart>
              </ResponsiveContainer>
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
                  <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat?.color ?? '#64748b' }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.note || cat?.name || 'Umbuchung'}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(t.date)} · {user?.name}{t.splits.length > 0 ? ' · geteilt' : ''}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      'shrink-0 text-sm font-semibold',
                      t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-500' : 'text-muted-foreground',
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
                  <div key={u.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: u.color }}>
                        {u.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">{u.name}</span>
                    </div>
                    <span className={cn('text-sm font-semibold', bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-rose-500' : 'text-muted-foreground')}>
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
