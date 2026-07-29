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
import { SearchableSelect } from '@/components/SearchableSelect';
import PensionAttachments from '@/components/PensionAttachments';
import { accountLabel, useInvalidatePension } from '@/lib/data';
import { amountPlaceholder, currencySymbol, formatBp, parseEuro, parsePercent } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** 3a-Konto, wie es pension.listPillar3 liefert (nur die hier benötigten Felder) */
export interface DialogPillar3 {
  id: number;
  name: string;
  institution: string;
  currentBalance: number;
  yearlyDeposit: number;
  interestRateBp: number;
  accountId: number | null;
  notes: string;
}

/** Cent-Betrag als Eingabe-String (deutsches Dezimalkomma) */
const centsInput = (cents: number): string =>
  cents > 0 ? (cents / 100).toFixed(2).replace('.', ',') : '';

/** Dialog zum Anlegen/Bearbeiten eines Säule-3a-Kontos */
export default function PensionPillar3Dialog({ pillar, trigger }: { pillar?: DialogPillar3; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <Pillar3DialogForm pillar={pillar} close={() => setOpen(false)} />}
    </Dialog>
  );
}

/** Formular-Inhalt; wird bei jedem Öffnen neu gemountet, damit die Initialwerte stimmen */
function Pillar3DialogForm({ pillar, close }: { pillar?: DialogPillar3; close: () => void }) {
  const invalidate = useInvalidatePension();
  const accountsQuery = trpc.finance.listAccounts.useQuery();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const isEdit = !!pillar;
  const [name, setName] = useState(pillar?.name ?? '');
  const [institution, setInstitution] = useState(pillar?.institution ?? '');
  const [balance, setBalance] = useState(centsInput(pillar?.currentBalance ?? 0));
  const [deposit, setDeposit] = useState(centsInput(pillar?.yearlyDeposit ?? 0));
  const [interest, setInterest] = useState(pillar ? formatBp(pillar.interestRateBp) : '');
  // Sentinel „none" = keine Konto-Verknüpfung
  const [accountId, setAccountId] = useState(pillar?.accountId != null ? String(pillar.accountId) : 'none');
  const [notes, setNotes] = useState(pillar?.notes ?? '');
  const [comment, setComment] = useState('');

  const addPillar3 = trpc.pension.addPillar3.useMutation({
    onSuccess: () => { toast.success('3a-Konto angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updatePillar3 = trpc.pension.updatePillar3.useMutation({
    onSuccess: () => { toast.success('3a-Konto gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const deletePillar3 = trpc.pension.deletePillar3.useMutation({
    onSuccess: () => { toast.success('3a-Konto gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });

  const accounts = accountsQuery.data ?? [];
  const banks = banksQuery.data ?? [];

  const submit = () => {
    if (!name.trim()) {
      toast.error('Name angeben.');
      return;
    }
    const values = {
      name: name.trim(),
      institution: institution.trim(),
      currentBalance: parseEuro(balance),
      yearlyDeposit: parseEuro(deposit),
      interestRateBp: Math.round(parsePercent(interest) * 100),
      accountId: accountId === 'none' ? null : Number(accountId),
      notes: notes.trim(),
    };
    if (isEdit && pillar) {
      updatePillar3.mutate({ id: pillar.id, ...values, comment: comment.trim() || undefined });
    } else {
      addPillar3.mutate(values);
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? '3a-Konto bearbeiten' : 'Neues 3a-Konto'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Angaben zum Säule-3a-Konto anpassen.'
            : 'Säule-3a-Konto (Bank oder Versicherung) erfassen.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="z. B. 3a-Konto" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Institution</Label>
            <Input placeholder="z. B. Bank, Versicherung" value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Guthaben ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={balance} onChange={(e) => setBalance(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Jährliche Einzahlung ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Verzinsung (% p. a.)</Label>
            <Input inputMode="decimal" placeholder="1,25" value={interest} onChange={(e) => setInterest(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Konto-Verknüpfung (optional)</Label>
            <SearchableSelect
              value={accountId}
              onValueChange={setAccountId}
              placeholder="Konto wählen"
              options={[
                { value: 'none', label: 'Keine Verknüpfung' },
                ...accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) })),
              ]}
            />
          </div>
        </div>
        {accountId !== 'none' && (
          <p className="text-xs text-muted-foreground">
            Bei einer Verknüpfung zählt der Kontostand des verknüpften Kontos als
            3a-Guthaben — der manuell eingetragene Betrag wird ignoriert.
          </p>
        )}
        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input placeholder="z. B. Jahresendstand 2025" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        )}

        {isEdit && pillar && (
          <div className="space-y-2 border-t pt-3">
            <Label>Anhänge</Label>
            <PensionAttachments entityType="pillar3" entityId={pillar.id} />
          </div>
        )}

        {isEdit && pillar && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Das 3a-Konto wird unwiderruflich gelöscht — inklusive aller Anhänge.
              Ein verknüpftes Konto bleibt bestehen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deletePillar3.isPending}>
                  3a-Konto endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>3a-Konto wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{pillar.name}“ wird unwiderruflich gelöscht — inklusive aller
                    Anhänge. Ein verknüpftes Konto bleibt bestehen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deletePillar3.mutate({ id: pillar.id })}
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
          disabled={addPillar3.isPending || updatePillar3.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
