import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileText,
  History,
  Info,
  Pencil,
  Plus,
  Repeat,
  Search,
  ShieldCheck,
  Umbrella,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { SearchableSelect } from "@/components/SearchableSelect";
import InsuranceAttachments from "@/components/InsuranceAttachments";
import InsuranceCoverageDialog from "@/components/InsuranceCoverageDialog";
import InsurancePolicyDialog from "@/components/InsurancePolicyDialog";
import InsuranceTransferDialog from "@/components/InsuranceTransferDialog";
import { trpc } from "@/providers/trpc";
import { useInvalidateInsurance } from "@/lib/data";
import { buildComparison } from "@/lib/insurance";
import {
  formatCents,
  formatDate,
  getUserLocale,
  formatBp,
  localISO,
} from "@/lib/finance";
import {
  INSURANCE_BRANCHES,
  INSURANCE_BRANCH_LABELS,
  INSURANCE_STATUS_LABELS,
  type InsuranceStatus,
} from "@contracts/insurance";
import { RECURRING_INTERVAL_LABELS } from "@contracts/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Outputs = inferRouterOutputs<AppRouter>;
type Policy = Outputs["insurance"]["listPolicies"][number];
type Coverage = Outputs["insurance"]["listCoverages"][number];
type Gap = Outputs["insurance"]["gapAnalysis"]["gaps"][number];

const MAX_COMPARE = 4;

/* ------------------------------- Historie --------------------------------- */

const ENTITY_LABELS: Record<string, string> = {
  policy: "Police",
  coverage: "Deckung",
  gap: "Deckungs-Check",
};

const MONEY_FIELDS = new Set(["Prämie", "Selbstbehalt", "Deckungssumme"]);
const DATE_FIELDS = new Set([
  "Vertragsbeginn",
  "Hauptverfall",
  "Vertragsende",
]);

const formatHistoryValue = (
  field: string,
  value: string | number | null
): string => {
  if (value === null) return "—";
  // „unbegrenzt" ist ein Wort, kein Betrag
  if (typeof value === "string" && !/^-?\d+$/.test(value)) {
    return DATE_FIELDS.has(field) && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatDate(value)
      : value;
  }
  if (MONEY_FIELDS.has(field)) return formatCents(Number(value));
  if (field.endsWith("(Bp)")) return `${formatBp(Number(value))} %`;
  if (DATE_FIELDS.has(field)) return formatDate(String(value));
  return String(value);
};

const dateTimeFormatter = new Intl.DateTimeFormat(getUserLocale(), {
  dateStyle: "short",
  timeStyle: "short",
});

/* ------------------------------- Lückentexte ------------------------------ */

/**
 * Hinweise kommen als strukturierte Daten vom Server — Beträge und
 * Datumsangaben werden erst hier locale-konform formatiert.
 */
function gapText(g: Gap): string {
  switch (g.kind) {
    case "missing_person":
      return `${g.personName} hat keine ${INSURANCE_BRANCH_LABELS[g.branch]} erfasst.`;
    case "missing_household":
      return `Für den Haushalt ist keine ${INSURANCE_BRANCH_LABELS[g.branch]} erfasst.`;
    case "missing_building":
      return g.propertyName
        ? `Für „${g.propertyName}“ ist keine Gebäudeversicherung erfasst.`
        : "Es ist Wohneigentum erfasst, aber keine Gebäudeversicherung.";
    case "coverage_ending":
      return `Die Deckung von „${g.policy}“ (${INSURANCE_BRANCH_LABELS[g.branch]}) endet am ${formatDate(g.endDate)} — in ${g.days} Tagen — und es gibt keine Nachfolge.`;
    case "notice_soon":
      return `„${g.policy}“ muss bis zum ${formatDate(g.cancelBy)} gekündigt werden (in ${g.days} Tagen), sonst verlängert sie sich.`;
    case "notice_missed":
      return g.nextCancelBy
        ? `Die Kündigungsfrist von „${g.policy}“ für den ${formatDate(g.dueDate)} ist verstrichen — nächste Möglichkeit: kündigen bis ${formatDate(g.nextCancelBy)}.`
        : `Die Kündigungsfrist von „${g.policy}“ für den ${formatDate(g.dueDate)} ist verstrichen.`;
    case "expiring":
      return `„${g.policy}“ läuft am ${formatDate(g.dueDate)} aus (in ${g.days} Tagen).`;
    case "no_end_date":
      return `„${g.policy}“ ist als befristet markiert, hat aber kein Vertragsende.`;
    case "no_premium":
      return `Für „${g.policy}“ ist keine Prämie erfasst.`;
    case "no_coverage":
      return `Für „${g.policy}“ sind keine Deckungen erfasst — dann lässt sich nicht nachschlagen, wofür sie aufkommt.`;
    case "quote_pending":
      return `Das Angebot „${g.policy}“ liegt seit ${g.days} Tagen unentschieden herum.`;
  }
}

/* ------------------------------ Leerer Zustand ---------------------------- */

function SetupCard() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Umbrella className="h-5 w-5 text-emerald-600" />
          Versicherungen erfassen
        </CardTitle>
        <CardDescription>
          Alle Policen des Haushalts an einem Ort — gemeinsame wie
          personenbezogene. Finance Fox stellt sie zum Vergleich nebeneinander,
          erinnert an Kündigungsfristen und zeigt, wo Deckungslücken bestehen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <InsurancePolicyDialog
          trigger={
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-2 h-4 w-4" /> Police anlegen
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Kennzahl ------------------------------- */

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-bold",
            tone === "warn" && "text-destructive"
          )}
        >
          {value}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Deckungs-Check ----------------------------- */

type DismissedGap = Outputs["insurance"]["gapAnalysis"]["dismissed"][number];

function GapRow({
  gap,
  dismissal,
  dismissed,
}: {
  gap: Gap;
  dismissal?: DismissedGap["dismissal"];
  dismissed?: boolean;
}) {
  const invalidate = useInvalidateInsurance();
  const [note, setNote] = useState("");
  const dismiss = trpc.insurance.dismissGap.useMutation({
    onSuccess: () => {
      toast.success("Hinweis ausgeblendet.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const restore = trpc.insurance.restoreGap.useMutation({
    onSuccess: () => {
      toast.success("Hinweis wieder eingeblendet.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="flex items-start gap-3 border-b py-2 last:border-0">
      {gap.severity === "warn" ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm",
            dismissed && "text-muted-foreground line-through"
          )}
        >
          {gapText(gap)}
        </p>
        {dismissal && (
          <p className="text-xs text-muted-foreground">
            {dismissal.note && <span>„{dismissal.note}“ · </span>}
            ausgeblendet von{" "}
            <span style={{ color: dismissal.userColor ?? undefined }}>
              {dismissal.userName ?? "Unbekannt"}
            </span>{" "}
            am {formatDate(localISO(new Date(dismissal.createdAt)))}
          </p>
        )}
      </div>
      {dismissed ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={restore.isPending}
          onClick={() => restore.mutate({ key: gap.key })}
        >
          Einblenden
        </Button>
      ) : (
        gap.dismissible && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                title="Hinweis ausblenden"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hinweis ausblenden?</AlertDialogTitle>
                <AlertDialogDescription>
                  Der Hinweis verschwindet aus dem Deckungs-Check, bleibt aber
                  unter „ausgeblendet“ auffindbar und lässt sich zurückholen.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                placeholder="Begründung (optional), z. B. „über die Hausratspolice gedeckt“"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    dismiss.mutate({ key: gap.key, note: note.trim() })
                  }
                >
                  Ausblenden
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      )}
    </div>
  );
}

function GapCard() {
  const gapsQuery = trpc.insurance.gapAnalysis.useQuery();
  const [showDismissed, setShowDismissed] = useState(false);
  const gaps = gapsQuery.data?.gaps ?? [];
  const dismissed = gapsQuery.data?.dismissed ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Deckungs-Check
        </CardTitle>
        <CardDescription>
          Regelbasierte Hinweise auf fehlende Deckungen und anstehende Fristen.
          Angebote zählen dabei nicht als Deckung.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {gapsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Prüfe Deckungen…</p>
        ) : gaps.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Keine Lücken gefunden.
          </p>
        ) : (
          <div>
            {gaps.map(g => (
              <GapRow key={g.key} gap={g} />
            ))}
          </div>
        )}
        {dismissed.length > 0 && (
          <Collapsible
            open={showDismissed}
            onOpenChange={setShowDismissed}
            className="pt-3"
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">
                <ChevronDown
                  className={cn(
                    "mr-1 h-3.5 w-3.5 transition-transform",
                    showDismissed && "rotate-180"
                  )}
                />
                {dismissed.length} ausgeblendet
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              {dismissed.map(g => (
                <GapRow
                  key={g.key}
                  gap={g}
                  dismissal={g.dismissal}
                  dismissed
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Vergleichsansicht -------------------------- */

function ComparisonCard({
  policies,
  coverages,
  onClear,
}: {
  policies: Policy[];
  coverages: Coverage[];
  onClear: () => void;
}) {
  const comparison = useMemo(
    () => buildComparison(policies, coverages),
    [policies, coverages]
  );

  const cell = (
    key: string,
    value: string | null,
    isBest: boolean,
    sub?: string | null
  ) => (
    <TableCell key={key} className="min-w-[9rem] align-top">
      <span
        className={cn(
          value === null && "text-muted-foreground",
          isBest && "font-semibold text-emerald-600"
        )}
      >
        {value ?? "—"}
      </span>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </TableCell>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>Vergleich ({policies.length} Policen)</CardTitle>
          <CardDescription>
            Der beste Wert je Zeile ist hervorgehoben — bei der Prämie der
            niedrigste Jahresbetrag, bei Deckungen die höchste Summe.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onClear}>
          Auswahl aufheben
        </Button>
      </CardHeader>
      {/* ui/table bringt seinen eigenen overflow-x-auto-Container mit —
          damit scrollt die Tabelle, nie die Seite. */}
      <CardContent className="p-0">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-card whitespace-nowrap">
                Merkmal
              </TableHead>
              {comparison.policies.map(p => (
                <TableHead key={p.id} className="min-w-[9rem]">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground" title={p.name}>
                      {p.name}
                    </p>
                    <Badge variant="secondary" className="mt-1">
                      {INSURANCE_BRANCH_LABELS[p.branch]}
                    </Badge>
                    {p.status === "quote" && (
                      <Badge variant="outline" className="ml-1 mt-1">
                        Angebot
                      </Badge>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.facts.map(row => (
              <TableRow key={row.label}>
                <TableCell className="sticky left-0 z-10 bg-card whitespace-nowrap font-medium">
                  {row.label}
                </TableCell>
                {row.cells.map((c, i) =>
                  cell(`${row.label}-${comparison.policies[i].id}`, c, row.bestIndex === i)
                )}
              </TableRow>
            ))}
            {comparison.coverages.length > 0 && (
              <TableRow>
                <TableCell
                  className="sticky left-0 z-10 bg-card whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  colSpan={1}
                >
                  Deckungen
                </TableCell>
                {comparison.policies.map(p => (
                  <TableCell key={p.id} />
                ))}
              </TableRow>
            )}
            {comparison.coverages.map(row => (
              <TableRow key={`c-${row.label}`}>
                <TableCell className="sticky left-0 z-10 bg-card whitespace-nowrap font-medium">
                  {row.label}
                </TableCell>
                {row.cells.map((c, i) =>
                  cell(
                    `c-${row.label}-${comparison.policies[i].id}`,
                    c,
                    row.bestIndex === i,
                    row.subCells?.[i]
                  )
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------- Policen-Karte ---------------------------- */

const STATUS_BADGE: Record<InsuranceStatus, string> = {
  active: "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  expired: "border-muted bg-muted text-muted-foreground",
  quote: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
};

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 font-medium",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function PolicyCard({
  policy,
  coverages,
  users,
  selected,
  onToggleSelect,
}: {
  policy: Policy;
  coverages: Coverage[];
  users: { id: number; name: string; color: string }[];
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [showCoverages, setShowCoverages] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const own = coverages.filter(c => c.policyId === policy.id);
  const notice = policy.notice;
  const days = notice.daysUntilCancel;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate" title={policy.name}>
              {policy.name}
            </CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Badge variant="secondary">
                {INSURANCE_BRANCH_LABELS[policy.branch]}
              </Badge>
              <Badge variant="outline" className={STATUS_BADGE[policy.status]}>
                {INSURANCE_STATUS_LABELS[policy.status]}
              </Badge>
              {policy.premiumRecurringId !== null && (
                <Badge variant="outline">Dauerbuchung</Badge>
              )}
              {policy.personIds.length === 0 ? (
                <Badge variant="secondary">Gemeinsam</Badge>
              ) : (
                policy.personIds.map(id => {
                  const u = users.find(x => x.id === id);
                  return (
                    <Badge
                      key={id}
                      variant="outline"
                      style={{
                        borderColor: u?.color,
                        color: u?.color ?? undefined,
                      }}
                    >
                      {u?.name ?? `#${id}`}
                    </Badge>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <label
              className="flex cursor-pointer items-center gap-1 rounded px-1 text-xs text-muted-foreground"
              title="Zum Vergleich markieren"
            >
              <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
            </label>
            {policy.premiumRecurringId === null &&
              policy.status === "active" &&
              policy.premium > 0 && (
                <InsuranceTransferDialog
                  policy={policy}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Als Dauerbuchung übernehmen"
                    >
                      <Repeat className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  }
                />
              )}
            <InsurancePolicyDialog
              policy={policy}
              trigger={
                <Button variant="ghost" size="icon-sm" title="Police bearbeiten">
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </Button>
              }
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xl font-bold">{formatCents(policy.premium)}</p>
          <p className="text-xs text-muted-foreground">
            {
              RECURRING_INTERVAL_LABELS[
                policy.premiumInterval as keyof typeof RECURRING_INTERVAL_LABELS
              ]
            }{" "}
            · {formatCents(policy.premiumYearly)} pro Jahr
          </p>
        </div>

        <div className="space-y-1">
          {policy.insurer && (
            <DetailRow label="Versicherer" value={policy.insurer} />
          )}
          {policy.policyNumber && (
            <DetailRow label="Policennummer" value={policy.policyNumber} />
          )}
          {policy.deductible !== null && (
            <DetailRow
              label="Selbstbehalt"
              value={formatCents(policy.deductible)}
            />
          )}
          {notice.cancelBy && (
            <DetailRow
              label={notice.currentPeriodMissed ? "Nächste Frist" : "Kündigen bis"}
              value={formatDate(notice.cancelBy)}
              tone={
                notice.currentPeriodMissed
                  ? "danger"
                  : days !== null && days <= 90
                    ? "warn"
                    : undefined
              }
            />
          )}
          {notice.dueDate && (
            <DetailRow
              label={policy.renewal === "fixed" ? "Vertragsende" : "Hauptverfall"}
              value={formatDate(notice.dueDate)}
            />
          )}
          {policy.accountName && (
            <DetailRow label="Belastungskonto" value={policy.accountName} />
          )}
        </div>

        {policy.notes && (
          <p className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
            {policy.notes}
          </p>
        )}

        {/* Der Kernnutzen: beim Arzttermin antippen und sofort sehen,
            was gedeckt ist — ohne Dialog. */}
        <Collapsible open={showCoverages} onOpenChange={setShowCoverages}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between px-2">
              <span>Deckungen ({own.length})</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  showCoverages && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pt-2">
            {own.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Noch keine Deckungen erfasst.
              </p>
            )}
            {own.map(c => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-2 rounded border px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm" title={c.label}>
                    {c.label}
                  </p>
                  {c.deductible !== null && (
                    <p className="text-xs text-muted-foreground">
                      Selbstbehalt {formatCents(c.deductible)}
                    </p>
                  )}
                  {c.notes && (
                    <p className="text-xs text-muted-foreground">{c.notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-sm font-medium">
                    {c.sumInsured === null
                      ? "unbegrenzt"
                      : formatCents(c.sumInsured)}
                  </span>
                  <InsuranceCoverageDialog
                    policyId={policy.id}
                    branch={policy.branch}
                    usedLabels={own.map(x => x.label)}
                    coverage={c}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Deckung bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    }
                  />
                </div>
              </div>
            ))}
            <InsuranceCoverageDialog
              policyId={policy.id}
              branch={policy.branch}
              usedLabels={own.map(x => x.label)}
              trigger={
                <Button variant="outline" size="sm" className="w-full">
                  <Plus className="mr-2 h-4 w-4" /> Deckung hinzufügen
                </Button>
              }
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showDocs} onOpenChange={setShowDocs}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between px-2">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Dokumente ({policy.attachmentCount})
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  showDocs && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {showDocs && <InsuranceAttachments policyId={policy.id} />}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Historie -------------------------------- */

function HistoryCard() {
  const changesQuery = trpc.insurance.listChanges.useInfiniteQuery(
    { limit: 25 },
    { getNextPageParam: lastPage => lastPage.nextCursor }
  );
  const changes = changesQuery.data?.pages.flatMap(p => p.entries) ?? [];
  const total = changesQuery.data?.pages[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          Verlauf
        </CardTitle>
        <CardDescription>
          Änderungen an den Versicherungs-Daten — neueste zuerst
          {total > 0 && ` (${changes.length} von ${total})`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {changesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Lade Verlauf…</p>
        ) : changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Einträge vorhanden.
          </p>
        ) : (
          <div className="space-y-4">
            {changes.map(entry => (
              <div
                key={entry.id}
                className="space-y-1 border-b pb-3 last:border-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {ENTITY_LABELS[entry.entity] ?? entry.entity}
                    </Badge>
                    {entry.userName && (
                      <span
                        className="text-xs text-muted-foreground"
                        style={{ color: entry.userColor ?? undefined }}
                      >
                        {entry.userName}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateTimeFormatter.format(new Date(entry.createdAt))}
                  </span>
                </div>
                <ul className="space-y-0.5 text-sm text-muted-foreground">
                  {entry.changes.map((c, idx) => (
                    <li key={idx}>
                      {c.field}: {formatHistoryValue(c.field, c.from)} →{" "}
                      {formatHistoryValue(c.field, c.to)}
                    </li>
                  ))}
                </ul>
                {entry.comment && (
                  <p className="text-sm italic text-muted-foreground">
                    „{entry.comment}“
                  </p>
                )}
              </div>
            ))}
            {changesQuery.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={changesQuery.isFetchingNextPage}
                onClick={() => changesQuery.fetchNextPage()}
              >
                {changesQuery.isFetchingNextPage ? "Lade…" : "Mehr laden"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- Seite --------------------------------- */

export default function Insurances() {
  const policiesQuery = trpc.insurance.listPolicies.useQuery();
  const coveragesQuery = trpc.insurance.listCoverages.useQuery();
  const summaryQuery = trpc.insurance.summary.useQuery();
  const usersQuery = trpc.auth.listUsers.useQuery();

  // Stabile Referenzen, damit die useMemo-Abhängigkeiten unten nicht bei
  // jedem Render wechseln
  const policies = useMemo(
    () => policiesQuery.data ?? [],
    [policiesQuery.data]
  );
  const coverages = useMemo(
    () => coveragesQuery.data ?? [],
    [coveragesQuery.data]
  );
  const users = usersQuery.data ?? [];
  const summary = summaryQuery.data;

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState("all");
  const [person, setPerson] = useState("all");
  const [insurer, setInsurer] = useState("all");
  const [compareIds, setCompareIds] = useState<number[]>([]);

  const insurers = useMemo(
    () =>
      [...new Set(policies.map(p => p.insurer).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [policies]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const coverageLabels = new Map<number, string>();
    for (const c of coverages) {
      coverageLabels.set(
        c.policyId,
        `${coverageLabels.get(c.policyId) ?? ""} ${c.label}`
      );
    }
    return policies.filter(p => {
      if (branch !== "all" && p.branch !== branch) return false;
      if (status !== "all" && p.status !== status) return false;
      if (person === "shared" && p.personIds.length > 0) return false;
      if (
        person !== "all" &&
        person !== "shared" &&
        !p.personIds.includes(Number(person))
      ) {
        return false;
      }
      if (insurer !== "all" && p.insurer !== insurer) return false;
      if (!needle) return true;
      const haystack = [
        p.name,
        p.insurer,
        p.policyNumber,
        INSURANCE_BRANCH_LABELS[p.branch],
        p.notes,
        coverageLabels.get(p.id) ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [policies, coverages, search, branch, status, person, insurer]);

  const comparePolicies = policies.filter(p => compareIds.includes(p.id));

  const toggleCompare = (id: number) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= MAX_COMPARE) {
        toast.error("Höchstens vier Policen lassen sich vergleichen.");
        return prev;
      }
      return [...prev, id];
    });
  };

  if (policiesQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Lade Versicherungen…</p>;
  }
  if (policies.length === 0) return <SetupCard />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Versicherungen</h1>
          <p className="text-sm text-muted-foreground">
            {summary
              ? `${summary.count} Policen · ${formatCents(summary.premiumMonthly)} pro Monat`
              : "Alle Policen des Haushalts"}
          </p>
        </div>
        <InsurancePolicyDialog
          trigger={
            <Button className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-2 h-4 w-4" /> Neue Police
            </Button>
          }
        />
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Policen"
            value={String(summary.activeCount)}
            hint={
              summary.quoteCount > 0
                ? `+ ${summary.quoteCount} Angebot(e)`
                : undefined
            }
            icon={<Umbrella className="h-4 w-4 text-muted-foreground" />}
          />
          <Kpi
            label="Prämie pro Monat"
            value={formatCents(summary.premiumMonthly)}
            hint="Ohne Angebote"
            icon={<CircleDollarSign className="h-4 w-4 text-muted-foreground" />}
          />
          <Kpi
            label="Prämie pro Jahr"
            value={formatCents(summary.premiumYearly)}
            icon={<CircleDollarSign className="h-4 w-4 text-muted-foreground" />}
          />
          <Kpi
            label="Nächste Kündigungsfrist"
            value={
              summary.nextCancelBy ? formatDate(summary.nextCancelBy) : "—"
            }
            hint={summary.nextCancelPolicy ?? undefined}
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            tone={
              summary.nextCancelDays !== null && summary.nextCancelDays <= 30
                ? "warn"
                : undefined
            }
          />
        </div>
      )}

      <GapCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Suchen…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <SearchableSelect
              value={branch}
              onValueChange={setBranch}
              placeholder="Sparte"
              options={[
                { value: "all", label: "Alle Sparten" },
                ...INSURANCE_BRANCHES.map(b => ({
                  value: b.key,
                  label: b.label,
                })),
              ]}
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                title="Status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="cancelled">Gekündigt</SelectItem>
                <SelectItem value="expired">Abgelaufen</SelectItem>
                <SelectItem value="quote">Angebot</SelectItem>
              </SelectContent>
            </Select>
            <SearchableSelect
              value={person}
              onValueChange={setPerson}
              placeholder="Person"
              options={[
                { value: "all", label: "Alle Personen" },
                { value: "shared", label: "Gemeinsam" },
                ...users.map(u => ({ value: String(u.id), label: u.name })),
              ]}
            />
            <SearchableSelect
              value={insurer}
              onValueChange={setInsurer}
              placeholder="Versicherer"
              options={[
                { value: "all", label: "Alle Versicherer" },
                ...insurers.map(i => ({ value: i, label: i })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {comparePolicies.length >= 2 && (
        <ComparisonCard
          policies={comparePolicies}
          coverages={coverages}
          onClear={() => setCompareIds([])}
        />
      )}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Keine Police passt zu den Filtern.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(p => (
            <PolicyCard
              key={p.id}
              policy={p}
              coverages={coverages}
              users={users}
              selected={compareIds.includes(p.id)}
              onToggleSelect={() => toggleCompare(p.id)}
            />
          ))}
        </div>
      )}

      {compareIds.length === 1 && (
        <div className="sticky bottom-2 z-10 rounded-lg border bg-card/95 p-2 text-sm shadow backdrop-blur">
          <span className="text-muted-foreground">
            1 Police ausgewählt — mindestens zwei für den Vergleich markieren.
          </span>
        </div>
      )}

      <HistoryCard />
    </div>
  );
}
