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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { accountLabel, useInvalidateInsurance } from "@/lib/data";
import {
  amountPlaceholder,
  currencySymbol,
  formatAmountInput,
  formatDate,
  parseEuro,
  todayISO,
} from "@/lib/finance";
import {
  INSURANCE_BRANCHES,
  INSURANCE_STATUS_LABELS,
  type InsuranceBranch,
  type InsuranceRenewal,
  type InsuranceStatus,
} from "@contracts/insurance";
import { RECURRING_INTERVAL_LABELS } from "@contracts/types";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

/** Police, wie sie insurance.listPolicies liefert */
export interface DialogPolicy {
  id: number;
  name: string;
  branch: InsuranceBranch;
  insurer: string;
  policyNumber: string;
  status: InsuranceStatus;
  premium: number;
  premiumInterval: string;
  deductible: number | null;
  startDate: string;
  renewal: InsuranceRenewal;
  mainDueDate: string | null;
  endDate: string | null;
  noticePeriodMonths: number;
  accountId: number | null;
  notes: string;
  personIds: number[];
}

type PremiumInterval = "monthly" | "quarterly" | "semiannual" | "yearly";

const PREMIUM_INTERVALS: PremiumInterval[] = [
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
];

const centsInput = (cents: number | null): string =>
  cents !== null && cents > 0 ? formatAmountInput(cents) : "";

/** Dialog zum Anlegen/Bearbeiten einer Police */
export default function InsurancePolicyDialog({
  policy,
  trigger,
}: {
  policy?: DialogPolicy;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <PolicyForm policy={policy} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/** Wird bei jedem Öffnen neu gemountet, damit die Initialwerte stimmen */
function PolicyForm({
  policy,
  close,
}: {
  policy?: DialogPolicy;
  close: () => void;
}) {
  const invalidate = useInvalidateInsurance();
  const isEdit = !!policy;
  const accountsQuery = trpc.finance.listAccounts.useQuery();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const usersQuery = trpc.auth.listUsers.useQuery();

  const [name, setName] = useState(policy?.name ?? "");
  const [branch, setBranch] = useState<InsuranceBranch>(
    policy?.branch ?? "hausrat"
  );
  const [insurer, setInsurer] = useState(policy?.insurer ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy?.policyNumber ?? "");
  const [status, setStatus] = useState<InsuranceStatus>(
    policy?.status ?? "active"
  );
  const [premium, setPremium] = useState(centsInput(policy?.premium ?? 0));
  const [interval, setInterval] = useState<PremiumInterval>(
    (policy?.premiumInterval as PremiumInterval) ?? "yearly"
  );
  const [deductible, setDeductible] = useState(
    centsInput(policy?.deductible ?? null)
  );
  const [startDate, setStartDate] = useState(policy?.startDate ?? todayISO());
  const [renewal, setRenewal] = useState<InsuranceRenewal>(
    policy?.renewal ?? "auto"
  );
  const [mainDueDate, setMainDueDate] = useState(policy?.mainDueDate ?? "");
  const [endDate, setEndDate] = useState(policy?.endDate ?? "");
  const [noticeMonths, setNoticeMonths] = useState(
    String(policy?.noticePeriodMonths ?? 3)
  );
  const [accountId, setAccountId] = useState(
    policy?.accountId !== null && policy?.accountId !== undefined
      ? String(policy.accountId)
      : "none"
  );
  const [personIds, setPersonIds] = useState<number[]>(policy?.personIds ?? []);
  const [notes, setNotes] = useState(policy?.notes ?? "");
  const [comment, setComment] = useState("");

  const accounts = accountsQuery.data ?? [];
  const banks = banksQuery.data ?? [];
  const users = usersQuery.data ?? [];

  const onError = (err: { message: string }) => toast.error(err.message);
  const addPolicy = trpc.insurance.addPolicy.useMutation({
    onSuccess: () => {
      toast.success("Police angelegt.");
      invalidate();
      close();
    },
    onError,
  });
  const updatePolicy = trpc.insurance.updatePolicy.useMutation({
    onSuccess: () => {
      toast.success("Police gespeichert.");
      invalidate();
      close();
    },
    onError,
  });
  const deletePolicy = trpc.insurance.deletePolicy.useMutation({
    onSuccess: () => {
      toast.success("Police gelöscht.");
      invalidate();
      close();
    },
    onError,
  });

  const togglePerson = (id: number) =>
    setPersonIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );

  // Live-Vorschau der Frist — dieselbe Rechnung wie serverseitig, aber nur
  // für den einfachen Fall (der Server bleibt die Quelle der Wahrheit).
  const previewCancelBy = (): string | null => {
    const months = Number(noticeMonths);
    if (!Number.isInteger(months) || months < 0) return null;
    const anchor = renewal === "fixed" ? endDate : mainDueDate || startDate;
    if (!anchor) return null;
    const [y, m, d] = anchor.split("-").map(Number);
    if (!y || !m || !d) return null;
    const total = y * 12 + (m - 1) - months;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const maxDay = new Date(year, month, 0).getDate();
    const day = Math.min(d, maxDay);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const preview = previewCancelBy();

  const submit = () => {
    if (!name.trim()) {
      toast.error("Name angeben.");
      return;
    }
    if (!startDate) {
      toast.error("Vertragsbeginn angeben.");
      return;
    }
    const months = Number(noticeMonths);
    if (!Number.isInteger(months) || months < 0 || months > 60) {
      toast.error("Kündigungsfrist zwischen 0 und 60 Monaten angeben.");
      return;
    }
    const values = {
      name: name.trim(),
      branch,
      insurer: insurer.trim(),
      policyNumber: policyNumber.trim(),
      status,
      premium: parseEuro(premium),
      premiumInterval: interval,
      deductible: deductible.trim() === "" ? null : parseEuro(deductible),
      startDate,
      renewal,
      mainDueDate: renewal === "fixed" ? null : mainDueDate || null,
      endDate: endDate || null,
      noticePeriodMonths: months,
      accountId: accountId === "none" ? null : Number(accountId),
      notes: notes.trim(),
      personIds,
    };
    if (isEdit && policy) {
      updatePolicy.mutate({
        id: policy.id,
        ...values,
        comment: comment.trim() || undefined,
      });
    } else {
      addPolicy.mutate(values);
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Police bearbeiten" : "Neue Police"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Angaben zur Versicherung anpassen."
            : "Versicherung erfassen — Grundlage für Vergleich, Fristen und Deckungs-Check."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="z. B. Hausrat & Privathaftpflicht"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Sparte</Label>
            <SearchableSelect
              value={branch}
              onValueChange={v => setBranch(v as InsuranceBranch)}
              placeholder="Sparte wählen"
              options={INSURANCE_BRANCHES.map(b => ({
                value: b.key,
                label: b.label,
              }))}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Versicherer (optional)</Label>
            <Input
              value={insurer}
              onChange={e => setInsurer(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Policennummer (optional)</Label>
            <Input
              value={policyNumber}
              onChange={e => setPolicyNumber(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={status}
            onValueChange={v => setStatus(v as InsuranceStatus)}
          >
            <SelectTrigger
              className="w-full min-w-0 [&>span]:truncate"
              title={INSURANCE_STATUS_LABELS[status]}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="cancelled">Gekündigt</SelectItem>
              <SelectItem value="expired">Abgelaufen</SelectItem>
              <SelectItem value="quote">Angebot</SelectItem>
            </SelectContent>
          </Select>
          {status === "quote" && (
            <p className="text-xs text-muted-foreground">
              Angebote zählen nicht in die Prämiensummen und gelten im
              Deckungs-Check nicht als Deckung — im Vergleich erscheinen sie.
            </p>
          )}
        </div>

        <SectionTitle>Vertrag &amp; Frist</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Vertragsbeginn</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Verlängerung</Label>
            <Select
              value={renewal}
              onValueChange={v => setRenewal(v as InsuranceRenewal)}
            >
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Verlängert sich automatisch</SelectItem>
                <SelectItem value="fixed">Befristet</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {renewal === "auto" ? (
            <div className="space-y-2">
              <Label>Hauptverfall (optional)</Label>
              <Input
                type="date"
                value={mainDueDate}
                onChange={e => setMainDueDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leer = Jahrestag des Vertragsbeginns.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Vertragsende</Label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Kündigungsfrist (Monate)</Label>
            <Input
              inputMode="numeric"
              value={noticeMonths}
              onChange={e => setNoticeMonths(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              0 = jederzeit kündbar.
            </p>
          </div>
        </div>
        {renewal === "auto" && (
          <div className="space-y-2">
            <Label>Vertragsende (optional)</Label>
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Nur ausfüllen, wenn die Police bereits gekündigt ist — bis zu
              diesem Datum besteht die Deckung weiter.
            </p>
          </div>
        )}
        {preview && (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Kündigen bis:{" "}
            <span className="font-semibold text-foreground">
              {formatDate(preview)}
            </span>{" "}
            — der Server rechnet den nächsten erreichbaren Termin und zeigt ihn
            auf der Karte.
          </p>
        )}

        <SectionTitle>Prämie</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Prämie ({currencySymbol()})</Label>
            <Input
              inputMode="decimal"
              placeholder={amountPlaceholder}
              value={premium}
              onChange={e => setPremium(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Zahlungsintervall</Label>
            <Select
              value={interval}
              onValueChange={v => setInterval(v as PremiumInterval)}
            >
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREMIUM_INTERVALS.map(i => (
                  <SelectItem key={i} value={i}>
                    {RECURRING_INTERVAL_LABELS[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Selbstbehalt / Franchise ({currencySymbol()})</Label>
            <Input
              inputMode="decimal"
              placeholder={amountPlaceholder}
              value={deductible}
              onChange={e => setDeductible(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leer lassen, wenn nicht erfasst — 0 ist ein gültiger Wert.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Belastungskonto (optional)</Label>
            <SearchableSelect
              value={accountId}
              onValueChange={setAccountId}
              placeholder="Konto wählen"
              options={[
                { value: "none", label: "Ohne Konto" },
                ...accounts.map(a => ({
                  value: String(a.id),
                  label: accountLabel(a, banks),
                })),
              ]}
            />
          </div>
        </div>

        <SectionTitle>Versicherte Personen</SectionTitle>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            {users.map(u => (
              <label
                key={u.id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={personIds.includes(u.id)}
                  onCheckedChange={() => togglePerson(u.id)}
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: u.color }}
                />
                <span className="min-w-0 truncate">{u.name}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Keine Auswahl = gemeinsame Police des Haushalts (gilt im
            Deckungs-Check für alle). Die Auswahl steuert nur die Zuordnung —
            sichtbar ist die Police ohnehin für alle Mitglieder.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
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
              placeholder="z. B. Prämie 2027 angepasst"
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        )}

        {isEdit && policy && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">
              Gefahrenzone
            </p>
            <p className="text-xs text-muted-foreground">
              Die Police wird unwiderruflich gelöscht — inklusive aller
              Deckungen und Dokumente. Übernommene Dauerbuchungen bleiben
              bestehen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={deletePolicy.isPending}
                >
                  Police endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Police wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{policy.name}“ wird unwiderruflich gelöscht — inklusive
                    aller Deckungen und hinterlegter Dokumente. Übernommene
                    Dauerbuchungen bleiben bestehen und müssen separat entfernt
                    werden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deletePolicy.mutate({ id: policy.id })}
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
          disabled={addPolicy.isPending || updatePolicy.isPending}
        >
          {isEdit ? "Speichern" : "Anlegen"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
