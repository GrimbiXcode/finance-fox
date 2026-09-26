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
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/SearchableSelect";
import { accountLabel, useInvalidateInsurance } from "@/lib/data";
import { formatCents, todayISO } from "@/lib/finance";
import { premiumMatches } from "@/lib/insurance";
import { RECURRING_INTERVAL_LABELS } from "@contracts/types";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

/**
 * „Als Dauerbuchung übernehmen" — die Prämie einer Police. Kopie, kein
 * Live-Sync: ändert sich die Prämie, muss die Dauerbuchung angepasst werden.
 * Gibt es schon eine passende Dauerbuchung (`premiumMatches`), steht oben
 * „Verknüpfen“ — dann entsteht keine zweite Belastung.
 */
export default function InsuranceTransferDialog({
  policy,
  trigger,
}: {
  policy: {
    id: number;
    name: string;
    premium: number;
    premiumInterval: string;
    accountId: number | null;
  };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <TransferForm policy={policy} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function TransferForm({
  policy,
  close,
}: {
  policy: Parameters<typeof InsuranceTransferDialog>[0]["policy"];
  close: () => void;
}) {
  const invalidate = useInvalidateInsurance();
  const accountsQuery = trpc.finance.listAccounts.useQuery();
  const recurringQuery = trpc.finance.listRecurring.useQuery();
  const policiesQuery = trpc.insurance.listPolicies.useQuery();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const categoriesQuery = trpc.finance.listCategories.useQuery();

  // Nur Konten, auf die wirklich gebucht werden darf
  const accounts = (accountsQuery.data ?? []).filter(a => a.access === "edit");
  const banks = banksQuery.data ?? [];
  const expenseCategories = (categoriesQuery.data ?? []).filter(
    c => c.type === "expense"
  );

  // Das hinterlegte Belastungskonto vorauswählen, wenn es bebuchbar ist
  const preselect =
    policy.accountId !== null &&
    accounts.some(a => a.id === policy.accountId)
      ? String(policy.accountId)
      : "";
  const [accountId, setAccountId] = useState(preselect);
  const [categoryId, setCategoryId] = useState("none");

  // Schon anderen Policen zugeordnete Dauerbuchungen kommen nicht in Frage
  const linkedIds = new Set(
    (policiesQuery.data ?? [])
      .map(p => p.premiumRecurringId)
      .filter((id): id is number => id !== null)
  );
  const matches = premiumMatches(
    policy,
    recurringQuery.data ?? [],
    linkedIds,
    todayISO()
  );
  const accountName = new Map(
    (accountsQuery.data ?? []).map(a => [a.id, a.name])
  );

  const link = trpc.insurance.linkPremiumToRecurring.useMutation({
    onSuccess: () => {
      toast.success("Mit der Dauerbuchung verknüpft.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });

  const transfer = trpc.insurance.transferPremiumToRecurring.useMutation({
    onSuccess: () => {
      toast.success("Dauerbuchung angelegt.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!accountId) {
      toast.error("Belastungskonto wählen.");
      return;
    }
    transfer.mutate({
      policyId: policy.id,
      accountId: Number(accountId),
      categoryId: categoryId === "none" ? null : Number(categoryId),
    });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Als Dauerbuchung übernehmen</DialogTitle>
        <DialogDescription>
          {policy.name} — {formatCents(policy.premium)}{" "}
          {RECURRING_INTERVAL_LABELS[
            policy.premiumInterval as keyof typeof RECURRING_INTERVAL_LABELS
          ].toLowerCase()}
          .
        </DialogDescription>
      </DialogHeader>
      {matches.length > 0 && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">
            {matches.length === 1
              ? "Passende Dauerbuchung gefunden"
              : "Passende Dauerbuchungen gefunden"}
          </p>
          <p className="text-xs text-muted-foreground">
            Gleicher Betrag, gleiches Intervall — wohl dieselbe Prämie.
            Verknüpfen legt nichts neu an.
          </p>
          <ul className="space-y-1.5">
            {matches.map(r => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {r.note || "Ohne Beschreibung"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {accountName.get(r.accountId) ?? "Konto"}
                    {!r.active && " · pausiert"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={link.isPending}
                  onClick={() =>
                    link.mutate({ policyId: policy.id, recurringId: r.id })
                  }
                >
                  Verknüpfen
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 py-2">
        {matches.length > 0 && (
          <p className="text-sm font-medium">Oder neu anlegen:</p>
        )}
        <div className="space-y-2">
          <Label>Belastungskonto</Label>
          <SearchableSelect
            value={accountId}
            onValueChange={setAccountId}
            placeholder="Konto wählen"
            options={accounts.map(a => ({
              value: String(a.id),
              label: accountLabel(a, banks),
            }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Kategorie (optional)</Label>
          <SearchableSelect
            value={categoryId}
            onValueChange={setCategoryId}
            placeholder="Kategorie wählen"
            options={[
              { value: "none", label: "Ohne Kategorie" },
              ...expenseCategories.map(c => ({
                value: String(c.id),
                label: c.name,
              })),
            ]}
          />
        </div>
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
          Es wird eine Kopie angelegt, kein laufender Abgleich: Ändert sich
          später die Prämie, muss die Dauerbuchung von Hand angepasst werden.
          Bereits von Hand erfasste Buchungen werden nicht rückwirkend ersetzt.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Abbrechen
        </Button>
        <Button
          variant="stamp"
          onClick={submit}
          disabled={transfer.isPending}
        >
          Übernehmen
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
