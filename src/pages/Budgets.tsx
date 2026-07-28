import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { amountPlaceholder, currencySymbol, formatCents, parseEuro } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function Budgets() {
  const { categories } = useFinanceData();
  const statusQuery = trpc.finance.listBudgetStatus.useQuery();
  const statuses = statusQuery.data ?? [];
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [rollover, setRollover] = useState(false);

  const setBudget = trpc.finance.setBudget.useMutation({
    onSuccess: () => {
      toast.success('Budget gespeichert.');
      invalidate();
      setOpen(false); setCategoryId(''); setAmount(''); setPeriod('monthly'); setRollover(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteBudget = trpc.finance.deleteBudget.useMutation({
    onSuccess: () => invalidate(),
  });

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  // Gruppiert: Oberkategorien mit eingerückten Unterkategorien (Budgets auf
  // Oberkategorien werten ihre Unterkategorien mit aus)
  const groupedCategories = expenseCategories
    .filter((c) => c.parentId === null)
    .flatMap((root) => [root, ...expenseCategories.filter((c) => c.parentId === root.id)]);
  const usedCategoryIds = new Set(statuses.map((s) => s.budget.categoryId));
  const totalBudget = statuses.reduce((s, x) => s + x.effectiveLimit, 0);
  const totalSpent = statuses.reduce((s, x) => s + x.spent, 0);

  const submit = () => {
    const cents = parseEuro(amount);
    if (!categoryId || cents <= 0) { toast.error('Kategorie und Betrag angeben.'); return; }
    setBudget.mutate({
      categoryId: Number(categoryId), amount: cents, period,
      rollover: period === 'monthly' ? rollover : false,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budgets</h1>
          <p className="text-sm text-muted-foreground">
            {formatCents(totalSpent)} von {formatCents(totalBudget)} ausgegeben
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neues Budget</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neues Budget</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Kategorie wählen" /></SelectTrigger>
                  <SelectContent>
                    {groupedCategories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.parentId ? `\u00A0\u00A0${c.name}` : c.name}
                        {usedCategoryIds.has(c.id) ? ' (überschreiben)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Zeitraum</Label>
                  <Select value={period} onValueChange={(v) => setPeriod(v as 'monthly' | 'yearly')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
              {period === 'monthly' && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rollover"
                    checked={rollover}
                    onCheckedChange={(checked) => setRollover(checked === true)}
                  />
                  <Label htmlFor="rollover" className="cursor-pointer font-normal">
                    Nicht verbrauchtes Budget in den Folgemonat übertragen (Rollover)
                  </Label>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={setBudget.isPending}>Speichern</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {statuses.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Noch keine Budgets angelegt. Lege ein monatliches oder jährliches Limit pro Ausgabenkategorie fest.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {statuses.map((s) => {
            const b = s.budget;
            const cat = categories.find((c) => c.id === b.categoryId);
            const used = s.spent;
            const limit = s.effectiveLimit;
            const pct = Math.min(100, s.percent);
            const over = used > limit;
            const carryover = b.period === 'monthly' && b.rollover && limit !== b.amount;
            return (
              <Card key={b.id}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cat?.color ?? '#94a3b8' }} />
                    <div>
                      <CardTitle className="text-base">{cat?.name ?? 'Unbekannt'}</CardTitle>
                      <CardDescription>
                        Limit: {formatCents(limit)} / {b.period === 'monthly' ? 'Monat' : 'Jahr'}
                        {b.period === 'monthly' && b.rollover && ' · inkl. Übertrag'}
                      </CardDescription>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteBudget.mutate({ id: b.id })} title="Budget löschen">
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className={cn('text-xl font-bold', over && 'text-destructive')}>{formatCents(used)}</span>
                    <span className={cn('text-sm font-medium', over ? 'text-destructive' : pct >= 80 ? 'text-amber-500' : 'text-muted-foreground')}>
                      {over ? `+${formatCents(used - limit)} überschritten` : `${s.percent} %`}
                    </span>
                  </div>
                  <Progress value={pct} className={cn('[&>div]:transition-all', over ? '[&>div]:bg-destructive' : pct >= 80 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-600')} />
                  <p className="text-xs text-muted-foreground">
                    {over ? 'Budget überschritten' : `Noch ${formatCents(s.remaining)} verfügbar`}
                    {carryover && ' (inkl. Übertrag aus Vormonaten)'}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
