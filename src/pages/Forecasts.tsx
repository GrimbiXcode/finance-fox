import { useState } from 'react';
import { AlertTriangle, CalendarClock, FlaskConical, LineChart as LineChartIcon, Target } from 'lucide-react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/providers/trpc';
import { currencySymbol, formatCents, formatMonth, getUserLocale } from '@/lib/finance';
import { cn } from '@/lib/utils';

export default function Forecasts() {
  const [months, setMonths] = useState('12');
  // Szenario-Planung: Formular-Werte + angewendete Parameter (Query-Input)
  const [incomePct, setIncomePct] = useState(100);
  const [excludeCat, setExcludeCat] = useState('none');
  const [applied, setApplied] = useState<{ incomePct: number; excludeCategoryId: number | null }>({
    incomePct: 100,
    excludeCategoryId: null,
  });
  const balance = trpc.forecast.balance.useQuery({
    months: Number(months),
    ...(applied.incomePct !== 100 ? { incomePct: applied.incomePct } : {}),
    ...(applied.excludeCategoryId !== null ? { excludeCategoryId: applied.excludeCategoryId } : {}),
  });
  const budgetFc = trpc.forecast.budgetForecast.useQuery();
  const goalFc = trpc.forecast.goalForecast.useQuery();
  const categories = trpc.finance.listCategories.useQuery();

  // Auswahl im Szenario: nur Ausgaben-Oberkategorien
  const rootExpenseCats = (categories.data ?? []).filter((c) => c.type === 'expense' && c.parentId === null);

  const scenarioActive = applied.incomePct !== 100 || applied.excludeCategoryId !== null;
  const scenarioParts: string[] = [];
  if (applied.incomePct !== 100) {
    const diff = applied.incomePct - 100;
    scenarioParts.push(`Einnahmen ${diff > 0 ? '+' : ''}${diff} %`);
  }
  if (applied.excludeCategoryId !== null) {
    const name = rootExpenseCats.find((c) => c.id === applied.excludeCategoryId)?.name;
    if (name) scenarioParts.push(`ohne Kategorie „${name}“`);
  }

  const applyScenario = () => {
    setApplied({
      incomePct,
      excludeCategoryId: excludeCat === 'none' ? null : Number(excludeCat),
    });
  };
  const resetScenario = () => {
    setIncomePct(100);
    setExcludeCat('none');
    setApplied({ incomePct: 100, excludeCategoryId: null });
  };

  const chartData = [
    ...(balance.data?.history ?? []).map((h) => ({
      month: formatMonth(h.month).slice(0, 3) + ` '${h.month.slice(2, 4)}`,
      Ist: Math.round(h.balance / 100),
    })),
    ...(balance.data?.projection ?? []).map((p) => ({
      month: formatMonth(p.month).slice(0, 3) + ` '${p.month.slice(2, 4)}`,
      Prognose: Math.round(p.balance / 100),
    })),
  ];
  // Verbindungspunkt: letzter Ist-Wert auch als Prognose-Start
  const hist = balance.data?.history ?? [];
  if (hist.length > 0 && balance.data) {
    const last = hist[hist.length - 1];
    chartData[hist.length - 1] = {
      ...chartData[hist.length - 1],
      Prognose: Math.round(last.balance / 100),
    };
  }

  const endBalance = balance.data?.projection[balance.data.projection.length - 1]?.balance;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Prognosen</h1>
          <p className="text-sm text-muted-foreground">
            Hochrechnungen auf Basis deiner Buchungen und Dauerbuchungen
          </p>
        </div>
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="6">6 Monate voraus</SelectItem>
            <SelectItem value="12">12 Monate voraus</SelectItem>
            <SelectItem value="24">24 Monate voraus</SelectItem>
            <SelectItem value="36">36 Monate voraus</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-violet-500" />
                Szenario
              </CardTitle>
              <CardDescription>
                Was-wäre-wenn: wirkt nur auf künftige Dauerbuchungen — Ist-Werte und Historie bleiben unverändert
              </CardDescription>
            </div>
            {scenarioActive && (
              <Badge variant="secondary">Szenario: {scenarioParts.join(', ')}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Einnahmen (Dauerbuchungen)</span>
                <span className="font-medium">{incomePct} %</span>
              </div>
              <Slider
                value={[incomePct]}
                onValueChange={(v) => setIncomePct(v[0])}
                min={50}
                max={200}
                step={5}
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">Ausgabenkategorie weglassen</span>
              <Select value={excludeCat} onValueChange={setExcludeCat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine</SelectItem>
                  {rootExpenseCats.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={applyScenario}>Szenario anwenden</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={resetScenario}
              disabled={!scenarioActive && incomePct === 100 && excludeCat === 'none'}
            >
              Zurücksetzen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LineChartIcon className="h-5 w-5 text-emerald-600" />
                Kontostand-Prognose
              </CardTitle>
              <CardDescription>
                Gesamtvermögen: 6 Monate zurück + Projektion (Dauerbuchungen + durchschnittliche variable Ausgaben der letzten 3 Monate)
              </CardDescription>
            </div>
            {endBalance !== undefined && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Voraussichtlich in {months} Monaten</div>
                <div className={cn('text-xl font-bold', endBalance < 0 ? 'text-destructive' : 'text-emerald-600')}>
                  {formatCents(endBalance)}
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="h-80">
          {balance.isLoading ? (
            <p className="text-sm text-muted-foreground">Prognose wird berechnet…</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k ${currencySymbol()}`} width={70} />
                <Tooltip formatter={(value: number | string) => `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="Ist" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="Prognose" stroke="#6366f1" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
        {balance.data && (
          <CardContent className="border-t pt-4">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Ø variable Einnahmen/Monat: </span>
                <span className="font-medium text-emerald-600">+{formatCents(balance.data.avgVariableIncome)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Ø variable Ausgaben/Monat: </span>
                <span className="font-medium text-rose-500">−{formatCents(balance.data.avgVariableExpense)}</span>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Budget-Hochrechnung
            </CardTitle>
            <CardDescription>Wohin steuern die Ausgaben bis Monatsende?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(budgetFc.data ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Keine Budgets angelegt.</p>
            )}
            {(budgetFc.data ?? []).map((b) => {
              const pct = b.budget > 0 ? Math.min(100, Math.round((b.projected / b.budget) * 100)) : 0;
              return (
                <div key={b.categoryId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                      {b.categoryName}
                    </span>
                    <span className={cn('font-semibold', b.willExceed ? 'text-destructive' : 'text-muted-foreground')}>
                      {formatCents(b.projected)} / {formatCents(b.budget)}
                      {b.willExceed && <Badge variant="destructive" className="ml-2 text-[10px]">Überschreitung</Badge>}
                    </span>
                  </div>
                  <Progress
                    value={pct}
                    className={cn(b.willExceed ? '[&>div]:bg-destructive' : pct >= 80 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-600')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Bisher {formatCents(b.spent)} ausgegeben
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-sky-500" />
              Sparziel-Prognose
            </CardTitle>
            <CardDescription>
              Wann sind die Ziele erreicht — bei aktueller Sparrate von{' '}
              {goalFc.data?.[0] ? formatCents(goalFc.data[0].monthlySurplus) : '…'}/Monat?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(goalFc.data ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Keine Sparziele angelegt.</p>
            )}
            {(goalFc.data ?? []).map((g) => {
              const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100)) : 0;
              return (
                <div key={g.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{g.name}</span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {g.etaMonth === 'Erreicht'
                        ? <Badge className="bg-emerald-600 text-[10px]">Erreicht</Badge>
                        : g.etaMonth
                          ? <span>voraussichtlich <span className="font-medium text-foreground">{formatMonth(g.etaMonth)}</span></span>
                          : <span>bei aktueller Sparrate nicht erreichbar</span>}
                    </span>
                  </div>
                  <Progress value={pct} style={{ ['--progress-color' as string]: g.color }} className="[&>div]:bg-[var(--progress-color)]" />
                  <p className="text-xs text-muted-foreground">
                    Noch {formatCents(g.remaining)} offen
                    {g.deadline ? ` · Stichtag ${new Date(`${g.deadline}T12:00:00`).toLocaleDateString(getUserLocale())}` : ''}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
