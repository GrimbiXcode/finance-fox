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
import { useInvalidateMortgage } from '@/lib/data';
import {
  amountPlaceholder, currencySymbol, formatAmountInput, formatBp, parseEuro, parsePercent,
} from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Liegenschaft, wie sie mortgage.listProperties liefert */
export interface DialogProperty {
  id: number;
  name: string;
  address: string;
  usage: 'owner_occupied' | 'rental' | 'vacation';
  purchasePrice: number;
  purchaseDate: string | null;
  marketValue: number;
  valueDate: string | null;
  householdIncome: number;
  firstMortgageLimitBp: number;
  maxLtvBp: number;
  calcInterestRateBp: number;
  maintenanceRateBp: number;
  amortizationYears: number;
  notes: string;
}

const centsInput = (cents: number): string =>
  cents > 0 ? formatAmountInput(cents) : '';

/** Dialog zum Anlegen/Bearbeiten einer Liegenschaft */
export default function MortgagePropertyDialog(
  { property, trigger }: { property?: DialogProperty; trigger: ReactNode },
) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <PropertyForm property={property} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
    </div>
  );
}

/** Wird bei jedem Öffnen neu gemountet, damit die Initialwerte stimmen */
function PropertyForm({ property, close }: { property?: DialogProperty; close: () => void }) {
  const invalidate = useInvalidateMortgage();
  const isEdit = !!property;
  const [name, setName] = useState(property?.name ?? '');
  const [address, setAddress] = useState(property?.address ?? '');
  const [usage, setUsage] = useState<DialogProperty['usage']>(property?.usage ?? 'owner_occupied');
  const [purchasePrice, setPurchasePrice] = useState(centsInput(property?.purchasePrice ?? 0));
  const [purchaseDate, setPurchaseDate] = useState(property?.purchaseDate ?? '');
  const [marketValue, setMarketValue] = useState(centsInput(property?.marketValue ?? 0));
  const [valueDate, setValueDate] = useState(property?.valueDate ?? '');
  const [income, setIncome] = useState(centsInput(property?.householdIncome ?? 0));
  const [firstLimit, setFirstLimit] = useState(formatBp(property?.firstMortgageLimitBp ?? 6667));
  const [maxLtv, setMaxLtv] = useState(formatBp(property?.maxLtvBp ?? 8000));
  const [calcRate, setCalcRate] = useState(formatBp(property?.calcInterestRateBp ?? 500));
  const [maintenance, setMaintenance] = useState(formatBp(property?.maintenanceRateBp ?? 100));
  const [years, setYears] = useState(String(property?.amortizationYears ?? 15));
  const [notes, setNotes] = useState(property?.notes ?? '');
  const [comment, setComment] = useState('');

  const addProperty = trpc.mortgage.addProperty.useMutation({
    onSuccess: () => { toast.success('Liegenschaft angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updateProperty = trpc.mortgage.updateProperty.useMutation({
    onSuccess: () => { toast.success('Liegenschaft gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteProperty = trpc.mortgage.deleteProperty.useMutation({
    onSuccess: () => { toast.success('Liegenschaft gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error('Name angeben.');
      return;
    }
    const amortizationYears = Number(years);
    if (!Number.isInteger(amortizationYears) || amortizationYears < 1 || amortizationYears > 50) {
      toast.error('Amortisationsfrist zwischen 1 und 50 Jahren angeben.');
      return;
    }
    const values = {
      name: name.trim(),
      address: address.trim(),
      usage,
      purchasePrice: parseEuro(purchasePrice),
      purchaseDate: purchaseDate || null,
      marketValue: parseEuro(marketValue),
      valueDate: valueDate || null,
      householdIncome: parseEuro(income),
      firstMortgageLimitBp: Math.round(parsePercent(firstLimit) * 100),
      maxLtvBp: Math.round(parsePercent(maxLtv) * 100),
      calcInterestRateBp: Math.round(parsePercent(calcRate) * 100),
      maintenanceRateBp: Math.round(parsePercent(maintenance) * 100),
      amortizationYears,
      notes: notes.trim(),
    };
    if (isEdit && property) {
      updateProperty.mutate({ id: property.id, ...values, comment: comment.trim() || undefined });
    } else {
      addProperty.mutate(values);
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Liegenschaft bearbeiten' : 'Neue Liegenschaft'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Angaben zur Liegenschaft anpassen.'
            : 'Wohneigentum mit Verkehrswert erfassen — Grundlage für Belehnung und Tragbarkeit.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="z. B. Eigenheim" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Nutzung</Label>
            <Select value={usage} onValueChange={(v) => setUsage(v as DialogProperty['usage'])}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner_occupied">Selbstbewohnt</SelectItem>
                <SelectItem value="rental">Renditeobjekt</SelectItem>
                <SelectItem value="vacation">Ferienobjekt</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Adresse (optional)</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <SectionTitle>Werte</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Kaufpreis ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Kaufdatum</Label>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Verkehrswert ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={marketValue} onChange={(e) => setMarketValue(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Stichtag Verkehrswert</Label>
            <Input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Bruttojahreseinkommen des Haushalts ({currencySymbol()})</Label>
          <Input inputMode="decimal" placeholder={amountPlaceholder} value={income} onChange={(e) => setIncome(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Nur für die Tragbarkeitsrechnung. Bewusst manuell: die Lohndaten im
            Vorsorge-Modul sind privat pro Person und werden hier nicht gelesen.
          </p>
        </div>

        <SectionTitle>Bank-Parameter</SectionTitle>
        <p className="text-xs text-muted-foreground">
          Die Voreinstellungen entsprechen dem Schweizer Marktstandard für
          selbstbewohntes Wohneigentum. Renditeobjekte rechnen Banken meist
          strenger (75 % Belehnung, 10 Jahre Amortisation).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Grenze 1. Hypothek (%)</Label>
            <Input inputMode="decimal" value={firstLimit} onChange={(e) => setFirstLimit(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Maximale Belehnung (%)</Label>
            <Input inputMode="decimal" value={maxLtv} onChange={(e) => setMaxLtv(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Kalkulatorischer Zins (%)</Label>
            <Input inputMode="decimal" value={calcRate} onChange={(e) => setCalcRate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Unterhalt (% des Verkehrswerts)</Label>
            <Input inputMode="decimal" value={maintenance} onChange={(e) => setMaintenance(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Amortisationsfrist (Jahre)</Label>
          <Input inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input placeholder="z. B. Neue Schätzung 2026" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        )}

        {isEdit && property && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Die Liegenschaft wird unwiderruflich gelöscht — inklusive aller
              Tranchen und Amortisationspläne. Übernommene Dauerbuchungen und
              bereits gebuchte Zahlungen bleiben bestehen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteProperty.isPending}>
                  Liegenschaft endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Liegenschaft wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{property.name}“ wird unwiderruflich gelöscht — inklusive
                    aller Tranchen und Amortisationspläne. Übernommene
                    Dauerbuchungen bleiben bestehen und müssen separat entfernt
                    werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteProperty.mutate({ id: property.id })}
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
          disabled={addProperty.isPending || updateProperty.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
