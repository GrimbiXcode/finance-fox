import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { currencySymbol, formatCents, parseEuro, todayISO } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

type TxType = 'income' | 'expense' | 'transfer';

/** Dialog zum Erfassen einer neuen Buchung (Einnahme, Ausgabe, Umbuchung) */
export default function TransactionDialog({ defaultType = 'expense' }: { defaultType?: TxType }) {
  const { user } = useAuth();
  const { accounts, categories, users } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TxType>(defaultType);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [shares, setShares] = useState<Record<number, string>>({});

  const createTx = trpc.finance.createTransaction.useMutation({
    onSuccess: () => {
      toast.success('Buchung gespeichert.');
      invalidate();
      setOpen(false);
      setAmount(''); setNote(''); setCategoryId(''); setSplitEnabled(false); setShares({});
      setDate(todayISO());
    },
    onError: (err) => toast.error(err.message),
  });

  const effectiveUserId = userId ? Number(userId) : (user?.id ?? 0);
  const effectiveAccountId = accountId ? Number(accountId) : (accounts[0]?.id ?? 0);
  const effectiveToAccountId = toAccountId ? Number(toAccountId) : (accounts.find((a) => a.id !== effectiveAccountId)?.id ?? 0);

  const filteredCategories = useMemo(
    () => categories.filter((c) => (type === 'income' ? c.type === 'income' : c.type === 'expense')),
    [categories, type],
  );

  const submit = () => {
    const cents = parseEuro(amount);
    if (cents <= 0) { toast.error('Bitte einen gültigen Betrag eingeben.'); return; }
    if (!effectiveAccountId) { toast.error('Bitte zuerst ein Konto anlegen.'); return; }
    if (type === 'transfer' && (!effectiveToAccountId || effectiveToAccountId === effectiveAccountId)) {
      toast.error('Zielkonto muss ein anderes Konto sein.'); return;
    }

    let splits;
    if (type === 'expense' && splitEnabled && users.length > 1) {
      const parsed = users.map((u) => ({ userId: u.id, amount: parseEuro(shares[u.id] ?? '') }));
      const sum = parsed.reduce((s, p) => s + p.amount, 0);
      if (sum !== cents) {
        toast.error(`Die Anteile (${formatCents(sum)}) müssen in Summe dem Betrag entsprechen.`);
        return;
      }
      splits = parsed.filter((p) => p.amount > 0);
    }

    createTx.mutate({
      type, accountId: effectiveAccountId,
      toAccountId: type === 'transfer' ? effectiveToAccountId : undefined,
      amount: cents, categoryId: categoryId ? Number(categoryId) : undefined,
      userId: effectiveUserId, date, note, splits,
    });
  };

  const splitEvenly = () => {
    const cents = parseEuro(amount);
    if (cents <= 0) { toast.error('Zuerst einen Betrag eingeben.'); return; }
    const base = Math.floor(cents / users.length);
    const next: Record<number, string> = {};
    users.forEach((u, idx) => {
      const share = idx === 0 ? cents - base * (users.length - 1) : base;
      next[u.id] = (share / 100).toFixed(2).replace('.', ',');
    });
    setShares(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> Neue Buchung
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neue Buchung</DialogTitle>
          <DialogDescription>Einnahme, Ausgabe oder Umbuchung zwischen Konten erfassen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-2">
            {([['expense', 'Ausgabe'], ['income', 'Einnahme'], ['transfer', 'Umbuchung']] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={type === value ? 'default' : 'outline'}
                className={type === value ? (value === 'expense' ? 'bg-rose-600 hover:bg-rose-700' : value === 'income' ? 'bg-emerald-600 hover:bg-emerald-700' : '') : ''}
                onClick={() => setType(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Betrag ({currencySymbol()})</Label>
              <Input id="amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Datum</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{type === 'transfer' ? 'Von Konto' : 'Konto'}</Label>
              <Select value={String(effectiveAccountId || '')} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {type === 'transfer' ? (
              <div className="space-y-2">
                <Label>Nach Konto</Label>
                <Select value={String(effectiveToAccountId || '')} onValueChange={setToAccountId}>
                  <SelectTrigger><SelectValue placeholder="Zielkonto" /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.id !== effectiveAccountId).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {filteredCategories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{type === 'expense' ? 'Bezahlt von' : 'Person'}</Label>
              <Select value={String(effectiveUserId || '')} onValueChange={setUserId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Notiz</Label>
              <Input id="note" placeholder="z. B. Wocheneinkauf" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          {type === 'expense' && users.length > 1 && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="split"
                    checked={splitEnabled}
                    onCheckedChange={(checked) => {
                      setSplitEnabled(checked === true);
                      if (checked === true) splitEvenly();
                    }}
                  />
                  <Label htmlFor="split" className="cursor-pointer">Kosten aufteilen</Label>
                </div>
                {splitEnabled && (
                  <Button type="button" variant="ghost" size="sm" onClick={splitEvenly}>Gleichmäßig</Button>
                )}
              </div>
              {splitEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  {users.map((u) => (
                    <div key={u.id} className="space-y-1">
                      <Label className="text-xs" style={{ color: u.color }}>{u.name} ({currencySymbol()})</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="0,00"
                        value={shares[u.id] ?? ''}
                        onChange={(e) => setShares((s) => ({ ...s, [u.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={createTx.isPending}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
