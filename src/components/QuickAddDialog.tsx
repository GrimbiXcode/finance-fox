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
import { amountPlaceholder, formatAmountInput, parseEuro, todayISO } from '@/lib/finance';
import NoteSuggestInput from '@/components/NoteSuggestInput';
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
  const { accounts, banks } = useFinanceData();
  const usage = trpc.finance.categoryUsage.useQuery();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // Kategorie aus einem gewählten Vorschlag (sonst: zuletzt verwendete)
  const [picked, setPicked] = useState<{ categoryId: number | null; type: 'income' | 'expense' } | null>(null);
  const isIncome = amount.trim().startsWith('-');

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
    // Zuletzt verwendete Kategorie der jeweiligen Art (ohne Stornos)
    // Kategorie des gewählten Vorschlags nur, wenn die Art noch passt (das
    // Vorzeichen kann nach der Auswahl geändert worden sein)
    const pickedCategory = picked && picked.type === type ? picked.categoryId : null;
    const lastCategoryId = pickedCategory ?? usage.data?.[type].last ?? null;
    createTx.mutate({
      type,
      accountId: account.id,
      amount: cents,
      categoryId: lastCategoryId ?? undefined,
      userId: user.id,
      date: todayISO(),
      note: note.trim(),
    });
  };

  return (
    <DialogContent
      className="sm:max-w-md"
      onEscapeKeyDown={(e) => {
        // Bei offener Vorschlagsliste schließt Escape nur die Liste
        if ((e.target as HTMLElement | null)?.getAttribute?.('aria-expanded') === 'true') e.preventDefault();
      }}
    >
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
          <div className="min-w-0 flex-1">
            <NoteSuggestInput
              placeholder="Notiz (optional)"
              type={isIncome ? 'income' : 'expense'}
              value={note}
              onChange={(v) => {
                setNote(v);
                setPicked(null);
              }}
              onPick={(s) => {
                setNote(s.note);
                setPicked({ categoryId: s.categoryId, type: isIncome ? 'income' : 'expense' });
                if (parseEuro(amount) <= 0) setAmount(formatAmountInput(s.amount));
              }}
            />
          </div>
          <Button type="submit" disabled={createTx.isPending}>
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
