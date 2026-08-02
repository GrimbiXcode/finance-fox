import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { accountLabel, useInvalidateMortgage } from '@/lib/data';
import {
  amountPlaceholder, currencySymbol, formatAmountInput, parseEuro, todayISO,
} from '@/lib/finance';
import { RECURRING_INTERVAL_LABELS } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const AMORT_INTERVALS = ['monthly', 'quarterly', 'semiannual', 'yearly'] as const;
type AmortInterval = (typeof AMORT_INTERVALS)[number];

/** Amortisation, wie sie mortgage.listAmortizations liefert */
export interface DialogAmortization {
  id: number;
  propertyId: number;
  trancheId: number | null;
  kind: 'direct' | 'indirect';
  amount: number;
  interval: string;
  accountId: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  notes: string;
}

const centsInput = (cents: number): string =>
  cents > 0 ? formatAmountInput(cents) : '';

/** Dialog zum Anlegen/Bearbeiten einer Amortisation */
export default function MortgageAmortizationDialog(
  { propertyId, tranches, amortization, trigger }: {
    propertyId: number;
    tranches: { id: number; name: string }[];
    amortization?: DialogAmortization;
    trigger: ReactNode;
  },
) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <AmortizationForm
          propertyId={propertyId}
          tranches={tranches}
          amortization={amortization}
          close={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function AmortizationForm(
  { propertyId, tranches, amortization, close }: {
    propertyId: number;
    tranches: { id: number; name: string }[];
    amortization?: DialogAmortization;
    close: () => void;
  },
) {
  const invalidate = useInvalidateMortgage();
  const accountsQuery = trpc.finance.listAccounts.useQuery();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const isEdit = !!amortization;
  const [kind, setKind] = useState<DialogAmortization['kind']>(amortization?.kind ?? 'direct');
  const [trancheId, setTrancheId] = useState(
    amortization?.trancheId != null
      ? String(amortization.trancheId)
      : (tranches[0] ? String(tranches[0].id) : ''),
  );
  const [amount, setAmount] = useState(centsInput(amortization?.amount ?? 0));
  const [interval, setInterval] = useState<AmortInterval>(
    (amortization?.interval as AmortInterval) ?? 'yearly',
  );
  const [accountId, setAccountId] = useState(
    amortization?.accountId != null ? String(amortization.accountId) : 'none',
  );
  const [startDate, setStartDate] = useState(amortization?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(amortization?.endDate ?? '');
  const [active, setActive] = useState(amortization?.active ?? true);
  const [notes, setNotes] = useState(amortization?.notes ?? '');
  const [comment, setComment] = useState('');

  const addAmortization = trpc.mortgage.addAmortization.useMutation({
    onSuccess: () => { toast.success('Amortisation angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updateAmortization = trpc.mortgage.updateAmortization.useMutation({
    onSuccess: () => { toast.success('Amortisation gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteAmortization = trpc.mortgage.deleteAmortization.useMutation({
    onSuccess: () => { toast.success('Amortisation gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });

  const accounts = accountsQuery.data ?? [];
  const banks = banksQuery.data ?? [];

  const submit = () => {
    const cents = parseEuro(amount);
    if (cents <= 0) {
      toast.error('Betrag angeben.');
      return;
    }
    if (!startDate) {
      toast.error('Beginn angeben.');
      return;
    }
    if (isEdit && amortization) {
      // Art und Tranche sind nach dem Anlegen unveränderlich — ein Wechsel
      // würde den bereits gerechneten Tilgungsverlauf rückwirkend ändern
      updateAmortization.mutate({
        id: amortization.id,
        amount: cents,
        interval,
        accountId: accountId === 'none' ? null : Number(accountId),
        startDate,
        endDate: endDate || null,
        active,
        notes: notes.trim(),
        comment: comment.trim() || undefined,
      });
      return;
    }
    if (kind === 'direct' && !trancheId) {
      toast.error('Für eine direkte Amortisation eine Tranche wählen.');
      return;
    }
    addAmortization.mutate({
      propertyId,
      kind,
      trancheId: kind === 'direct' ? Number(trancheId) : null,
      amount: cents,
      interval,
      accountId: accountId === 'none' ? null : Number(accountId),
      startDate,
      endDate: endDate || null,
      active,
      notes: notes.trim(),
    });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Amortisation bearbeiten' : 'Neue Amortisation'}</DialogTitle>
        <DialogDescription>
          Direkt senkt die Restschuld der Tranche. Indirekt zahlt auf ein Konto
          (meist Säule 3a) ein — die Schuld bleibt bestehen, das Guthaben wächst.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Art</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as DialogAmortization['kind'])}
              disabled={isEdit}
            >
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                title={isEdit ? 'Die Art lässt sich nachträglich nicht ändern' : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direkt (senkt die Schuld)</SelectItem>
                <SelectItem value="indirect">Indirekt (Einzahlung auf ein Konto)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === 'direct' && (
            <div className="space-y-2">
              <Label>Tranche</Label>
              <SearchableSelect
                value={trancheId}
                onValueChange={setTrancheId}
                disabled={isEdit}
                placeholder="Tranche wählen"
                options={tranches.map((t) => ({ value: String(t.id), label: t.name }))}
              />
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Betrag pro Zahlung ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Intervall</Label>
            <Select value={interval} onValueChange={(v) => setInterval(v as AmortInterval)}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate" title={RECURRING_INTERVAL_LABELS[interval]}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AMORT_INTERVALS.map((i) => (
                  <SelectItem key={i} value={i}>{RECURRING_INTERVAL_LABELS[i]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            {kind === 'indirect' ? 'Zielkonto (Säule 3a / Sparkonto)' : 'Zielkonto (optional)'}
          </Label>
          <SearchableSelect
            value={accountId}
            onValueChange={setAccountId}
            placeholder="Konto wählen"
            options={[
              { value: 'none', label: 'Kein Konto' },
              ...accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) })),
            ]}
          />
          {kind === 'indirect' && (
            <p className="text-xs text-muted-foreground">
              Das angesparte Guthaben steckt im Saldo dieses Kontos und zählt
              deshalb nicht zusätzlich zum Vermögen — es wird getrennt als
              „indirekt angespart" ausgewiesen.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Beginn</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Ende (optional)</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="min-w-0 space-y-0.5">
            <Label>Aktiv</Label>
            <p className="text-xs text-muted-foreground">
              Pausierte Amortisationen zählen nicht in die Berechnung.
            </p>
          </div>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>

        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input placeholder="z. B. Rate erhöht" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        )}

        {isEdit && amortization && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Der Amortisationsplan wird unwiderruflich gelöscht. Eine
              übernommene Dauerbuchung bleibt bestehen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteAmortization.isPending}>
                  Amortisation endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Amortisation wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Der Amortisationsplan wird unwiderruflich gelöscht. Eine
                    übernommene Dauerbuchung bleibt bestehen und muss separat
                    entfernt werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteAmortization.mutate({ id: amortization.id })}
                  >
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>Abbrechen</Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={addAmortization.isPending || updateAmortization.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
