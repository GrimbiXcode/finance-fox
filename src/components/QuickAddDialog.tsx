import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/SearchableSelect';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { amountPlaceholder, parseEuro, todayISO } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/**
 * Schnellerfassung: minimaler Ein-Tap-Dialog für eine Buchung (Betrag +
 * Notiz). Positive Beträge werden als Ausgabe abgezogen, negative (mit
 * Vorzeichen, z. B. „-50") als Einnahme gutgeschrieben. Kategorie (zuletzt
 * verwendete der jeweiligen Art), Datum (heute) und Person (aktueller User)
 * werden automatisch gesetzt. Das Konto ist pro Benutzer konfigurierbar
 * (users.quickAccountId via auth.setQuickAccount) — Default: erstes Konto
 * mit „edit"-Recht.
 */
export default function QuickAddDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" title="Schnellbuchung erfassen">
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
  const { accounts, transactions, banks } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const editableAccounts = useMemo(
    () => accounts.filter((a) => a.access === 'edit'),
    [accounts],
  );
  // Konfiguriertes Konto, falls vorhanden und noch bearbeitbar — sonst
  // automatisch das erste Konto mit „edit"-Recht
  const configured = editableAccounts.find((a) => a.id === user?.quickAccountId);
  const account = configured ?? editableAccounts[0];

  const setQuickAccount = trpc.auth.setQuickAccount.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const createTx = trpc.finance.createTransaction.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(vars.type === 'income' ? 'Einnahme erfasst.' : 'Ausgabe erfasst.');
      invalidate();
      close();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    // parseEuro liefert den Absolutbetrag — das Vorzeichen kommt aus der Eingabe
    const isIncome = amount.trim().startsWith('-');
    const cents = parseEuro(amount);
    if (cents <= 0) {
      toast.error('Bitte einen gültigen Betrag eingeben.');
      return;
    }
    if (!account || !user) {
      toast.error('Kein bearbeitbares Konto vorhanden.');
      return;
    }
    const type = isIncome ? 'income' : 'expense';
    // Zuletzt verwendete Kategorie der jeweiligen Art (Liste ist neueste zuerst)
    const lastOfType = transactions.find((t) => t.type === type && t.categoryId !== null);
    createTx.mutate({
      type,
      accountId: account.id,
      amount: cents,
      categoryId: lastOfType?.categoryId ?? undefined,
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
          Betrag mit einem Tap buchen — positiv = Ausgabe, negativ (mit „-") = Einnahme.
          Kategorie, Datum und Person werden automatisch gesetzt.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
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
        <div className="space-y-1">
          <SearchableSelect
            value={account ? String(account.id) : ''}
            onValueChange={(v) => {
              const id = Number(v);
              if (id !== user?.quickAccountId) setQuickAccount.mutate({ accountId: id });
            }}
            options={editableAccounts.map((a) => ({
              value: String(a.id),
              label: accountLabel(a, banks),
            }))}
            placeholder="Konto wählen"
            disabled={editableAccounts.length === 0 || setQuickAccount.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Buchungskonto — deine Wahl wird für die Schnellerfassung gespeichert.
          </p>
        </div>
      </div>
    </DialogContent>
  );
}
