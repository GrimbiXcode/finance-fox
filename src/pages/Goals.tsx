import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { amountPlaceholder, currencySymbol, formatCents, formatDate, parseEuro } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { useAuth, type SessionUser } from '@/providers/auth';
import { toast } from 'sonner';

const GOAL_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#6366f1'];

type Goal = ReturnType<typeof useFinanceData>['goals'][number];

/**
 * Karte eines Sparziels. Gesamtfortschritt = Basis (savedAmount, manuell
 * per „Einzahlen") + Summe der Beiträge aller Mitglieder. Der gestapelte
 * Balken und die Beitragsliste zeigen den Einzel-Fortschritt je Person.
 */
function GoalCard({ goal, currentUser, onDeposit, onDelete }: {
  goal: Goal;
  currentUser: SessionUser | null | undefined;
  onDeposit: (goal: Goal) => void;
  onDelete: (id: number) => void;
}) {
  const invalidate = useInvalidateFinance();
  const contribsQuery = trpc.finance.listGoalContributions.useQuery({ goalId: goal.id });
  const [showContribs, setShowContribs] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const addContribution = trpc.finance.addGoalContribution.useMutation({
    onSuccess: () => {
      toast.success('Beitrag verbucht.');
      invalidate();
      setAddOpen(false); setAmount(''); setNote('');
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteContribution = trpc.finance.deleteGoalContribution.useMutation({
    onSuccess: () => { toast.success('Beitrag gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const contribs = contribsQuery.data ?? [];
  const contribTotal = contribs.reduce((s, c) => s + c.amount, 0);
  const total = goal.savedAmount + contribTotal;
  const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((total / goal.targetAmount) * 100)) : 0;
  const done = total >= goal.targetAmount;

  // Einzel-Fortschritt: Summe je Beitragszahler
  const perUser = new Map<number, { name: string; color: string; sum: number }>();
  for (const c of contribs) {
    const entry = perUser.get(c.userId) ?? { name: c.userName, color: c.userColor, sum: 0 };
    entry.sum += c.amount;
    perUser.set(c.userId, entry);
  }
  // Balkenbreiten als Anteil am Zielbetrag (Summe auf 100 % gedeckelt)
  const widthOf = (cents: number) =>
    goal.targetAmount > 0 ? Math.min(100, (cents / goal.targetAmount) * 100) : 0;

  const submitContribution = () => {
    const cents = parseEuro(amount);
    if (cents <= 0) { toast.error('Betrag angeben.'); return; }
    addContribution.mutate({ goalId: goal.id, amount: cents, note: note.trim() || undefined });
  };

  const mayDelete = (userId: number) =>
    currentUser?.role === 'admin' || currentUser?.id === userId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-base">{goal.name}</CardTitle>
          <CardDescription>
            {goal.deadline ? `bis ${formatDate(goal.deadline)}` : 'ohne Stichtag'}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onDelete(goal.id)} title="Ziel löschen">
          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-bold" style={{ color: goal.color }}>{formatCents(total)}</span>
          <span className="text-sm text-muted-foreground">von {formatCents(goal.targetAmount)}</span>
        </div>
        {/* Gestapelter Balken: Basis in Zielfarbe, Beiträge in Personenfarbe */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
          {goal.savedAmount > 0 && (
            <div style={{ width: `${widthOf(goal.savedAmount)}%`, backgroundColor: goal.color }} />
          )}
          {[...perUser.values()].map((p) => (
            <div key={p.name} style={{ width: `${widthOf(p.sum)}%`, backgroundColor: p.color }} />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{done ? 'Erreicht! 🎉' : `${pct} %`}</span>
          {!done && (
            <Button variant="outline" size="sm" onClick={() => onDeposit(goal)}>Einzahlen</Button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between"
          onClick={() => setShowContribs((v) => !v)}
        >
          Beiträge ({contribs.length})
          {showContribs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {showContribs && (
          <div className="space-y-2 border-t pt-3">
            {/* Summen je Person (Einzel-Fortschritt) */}
            <div className="space-y-1">
              {goal.savedAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: goal.color }} />
                    Basis (manuell)
                  </span>
                  <span className="font-medium">{formatCents(goal.savedAmount)}</span>
                </div>
              )}
              {[...perUser.values()].map((p) => (
                <div key={p.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </span>
                  <span className="font-medium">{formatCents(p.sum)}</span>
                </div>
              ))}
            </div>

            {contribs.length > 0 && (
              <ul className="space-y-1 border-t pt-2">
                {contribs.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.userColor }} />
                      <span className="truncate">
                        {c.userName}
                        {c.note ? ` — ${c.note}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-muted-foreground">
                        {formatDate(new Date(c.createdAt).toISOString().slice(0, 10))}
                      </span>
                      <span className="font-medium">{formatCents(c.amount)}</span>
                      {mayDelete(c.userId) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Beitrag löschen"
                          onClick={() => deleteContribution.mutate({ id: c.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <Plus className="mr-2 h-4 w-4" /> Beitrag hinzufügen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Beitrag zu „{goal.name}"</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="space-y-2">
                    <Label>Betrag ({currencySymbol()})</Label>
                    <Input inputMode="decimal" placeholder={amountPlaceholder} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Notiz (optional)</Label>
                    <Input placeholder="z. B. Geburtstagsgeld" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Abbrechen</Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitContribution} disabled={addContribution.isPending}>Verbuchen</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Goals() {
  const { goals } = useFinanceData();
  const { user } = useAuth();
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
                  <Input inputMode="decimal" placeholder={amountPlaceholder} value={target} onChange={(e) => setTarget(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Bereits gespart ({currencySymbol()})</Label>
                  <Input inputMode="decimal" placeholder={amountPlaceholder} value={saved} onChange={(e) => setSaved(e.target.value)} />
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
        {goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            currentUser={user}
            onDeposit={(goal) => setDepositFor(goal.id)}
            onDelete={(id) => deleteGoal.mutate({ id })}
          />
        ))}
      </div>

      <Dialog open={depositFor !== null} onOpenChange={(o) => { if (!o) setDepositFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Auf Sparziel einzahlen</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Betrag ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
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
