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
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useInvalidateMortgage } from '@/lib/data';
import {
  amountPlaceholder, currencySymbol, formatAmountInput, formatBp, parseEuro, parsePercent, todayISO,
} from '@/lib/finance';
import { RECURRING_INTERVAL_LABELS } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Zahlungsrhythmen einer Tranche — wöchentlich gibt es fachlich nicht */
const PAYMENT_INTERVALS = ['monthly', 'quarterly', 'semiannual', 'yearly'] as const;
type PaymentInterval = (typeof PAYMENT_INTERVALS)[number];

/** Tranche, wie sie mortgage.listTranches liefert */
export interface DialogTranche {
  id: number;
  propertyId: number;
  name: string;
  kind: 'fixed' | 'saron' | 'variable';
  principal: number;
  balanceDate: string | null;
  interestRateBp: number;
  marginBp: number | null;
  bankId: number | null;
  startDate: string;
  maturityDate: string | null;
  paymentInterval: string;
  notes: string;
}

const centsInput = (cents: number): string =>
  cents > 0 ? formatAmountInput(cents) : '';

/** Dialog zum Anlegen/Bearbeiten einer Hypothekar-Tranche */
export default function MortgageTrancheDialog(
  { propertyId, tranche, trigger }:
  { propertyId: number; tranche?: DialogTranche; trigger: ReactNode },
) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <TrancheForm propertyId={propertyId} tranche={tranche} close={() => setOpen(false)} />
      )}
    </Dialog>
  );
}

function TrancheForm(
  { propertyId, tranche, close }:
  { propertyId: number; tranche?: DialogTranche; close: () => void },
) {
  const invalidate = useInvalidateMortgage();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const isEdit = !!tranche;
  const [name, setName] = useState(tranche?.name ?? '');
  const [kind, setKind] = useState<DialogTranche['kind']>(tranche?.kind ?? 'fixed');
  const [principal, setPrincipal] = useState(centsInput(tranche?.principal ?? 0));
  const [balanceDate, setBalanceDate] = useState(tranche?.balanceDate ?? '');
  const [rate, setRate] = useState(tranche ? formatBp(tranche.interestRateBp) : '');
  const [margin, setMargin] = useState(
    tranche?.marginBp != null ? formatBp(tranche.marginBp) : '',
  );
  const [bankId, setBankId] = useState(tranche?.bankId != null ? String(tranche.bankId) : 'none');
  const [startDate, setStartDate] = useState(tranche?.startDate ?? todayISO());
  const [maturityDate, setMaturityDate] = useState(tranche?.maturityDate ?? '');
  const [interval, setInterval] = useState<PaymentInterval>(
    (tranche?.paymentInterval as PaymentInterval) ?? 'quarterly',
  );
  const [notes, setNotes] = useState(tranche?.notes ?? '');
  const [comment, setComment] = useState('');

  const addTranche = trpc.mortgage.addTranche.useMutation({
    onSuccess: () => { toast.success('Tranche angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updateTranche = trpc.mortgage.updateTranche.useMutation({
    onSuccess: () => { toast.success('Tranche gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteTranche = trpc.mortgage.deleteTranche.useMutation({
    onSuccess: () => { toast.success('Tranche gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });

  const banks = banksQuery.data ?? [];
  // SARON und variable Hypotheken haben keine feste Zinsbindung
  const hasMaturity = kind === 'fixed';

  const submit = () => {
    if (!name.trim()) {
      toast.error('Name angeben.');
      return;
    }
    if (!startDate) {
      toast.error('Beginn angeben.');
      return;
    }
    const values = {
      name: name.trim(),
      kind,
      principal: parseEuro(principal),
      balanceDate: balanceDate || null,
      interestRateBp: Math.round(parsePercent(rate) * 100),
      marginBp: kind === 'saron' && margin ? Math.round(parsePercent(margin) * 100) : null,
      bankId: bankId === 'none' ? null : Number(bankId),
      startDate,
      maturityDate: hasMaturity && maturityDate ? maturityDate : null,
      paymentInterval: interval,
      notes: notes.trim(),
    };
    if (isEdit && tranche) {
      updateTranche.mutate({ id: tranche.id, ...values, comment: comment.trim() || undefined });
    } else {
      addTranche.mutate({ propertyId, ...values });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Tranche bearbeiten' : 'Neue Tranche'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Angaben zur Hypothekar-Tranche anpassen.'
            : 'Festhypothek, SARON oder variable Hypothek mit eigenem Zinssatz erfassen.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="z. B. Festhypothek 5 Jahre" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Art</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as DialogTranche['kind'])}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Festhypothek</SelectItem>
                <SelectItem value="saron">SARON</SelectItem>
                <SelectItem value="variable">Variabel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Restschuld ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Stichtag der Restschuld (optional)</Label>
            <Input type="date" value={balanceDate} onChange={(e) => setBalanceDate(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{kind === 'saron' ? 'Basissatz (% p. a.)' : 'Zinssatz (% p. a.)'}</Label>
            <Input inputMode="decimal" placeholder={formatBp(150)} value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          {kind === 'saron' ? (
            <div className="space-y-2">
              <Label>Marge (% p. a.)</Label>
              <Input inputMode="decimal" placeholder={formatBp(80)} value={margin} onChange={(e) => setMargin(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Bank (optional)</Label>
              <SearchableSelect
                value={bankId}
                onValueChange={setBankId}
                placeholder="Bank wählen"
                options={[
                  { value: 'none', label: 'Keine Bank' },
                  ...banks.map((b) => ({ value: String(b.id), label: b.name })),
                ]}
              />
            </div>
          )}
        </div>
        {kind === 'saron' && (
          <div className="space-y-2">
            <Label>Bank (optional)</Label>
            <SearchableSelect
              value={bankId}
              onValueChange={setBankId}
              placeholder="Bank wählen"
              options={[
                { value: 'none', label: 'Keine Bank' },
                ...banks.map((b) => ({ value: String(b.id), label: b.name })),
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Der effektive Zinssatz ist Basissatz + Marge.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Beginn</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          {hasMaturity && (
            <div className="space-y-2">
              <Label>Ablauf der Zinsbindung</Label>
              <Input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Zahlungsrhythmus des Zinses</Label>
          <Select value={interval} onValueChange={(v) => setInterval(v as PaymentInterval)}>
            <SelectTrigger className="w-full min-w-0 [&>span]:truncate" title={RECURRING_INTERVAL_LABELS[interval]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_INTERVALS.map((i) => (
                <SelectItem key={i} value={i}>{RECURRING_INTERVAL_LABELS[i]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input placeholder="z. B. Verlängerung 2031" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        )}

        {isEdit && tranche && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Die Tranche wird unwiderruflich gelöscht — inklusive der direkten
              Amortisationen, die auf sie zeigen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteTranche.isPending}>
                  Tranche endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Tranche wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{tranche.name}“ wird unwiderruflich gelöscht — inklusive
                    der direkten Amortisationen dieser Tranche. Eine übernommene
                    Zins-Dauerbuchung bleibt bestehen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteTranche.mutate({ id: tranche.id })}
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
          disabled={addTranche.isPending || updateTranche.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
