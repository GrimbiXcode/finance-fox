import { useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  History,
  House,
  Landmark,
  Percent,
  Pencil,
  PiggyBank,
  Plus,
  Repeat,
  Scale,
  TrendingDown,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SearchableSelect } from "@/components/SearchableSelect";
import MortgagePropertyDialog, {
  type DialogProperty,
} from "@/components/MortgagePropertyDialog";
import MortgageTrancheDialog, {
  type DialogTranche,
} from "@/components/MortgageTrancheDialog";
import MortgageAmortizationDialog, {
  type DialogAmortization,
} from "@/components/MortgageAmortizationDialog";
import MortgageTransferDialog from "@/components/MortgageTransferDialog";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { useFinanceData } from "@/lib/data";
import {
  currencySymbol,
  formatBp,
  formatCents,
  formatDate,
  getUserLocale,
  totalBalance,
} from "@/lib/finance";
import { RECURRING_INTERVAL_LABELS } from "@contracts/types";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";

/** Berechnungsergebnis, wie es mortgage.forecast liefert */
type Schedule = inferRouterOutputs<AppRouter>["mortgage"]["forecast"];
type PropertyRow = inferRouterOutputs<AppRouter>["mortgage"]["listProperties"][number];
type TrancheRow = inferRouterOutputs<AppRouter>["mortgage"]["listTranches"][number];
type AmortizationRow =
  inferRouterOutputs<AppRouter>["mortgage"]["listAmortizations"][number];

/** Deutsche Entity-Namen des Verlaufs */
const ENTITY_LABELS: Record<string, string> = {
  property: "Liegenschaft",
  tranche: "Tranche",
  amortization: "Amortisation",
};

/** Historien-Felder, deren Werte Cent-Beträge sind (Labels kommen vom Server) */
const MONEY_FIELDS = new Set([
  "Kaufpreis",
  "Verkehrswert",
  "Bruttojahreseinkommen",
  "Restschuld",
  "Betrag",
]);

/** Historien-Felder mit Datumswerten */
const DATE_FIELDS = new Set([
  "Kaufdatum",
  "Stichtag Verkehrswert",
  "Stichtag Restschuld",
  "Beginn",
  "Ende",
  "Ablauf Zinsbindung",
]);

const formatHistoryValue = (
  field: string,
  value: string | number | null
): string => {
  if (value === null || value === "") return "—";
  if (MONEY_FIELDS.has(field)) return formatCents(Number(value));
  if (field.endsWith("(Bp)")) return `${formatBp(Number(value))} %`;
  if (DATE_FIELDS.has(field)) return formatDate(String(value));
  return String(value);
};

const dateTimeFormatter = new Intl.DateTimeFormat(getUserLocale(), {
  dateStyle: "short",
  timeStyle: "short",
});

const TRANCHE_KIND_LABELS: Record<string, string> = {
  fixed: "Festhypothek",
  saron: "SARON",
  variable: "Variabel",
};

/**
 * Hinweise kommen als strukturierte Daten vom Server — Beträge, Prozente
 * und Datumsangaben werden erst hier locale-konform formatiert.
 */
function warningText(w: Schedule["warnings"][number]): string {
  switch (w.kind) {
    case "no_market_value":
      return "Ohne Verkehrswert lassen sich Belehnung und Tragbarkeit nicht berechnen.";
    case "ltv_exceeded":
      return `Die Belehnung liegt bei ${formatBp(w.ltvBp)} % und übersteigt die Grenze von ${formatBp(w.maxLtvBp)} %.`;
    case "no_income":
      return "Ohne Bruttojahreseinkommen lässt sich die Tragbarkeit nicht berechnen.";
    case "affordability_exceeded":
      return `Die Tragbarkeit liegt bei ${formatBp(w.ratioBp)} % des Bruttoeinkommens (Richtwert: höchstens 33 %).`;
    case "amortization_uncovered":
      return `Die Amortisationspflicht der 2. Hypothek von ${formatCents(w.required)} pro Jahr ist nicht gedeckt — erfasst sind ${formatCents(w.actual)}.`;
    case "maturity_due":
      return `Die Zinsbindung von „${w.tranche}“ läuft am ${formatDate(w.date)} ab.`;
    case "maturity_passed":
      return `Die Zinsbindung von „${w.tranche}“ ist am ${formatDate(w.date)} abgelaufen.`;
    case "stale_balance":
      return `Die Restschuld von „${w.tranche}“ ist per ${formatDate(w.date)} erfasst — bitte aktualisieren.`;
  }
}

/* ------------------------------ Leerer Zustand ---------------------------- */

function SetupCard() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <House className="h-5 w-5 text-emerald-600" />
          Wohneigentum erfassen
        </CardTitle>
        <CardDescription>
          Erfasse deine Liegenschaft mit dem Verkehrswert und danach die
          Hypothekar-Tranchen. Finance Fox rechnet daraus Zinslast, Belehnung,
          Tragbarkeit und den Schuldenverlauf — und bezieht die Immobilie ins
          Nettovermögen ein.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MortgagePropertyDialog
          trigger={
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-2 h-4 w-4" /> Liegenschaft anlegen
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

/* -------------------------------- Übersicht ------------------------------- */

function OverviewSection({
  property,
  schedule,
  isLoading,
}: {
  property: PropertyRow;
  schedule: Schedule | undefined;
  isLoading: boolean;
}) {
  const { accounts, transactions } = useFinanceData();
  const liquid = totalBalance(accounts, transactions);

  if (isLoading || !schedule) {
    return <p className="text-sm text-muted-foreground">Lade Berechnung…</p>;
  }

  const { totals, ltv, affordability } = schedule;
  const netWorth = liquid + property.marketValue - totals.debt;
  const indirect = schedule.monthlyIndirect.at(-1) ?? 0;

  // Cent → Währungseinheiten: die Achsen-/Tooltip-Formatter rechnen in
  // Einheiten, nicht in Cent
  const chartData = schedule.series.map(s => ({
    year: s.year,
    Restschuld: Math.round(s.debt / 100),
    Eigenkapital: Math.round(Math.max(0, s.equity) / 100),
  }));
  const firstYear = chartData[0]?.year ?? null;
  const lastYear = chartData.at(-1)?.year ?? null;

  // Zinsbindungs-Bänder: je Festhypothek ein Band bis zum Ablauf
  const bands = schedule.tranches
    .filter(t => t.maturityDate !== null)
    .map(t => ({ name: t.name, year: Number(t.maturityDate!.slice(0, 4)) }))
    .filter(b => firstYear !== null && b.year >= firstYear);

  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Restschuld"
          value={formatCents(totals.debt)}
          hint={`${schedule.tranches.length} Tranche${schedule.tranches.length === 1 ? "" : "n"}`}
          icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
        />
        <Kpi
          label="Ø Zinssatz"
          value={`${formatBp(totals.avgRateBp)} %`}
          hint={`${formatCents(totals.yearlyInterest)} pro Jahr`}
          icon={<Percent className="h-4 w-4 text-muted-foreground" />}
        />
        <Kpi
          label="Monatliche Belastung"
          value={formatCents(totals.monthlyBurden)}
          hint={`davon ${formatCents(totals.monthlyInterest)} Zins`}
          icon={<TrendingDown className="h-4 w-4 text-rose-500" />}
        />
        <Kpi
          label="Belehnung"
          value={ltv.bp === null ? "—" : `${formatBp(ltv.bp)} %`}
          hint={
            ltv.bp === null
              ? "Verkehrswert fehlt"
              : `noch ${formatCents(ltv.headroom)} Spielraum`
          }
          icon={<Scale className="h-4 w-4 text-muted-foreground" />}
          tone={
            ltv.bp !== null && ltv.bp > property.maxLtvBp ? "warn" : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PiggyBank className="h-5 w-5 text-emerald-600" />
              Nettovermögen
            </CardTitle>
            <CardDescription>
              Nur für dich sichtbare Konten, plus Verkehrswert, minus Restschuld
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="text-2xl font-bold">{formatCents(netWorth)}</div>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">Kontosalden</span>
              <span className="shrink-0 font-medium">{formatCents(liquid)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">Verkehrswert</span>
              <span className="shrink-0 font-medium">
                {formatCents(property.marketValue)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">Restschuld</span>
              <span className="shrink-0 font-medium text-rose-500">
                −{formatCents(totals.debt)}
              </span>
            </div>
            {indirect > 0 && (
              <p className="border-t pt-2 text-xs text-muted-foreground">
                Indirekt angespart bis zum Horizont: {formatCents(indirect)} —
                bereits im Saldo des verknüpften Kontos enthalten, deshalb hier
                nicht zusätzlich gezählt.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-5 w-5 text-indigo-500" />
              Tragbarkeit
            </CardTitle>
            <CardDescription>
              Kalkulatorischer Zins {formatBp(property.calcInterestRateBp)} %,
              Unterhalt {formatBp(property.maintenanceRateBp)} % — Richtwert
              höchstens 33 % des Bruttoeinkommens
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div
              className={cn(
                "text-2xl font-bold",
                affordability.affordable === false && "text-destructive"
              )}
            >
              {affordability.ratioBp === null
                ? "—"
                : `${formatBp(affordability.ratioBp)} %`}
            </div>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">
                Kalkulatorischer Zins
              </span>
              <span className="shrink-0 font-medium">
                {formatCents(affordability.calcInterest)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">
                Unterhalt/Nebenkosten
              </span>
              <span className="shrink-0 font-medium">
                {formatCents(affordability.maintenance)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 text-muted-foreground">
                Pflicht-Amortisation
              </span>
              <span className="shrink-0 font-medium">
                {formatCents(affordability.requiredAmortization)}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-t pt-1.5">
              <span className="min-w-0 text-muted-foreground">
                Kosten pro Jahr
              </span>
              <span className="shrink-0 font-semibold">
                {formatCents(affordability.totalCost)}
              </span>
            </div>
            {affordability.actualAmortization <
              affordability.requiredAmortization && (
              <p className="pt-1 text-xs text-muted-foreground">
                Erfasst sind bisher{" "}
                {formatCents(affordability.actualAmortization)} pro Jahr.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {schedule.warnings.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Hinweise
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {schedule.warnings.map((w, i) => (
                <li key={`${w.kind}-${i}`}>{warningText(w)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Schuldenverlauf</CardTitle>
            <CardDescription>
              Restschuld und Eigenkapital im Objekt. Der Verkehrswert wird
              konstant fortgeschrieben.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  {/* Numerische Achse: mit einer Kategorien-Achse liefert die
                      Band-Skala für ReferenceArea keine Koordinaten (NaN) */}
                  <XAxis
                    dataKey="year"
                    type="number"
                    domain={
                      firstYear !== null && lastYear !== null
                        ? [firstYear, lastYear]
                        : undefined
                    }
                    tickCount={Math.min(12, chartData.length)}
                    tickFormatter={(v: number) => String(v)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      `${(v / 1000).toFixed(0)}k ${currencySymbol()}`
                    }
                    width={80}
                  />
                  <Tooltip
                    formatter={(value: number | string, name: string) => [
                      `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`,
                      name,
                    ]}
                  />
                  {bands.map(b => (
                    <ReferenceArea
                      ifOverflow="hidden"
                      key={`${b.name}-${b.year}`}
                      x1={b.year}
                      x2={b.year}
                      stroke="#f59e0b"
                      strokeOpacity={0.6}
                      fill="#f59e0b"
                      fillOpacity={0.08}
                      label={{
                        value: `Ablauf ${b.name}`,
                        position: "insideTop",
                        fontSize: 10,
                        fill: "#64748b",
                      }}
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="Restschuld"
                    stroke="#f43f5e"
                    fill="#f43f5e"
                    fillOpacity={0.3}
                  />
                  <Area
                    type="monotone"
                    dataKey="Eigenkapital"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/* -------------------------------- Tranchen -------------------------------- */

function TranchesSection({
  property,
  tranches,
  schedule,
}: {
  property: PropertyRow;
  tranches: TrancheRow[];
  schedule: Schedule | undefined;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Landmark className="h-5 w-5 text-indigo-500" />
          Tranchen
        </h2>
        <MortgageTrancheDialog
          propertyId={property.id}
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Neue Tranche
            </Button>
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tranches.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Tranche erfasst.
            </CardContent>
          </Card>
        )}
        {tranches.map(t => {
          const calc = schedule?.tranches.find(x => x.id === t.id);
          const expiring =
            calc?.monthsToMaturity != null && calc.monthsToMaturity <= 12;
          return (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base" title={t.name}>
                    {t.name}
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      {TRANCHE_KIND_LABELS[t.kind] ?? t.kind}
                    </Badge>
                    {t.bankName && (
                      <Badge variant="outline" className="max-w-full whitespace-normal">
                        {t.bankName}
                      </Badge>
                    )}
                    {expiring && (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        Ablauf nah
                      </Badge>
                    )}
                    {t.interestRecurringId !== null && (
                      <Badge variant="outline" className="text-[10px]">
                        Dauerbuchung
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  {t.interestRecurringId === null && t.principal > 0 && (
                    <MortgageTransferDialog
                      target={{
                        kind: "interest",
                        trancheId: t.id,
                        name: `Hypothekarzins „${t.name}"`,
                        amount: calc?.interestPerPayment ?? 0,
                        interval: t.paymentInterval,
                      }}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Zins als Dauerbuchung übernehmen"
                        >
                          <Repeat className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      }
                    />
                  )}
                  <MortgageTrancheDialog
                    propertyId={property.id}
                    tranche={t as DialogTranche}
                    trigger={
                      <Button variant="ghost" size="icon" title="Tranche bearbeiten">
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="text-xl font-bold">{formatCents(t.principal)}</div>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 text-muted-foreground">Zinssatz</span>
                  <span className="shrink-0 font-medium">
                    {formatBp(t.effectiveRateBp)} %
                    {t.kind === "saron" && t.marginBp !== null && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({formatBp(t.interestRateBp)} + {formatBp(t.marginBp)})
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 text-muted-foreground">
                    Zins {RECURRING_INTERVAL_LABELS[t.paymentInterval].toLowerCase()}
                  </span>
                  <span className="shrink-0 font-medium">
                    {formatCents(calc?.interestPerPayment ?? 0)}
                  </span>
                </div>
                {t.maturityDate && (
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">
                      Zinsbindung bis
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-medium",
                        expiring && "text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {formatDate(t.maturityDate)}
                    </span>
                  </div>
                )}
                {t.balanceDate && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Restschuld per {formatDate(t.balanceDate)}
                  </p>
                )}
                {t.notes && (
                  <p className="pt-1 text-xs text-muted-foreground">{t.notes}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* ----------------------------- Amortisationen ----------------------------- */

function AmortizationSection({
  property,
  tranches,
  amortizations,
}: {
  property: PropertyRow;
  tranches: TrancheRow[];
  amortizations: AmortizationRow[];
}) {
  const { accounts } = useFinanceData();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Banknote className="h-5 w-5 text-emerald-600" />
          Amortisation
        </h2>
        <MortgageAmortizationDialog
          propertyId={property.id}
          tranches={tranches}
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Neue Amortisation
            </Button>
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {amortizations.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Amortisation erfasst.
            </CardContent>
          </Card>
        )}
        {amortizations.map(a => {
          const tranche = tranches.find(t => t.id === a.trancheId);
          return (
            <Card key={a.id} className={cn(!a.active && "opacity-60")}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base">
                    {a.kind === "direct" ? "Direkt" : "Indirekt"}
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      {RECURRING_INTERVAL_LABELS[a.interval]}
                    </Badge>
                    {!a.active && <Badge variant="outline">Pausiert</Badge>}
                    {a.recurringId !== null && (
                      <Badge variant="outline" className="text-[10px]">
                        Dauerbuchung
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  {a.recurringId === null && a.active && (
                    <MortgageTransferDialog
                      target={{
                        kind: "amortization",
                        amortizationId: a.id,
                        name:
                          a.kind === "direct"
                            ? `Amortisation „${tranche?.name ?? ""}"`
                            : "Amortisation (indirekt)",
                        amount: a.amount,
                        interval: a.interval,
                        indirect: a.kind === "indirect",
                        targetAccountId: a.accountId,
                      }}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Als Dauerbuchung übernehmen"
                        >
                          <Repeat className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      }
                    />
                  )}
                  <MortgageAmortizationDialog
                    propertyId={property.id}
                    tranches={tranches}
                    amortization={a as DialogAmortization}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Amortisation bearbeiten"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="text-xl font-bold">{formatCents(a.amount)}</div>
                {a.kind === "direct" && tranche && (
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">Tranche</span>
                    <span className="shrink-0 font-medium" title={tranche.name}>
                      {tranche.name}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 text-muted-foreground">Beginn</span>
                  <span className="shrink-0 font-medium">
                    {formatDate(a.startDate)}
                  </span>
                </div>
                {a.endDate && (
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">Ende</span>
                    <span className="shrink-0 font-medium">
                      {formatDate(a.endDate)}
                    </span>
                  </div>
                )}
                {a.accountId !== null && (
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">Zielkonto</span>
                    <span className="shrink-0 font-medium">
                      {accounts.find(x => x.id === a.accountId)?.name ?? "—"}
                    </span>
                  </div>
                )}
                {a.kind === "indirect" && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Zahlt auf ein Konto ein — die Restschuld bleibt bestehen.
                  </p>
                )}
                {a.notes && (
                  <p className="pt-1 text-xs text-muted-foreground">{a.notes}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------- Verlauf -------------------------------- */

function HistoryCard() {
  const changesQuery = trpc.mortgage.listChanges.useInfiniteQuery(
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
          Änderungen an den Hypotheken-Daten — neueste zuerst
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
              <div key={entry.id} className="space-y-1 border-b pb-3 last:border-0">
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

export default function Mortgages() {
  const propertiesQuery = trpc.mortgage.listProperties.useQuery();
  const propertyList = propertiesQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Ohne explizite Wahl die erste Liegenschaft zeigen
  const property =
    propertyList.find(p => p.id === selectedId) ?? propertyList[0] ?? null;

  const tranchesQuery = trpc.mortgage.listTranches.useQuery(
    { propertyId: property?.id ?? 0 },
    { enabled: !!property }
  );
  const amortizationsQuery = trpc.mortgage.listAmortizations.useQuery(
    { propertyId: property?.id ?? 0 },
    { enabled: !!property }
  );
  const scheduleQuery = trpc.mortgage.forecast.useQuery(
    { propertyId: property?.id ?? 0, months: 360 },
    { enabled: !!property, retry: false }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Hypotheken</h1>
          <p className="text-sm text-muted-foreground">
            Wohneigentum, Tranchen und Amortisation im Überblick
          </p>
        </div>
        {property && (
          <div className="flex flex-wrap items-center gap-2">
            {propertyList.length > 1 && (
              <div className="w-56">
                <SearchableSelect
                  value={String(property.id)}
                  onValueChange={v => setSelectedId(Number(v))}
                  options={propertyList.map(p => ({
                    value: String(p.id),
                    label: p.name,
                  }))}
                />
              </div>
            )}
            <MortgagePropertyDialog
              property={property as DialogProperty}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="mr-2 h-4 w-4" /> Liegenschaft
                </Button>
              }
            />
            <MortgagePropertyDialog
              trigger={
                <Button variant="outline" size="sm">
                  <Plus className="mr-2 h-4 w-4" /> Weitere
                </Button>
              }
            />
          </div>
        )}
      </div>

      {propertiesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Lade Hypotheken…</p>
      ) : !property ? (
        <SetupCard />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-sm">
              <div className="flex items-center gap-2">
                <House className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{property.name}</span>
              </div>
              {property.address && (
                <span className="text-muted-foreground">{property.address}</span>
              )}
              <span className="text-muted-foreground">
                Verkehrswert {formatCents(property.marketValue)}
              </span>
              {property.valueDate && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  per {formatDate(property.valueDate)}
                </span>
              )}
            </CardContent>
          </Card>

          {scheduleQuery.isError ? (
            <Card className="border-destructive/50">
              <CardContent className="py-6 text-sm text-destructive">
                {scheduleQuery.error.message}
              </CardContent>
            </Card>
          ) : (
            <OverviewSection
              property={property}
              schedule={scheduleQuery.data}
              isLoading={scheduleQuery.isLoading}
            />
          )}

          <TranchesSection
            property={property}
            tranches={tranchesQuery.data ?? []}
            schedule={scheduleQuery.data}
          />
          <AmortizationSection
            property={property}
            tranches={tranchesQuery.data ?? []}
            amortizations={amortizationsQuery.data ?? []}
          />
          <HistoryCard />
        </>
      )}
    </div>
  );
}
