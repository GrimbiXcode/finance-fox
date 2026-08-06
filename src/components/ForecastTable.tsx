import { useState, type ReactNode } from "react";
import { Check, TableProperties } from "lucide-react";
import {
  FORECAST_GRANULARITIES,
  FORECAST_GRANULARITY_LABELS,
  type ForecastGranularity,
} from "@contracts/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { trpc } from "@/providers/trpc";
import { accountLabel } from "@/lib/data";
import { formatCents, formatMonth, formatMonthYearShort } from "@/lib/finance";
import { cn } from "@/lib/utils";

/**
 * Prognose-Tabelle: Kontosalden, Sparziel-Fortschritt, Ein-/Ausgaben und
 * Nettovermögen über frei wählbaren Horizont und Aggregationsgröße.
 *
 * Saldo-Zeilen zeigen den Stand am ENDE der Periode (Bestandsgröße),
 * Bewegungszeilen die Summe der Periode.
 */

/** Horizont-Auswahl in Monaten */
const HORIZONS = [
  { months: 12, label: "1 Jahr voraus" },
  { months: 24, label: "2 Jahre voraus" },
  { months: 36, label: "3 Jahre voraus" },
  { months: 60, label: "5 Jahre voraus" },
  { months: 120, label: "10 Jahre voraus" },
];

interface ForecastTableProps {
  /** Wirksames Szenario der Seite — die Tabelle rechnet damit wie das Diagramm */
  scenario: { incomePct: number; excludeCategoryId: number | null };
}

export function ForecastTable({ scenario }: ForecastTableProps) {
  const [months, setMonths] = useState("60");
  const [granularity, setGranularity] =
    useState<ForecastGranularity>("semiannual");
  const [includeVariable, setIncludeVariable] = useState(false);

  const banks = trpc.finance.listBanks.useQuery();
  const query = trpc.forecast.table.useQuery({
    months: Number(months),
    granularity,
    includeVariable,
    ...(scenario.incomePct !== 100 ? { incomePct: scenario.incomePct } : {}),
    ...(scenario.excludeCategoryId !== null
      ? { excludeCategoryId: scenario.excludeCategoryId }
      : {}),
  });
  const data = query.data;

  /** Spaltenkopf: Stichtagsmonat kurz, voller Bereich im Tooltip */
  const columnTitle = (startMonth: string, endMonth: string): string =>
    startMonth === endMonth
      ? formatMonth(endMonth)
      : `${formatMonth(startMonth)} – ${formatMonth(endMonth)}`;

  /** Betragszelle: negative Werte hervorgehoben */
  const amount = (value: number) => (
    <span
      className={cn("tabular-nums", value < 0 ? "text-destructive" : undefined)}
    >
      {formatCents(value)}
    </span>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <TableProperties className="h-5 w-5 text-indigo-500" />
              Prognose-Tabelle
            </CardTitle>
            <CardDescription>
              Kontosalden und Sparziel-Fortschritt aus den Dauerbuchungen —
              Saldo-Zeilen zeigen den Stand am Periodenende, Ein-/Ausgaben die
              Summe der Periode.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger className="w-40 min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HORIZONS.map(h => (
                  <SelectItem key={h.months} value={String(h.months)}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={granularity}
              onValueChange={v => setGranularity(v as ForecastGranularity)}
            >
              <SelectTrigger className="w-36 min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORECAST_GRANULARITIES.map(g => (
                  <SelectItem key={g} value={g}>
                    Spalten: {FORECAST_GRANULARITY_LABELS[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Switch
            id="forecast-variable"
            checked={includeVariable}
            onCheckedChange={setIncludeVariable}
          />
          <label
            htmlFor="forecast-variable"
            className="cursor-pointer text-sm text-muted-foreground"
          >
            Ø variable Buchungen einbeziehen
            {data && (
              <span className="ml-1">
                (+{formatCents(data.avgVariableIncome)} / −
                {formatCents(data.avgVariableExpense)} pro Monat)
              </span>
            )}
          </label>
        </div>
        {(data?.mortgageMissingRecurring ?? 0) > 0 && (
          <p className="pt-1 text-xs text-amber-600 dark:text-amber-400">
            {data!.mortgageMissingRecurring} Hypotheken-Posten ohne Dauerbuchung
            — deren Zahlungen fehlen in der Prognose, das Nettovermögen fällt
            dadurch zu optimistisch aus.
          </p>
        )}
      </CardHeader>

      {/* ui/table bringt seinen eigenen overflow-x-auto-Container mit —
          damit scrollt die Tabelle, nie die Seite. */}
      <CardContent className="p-0">
        {query.isLoading || !data ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            Prognose wird berechnet…
          </p>
        ) : data.accounts.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            Keine Konten sichtbar — ohne Konten gibt es nichts zu
            prognostizieren.
          </p>
        ) : (
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card whitespace-nowrap">
                  Position
                </TableHead>
                <TableHead className="min-w-[7.5rem] text-right whitespace-nowrap">
                  Heute
                </TableHead>
                {data.periods.map(p => (
                  <TableHead
                    key={p.endMonth}
                    className="min-w-[7.5rem] text-right whitespace-nowrap"
                    title={columnTitle(p.startMonth, p.endMonth)}
                  >
                    {formatMonthYearShort(p.endMonth)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <GroupRow label="Konten" span={data.periods.length + 1} />
              {data.accounts.map(a => (
                <TableRow key={a.accountId}>
                  <LabelCell>{accountLabel(a, banks.data ?? [])}</LabelCell>
                  <TableCell className="text-right">
                    {amount(a.current)}
                  </TableCell>
                  {a.values.map((v, i) => (
                    <TableCell key={i} className="text-right">
                      {amount(v)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-semibold">
                <LabelCell className="font-semibold">Gesamt</LabelCell>
                <TableCell className="text-right">
                  {amount(data.total.current)}
                </TableCell>
                {data.total.values.map((v, i) => (
                  <TableCell key={i} className="text-right">
                    {amount(v)}
                  </TableCell>
                ))}
              </TableRow>
              {data.netWorth && (
                <TableRow>
                  <LabelCell title="Saldo + Verkehrswert der Liegenschaften − simulierte Restschuld (Verkehrswert konstant fortgeschrieben)">
                    Nettovermögen
                  </LabelCell>
                  <TableCell className="text-right">
                    {amount(data.netWorth.current)}
                  </TableCell>
                  {data.netWorth.values.map((v, i) => (
                    <TableCell key={i} className="text-right">
                      {amount(v)}
                    </TableCell>
                  ))}
                </TableRow>
              )}

              <GroupRow
                label="Bewegung je Periode"
                span={data.periods.length + 1}
              />
              <TableRow>
                <LabelCell>Einnahmen</LabelCell>
                <TableCell className="text-right text-muted-foreground">
                  —
                </TableCell>
                {data.flows.income.map((v, i) => (
                  <TableCell
                    key={i}
                    className="text-right tabular-nums text-emerald-600"
                  >
                    +{formatCents(v)}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <LabelCell>Ausgaben</LabelCell>
                <TableCell className="text-right text-muted-foreground">
                  —
                </TableCell>
                {data.flows.expense.map((v, i) => (
                  <TableCell
                    key={i}
                    className="text-right tabular-nums text-rose-500"
                  >
                    −{formatCents(v)}
                  </TableCell>
                ))}
              </TableRow>
              {data.flows.transferNet.some(v => v !== 0) && (
                <TableRow>
                  <LabelCell title="Dauer-Umbuchungen, bei denen nur eine Seite sichtbar ist — zwischen zwei sichtbaren Konten sind sie neutral">
                    Umbuchungen (netto)
                  </LabelCell>
                  <TableCell className="text-right text-muted-foreground">
                    —
                  </TableCell>
                  {data.flows.transferNet.map((v, i) => (
                    <TableCell key={i} className="text-right">
                      {amount(v)}
                    </TableCell>
                  ))}
                </TableRow>
              )}

              {data.goals.length > 0 && (
                <GroupRow label="Sparziele" span={data.periods.length + 1} />
              )}
              {data.goals.map(g => (
                <TableRow key={g.goalId}>
                  <LabelCell>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: g.color }}
                      />
                      {/* min-w-0, sonst schrumpft der Name im Flex nicht und
                          die Badges werden abgeschnitten statt der Name */}
                      <span className="min-w-0 truncate">{g.name}</span>
                      {g.targetAmount === null && (
                        <Badge variant="secondary" className="text-[10px]">
                          offenes Ziel
                        </Badge>
                      )}
                      {g.hasHiddenSources && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          title="Enthält Quellen auf Konten, die du nicht sehen darfst — der Stand ist unvollständig"
                        >
                          verborgene Quellen
                        </Badge>
                      )}
                    </span>
                  </LabelCell>
                  <GoalCell
                    value={g.current}
                    target={g.targetAmount}
                    reached={g.reachedNow}
                  />
                  {g.values.map((v, i) => (
                    <GoalCell
                      key={i}
                      value={v}
                      target={g.targetAmount}
                      // Nur die Periode markieren, in der das Ziel erreicht wird
                      reached={g.reachedIndex === i}
                    />
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {data && (
        <CardContent className="border-t pt-4 text-xs text-muted-foreground">
          Gerechnet wird mit den aktiven Dauerbuchungen (Enddatum wird
          berücksichtigt).
          {data.includeVariable
            ? " Der Ø variabler Buchungen wirkt nur auf Gesamt und Nettovermögen — ein Durchschnitt über alle Buchungen ist keinem einzelnen Konto zuordenbar."
            : " Einmalige Buchungen fließen nicht ein — dafür den Schalter oben nutzen."}
        </CardContent>
      )}
    </Card>
  );
}

/** Zwischenüberschrift über die ganze Tabellenbreite */
function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="sticky left-0 z-10 bg-card whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </TableCell>
      <TableCell colSpan={span} />
    </TableRow>
  );
}

/** Erste Spalte: bleibt beim horizontalen Scrollen stehen */
function LabelCell({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <TableCell
      title={title}
      className={cn(
        // overflow-hidden ist Pflicht: ohne es läuft ein langer Kontoname trotz
        // max-w sichtbar in die erste Wertespalte hinein.
        "sticky left-0 z-10 max-w-[14rem] overflow-hidden bg-card text-ellipsis whitespace-nowrap font-medium",
        className
      )}
    >
      {children}
    </TableCell>
  );
}

/**
 * Sparziel-Zelle: Stand und — bei Zielen mit Zielbetrag — der Anteil daran.
 * Offene Ziele zeigen bewusst keinen Prozentwert (es gibt keinen Bezug).
 */
function GoalCell({
  value,
  target,
  reached,
}: {
  value: number;
  target: number | null;
  reached: boolean;
}) {
  const percent =
    target !== null && target > 0
      ? Math.min(100, Math.round((value / target) * 100))
      : null;
  return (
    <TableCell
      className={cn(
        "text-right",
        reached && "bg-emerald-50 dark:bg-emerald-950/40"
      )}
    >
      <span className="flex items-center justify-end gap-1 tabular-nums">
        {reached && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        {formatCents(value)}
      </span>
      {percent !== null && (
        <span className="block text-[11px] text-muted-foreground">
          {percent} %
        </span>
      )}
    </TableCell>
  );
}
