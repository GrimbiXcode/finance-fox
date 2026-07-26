import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { currencySymbol, formatCents, formatDate, parseEuro } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const GOAL_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#6366f1'];

export default function Goals() {
  const { goals } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [deadline, setDeadline] = useState('');
  const [depositFor, setDepositFor] = useState<number | null>(null);
  const [deposit, setDeposit] = useState('');

  const createGoal = trpc.finance.createGoal.useMutation({
    onSuccess: () => {
      toast.success('Sparziel angelegt.');
      invalidate();
      setOpen(false); setName(''); setTarget(''); setSaved(''); setDeadline('');
    },
    onError: (err) => toast.error(err.message),
  });
  const updateSaved = trpc.finance.updateGoalSaved.useMutation({
    onSuccess: () => { toast.success('Einzahlung verbucht.'); invalidate(); setDepositFor(null); setDeposit(''); },
  });
  const deleteGoal = trpc.finance.deleteGoal.useMutation({ onSuccess: () => invalidate() });

  const submit = () => {
    const targetCents = parseEuro(target);
    if (!name.trim() || targetCents <= 0) { toast.error('Name und Zielbetrag angeben.'); return; }
    createGoal.mutate({
      name: name.trim(), targetAmount: targetCents, savedAmount: parseEuro(saved),
      color: GOAL_COLORS[goals.length % GOAL_COLORS.length],
      deadline: deadline || undefined,
    });
  };

  const submitDeposit = () => {
    const goal = goals.find((g) => g.id === depositFor);
    if (!goal) return;
    const cents = parseEuro(deposit);
    if (cents <= 0) { toast.error('Betrag angeben.'); return; }
    updateSaved.mutate({ id: goal.id, savedAmount: Math.min(goal.targetAmount, goal.savedAmount + cents) });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sparziele</h1>
          <p className="text-sm text-muted-foreground">{goals.length} Ziele im Haushalt</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neues Ziel</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neues Sparziel</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="z. B. Urlaub, Notgroschen" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Zielbetrag ({currencySymbol()})</Label>
                  <Input inputMode="decimal" placeholder="0,00" value={target} onChange={(e) => setTarget(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Bereits gespart ({currencySymbol()})</Label>
                  <Input inputMode="decimal" placeholder="0,00" value={saved} onChange={(e) => setSaved(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Stichtag (optional)</Label>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={createGoal.isPending}>Anlegen</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {goals.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-muted-foreground">
              Noch keine Sparziele angelegt.
            </CardContent>
          </Card>
        )}
        {goals.map((g) => {
          const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100)) : 0;
          const done = g.savedAmount >= g.targetAmount;
          return (
            <Card key={g.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-base">{g.name}</CardTitle>
                  <CardDescription>
                    {g.deadline ? `bis ${formatDate(g.deadline)}` : 'ohne Stichtag'}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteGoal.mutate({ id: g.id })} title="Ziel löschen">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold" style={{ color: g.color }}>{formatCents(g.savedAmount)}</span>
                  <span className="text-sm text-muted-foreground">von {formatCents(g.targetAmount)}</span>
                </div>
                <Progress value={pct} style={{ ['--progress-color' as string]: g.color }} className="[&>div]:bg-[var(--progress-color)]" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{done ? 'Erreicht! 🎉' : `${pct} %`}</span>
                  {!done && (
                    <Button variant="outline" size="sm" onClick={() => setDepositFor(g.id)}>Einzahlen</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={depositFor !== null} onOpenChange={(o) => { if (!o) setDepositFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Auf Sparziel einzahlen</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Betrag ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder="0,00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositFor(null)}>Abbrechen</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitDeposit} disabled={updateSaved.isPending}>Einzahlen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
