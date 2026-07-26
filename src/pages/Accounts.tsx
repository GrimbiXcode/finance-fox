import { useState } from 'react';
import { Banknote, CreditCard, PiggyBank, Plus, Trash2 } from 'lucide-react';
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
import { currencySymbol, formatCents, parseEuro } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type AccountType = 'checking' | 'cash' | 'savings';

const typeMeta: Record<AccountType, { label: string; icon: typeof CreditCard }> = {
  checking: { label: 'Girokonto', icon: CreditCard },
  cash: { label: 'Bargeld', icon: Banknote },
  savings: { label: 'Sparkonto', icon: PiggyBank },
};

export default function Accounts() {
  const { accounts, transactions } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('');

  const createAccount = trpc.finance.createAccount.useMutation({
    onSuccess: () => {
      toast.success('Konto angelegt.');
      invalidate();
      setOpen(false); setName(''); setBalance('');
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteAccount = trpc.finance.deleteAccount.useMutation({
    onSuccess: () => { toast.success('Konto und zugehörige Buchungen gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) { toast.error('Bitte einen Namen eingeben.'); return; }
    createAccount.mutate({ name: name.trim(), type, initialBalance: parseEuro(balance) });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Konten</h1>
          <p className="text-sm text-muted-foreground">{accounts.length} Konten im Haushalt</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neues Konto</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neues Konto</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="z. B. Gemeinschaftskonto" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Typ</Label>
                  <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(typeMeta).map(([key, meta]) => (
                        <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Anfangsbestand ({currencySymbol()})</Label>
                  <Input inputMode="decimal" placeholder="0,00" value={balance} onChange={(e) => setBalance(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={createAccount.isPending}>Anlegen</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {accounts.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Noch keine Konten — lege dein erstes Konto an, um Buchungen zu erfassen.
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const meta = typeMeta[a.type];
          const txCount = transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length;
          return (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
                    <meta.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <CardDescription>{meta.label}</CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost" size="icon"
                  onClick={() => deleteAccount.mutate({ id: a.id })}
                  title="Konto löschen"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className={cn('text-2xl font-bold', a.balance < 0 && 'text-destructive')}>{formatCents(a.balance)}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{txCount} Buchungen</Badge>
                  <span>Anfangsbestand: {formatCents(a.initialBalance)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
