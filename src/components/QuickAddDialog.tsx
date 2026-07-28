import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { amountPlaceholder, parseEuro, todayISO } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/**
 * Schnellerfassung: minimaler Ein-Tap-Dialog für eine Ausgabe (nur Betrag +
 * Notiz). Konto (erstes mit „edit"), Kategorie (zuletzt verwendete Ausgaben-
 * Kategorie), Datum (heute) und Person (aktueller User) werden automatisch
 * gesetzt — null Konfiguration.
 */
export default function QuickAddDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" title="Ausgabe schnell erfassen">
          <Zap className="h-4 w-4" />
          <span className="hidden sm:inline">Schnell</span>
        </Button>
      </DialogTrigger>
      {open && <QuickAddForm close={() => setOpen(false)} />}
    </Dialog>
  );
}

function QuickAddForm({ close }: { close: () => void }) {
  const { user } = useAuth();
  const { accounts, transactions } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const createTx = trpc.finance.createTransaction.useMutation({
    onSuccess: () => {
      toast.success('Ausgabe erfasst.');
      invalidate();
      close();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const cents = parseEuro(amount);
    if (cents <= 0) {
      toast.error('Bitte einen gültigen Betrag eingeben.');
      return;
    }
    const account = accounts.find((a) => a.access === 'edit');
    if (!account || !user) {
      toast.error('Kein bearbeitbares Konto vorhanden.');
      return;
    }
    // Zuletzt verwendete Ausgaben-Kategorie (Liste ist neueste zuerst sortiert)
    const lastExpense = transactions.find((t) => t.type === 'expense' && t.categoryId !== null);
    createTx.mutate({
      type: 'expense',
      accountId: account.id,
      amount: cents,
      categoryId: lastExpense?.categoryId ?? undefined,
      userId: user.id,
      date: todayISO(),
      note: note.trim(),
    });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Schnellerfassung</DialogTitle>
        <DialogDescription>
          Ausgabe mit einem Tap buchen — Konto, Kategorie, Datum und Person werden automatisch gesetzt.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          autoFocus
          inputMode="decimal"
          placeholder={amountPlaceholder}
          aria-label="Betrag"
          className="w-32"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          placeholder="Notiz (optional)"
          aria-label="Notiz"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={createTx.isPending}>
          Buchen
        </Button>
      </form>
    </DialogContent>
  );
}
