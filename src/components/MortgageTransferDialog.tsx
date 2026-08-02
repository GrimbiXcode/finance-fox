import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/SearchableSelect';
import { accountLabel, useInvalidateMortgage } from '@/lib/data';
import { formatCents } from '@/lib/finance';
import { RECURRING_INTERVAL_LABELS, type RecurringInterval } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/**
 * „Als Dauerbuchung übernehmen" — für den Zins einer Tranche oder eine
 * Amortisation. Kopie, kein Live-Sync: ändert sich später der Zinssatz,
 * muss die Dauerbuchung von Hand angepasst werden.
 */
export default function MortgageTransferDialog(
  { target, trigger }: {
    target:
      | { kind: 'interest'; trancheId: number; name: string; amount: number; interval: RecurringInterval }
      | { kind: 'amortization'; amortizationId: number; name: string; amount: number; interval: RecurringInterval; indirect: boolean; targetAccountId: number | null };
    trigger: ReactNode;
  },
) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <TransferForm target={target} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function TransferForm(
  { target, close }: {
    target: Parameters<typeof MortgageTransferDialog>[0]['target'];
    close: () => void;
  },
) {
  const invalidate = useInvalidateMortgage();
  const accountsQuery = trpc.finance.listAccounts.useQuery();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const categoriesQuery = trpc.finance.listCategories.useQuery();
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('none');

  const onSuccess = () => {
    toast.success('Dauerbuchung angelegt.');
    invalidate();
    close();
  };
  const onError = (err: { message: string }) => toast.error(err.message);

  const transferInterest = trpc.mortgage.transferInterestToRecurring.useMutation({ onSuccess, onError });
  const transferAmortization = trpc.mortgage.transferAmortizationToRecurring.useMutation({ onSuccess, onError });

  // Nur Konten, auf die wirklich gebucht werden darf
  const accounts = (accountsQuery.data ?? []).filter((a) => a.access === 'edit');
  const banks = banksQuery.data ?? [];
  const expenseCategories = (categoriesQuery.data ?? []).filter((c) => c.type === 'expense');
  const isIndirect = target.kind === 'amortization' && target.indirect;

  const submit = () => {
    if (!accountId) {
      toast.error('Belastungskonto wählen.');
      return;
    }
    const category = categoryId === 'none' ? null : Number(categoryId);
    if (target.kind === 'interest') {
      transferInterest.mutate({
        trancheId: target.trancheId,
        accountId: Number(accountId),
        categoryId: category,
      });
    } else {
      transferAmortization.mutate({
        amortizationId: target.amortizationId,
        accountId: Number(accountId),
        categoryId: category,
      });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Als Dauerbuchung übernehmen</DialogTitle>
        <DialogDescription>
          {target.name} — {formatCents(target.amount)}{' '}
          {RECURRING_INTERVAL_LABELS[target.interval].toLowerCase()}.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label>Belastungskonto</Label>
          <SearchableSelect
            value={accountId}
            onValueChange={setAccountId}
            placeholder="Konto wählen"
            options={accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
          />
        </div>
        {isIndirect ? (
          <p className="text-xs text-muted-foreground">
            Die indirekte Amortisation wird als Umbuchung auf das hinterlegte
            Zielkonto angelegt.
          </p>
        ) : (
          <div className="space-y-2">
            <Label>Kategorie (optional)</Label>
            <SearchableSelect
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Kategorie wählen"
              options={[
                { value: 'none', label: 'Ohne Kategorie' },
                ...expenseCategories.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
            />
          </div>
        )}
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          Es wird eine Kopie angelegt, kein laufender Abgleich: Ändert sich
          später der Zinssatz oder die Rate, muss die Dauerbuchung von Hand
          angepasst werden. Bereits von Hand erfasste Buchungen werden nicht
          rückwirkend ersetzt.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>Abbrechen</Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={transferInterest.isPending || transferAmortization.isPending}
        >
          Übernehmen
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
