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
import { formatCents } from "@/lib/finance";
import { RECURRING_INTERVAL_LABELS } from "@contracts/types";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

/**
 * „Als Dauerbuchung übernehmen" — die Prämie einer Police. Kopie, kein
 * Live-Sync: ändert sich die Prämie, muss die Dauerbuchung angepasst werden.
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
      <div className="grid gap-4 py-2">
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
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
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
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={transfer.isPending}
        >
          Übernehmen
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
