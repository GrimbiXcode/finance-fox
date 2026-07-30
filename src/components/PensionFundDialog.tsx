import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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

/** Sparbeitrags-Stufe, wie sie pension.listFunds liefert (Raten in Basispunkten) */
export interface DialogFundTier {
  ageFrom: number;
  employeeRateBp: number;
  employerRateBp: number;
}

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
  employer: string | null;
  insuredSalary: number | null;
  coordinationDeduction: number | null;
  buyInPotential: number | null;
  disabilityPension: number | null;
  deathBenefit: number | null;
  /** Stichtag der Angaben (YYYY-MM-DD) — Prognose akkumuliert ab diesem Datum */
  valueDate: string | null;
  tiers: DialogFundTier[];
}

/** Cent-Betrag als Eingabe-String (locale-konformes Dezimalzeichen; null/0 = leer) */
const centsInput = (cents: number | null | undefined): string =>
  cents != null && cents > 0 ? formatAmountInput(cents) : '';

/** Leerer Eingabe-String → null (Feld entfernen), sonst Cent-Betrag */
const nullableCents = (input: string): number | null =>
  input.trim() === '' ? null : parseEuro(input);

/** Eingabe-Zeile des Stufen-Editors (Raten als Prozent-Strings) */
interface TierRow {
  ageFrom: string;
  employee: string;
  employer: string;
}

/** Typische CH-Sparbeitrags-Staffel (AN/AG in Basispunkten) */
const DEFAULT_TIERS: TierRow[] = [
  { ageFrom: '25', employee: formatBp(700), employer: formatBp(700) },
  { ageFrom: '35', employee: formatBp(1000), employer: formatBp(1000) },
  { ageFrom: '45', employee: formatBp(1500), employer: formatBp(1500) },
  { ageFrom: '55', employee: formatBp(1800), employer: formatBp(1800) },
];

/** Kleine Zwischenüberschrift mit Trennlinie für die Formular-Sektionen */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

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
  const [employer, setEmployer] = useState(fund?.employer ?? '');
  const [capital, setCapital] = useState(centsInput(fund?.currentCapital ?? 0));
  const [valueDate, setValueDate] = useState(fund?.valueDate ?? '');
  const [insuredSalary, setInsuredSalary] = useState(centsInput(fund?.insuredSalary));
  const [coordinationDeduction, setCoordinationDeduction] = useState(centsInput(fund?.coordinationDeduction));
  const [buyInPotential, setBuyInPotential] = useState(centsInput(fund?.buyInPotential));
  const [savings, setSavings] = useState(centsInput(fund?.yearlySavings ?? 0));
  const [tiers, setTiers] = useState<TierRow[]>(
    (fund?.tiers ?? []).map((t) => ({
      ageFrom: String(t.ageFrom),
      employee: formatBp(t.employeeRateBp),
      employer: formatBp(t.employerRateBp),
    })),
  );
  const [interest, setInterest] = useState(fund ? formatBp(fund.interestRateBp) : '');
  const [conversion, setConversion] = useState(formatBp(fund?.conversionRateBp ?? 680));
  const [disabilityPension, setDisabilityPension] = useState(centsInput(fund?.disabilityPension));
  const [deathBenefit, setDeathBenefit] = useState(centsInput(fund?.deathBenefit));
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

  const setTier = (index: number, patch: Partial<TierRow>) =>
    setTiers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Eingegebene Stufen validieren und in das Backend-Format (int, Basispunkte) bringen */
  const parseTiers = (): DialogFundTier[] | null => {
    const parsed: DialogFundTier[] = [];
    for (const row of tiers) {
      // Komplett leere Zeilen ignorieren
      if (!row.ageFrom.trim() && !row.employee.trim() && !row.employer.trim()) continue;
      const ageFrom = Number(row.ageFrom);
      if (!Number.isInteger(ageFrom) || ageFrom < 18 || ageFrom > 75) {
        toast.error('Abstufungen: „Ab Alter“ muss eine ganze Zahl zwischen 18 und 75 sein.');
        return null;
      }
      parsed.push({
        ageFrom,
        employeeRateBp: Math.round(parsePercent(row.employee) * 100),
        employerRateBp: Math.round(parsePercent(row.employer) * 100),
      });
    }
    if (new Set(parsed.map((t) => t.ageFrom)).size !== parsed.length) {
      toast.error('Abstufungen: Pro Alter nur eine Stufe.');
      return null;
    }
    return parsed;
  };

  const submit = () => {
    if (!name.trim()) {
      toast.error('Name angeben.');
      return;
    }
    // Stufen-Editor gibt es nur für Pensionskassen; Freizügigkeitskonten
    // bekommen beim Speichern eine leere Liste (Ersetzen-Semantik)
    const parsedTiers = kind === 'pension_fund' ? parseTiers() : [];
    if (parsedTiers === null) return;
    const values = {
      name: name.trim(),
      kind,
      currentCapital: parseEuro(capital),
      yearlySavings: parseEuro(savings),
      interestRateBp: Math.round(parsePercent(interest) * 100),
      conversionRateBp: Math.round(parsePercent(conversion) * 100),
      notes: notes.trim(),
      employer: employer.trim() || null,
      insuredSalary: nullableCents(insuredSalary),
      coordinationDeduction: nullableCents(coordinationDeduction),
      buyInPotential: nullableCents(buyInPotential),
      disabilityPension: nullableCents(disabilityPension),
      deathBenefit: nullableCents(deathBenefit),
      valueDate: valueDate || null,
      tiers: parsedTiers,
    };
    if (isEdit && fund) {
      updateFund.mutate({ id: fund.id, ...values, comment: comment.trim() || undefined });
    } else {
      addFund.mutate(values);
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Vorsorgekonto bearbeiten' : 'Neues Vorsorgekonto'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Angaben zur Pensionskasse bzw. zum Freizügigkeitskonto anpassen.'
            : 'Pensionskasse oder Freizügigkeitskonto der 2. Säule erfassen.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <SectionTitle>Stammdaten</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="z. B. PK Arbeitgeber" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Arbeitgeber (optional)</Label>
            <Input placeholder="z. B. Muster AG" value={employer} onChange={(e) => setEmployer(e.target.value)} />
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

        <SectionTitle>Guthaben &amp; Lohn</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Guthaben ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={capital} onChange={(e) => setCapital(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Stichtag der Angaben (optional)</Label>
            <Input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Das Guthaben gilt per diesem Datum (z. B. 31.12. des Ausweises) — die
              Prognose rechnet ab dann. Leer = ab heute.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Versicherter Jahreslohn ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={insuredSalary} onChange={(e) => setInsuredSalary(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Koordinationsabzug ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={coordinationDeduction} onChange={(e) => setCoordinationDeduction(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Einkaufspotenzial ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={buyInPotential} onChange={(e) => setBuyInPotential(e.target.value)} />
          </div>
        </div>

        <SectionTitle>Sparbeiträge</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Jährliches Sparen ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={savings} onChange={(e) => setSavings(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {kind === 'vested_benefits'
                ? 'Freizügigkeitskonten werden in der Prognose nur verzinst.'
                : 'Gilt in der Prognose nur, wenn keine Abstufungen mit versichertem Lohn hinterlegt sind.'}
            </p>
          </div>
        </div>
        {kind === 'pension_fund' && (
          <div className="space-y-2">
            <Label>Abstufungen nach Alter (AN/AG in % des versicherten Lohns)</Label>
            {tiers.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <span className="text-xs text-muted-foreground">Ab Alter</span>
                  <span className="text-xs text-muted-foreground">AN %</span>
                  <span className="text-xs text-muted-foreground">AG %</span>
                  <span />
                </div>
                {tiers.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="25"
                      aria-label={`Stufe ${i + 1}: ab Alter`}
                      value={row.ageFrom}
                      onChange={(e) => setTier(i, { ageFrom: e.target.value })}
                    />
                    <Input
                      inputMode="decimal"
                      placeholder={formatBp(700)}
                      aria-label={`Stufe ${i + 1}: AN %`}
                      value={row.employee}
                      onChange={(e) => setTier(i, { employee: e.target.value })}
                    />
                    <Input
                      inputMode="decimal"
                      placeholder={formatBp(700)}
                      aria-label={`Stufe ${i + 1}: AG %`}
                      value={row.employer}
                      onChange={(e) => setTier(i, { employer: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Stufe entfernen"
                      onClick={() => setTiers((rows) => rows.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTiers((rows) => [...rows, { ageFrom: '', employee: '', employer: '' }])}
              >
                <Plus className="mr-2 h-4 w-4" /> Stufe hinzufügen
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Typische CH-Staffel (25: 7/7, 35: 10/10, 45: 15/15, 55: 18/18) — ersetzt die aktuellen Zeilen"
                onClick={() => setTiers(DEFAULT_TIERS)}
              >
                Standard-Staffel
              </Button>
            </div>
          </div>
        )}

        <SectionTitle>Konditionen</SectionTitle>
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

        <SectionTitle>Risikoleistungen</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Invalidenrente pro Jahr ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={disabilityPension} onChange={(e) => setDisabilityPension(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Todesfallkapital ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={deathBenefit} onChange={(e) => setDeathBenefit(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2 border-t pt-3">
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
