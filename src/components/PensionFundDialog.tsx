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
import PensionAttachments from '@/components/PensionAttachments';
import { useInvalidatePension } from '@/lib/data';
import { amountPlaceholder, currencySymbol, formatAmountInput, formatBp, parseEuro, parsePercent } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Pensionskasse/Freizügigkeitskonto, wie es pension.listFunds liefert */
export interface DialogFund {
  id: number;
  name: string;
  kind: 'pension_fund' | 'vested_benefits';
  currentCapital: number;
  yearlySavings: number;
  interestRateBp: number;
  conversionRateBp: number;
  notes: string;
}

/** Cent-Betrag als Eingabe-String (locale-konformes Dezimalzeichen) */
const centsInput = (cents: number): string =>
  cents > 0 ? formatAmountInput(cents) : '';

/** Dialog zum Anlegen/Bearbeiten eines Vorsorgekontos der 2. Säule */
export default function PensionFundDialog({ fund, trigger }: { fund?: DialogFund; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <FundDialogForm fund={fund} close={() => setOpen(false)} />}
    </Dialog>
  );
}

/** Formular-Inhalt; wird bei jedem Öffnen neu gemountet, damit die Initialwerte stimmen */
function FundDialogForm({ fund, close }: { fund?: DialogFund; close: () => void }) {
  const invalidate = useInvalidatePension();
  const isEdit = !!fund;
  const [name, setName] = useState(fund?.name ?? '');
  const [kind, setKind] = useState<'pension_fund' | 'vested_benefits'>(fund?.kind ?? 'pension_fund');
  const [capital, setCapital] = useState(centsInput(fund?.currentCapital ?? 0));
  const [savings, setSavings] = useState(centsInput(fund?.yearlySavings ?? 0));
  const [interest, setInterest] = useState(fund ? formatBp(fund.interestRateBp) : '');
  const [conversion, setConversion] = useState(formatBp(fund?.conversionRateBp ?? 680));
  const [notes, setNotes] = useState(fund?.notes ?? '');
  const [comment, setComment] = useState('');

  const addFund = trpc.pension.addFund.useMutation({
    onSuccess: () => { toast.success('Vorsorgekonto angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updateFund = trpc.pension.updateFund.useMutation({
    onSuccess: () => { toast.success('Vorsorgekonto gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteFund = trpc.pension.deleteFund.useMutation({
    onSuccess: () => { toast.success('Vorsorgekonto gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error('Name angeben.');
      return;
    }
    const values = {
      name: name.trim(),
      kind,
      currentCapital: parseEuro(capital),
      yearlySavings: parseEuro(savings),
      interestRateBp: Math.round(parsePercent(interest) * 100),
      conversionRateBp: Math.round(parsePercent(conversion) * 100),
      notes: notes.trim(),
    };
    if (isEdit && fund) {
      updateFund.mutate({ id: fund.id, ...values, comment: comment.trim() || undefined });
    } else {
      addFund.mutate(values);
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Vorsorgekonto bearbeiten' : 'Neues Vorsorgekonto'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Angaben zur Pensionskasse bzw. zum Freizügigkeitskonto anpassen.'
            : 'Pensionskasse oder Freizügigkeitskonto der 2. Säule erfassen.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="z. B. PK Arbeitgeber" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Art</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                title={kind === 'pension_fund' ? 'Pensionskasse' : 'Freizügigkeitskonto'}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pension_fund">Pensionskasse</SelectItem>
                <SelectItem value="vested_benefits">Freizügigkeitskonto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Guthaben ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={capital} onChange={(e) => setCapital(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Jährliches Sparen ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={savings} onChange={(e) => setSavings(e.target.value)} />
            {kind === 'vested_benefits' && (
              <p className="text-xs text-muted-foreground">
                Freizügigkeitskonten werden in der Prognose nur verzinst.
              </p>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Verzinsung (% p. a.)</Label>
            <Input inputMode="decimal" placeholder={formatBp(125)} value={interest} onChange={(e) => setInterest(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Umwandlungssatz (%)</Label>
            <Input inputMode="decimal" placeholder={formatBp(680)} value={conversion} onChange={(e) => setConversion(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input placeholder="z. B. Auszug 2025 eingetragen" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        )}

        {isEdit && fund && (
          <div className="space-y-2 border-t pt-3">
            <Label>Anhänge</Label>
            <PensionAttachments entityType="fund" entityId={fund.id} />
          </div>
        )}

        {isEdit && fund && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Das Vorsorgekonto wird unwiderruflich gelöscht — inklusive aller Anhänge.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteFund.isPending}>
                  Vorsorgekonto endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Vorsorgekonto wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{fund.name}“ wird unwiderruflich gelöscht — inklusive aller Anhänge.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteFund.mutate({ id: fund.id })}
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
          disabled={addFund.isPending || updateFund.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
