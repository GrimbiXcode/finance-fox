import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateInsurance } from "@/lib/data";
import {
  amountPlaceholder,
  currencySymbol,
  formatAmountInput,
  parseEuro,
} from "@/lib/finance";
import {
  INSURANCE_BRANCH_BY_KEY,
  type InsuranceBranch,
} from "@contracts/insurance";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

/** Deckung, wie sie insurance.listCoverages liefert */
export interface DialogCoverage {
  id: number;
  policyId: number;
  label: string;
  sumInsured: number | null;
  deductible: number | null;
  notes: string;
}

const centsInput = (cents: number | null): string =>
  cents !== null && cents > 0 ? formatAmountInput(cents) : "";

/**
 * Dialog für eine Deckungs-Zeile („wofür bin ich versichert?").
 * Die Sparte liefert nur Vorschläge, keine Pflichtfelder — Versicherer
 * benennen dieselbe Deckung unterschiedlich.
 */
export default function InsuranceCoverageDialog({
  policyId,
  branch,
  usedLabels,
  coverage,
  trigger,
}: {
  policyId: number;
  branch: InsuranceBranch;
  /** Bereits erfasste Bezeichnungen — die Chips filtern sie heraus */
  usedLabels: string[];
  coverage?: DialogCoverage;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <CoverageForm
          policyId={policyId}
          branch={branch}
          usedLabels={usedLabels}
          coverage={coverage}
          close={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function CoverageForm({
  policyId,
  branch,
  usedLabels,
  coverage,
  close,
}: {
  policyId: number;
  branch: InsuranceBranch;
  usedLabels: string[];
  coverage?: DialogCoverage;
  close: () => void;
}) {
  const invalidate = useInvalidateInsurance();
  const isEdit = !!coverage;
  const [label, setLabel] = useState(coverage?.label ?? "");
  const [unlimited, setUnlimited] = useState(
    isEdit ? coverage.sumInsured === null : false
  );
  const [sumInsured, setSumInsured] = useState(
    centsInput(coverage?.sumInsured ?? null)
  );
  const [deductible, setDeductible] = useState(
    centsInput(coverage?.deductible ?? null)
  );
  const [notes, setNotes] = useState(coverage?.notes ?? "");
  const [comment, setComment] = useState("");

  const onError = (err: { message: string }) => toast.error(err.message);
  const addCoverage = trpc.insurance.addCoverage.useMutation({
    onSuccess: () => {
      toast.success("Deckung hinzugefügt.");
      invalidate();
      close();
    },
    onError,
  });
  const updateCoverage = trpc.insurance.updateCoverage.useMutation({
    onSuccess: () => {
      toast.success("Deckung gespeichert.");
      invalidate();
      close();
    },
    onError,
  });
  const deleteCoverage = trpc.insurance.deleteCoverage.useMutation({
    onSuccess: () => {
      toast.success("Deckung gelöscht.");
      invalidate();
      close();
    },
    onError,
  });

  const used = new Set(usedLabels.map(l => l.trim().toLowerCase()));
  const suggestions = INSURANCE_BRANCH_BY_KEY[branch].coverageSuggestions.filter(
    s => !used.has(s.toLowerCase())
  );

  const submit = () => {
    if (!label.trim()) {
      toast.error("Bezeichnung angeben.");
      return;
    }
    const values = {
      label: label.trim(),
      // null heißt hier ausdrücklich „unbegrenzt", nicht „unbekannt"
      sumInsured: unlimited
        ? null
        : sumInsured.trim() === ""
          ? null
          : parseEuro(sumInsured),
      deductible: deductible.trim() === "" ? null : parseEuro(deductible),
      notes: notes.trim(),
    };
    if (isEdit && coverage) {
      updateCoverage.mutate({
        id: coverage.id,
        ...values,
        comment: comment.trim() || undefined,
      });
    } else {
      addCoverage.mutate({ policyId, ...values });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Deckung bearbeiten" : "Deckung hinzufügen"}
        </DialogTitle>
        <DialogDescription>
          Wofür genau diese Police aufkommt — mit Summe und Selbstbehalt wird
          sie vergleichbar.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label>Bezeichnung</Label>
          <Input
            placeholder="z. B. Annullierungskosten"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          {!isEdit && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {suggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setLabel(s)}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:border-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Deckungssumme ({currencySymbol()})</Label>
          <Input
            inputMode="decimal"
            placeholder={amountPlaceholder}
            value={unlimited ? "" : sumInsured}
            disabled={unlimited}
            onChange={e => setSumInsured(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={unlimited}
              onCheckedChange={v => setUnlimited(v === true)}
            />
            <span>Unbegrenzt</span>
          </label>
        </div>
        <div className="space-y-2">
          <Label>Abweichender Selbstbehalt ({currencySymbol()})</Label>
          <Input
            inputMode="decimal"
            placeholder={amountPlaceholder}
            value={deductible}
            onChange={e => setDeductible(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leer lassen, wenn der Selbstbehalt der Police gilt.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Notiz (optional)</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        )}

        {isEdit && coverage && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">
              Gefahrenzone
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={deleteCoverage.isPending}
                >
                  Deckung löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deckung wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{coverage.label}“ wird aus dieser Police entfernt.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteCoverage.mutate({ id: coverage.id })}
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
        <Button variant="outline" onClick={close}>
          Abbrechen
        </Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={addCoverage.isPending || updateCoverage.isPending}
        >
          {isEdit ? "Speichern" : "Hinzufügen"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
