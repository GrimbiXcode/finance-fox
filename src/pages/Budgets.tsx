import { useState, type ReactNode } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import BudgetMeter from '@/components/BudgetMeter';
import BudgetDetail from '@/components/BudgetDetail';
import InfoTip from '@/components/InfoTip';
import { Link } from 'react-router';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import {
  amountPlaceholder, currencySymbol, formatAmountInput, formatCents, parseEuro, todayISO,
} from '@/lib/finance';
import { budgetPace, periodElapsed } from '@contracts/planning';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { CHART } from '@/lib/chartColors';
import { pencil } from '@/lib/pencil';

type Period = 'monthly' | 'yearly';
type BudgetStatus = {
  budget: { id: number; categoryId: number; amount: number; period: Period; rollover: boolean };
  spent: number;
  effectiveLimit: number;
  remaining: number;
  percent: number;
};

/**
 * Dialog zum Anlegen und Bearbeiten eines Budgets. `setBudget` arbeitet als
 * Upsert pro Kategorie — im Bearbeiten-Modus ist die Kategorie deshalb fest.
 */
function BudgetDialog({
  budget,
  initialCategoryId,
  usedCategoryIds,
  trigger,
}: {
  budget?: BudgetStatus['budget'];
  /** Vorauswahl beim Anlegen (z. B. aus „Ohne Budget“) */
  initialCategoryId?: number;
  usedCategoryIds: Set<number>;
  trigger: ReactNode;
}) {
  const { categories } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const isEdit = budget !== undefined;
  const [open, setOpen] = useState(false);
  const initialCategory = budget?.categoryId ?? initialCategoryId;
  const [categoryId, setCategoryId] = useState(initialCategory ? String(initialCategory) : '');
  const [amount, setAmount] = useState(budget ? formatAmountInput(budget.amount) : '');
  const [period, setPeriod] = useState<Period>(budget?.period ?? 'monthly');
  const [rollover, setRollover] = useState(budget?.rollover ?? false);

  const reset = () => {
    if (isEdit) return;
    setCategoryId(initialCategoryId ? String(initialCategoryId) : '');
    setAmount(''); setPeriod('monthly'); setRollover(false);
  };

  // Vorschläge aus den bisherigen Ausgaben: ein Budget, das nie passt, wird
  // ignoriert — eines unter dem Durchschnitt ist nach einer Woche rot
  const stats = trpc.analysis.categoryStats.useQuery(
    { categoryId: Number(categoryId) },
    { enabled: open && Number(categoryId) > 0 },
  );
  const factor = period === 'yearly' ? 12 : 1;
  const suggestions = stats.data && stats.data.average6 > 0
    ? [
        { label: 'Ø 3 Monate', value: stats.data.average3 * factor },
        { label: 'Ø 6 Monate', value: stats.data.average6 * factor },
        { label: 'Höchster Monat', value: stats.data.max * factor },
      ].filter((x) => x.value > 0)
    : [];

  const setBudget = trpc.finance.setBudget.useMutation({
    onSuccess: () => {
      toast.success('Budget gespeichert.');
      invalidate();
      setOpen(false);
      reset();
    },
    onError: (err) => toast.error(err.message),
  });

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  // Gruppiert: Oberkategorien mit eingerückten Unterkategorien (Budgets auf
  // Oberkategorien werten ihre Unterkategorien mit aus)
  const groupedCategories = expenseCategories
    .filter((c) => c.parentId === null)
    .flatMap((root) => [root, ...expenseCategories.filter((c) => c.parentId === root.id)]);
  const categoryName = categories.find((c) => c.id === budget?.categoryId)?.name;

  const submit = () => {
    const cents = parseEuro(amount);
    if (!categoryId || cents <= 0) { toast.error('Kategorie und Betrag angeben.'); return; }
    setBudget.mutate({
      categoryId: Number(categoryId), amount: cents, period,
      rollover: period === 'monthly' ? rollover : false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Budget „${categoryName ?? ''}“ bearbeiten` : 'Neues Budget'}</DialogTitle>
          <DialogDescription>
            Ein Limit pro Ausgabenkategorie — Unterkategorien zählen zur Oberkategorie.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {!isEdit && (
            <div className="space-y-2">
              <Label>Kategorie</Label>
              <SearchableSelect
                value={categoryId}
                onValueChange={setCategoryId}
                placeholder="Kategorie wählen"
                options={groupedCategories.map((c) => ({
                  value: String(c.id),
                  // Unterkategorien eingerückt; Suffix bei bestehendem Budget
                  label: `${c.parentId ? '  ' : ''}${c.name}${usedCategoryIds.has(c.id) ? ' (überschreiben)' : ''}`,
                }))}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Zeitraum</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger
                  className="w-full min-w-0 [&>span]:truncate"
                  title={period === 'monthly' ? 'Monat' : 'Jahr'}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monat</SelectItem>
                  <SelectItem value="yearly">Jahr</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Limit pro {period === 'monthly' ? 'Monat' : 'Jahr'} ({currencySymbol()})</Label>
              <Input inputMode="decimal" placeholder={amountPlaceholder} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Bisher ausgegeben{period === 'yearly' ? ' (hochgerechnet aufs Jahr)' : ''} — antippen zum Übernehmen:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((x) => (
                  <Button
                    key={x.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setAmount(formatAmountInput(x.value))}
                  >
                    {x.label}: <span className="ml-1 font-mono tabular-nums">{formatCents(x.value)}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          {stats.data && stats.data.average6 === 0 && (
            <p className="text-xs text-muted-foreground">In den letzten sechs Monaten keine Ausgaben in dieser Kategorie.</p>
          )}
          {period === 'monthly' && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`rollover-${budget?.id ?? 'neu'}`}
                checked={rollover}
                onCheckedChange={(checked) => setRollover(checked === true)}
              />
              <Label htmlFor={`rollover-${budget?.id ?? 'neu'}`} className="cursor-pointer font-normal">
                Nicht verbrauchtes Budget in den Folgemonat übertragen (Rollover)
              </Label>
              <InfoTip term="rollover" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button onClick={submit} disabled={setBudget.isPending}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Verbleibende Tage (inkl. heute) bzw. Monate (inkl. laufendem) im Zeitraum */
function remainingUnits(period: Period, today: string): number {
  const [y, m, d] = today.split('-').map(Number);
  if (period === 'monthly') return new Date(y, m, 0).getDate() - d + 1;
  return 12 - m + 1;
}

function BudgetCard({
  status, usedCategoryIds, today,
}: {
  status: BudgetStatus;
  usedCategoryIds: Set<number>;
  today: string;
}) {
  const { categories } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [showDetail, setShowDetail] = useState(false);
  const deleteBudget = trpc.finance.deleteBudget.useMutation({
    onSuccess: () => { toast.success('Budget gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const b = status.budget;
  const cat = categories.find((c) => c.id === b.categoryId);
  const used = status.spent;
  const limit = status.effectiveLimit;
  const elapsed = periodElapsed(b.period, today);
  const pace = budgetPace(used, limit, elapsed);
  const plan = Math.round(limit * elapsed);
  const units = remainingUnits(b.period, today);
  const perUnit = status.remaining > 0 ? Math.floor(status.remaining / units) : 0;
  const unitLabel = b.period === 'monthly' ? 'Tag' : 'Monat';
  const periodLabel = b.period === 'monthly' ? 'Monat' : 'Jahr';
  const carryover = b.period === 'monthly' && b.rollover && limit !== b.amount;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: pencil(cat?.color) ?? CHART.muted }} />
          <div className="min-w-0">
            <CardTitle className="truncate text-base" title={cat?.name}>{cat?.name ?? 'Unbekannt'}</CardTitle>
            <CardDescription>
              Limit: {formatCents(limit)} / {periodLabel}
              {b.period === 'monthly' && b.rollover && ' · inkl. Übertrag'}
            </CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <BudgetDialog
            key={`${b.id}:${b.amount}:${b.period}:${b.rollover}`}
            budget={b}
            usedCategoryIds={usedCategoryIds}
            trigger={
              <Button variant="ghost" size="icon" title="Budget bearbeiten">
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" title="Budget löschen">
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Budget „{cat?.name}“ löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Das Limit von {formatCents(b.amount)} pro {periodLabel} wird entfernt.
                  Die Buchungen der Kategorie bleiben unverändert.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteBudget.isPending}
                  onClick={() => deleteBudget.mutate({ id: b.id })}
                >
                  Löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('font-serif text-xl font-semibold tabular-nums', pace === 'over' && 'text-destructive')}>
            {formatCents(used)}
          </span>
          <span className={cn(
            'whitespace-nowrap text-sm font-medium tabular-nums',
            pace === 'over' ? 'text-destructive' : pace === 'fast' ? 'text-warning' : 'text-muted-foreground',
          )}>
            {pace === 'over' ? `+${formatCents(used - limit)} überschritten` : `${status.percent} %`}
          </span>
        </div>
        <BudgetMeter percent={status.percent} elapsed={elapsed} pace={pace} period={b.period} />
        <p className="text-xs text-muted-foreground">
          {pace === 'over' && 'Budget überschritten'}
          {pace === 'fast' && (
            <span className="text-warning">
              Zu schnell: {formatCents(used - plan)} über Plan
            </span>
          )}
          {pace === 'ok' && 'Im Plan'}
          {pace !== 'over' && status.remaining > 0 && (
            <> · noch {formatCents(status.remaining)}, {formatCents(perUnit)} pro {unitLabel}</>
          )}
          {carryover && ' (inkl. Übertrag aus Vormonaten)'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
          aria-expanded={showDetail}
          onClick={() => setShowDetail((v) => !v)}
        >
          <ChevronDown className={cn('mr-1 h-3.5 w-3.5 transition-transform', showDetail && 'rotate-180')} />
          {showDetail ? 'Weniger' : 'Verlauf & Details'}
        </Button>
        {/* Query erst beim Aufklappen */}
        {showDetail && <BudgetDetail budgetId={b.id} categoryId={b.categoryId} />}
      </CardContent>
    </Card>
  );
}

function sumLine(list: BudgetStatus[]) {
  const spent = list.reduce((s, x) => s + x.spent, 0);
  const limit = list.reduce((s, x) => s + x.effectiveLimit, 0);
  return `${formatCents(spent)} von ${formatCents(limit)}`;
}

/**
 * Wie viel der Ausgaben dieses Monats deckt kein Budget ab? Budgets helfen
 * nur dort, wo sie existieren — die größten Lücken mit Direkt-Anlage.
 */
function CoverageCard({ usedCategoryIds }: { usedCategoryIds: Set<number> }) {
  const { categories } = useFinanceData();
  const query = trpc.analysis.budgetCoverage.useQuery();
  const d = query.data;
  if (!d || d.total === 0) return null;
  const share = Math.round((d.uncovered / d.total) * 100);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Ohne Budget</CardTitle>
        <CardDescription className="tabular-nums">
          {d.uncovered === 0
            ? `Alle Ausgaben dieses Monats (${formatCents(d.total)}) liegen in Kategorien mit Budget.`
            : `${formatCents(d.uncovered)} von ${formatCents(d.total)} (${share} %) der Ausgaben dieses Monats liegen in keinem Budget.`}
        </CardDescription>
      </CardHeader>
      {d.top.length > 0 && (
        <CardContent>
          <ul className="divide-y text-sm">
            {d.top.map((row) => {
              const cat = categories.find((c) => c.id === row.categoryId);
              const link = `/transaktionen?${new URLSearchParams({ monat: d.month, typ: 'expense', kategorie: String(row.categoryId), sicht: 'haushalt' })}`;
              return (
                <li key={row.categoryId} className="flex items-center gap-2 py-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(cat?.color) ?? CHART.muted }} />
                  <Link to={link} className="min-w-0 flex-1 truncate hover:underline" title={row.name}>{row.name}</Link>
                  <span className="shrink-0 font-mono tabular-nums">{formatCents(row.amount)}</span>
                  {/* Ohne Kategorie lässt sich kein Budget anlegen */}
                  {row.categoryId > 0 && cat?.type === 'expense' ? (
                    <BudgetDialog
                      initialCategoryId={row.categoryId}
                      usedCategoryIds={usedCategoryIds}
                      trigger={
                        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs text-stamp">
                          <Plus className="mr-1 h-3.5 w-3.5" /> Budget
                        </Button>
                      }
                    />
                  ) : <span className="w-[4.75rem] shrink-0" />}
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

export default function Budgets() {
  const statusQuery = trpc.finance.listBudgetStatus.useQuery();
  const statuses = (statusQuery.data ?? []) as BudgetStatus[];
  const usedCategoryIds = new Set(statuses.map((s) => s.budget.categoryId));
  const today = todayISO();
  // Kritischste zuerst — nach Auslastung absteigend
  const byUsage = (a: BudgetStatus, b: BudgetStatus) => b.percent - a.percent;
  const monthly = statuses.filter((s) => s.budget.period === 'monthly').sort(byUsage);
  const yearly = statuses.filter((s) => s.budget.period === 'yearly').sort(byUsage);

  const section = (title: string, list: BudgetStatus[]) => list.length > 0 && (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{sumLine(list)} ausgegeben</span>
      </div>
      {/* items-start: ein aufgeklappter Verlauf streckt die Nachbarkarten nicht */}
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((s) => (
          <BudgetCard key={s.budget.id} status={s} usedCategoryIds={usedCategoryIds} today={today} />
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Budgets</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {statuses.length === 0
              ? 'Limits pro Ausgabenkategorie'
              : [
                  monthly.length > 0 && `Monat: ${sumLine(monthly)}`,
                  yearly.length > 0 && `Jahr: ${sumLine(yearly)}`,
                ].filter(Boolean).join(' · ')}
          </p>
        </div>
        <BudgetDialog
          usedCategoryIds={usedCategoryIds}
          trigger={<Button><Plus className="mr-2 h-4 w-4" /> Neues Budget</Button>}
        />
      </div>

      {statuses.length === 0 && !statusQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-muted-foreground">
            <p>
              Noch keine Budgets angelegt. Ein Budget setzt ein monatliches oder
              jährliches Limit pro Ausgabenkategorie und zeigt, ob du im Plan liegst.
            </p>
            <BudgetDialog
              usedCategoryIds={usedCategoryIds}
              trigger={<Button variant="outline"><Plus className="mr-2 h-4 w-4" /> Erstes Budget anlegen</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {section('Monatsbudgets', monthly)}
          {section('Jahresbudgets', yearly)}
        </>
      )}
      {/* Auch ohne Budgets: zeigt, wo die Ausgaben liegen, mit Direkt-Anlage */}
      {!statusQuery.isLoading && <CoverageCard usedCategoryIds={usedCategoryIds} />}
    </div>
  );
}
