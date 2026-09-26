import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import {
  AlertCircle, AlertTriangle, ArrowRight, Banknote, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Info,
  PiggyBank, Scale, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { budgetPace, percentChange, periodElapsed, requiredMonthlyRate, shiftMonth } from '@contracts/planning';
import { useFinanceData } from '@/lib/data';
import {
  currentMonthKey, formatCents, formatDate, formatMonth, formatMonthShort, getUserLocale, todayISO,
} from '@/lib/finance';
import { attentionEntry } from '@/lib/attention';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_GROUPS } from '@/lib/auditLabels';
import TransactionDialog from '@/components/TransactionDialog';
import GettingStarted from '@/components/GettingStarted';
import BudgetMeter from '@/components/BudgetMeter';
import KpiCard from '@/components/KpiCard';
import { useOffline } from '@/providers/offline';
import { useScope } from '@/providers/scope';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { CHART } from '@/lib/chartColors';
import {
  AXIS_MONEY_WIDTH, AXIS_PROPS, axisMoney, CURSOR_LINE, GRID_PROPS, HATCH_OPACITY, SHEET,
  activeDotFor, dotFor, hatch, moneyLabel,
} from '@/lib/chartTheme';
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
    const good = (diff > 0) === higherIsGood;
    return (
      <span className={cn('whitespace-nowrap tabular-nums', good ? 'text-positive' : 'text-negative')}>
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

/** Kennzahl-Karte; `to` macht den Betrag zum Link auf die Buchungen dahinter */
function Kpi({
  title, icon, value, tone, to, children,
}: {
  title: string;
  icon: ReactNode;
  value: number;
  tone?: 'positive' | 'negative' | 'auto';
  to?: string;
  children?: ReactNode;
}) {
  const color = tone === 'positive' ? 'text-positive'
    : tone === 'negative' ? 'text-negative'
      : tone === 'auto' ? (value < 0 ? 'text-negative' : 'text-positive')
        : value < 0 ? 'text-destructive' : '';
  return (
    <KpiCard title={title} icon={icon} value={formatCents(value)} valueClassName={color} to={to}>
      {children}
    </KpiCard>
  );
}

const SEVERITY_ICON = {
  bad: <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-negative" />,
  warn: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />,
  info: <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />,
};

/**
 * „Was ansteht“: alles, was Aufmerksamkeit braucht, an einem Ort — Budgets,
 * Bargeld, Dauerbuchungen, Ausgleich, Sparziele, Hypotheken,
 * Versicherungen (Server, `dashboard.attention`) plus Abgleich-Konflikte
 * dieses Geräts. Jede Zeile führt zur Stelle, an der man handelt.
 */
function AttentionCard({ names }: { names: Map<number, string> }) {
  const attention = trpc.dashboard.attention.useQuery();
  const { status } = useOffline();
  const [showAll, setShowAll] = useState(false);

  const entries = (attention.data ?? []).map((item) => ({
    severity: item.severity,
    ...attentionEntry(item, names),
  }));
  if ((status?.conflicts ?? 0) > 0) {
    entries.unshift({
      severity: 'warn',
      text: `${status!.conflicts} ${status!.conflicts === 1 ? 'Datensatz wurde' : 'Datensätze wurden'} unterwegs und zuhause verschieden geändert — bitte entscheiden.`,
      to: '/abgleich',
    });
  }
  const LIMIT = 6;
  const visible = showAll ? entries : entries.slice(0, LIMIT);

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Was ansteht</CardTitle>
        <CardDescription>Was heute Aufmerksamkeit braucht — jede Zeile führt zur passenden Stelle</CardDescription>
      </CardHeader>
      <CardContent>
        {attention.isLoading ? (
          <p className="text-sm text-muted-foreground">Wird geprüft…</p>
        ) : attention.isError ? (
          // Nie „alles im grünen Bereich“ melden, wenn gar nicht geprüft wurde
          <p className="flex items-center gap-2 text-sm text-negative">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Die Hinweise konnten nicht geladen werden: {attention.error.message}
          </p>
        ) : entries.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-positive/30 bg-positive/5 px-4 py-3 text-sm text-positive">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Alles im grünen Bereich — nichts, was gerade Aufmerksamkeit braucht.
          </div>
        ) : (
          <ul className="space-y-1">
            {visible.map((e, i) => (
              <li key={`${e.to}-${i}`}>
                <Link
                  to={e.to}
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  {SEVERITY_ICON[e.severity]}
                  <span className="min-w-0 flex-1">{e.text}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-stamp opacity-70 group-hover:opacity-100">
                    {e.action}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </li>
            ))}
            {entries.length > LIMIT && (
              <li>
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? 'Weniger anzeigen' : `+ ${entries.length - LIMIT} weitere`}
                </button>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Die kritischsten Budgets als schmale Balken mit Zeitmarke */
function BudgetsCard() {
  const { categories } = useFinanceData();
  const statuses = trpc.finance.listBudgetStatus.useQuery().data ?? [];
  const today = todayISO();
  const top = [...statuses].sort((a, b) => b.percent - a.percent).slice(0, 5);
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>Budgets</CardTitle>
          <CardDescription>Stand heute — der Strich zeigt den Zeitplan</CardDescription>
        </div>
        <Link to="/budgets" className="shrink-0 text-sm text-stamp hover:underline">Alle</Link>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Noch keine Budgets — ein Limit pro Kategorie zeigt, ob du im Plan liegst.</p>
            <Button asChild variant="outline" size="sm"><Link to="/budgets">Erstes Budget anlegen</Link></Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {top.map((s) => {
              const cat = categories.find((c) => c.id === s.budget.categoryId);
              const period = s.budget.period === 'yearly' ? 'yearly' : 'monthly';
              const elapsed = periodElapsed(period, today);
              const pace = budgetPace(s.spent, s.effectiveLimit, elapsed);
              return (
                <li key={s.budget.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(cat?.color) ?? CHART.muted }} />
                      <span className="truncate">{cat?.name ?? '?'}</span>
                      {period === 'yearly' && <span className="text-xs text-muted-foreground">Jahr</span>}
                    </span>
                    <span className={cn(
                      'shrink-0 whitespace-nowrap font-mono text-xs tabular-nums',
                      pace === 'over' ? 'text-negative' : pace === 'fast' ? 'text-warning' : 'text-muted-foreground',
                    )}>
                      {formatCents(s.spent)} / {formatCents(s.effectiveLimit)}
                    </span>
                  </div>
                  <BudgetMeter percent={s.percent} elapsed={elapsed} pace={pace} period={period} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ACCOUNT_ICONS: Record<string, typeof Wallet> = { checking: CreditCard, cash: Banknote, savings: PiggyBank };

/**
 * Konten auf einen Blick: Saldo je sichtbarem Konto, Minus hervorgehoben,
 * Privatkonten markiert. Ein Klick öffnet die Kontenseite mit dem
 * Saldo-Verlauf dieses Kontos.
 */
function AccountsCard() {
  const { accounts } = useFinanceData();
  const LIMIT = 8;
  // Konten im Minus zuerst — genau die sollen nicht hinter „+ N weitere“
  // verschwinden; dann nach Saldo
  const sorted = [...accounts].sort(
    (a, b) => Number(b.balance < 0) - Number(a.balance < 0) || b.balance - a.balance,
  );
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Konten</CardTitle>
        <Link to="/konten" className="shrink-0 text-sm text-stamp hover:underline">Alle</Link>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Konten.</p>
        ) : (
          <ul className="divide-y text-sm">
            {sorted.slice(0, LIMIT).map((a) => {
              const Icon = ACCOUNT_ICONS[a.type] ?? Wallet;
              return (
                <li key={a.id}>
                  <Link
                    to={`/konten?verlauf=${a.id}`}
                    className="flex items-center gap-2 py-1.5 hover:bg-muted/40"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" title={a.name}>{a.name}</span>
                    {a.owners.length > 0 && <Badge variant="stamp" tone="ink">Privat</Badge>}
                    <span className={cn('shrink-0 font-mono tabular-nums', a.balance < 0 && 'text-negative')}>
                      {formatCents(a.balance)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {sorted.length > LIMIT && (
          <p className="pt-2 text-xs text-muted-foreground">+ {sorted.length - LIMIT} weitere Konten</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Sparziele auf dem Dashboard: bis zu drei offene Ziele mit Zielbetrag,
 * nächster Stichtag zuerst. Balken in der Zielfarbe, dazu die Prognose
 * („erreicht im …“) oder die nötige Monatsrate, wenn es sonst nicht reicht.
 */
function GoalsCard() {
  const { goals } = useFinanceData();
  const forecastQuery = trpc.forecast.goalForecast.useQuery();
  const forecast = forecastQuery.data;
  const byGoal = new Map((forecast ?? []).map((f) => [f.goalId, f]));
  const today = todayISO();
  const active = goals
    .filter((g) => g.archivedAt === null && g.targetAmount !== null && g.totalSaved < g.targetAmount)
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || (b.percent ?? 0) - (a.percent ?? 0))
    .slice(0, 3);
  if (active.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Sparziele</CardTitle>
        <Link to="/sparziele" className="shrink-0 text-sm text-stamp hover:underline">Alle</Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.map((g) => {
          const fc = byGoal.get(g.id);
          // Erst mit Prognose urteilen (sonst blitzt kurz eine Rate auf) und
          // nie bei verborgenen Quellen: Der Partner spart dort vielleicht
          // längst mit — wie in „Was ansteht“
          const late = !!forecast && !g.hasHiddenSources && !!g.deadline &&
            (!fc?.etaMonth || fc.etaMonth > g.deadline.slice(0, 7));
          const rate = late ? requiredMonthlyRate(g.targetAmount! - g.totalSaved, g.deadline!, today) : null;
          return (
            <div key={g.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium" title={g.name}>{g.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatCents(g.totalSaved)} / {formatCents(g.targetAmount!)}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar" aria-valuenow={g.percent ?? 0} aria-valuemin={0} aria-valuemax={100}
                aria-label={`${g.name}: ${g.percent ?? 0} %`}
              >
                <div className="h-full rounded-full" style={{ width: `${g.percent ?? 0}%`, backgroundColor: pencil(g.color) }} />
              </div>
              <p className={cn('text-xs', rate ? 'text-warning' : 'text-muted-foreground')}>
                {g.percent ?? 0} %
                {rate
                  ? ` · bis ${formatDate(g.deadline!)} nötig: ${formatCents(rate)} pro Monat`
                  : g.hasHiddenSources
                    ? ' · enthält Quellen, die du nicht siehst'
                    : fc?.etaMonth
                      ? ` · erreicht voraussichtlich im ${formatMonth(fc.etaMonth)}`
                      : ''}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const HOUSEHOLD_ENTITIES = AUDIT_ENTITY_GROUPS
  .filter(([key]) => !['user', 'settings', 'pension'].includes(key))
  .flatMap(([, , entities]) => entities);
const activityTime = (d: Date) => {
  if (d.toDateString() === new Date().toDateString()) {
    return `heute ${d.toLocaleTimeString(getUserLocale(), { hour: '2-digit', minute: '2-digit' })}`;
  }
  // Lokales Datum — toISOString wäre UTC und kurz nach Mitternacht falsch
  const pad = (n: number) => String(n).padStart(2, '0');
  return formatDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
};

/**
 * „Zuletzt im Haushalt“: was die anderen zuletzt gebucht oder geändert
 * haben — damit man nicht doppelt erfasst und Änderungen mitbekommt. Nur in
 * Haushalten mit mehr als einer Person; Einträge, die man nicht sehen darf,
 * filtert der Server.
 */
function HouseholdActivityCard() {
  const query = trpc.finance.listAuditLog.useQuery({ limit: 5, othersOnly: true, entities: HOUSEHOLD_ENTITIES });
  const entries = query.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Zuletzt im Haushalt</CardTitle>
        <Link to="/verlauf" className="shrink-0 text-sm text-stamp hover:underline">Verlauf</Link>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query.isLoading ? 'Lade…' : 'Von den anderen gibt es noch keine Einträge.'}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(e.userColor) ?? CHART.muted }} />
                <div className="min-w-0">
                  <div>
                    <span className="font-medium">{e.userName ?? 'System'}</span>{' '}
                    {AUDIT_ACTION_LABELS[e.action] ?? e.action}
                  </div>
                  <div className="truncate text-xs text-muted-foreground" title={e.detail}>
                    {activityTime(new Date(e.createdAt))}{e.detail ? ` · ${e.detail}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { categories, users } = useFinanceData();
  const navigate = useNavigate();
  // Liegenschaften/Hypotheken für die Zusatzzeile im Gesamtvermögen
  const mortgage = trpc.mortgage.summary.useQuery().data;
  // Fehlen Privatkonten anderer in der Summe? Dann ehrliches Label (H1)
  const visibility = trpc.finance.accountVisibility.useQuery().data;
  // Gewählter Monat steht in der URL (`#/?monat=2026-08`) — Standard: aktueller
  const [params, setParams] = useSearchParams();
  const thisMonth = currentMonthKey();
  const requested = params.get('monat');
  const month = requested && /^\d{4}-\d{2}$/.test(requested) && requested <= thisMonth ? requested : thisMonth;
  const isCurrent = month === thisMonth;
  const setMonth = (key: string) =>
    setParams(key === thisMonth ? {} : { monat: key }, { replace: true });
  const prevMonth = shiftMonth(month, -1);

  // Vorherigen Monat stehen lassen, bis der neue geladen ist — sonst blinkt
  // beim Blättern die ganze Seite
  const { userId: scopeUserId } = useScope();
  const summaryQuery = trpc.dashboard.summary.useQuery(
    { month, today: todayISO(), userId: scopeUserId },
    { placeholderData: keepPreviousData },
  );
  const summary = summaryQuery.data;
  const names = new Map(users.map((u) => [u.id, u.name]));

  const txLink = (extra: Record<string, string> = {}) =>
    `/transaktionen?${new URLSearchParams({ monat: month, ...extra })}`;

  if (!summary) {
    return summaryQuery.error
      ? <p className="text-destructive">{summaryQuery.error.message}</p>
      : <p className="text-muted-foreground">Daten werden geladen…</p>;
  }

  const totals = summary.totals.current;
  const savings = totals.income - totals.expense;
  const savingsOf = (t: { income: number; expense: number }) => t.income - t.expense;
  const cashflow = summary.cashflow.map((c) => ({
    key: c.month,
    month: formatMonthShort(c.month),
    Einnahmen: c.income / 100,
    Ausgaben: c.expense / 100,
  }));
  const categoryData = summary.categories.map((c) => ({ ...c, value: c.amount / 100 }));
  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0);
  const balances = new Map(summary.memberBalances.map((b) => [b.userId, b.amount]));

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
              {scopeUserId !== undefined && ' · Meine Sicht'}
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          title={visibility?.hasHidden ? 'Sichtbares Vermögen' : 'Gesamtvermögen'}
          icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
          value={summary.balance.current}
          to="/konten"
        >
          <p className="text-xs text-muted-foreground">
            {isCurrent
              ? `${summary.accountCount} ${summary.accountCount === 1 ? 'Konto' : 'Konten'}`
              : `Stand Ende ${formatMonth(month)}`}
            {visibility?.hasHidden && ' · ohne private Konten anderer'}
            {(visibility?.readOnly ?? 0) > 0 && ` · davon ${visibility!.readOnly} nur lesend`}
          </p>
          <Change
            current={summary.balance.current} previous={summary.balance.previous}
            previousYear={summary.balance.previousYear} higherIsGood month={month}
          />
          {isCurrent && mortgage && mortgage.count > 0 && (
            <p className="text-xs text-muted-foreground" title="Kontosalden plus Verkehrswert der Liegenschaften minus Restschuld">
              inkl. Immobilie: {formatCents(summary.balance.current + mortgage.equity)}
            </p>
          )}
        </Kpi>
        <Kpi
          title="Einnahmen (Monat)"
          icon={<TrendingUp className="h-4 w-4 text-positive" />}
          value={totals.income}
          tone="positive"
          to={txLink({ typ: 'income' })}
        >
          <Change
            current={totals.income} previous={summary.totals.previous.income}
            previousYear={summary.totals.previousYear.income} higherIsGood month={month}
          />
        </Kpi>
        <Kpi
          title="Ausgaben (Monat)"
          icon={<TrendingDown className="h-4 w-4 text-negative" />}
          value={totals.expense}
          tone="negative"
          to={txLink({ typ: 'expense' })}
        >
          <Change
            current={totals.expense} previous={summary.totals.previous.expense}
            previousYear={summary.totals.previousYear.expense} higherIsGood={false} month={month}
          />
        </Kpi>
        <Kpi
          title="Sparrate (Monat)"
          icon={<Scale className="h-4 w-4 text-muted-foreground" />}
          value={savings}
          tone="auto"
        >
          <p className="text-xs text-muted-foreground">
            {totals.income > 0 ? `${Math.round((savings / totals.income) * 100)} % der Einnahmen` : 'Keine Einnahmen'}
          </p>
          <Change
            current={savings} previous={savingsOf(summary.totals.previous)}
            previousYear={savingsOf(summary.totals.previousYear)} higherIsGood month={month} asAmount
          />
        </Kpi>
      </div>

      {isCurrent && (
        <div className="grid gap-4 lg:grid-cols-5">
          <AttentionCard names={names} />
          <BudgetsCard />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Cashflow</CardTitle>
            <CardDescription>
              Einnahmen vs. Ausgaben der letzten 6 Monate{isCurrent ? '' : ` bis ${formatMonth(month)}`} — ein Klick zeigt die Buchungen des Monats
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
                <AreaChart
                  data={cashflow}
                  margin={{ left: 0, right: 8, top: 8 }}
                  className="cursor-pointer"
                  onClick={(state) => {
                    const index = state?.activeTooltipIndex;
                    const key = typeof index === 'number' ? cashflow[index]?.key : undefined;
                    if (key) navigate(`/transaktionen?monat=${key}`);
                  }}
                >
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
              <p className="text-sm text-muted-foreground">
                {isCurrent ? 'Noch keine Ausgaben in diesem Monat.' : `Keine Ausgaben im ${formatMonth(month)}.`}
              </p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {/* Ring mit Papierfugen, Summe in Serife in der Mitte */}
                <div className="relative h-52 w-52 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90}
                        stroke={SHEET} strokeWidth={2} className="cursor-pointer"
                        onClick={(entry: { categoryId?: number }) => {
                          if (entry?.categoryId !== undefined) {
                            navigate(txLink({ typ: 'expense', kategorie: String(entry.categoryId) }));
                          }
                        }}
                      >
                        {categoryData.map((entry, idx) => (
                          <Cell key={entry.name} fill={entry.color ? pencil(entry.color) : pencilSlot(idx + 1)} />
                        ))}
                      </Pie>
                      <Tooltip content={<PaperTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-serif text-[15px] font-semibold tabular-nums">{moneyLabel(categoryTotal)}</span>
                    <span className="text-[11px] text-muted-foreground">{formatMonth(month)}</span>
                  </div>
                </div>
                {/* Legende mit Betrag und Anteil – die Farbe allein trägt nie die Identität */}
                <ul className="w-full min-w-0 flex-1 text-xs">
                  {categoryData.slice(0, 6).map((entry, idx) => (
                    <li key={entry.name} className="border-b last:border-0">
                      {/* Klick führt zu den Buchungen der Kategorie in diesem Monat */}
                      <Link
                        to={txLink({ typ: 'expense', kategorie: String(entry.categoryId) })}
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

      {isCurrent && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <AccountsCard />
          <GoalsCard />
        </div>
      )}

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
              {summary.recent.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Noch keine Buchungen — lege mit „Neue Buchung“ los.
                </p>
              )}
              {summary.recent.map((t) => {
                const cat = categories.find((c) => c.id === t.categoryId);
                return (
                  <Link
                    key={t.id}
                    to={`/transaktionen?${new URLSearchParams({ monat: t.date.slice(0, 7), fokus: String(t.id) })}`}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pencil(cat?.color) ?? CHART.muted }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.note || cat?.name || 'Umbuchung'}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(t.date)} · {names.get(t.userId)}{t.shared ? ' · geteilt' : ''}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      'shrink-0 font-mono text-sm font-medium tabular-nums',
                      t.type === 'income' ? 'text-positive' : t.type === 'expense' ? 'text-negative' : 'text-muted-foreground',
                    )}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{formatCents(t.amount)}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
        <Card>
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
              <Link to="/aufteilung" className="block pt-2 text-xs text-stamp hover:underline">
                Details und Ausgleichsvorschläge unter „Aufteilung“
              </Link>
            </div>
          </CardContent>
        </Card>
        {users.length > 1 && <HouseholdActivityCard />}
        </div>
      </div>
    </div>
  );
}
