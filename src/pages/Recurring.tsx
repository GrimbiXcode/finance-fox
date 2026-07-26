import { useState } from 'react';
import { Pause, Play, Plus, Trash2, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { formatCents, formatDate, parseEuro, todayISO } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Interval = 'weekly' | 'monthly' | 'yearly';
const intervalLabel: Record<Interval, string> = {
  weekly: 'Wöchentlich', monthly: 'Monatlich', yearly: 'Jährlich',
};

export default function Recurring() {
  const { user } = useAuth();
  const { accounts, categories, recurring, users } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [interval, setIntervalVal] = useState<Interval>('monthly');
  const [nextDate, setNextDate] = useState(todayISO());

  const createRecurring = trpc.finance.createRecurring.useMutation({
    onSuccess: () => {
      toast.success('Dauerbuchung angelegt — fällige Buchungen erzeugt der Server automatisch.');
      invalidate();
      setOpen(false); setAmount(''); setNote('');
    },
    onError: (err) => toast.error(err.message),
  });
  const toggle = trpc.finance.toggleRecurring.useMutation({ onSuccess: () => invalidate() });
  const remove = trpc.finance.deleteRecurring.useMutation({ onSuccess: () => invalidate() });
  const runNow = trpc.finance.runRecurringNow.useMutation({
    onSuccess: (res) => {
      toast.success(res.created > 0 ? `${res.created} fällige Buchung(en) verbucht.` : 'Keine fälligen Buchungen.');
      invalidate();
    },
  });

  const submit = () => {
    const cents = parseEuro(amount);
    const accId = Number(accountId) || accounts[0]?.id;
    if (cents <= 0 || !accId) { toast.error('Betrag und Konto angeben.'); return; }
    createRecurring.mutate({
      type, amount: cents, accountId: accId,
      categoryId: categoryId ? Number(categoryId) : undefined,
      userId: Number(userId) || user?.id || 0,
      note: note.trim(), interval, nextDate,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Wiederkehrende Buchungen</h1>
          <p className="text-sm text-muted-foreground">
            Der Server verbucht fällige Dauerbuchungen automatisch täglich (03:00 Uhr) und bei jedem Start.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            <Zap className="mr-2 h-4 w-4" /> Jetzt verbuchen
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neue Dauerbuchung</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Neue wiederkehrende Buchung</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={type === 'expense' ? 'default' : 'outline'} className={type === 'expense' ? 'bg-rose-600 hover:bg-rose-700' : ''} onClick={() => setType('expense')}>Ausgabe</Button>
                  <Button type="button" variant={type === 'income' ? 'default' : 'outline'} className={type === 'income' ? 'bg-emerald-600 hover:bg-emerald-700' : ''} onClick={() => setType('income')}>Einnahme</Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Betrag (€)</Label>
                    <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Intervall</Label>
                    <Select value={interval} onValueChange={(v) => setIntervalVal(v as Interval)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(intervalLabel).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Konto</Label>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Kategorie</Label>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>
                        {categories.filter((c) => c.type === type).map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Person</Label>
                    <Select value={userId} onValueChange={setUserId}>
                      <SelectTrigger><SelectValue placeholder={user?.name} /></SelectTrigger>
                      <SelectContent>
                        {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Nächste Fälligkeit</Label>
                    <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notiz</Label>
                  <Input placeholder="z. B. Miete" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={createRecurring.isPending}>Anlegen</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {recurring.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-muted-foreground">
              Noch keine Dauerbuchungen angelegt.
            </CardContent>
          </Card>
        )}
        {recurring.map((r) => {
          const cat = categories.find((c) => c.id === r.categoryId);
          const account = accounts.find((a) => a.id === r.accountId);
          const owner = users.find((u) => u.id === r.userId);
          return (
            <Card key={r.id} className={cn(!r.active && 'opacity-60')}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{r.note || cat?.name || 'Dauerbuchung'}</CardTitle>
                    <CardDescription>{account?.name} · {owner?.name}</CardDescription>
                  </div>
                  <Badge variant={r.active ? 'default' : 'secondary'} className={r.active ? 'bg-emerald-600' : ''}>
                    {r.active ? 'Aktiv' : 'Pausiert'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className={cn('text-xl font-bold', r.type === 'income' ? 'text-emerald-600' : 'text-rose-500')}>
                    {r.type === 'income' ? '+' : '−'}{formatCents(r.amount)}
                  </span>
                  <span className="text-sm text-muted-foreground">{intervalLabel[r.interval]}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Nächste Fälligkeit: <span className="font-medium text-foreground">{formatDate(r.nextDate)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => toggle.mutate({ id: r.id })}>
                    {r.active ? <><Pause className="mr-1.5 h-3.5 w-3.5" /> Pausieren</> : <><Play className="mr-1.5 h-3.5 w-3.5" /> Fortsetzen</>}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove.mutate({ id: r.id })} title="Löschen">
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
