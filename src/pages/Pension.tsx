import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  FileText,
  History,
  Landmark,
  MinusCircle,
  Pencil,
  PiggyBank,
  Plus,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Wallet,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { SearchableSelect } from "@/components/SearchableSelect";
import PensionAttachments from "@/components/PensionAttachments";
import PensionFundDialog, {
  type DialogFund,
} from "@/components/PensionFundDialog";
import PensionFundStatement from "@/components/PensionFundStatement";
import PensionPillar3Dialog, {
  type DialogPillar3,
} from "@/components/PensionPillar3Dialog";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { accountLabel, useInvalidatePension } from "@/lib/data";
import {
  amountPlaceholder,
  currencySymbol,
  formatAmountInput,
  formatBp,
  formatCents,
  formatDate,
  formatMonth,
  getUserLocale,
  parseEuro,
  parsePercent,
} from "@/lib/finance";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

/** Zeilen-Typen der Vorsorge-Queries (nur die hier benötigten Felder) */
interface SalaryDeduction {
  id: number;
  name: string;
  mode: "percent" | "absolute";
  value: number; // percent: Basispunkte, absolute: Cent
  active: boolean;
}
interface SalaryRow {
  id: number;
  validFrom: string; // YYYY-MM
  grossMonthly: number;
  note: string;
  /** Eintragsbezogene Abzüge (gelten nur für diesen Lohn) */
  deductions: SalaryDeduction[];
}
interface DeductionRow {
  id: number;
  salaryId: number | null; // null = global (gilt für alle Löhne)
  name: string;
  mode: "percent" | "absolute";
  value: number; // percent: Basispunkte, absolute: Cent
  active: boolean;
}
interface AhvRow {
  id: number;
  ahvNumber: string | null;
  contributionYears: number | null;
  expectedMonthlyPension: number | null;
  notes: string;
}
type Pillar3Row = DialogPillar3 & {
  syncedBalance: number | null;
  goalCommitment: number | null;
  goalNames: string[];
};

/** Deutsche Entity-Namen des Verlaufs */
const ENTITY_LABELS: Record<string, string> = {
  profile: "Profil",
  salary: "Lohn",
  deduction: "Abzug",
  ahv: "AHV",
  fund: "Pensionskasse",
  pillar3: "Säule 3a",
};

/** Historien-Felder, deren Werte Cent-Beträge sind (Labels kommen vom Server) */
const MONEY_FIELDS = new Set([
  "Bruttolohn",
  "Guthaben",
  "Jährliches Sparen",
  "Jährliche Einzahlung",
  "Erwartete Monatsrente",
  "Versicherter Jahreslohn",
  "Koordinationsabzug",
  "Einkaufspotenzial",
  "Invalidenrente/Jahr",
  "Todesfallkapital",
]);

/** Werte im Verlauf lesbar formatieren (Beträge in Cent, Datum/Monat ISO) */
const formatHistoryValue = (
  field: string,
  value: string | number | null
): string => {
  if (value === null || value === "") return "—";
  if (MONEY_FIELDS.has(field)) return formatCents(Number(value));
  if (field.endsWith("(Bp)")) return `${formatBp(Number(value))} %`;
  if (field === "Geburtsdatum") return formatDate(String(value));
  if (field === "Stichtag der Angaben") return formatDate(String(value));
  if (field === "Gültig ab") return formatMonth(String(value));
  return String(value);
};

/** Zeitpunkt eines Verlaufs-Eintrags locale-konform (Datum + Uhrzeit) */
const dateTimeFormatter = new Intl.DateTimeFormat(getUserLocale(), {
  dateStyle: "short",
  timeStyle: "short",
});

/** Cent-Betrag als Eingabe-String (locale-konformes Dezimalzeichen) */
const centsInput = (cents: number): string =>
  cents > 0 ? formatAmountInput(cents) : "";

/* ------------------------------- Einrichtung ------------------------------- */

/** Leere-Zustand: ohne Profil nur Erklärtext + Einrichtungs-Formular */
function SetupCard() {
  const invalidate = useInvalidatePension();
  const [birthDate, setBirthDate] = useState("");
  const [retirementAge, setRetirementAge] = useState("65");

  const updateProfile = trpc.pension.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Vorsorgeprofil angelegt.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!birthDate) {
      toast.error("Geburtsdatum angeben.");
      return;
    }
    const age = Number(retirementAge);
    if (!Number.isInteger(age) || age < 50 || age > 75) {
      toast.error("Pensionierungsalter zwischen 50 und 75 angeben.");
      return;
    }
    updateProfile.mutate({ birthDate, retirementAge: age });
  };

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Vorsorge einrichten
        </CardTitle>
        <CardDescription>
          Plane deine Altersvorsorge nach dem 3-Säulen-Prinzip: AHV,
          Pensionskasse und Säule 3a — inklusive Prognose bis zur Pensionierung.
          Alle Angaben sind privat und nur für dich sichtbar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Geburtsdatum</Label>
            <Input
              type="date"
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Pensionierungsalter</Label>
            <Input
              inputMode="numeric"
              value={retirementAge}
              onChange={e => setRetirementAge(e.target.value)}
            />
          </div>
        </div>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={updateProfile.isPending}
        >
          Vorsorge einrichten
        </Button>
      </CardContent>
    </Card>
  );
}

/* --------------------------- Profil bearbeiten ----------------------------- */

interface ProfileRow {
  birthDate: string;
  retirementAge: number;
}

/** Dialog zum nachträglichen Ändern von Geburtsdatum und Pensionierungsalter */
function ProfileDialog({
  profile,
  trigger,
}: {
  profile: ProfileRow;
  trigger: ReactNode;
}) {
  const invalidate = useInvalidatePension();
  const [open, setOpen] = useState(false);
  const [birthDate, setBirthDate] = useState(profile.birthDate);
  const [retirementAge, setRetirementAge] = useState(
    String(profile.retirementAge)
  );
  const [comment, setComment] = useState("");

  const updateProfile = trpc.pension.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Vorsorgeprofil aktualisiert.");
      invalidate();
      setOpen(false);
    },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!birthDate) {
      toast.error("Geburtsdatum angeben.");
      return;
    }
    const age = Number(retirementAge);
    if (!Number.isInteger(age) || age < 50 || age > 75) {
      toast.error("Pensionierungsalter zwischen 50 und 75 angeben.");
      return;
    }
    updateProfile.mutate({
      birthDate,
      retirementAge: age,
      comment: comment.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vorsorgeprofil bearbeiten</DialogTitle>
          <DialogDescription>
            Geburtsdatum und Pensionierungsalter — die Prognose rechnet sofort
            mit den neuen Werten.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Geburtsdatum</Label>
              <Input
                type="date"
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pensionierungsalter</Label>
              <Input
                inputMode="numeric"
                value={retirementAge}
                onChange={e => setRetirementAge(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input
              placeholder="z. B. Frühpensionierung geplant"
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={submit}
            disabled={updateProfile.isPending}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Übersicht & Prognose -------------------------- */

/** Prognose-Ergebnis, wie es pension.forecast liefert */
type Forecast = inferRouterOutputs<AppRouter>["pension"]["forecast"];

/** Säulen-Karten, Kennzahlen, Projektions-Chart, Was-wäre-wenn und Warnungen */
function OverviewSection({
  forecast,
  isLoading,
  profile,
}: {
  forecast: Forecast | undefined;
  isLoading: boolean;
  profile: ProfileRow;
}) {
  // Hypothetisches Rentenalter (Was-wäre-wenn) — eigene Prognose-Query mit Override
  const [hypAge, setHypAge] = useState("");
  const hypAgeNum = Number(hypAge);
  const hypValid =
    hypAge.trim() !== "" &&
    Number.isInteger(hypAgeNum) &&
    hypAgeNum >= 50 &&
    hypAgeNum <= 75 &&
    hypAgeNum !== profile.retirementAge;
  const hypoQuery = trpc.pension.forecast.useQuery(
    { retirementAge: hypAgeNum },
    { enabled: hypValid }
  );
  const hypo = hypValid ? hypoQuery.data : undefined;

  const chartData = (forecast?.series ?? []).map(s => ({
    // Numerische Jahres-Achse: mit einer Kategorien-Achse liefert die
    // Band-Skala für die ReferenceArea-Bänder keine Koordinaten (NaN)
    year: s.year,
    "Säule 2": Math.round(s.pillar2 / 100),
    "Säule 3a": Math.round(s.pillar3 / 100),
  }));

  // Phasen-Bänder der Sparbeitrags-Abstufungen: nur wenn genau eine Kasse
  // Stufen hat — bei mehreren Kassen bliebe das Haupt-Chart unlesbar, die
  // Bänder stehen dann nur im Versicherungsausweis der jeweiligen Kasse
  const fundsWithPhases = (forecast?.funds ?? []).filter(
    f => f.phases.length > 0
  );
  const phaseBands =
    fundsWithPhases.length === 1 ? fundsWithPhases[0].phases : [];
  const firstYear = forecast?.series.length ? forecast.series[0].year : null;
  const lastYear = forecast?.series.length
    ? forecast.series[forecast.series.length - 1].year
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              Übersicht &amp; Prognose
            </CardTitle>
            <CardDescription>
              Projektion deiner Vorsorge bis zur Pensionierung
              {forecast ? ` (${formatDate(forecast.retirementDate)})` : ""}
            </CardDescription>
          </div>
          {forecast && (
            <div className="flex items-start gap-2">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">
                  Monatliches Einkommen im Alter
                </div>
                <div className="text-xl font-bold text-emerald-600">
                  {formatCents(forecast.monthlyRetirementIncome)}
                </div>
              </div>
              <ProfileDialog
                profile={profile}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Profil bearbeiten (Geburtsdatum, Pensionierungsalter)"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Prognose wird berechnet…
          </p>
        ) : !forecast ? (
          <p className="text-sm text-muted-foreground">
            Keine Prognose verfügbar.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  Säule 1 · AHV
                  {forecast.ahv.estimated && (
                    <Badge variant="secondary" className="text-[10px]">
                      Schätzung
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {formatCents(forecast.ahv.monthlyPension)}
                </div>
                <div className="text-xs text-muted-foreground">Monatsrente</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">
                  Säule 2 · Pensionskasse
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {formatCents(forecast.pillar2.monthlyPension)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Monatsrente · Guthaben {formatCents(forecast.pillar2.capital)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Säule 3a</div>
                <div className="mt-1 text-lg font-semibold">
                  {formatCents(forecast.pillar3.monthlyWithdrawal)}
                </div>
                <div className="text-xs text-muted-foreground">
                  monatl. Entnahme · Kapital{" "}
                  {formatCents(forecast.pillar3.capital)}
                </div>
              </div>
            </div>

            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <span className="text-muted-foreground">Pensionierung: </span>
                <span className="font-medium">
                  {formatDate(forecast.retirementDate)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Ersatzrate: </span>
                <span className="font-medium">
                  {forecast.replacementRate != null
                    ? `${forecast.replacementRate} %`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Aktuelles Netto: </span>
                <span className="font-medium">
                  {forecast.currentNet != null
                    ? formatCents(forecast.currentNet)
                    : "—"}
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-dashed p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Was-wäre-wenn: Pensionierung mit
                </span>
                <Input
                  inputMode="numeric"
                  className="h-8 w-20"
                  placeholder={String(profile.retirementAge)}
                  aria-label="Hypothetisches Pensionierungsalter"
                  value={hypAge}
                  onChange={e => setHypAge(e.target.value)}
                />
                <span className="text-muted-foreground">Jahren</span>
                {hypAge.trim() !== "" && !hypValid && (
                  <span className="text-xs text-amber-600">
                    Ganzzahl 50–75, abweichend vom eingestellten Alter (
                    {profile.retirementAge})
                  </span>
                )}
              </div>
              {hypValid && hypoQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  Hypothetische Rente wird berechnet…
                </p>
              )}
              {hypo && (
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">
                      Hypothese: Pensionierung mit {hypAgeNum} (
                      {formatDate(hypo.retirementDate)}) — monatliches
                      Einkommen{" "}
                    </span>
                    <span className="font-semibold text-emerald-600">
                      {formatCents(hypo.monthlyRetirementIncome)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · Ersatzrate{" "}
                      {hypo.replacementRate != null
                        ? `${hypo.replacementRate} %`
                        : "—"}
                    </span>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">AHV: </span>
                      <span className="font-medium">
                        {formatCents(hypo.ahv.monthlyPension)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Pensionskasse:{" "}
                      </span>
                      <span className="font-medium">
                        {formatCents(hypo.pillar2.monthlyPension)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · Guthaben {formatCents(hypo.pillar2.capital)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Säule 3a: </span>
                      <span className="font-medium">
                        {formatCents(hypo.pillar3.monthlyWithdrawal)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · Kapital {formatCents(hypo.pillar3.capital)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {chartData.length > 1 && (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ left: 0, right: 8, top: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
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
                    {phaseBands.map((p, i) => (
                      <ReferenceArea
                        ifOverflow="hidden"
                        key={`${p.ageFrom}-${p.fromYear}`}
                        x1={p.fromYear}
                        x2={
                          phaseBands[i + 1]?.fromYear ?? lastYear ?? p.fromYear
                        }
                        fill="#6366f1"
                        fillOpacity={0.05}
                        label={{
                          value: `${formatBp(p.rateBp)} %`,
                          position: "insideTop",
                          fontSize: 10,
                          fill: "#64748b",
                        }}
                      />
                    ))}
                    <Area
                      type="monotone"
                      dataKey="Säule 2"
                      stackId="1"
                      stroke="#6366f1"
                      fill="#6366f1"
                      fillOpacity={0.4}
                    />
                    <Area
                      type="monotone"
                      dataKey="Säule 3a"
                      stackId="1"
                      stroke="#0ea5e9"
                      fill="#0ea5e9"
                      fillOpacity={0.4}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {forecast.warnings.length > 0 && (
              <ul className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                {forecast.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Lohn & Abzüge ------------------------------ */

/** Dialog zum Anlegen/Bearbeiten eines Lohneintrags */
function SalaryDialog({
  salary,
  trigger,
}: {
  salary?: SalaryRow;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <SalaryDialogForm salary={salary} close={() => setOpen(false)} />
      )}
    </Dialog>
  );
}

/** Eingabe-Zeile des Abzüge-Editors im Lohn-Dialog (Wert als String) */
interface DeductionEditRow {
  name: string;
  mode: "percent" | "absolute";
  value: string;
  active: boolean;
}

function SalaryDialogForm({
  salary,
  close,
}: {
  salary?: SalaryRow;
  close: () => void;
}) {
  const invalidate = useInvalidatePension();
  const isEdit = !!salary;
  const [validFrom, setValidFrom] = useState(salary?.validFrom ?? "");
  const [gross, setGross] = useState(centsInput(salary?.grossMonthly ?? 0));
  const [note, setNote] = useState(salary?.note ?? "");
  const [deductions, setDeductions] = useState<DeductionEditRow[]>(
    (salary?.deductions ?? []).map(d => ({
      name: d.name,
      mode: d.mode,
      value: d.mode === "percent" ? formatBp(d.value) : centsInput(d.value),
      active: d.active,
    }))
  );
  const [comment, setComment] = useState("");

  const addSalary = trpc.pension.addSalary.useMutation({
    onSuccess: () => {
      toast.success("Lohn erfasst.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });
  const updateSalary = trpc.pension.updateSalary.useMutation({
    onSuccess: () => {
      toast.success("Lohn gespeichert.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });

  const setDeduction = (index: number, patch: Partial<DeductionEditRow>) =>
    setDeductions(rows =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );

  /** Eingegebene Abzüge validieren und in das Backend-Format bringen */
  const parseDeductions = (): Omit<SalaryDeduction, "id">[] | null => {
    const parsed: Omit<SalaryDeduction, "id">[] = [];
    for (const row of deductions) {
      // Komplett leere Zeilen ignorieren
      if (!row.name.trim() && !row.value.trim()) continue;
      if (!row.name.trim()) {
        toast.error("Abzüge: Name angeben.");
        return null;
      }
      const value =
        row.mode === "percent"
          ? Math.round(parsePercent(row.value) * 100)
          : parseEuro(row.value);
      if (value <= 0) {
        toast.error("Abzüge: Wert größer 0 angeben.");
        return null;
      }
      if (row.mode === "percent" && value > 10000) {
        toast.error("Abzüge: Prozentwert höchstens 100 %.");
        return null;
      }
      parsed.push({
        name: row.name.trim(),
        mode: row.mode,
        value,
        active: row.active,
      });
    }
    return parsed;
  };

  const submit = () => {
    if (!validFrom) {
      toast.error("Monat angeben.");
      return;
    }
    const grossMonthly = parseEuro(gross);
    if (grossMonthly <= 0) {
      toast.error("Bruttolohn größer 0 angeben.");
      return;
    }
    // Abzüge werden immer mitgeschickt (Ersetzen-Semantik wie bei den Stufen)
    const parsedDeductions = parseDeductions();
    if (parsedDeductions === null) return;
    if (isEdit && salary) {
      updateSalary.mutate({
        id: salary.id,
        validFrom,
        grossMonthly,
        note: note.trim(),
        deductions: parsedDeductions,
        comment: comment.trim() || undefined,
      });
    } else {
      addSalary.mutate({
        validFrom,
        grossMonthly,
        note: note.trim(),
        deductions: parsedDeductions,
      });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Lohn bearbeiten" : "Lohn erfassen"}
        </DialogTitle>
        <DialogDescription>
          Bruttolohn mit Gültigkeitsmonat — der jeweils aktuelle Stand gilt bis
          zum nächsten Eintrag.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Gültig ab</Label>
            <Input
              type="month"
              value={validFrom}
              onChange={e => setValidFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Bruttolohn ({currencySymbol()}/Monat)</Label>
            <Input
              inputMode="decimal"
              placeholder={amountPlaceholder}
              value={gross}
              onChange={e => setGross(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notiz (optional)</Label>
          <Input
            placeholder="z. B. Lohnerhöhung"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Abzüge (nur für diesen Lohn)</Label>
          {deductions.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                <span className="text-xs text-muted-foreground">Name</span>
                <span className="text-xs text-muted-foreground">Modus</span>
                <span className="text-xs text-muted-foreground">Wert</span>
                <span />
              </div>
              {deductions.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2"
                >
                  <Input
                    placeholder="z. B. PK"
                    aria-label={`Abzug ${i + 1}: Name`}
                    value={row.name}
                    onChange={e => setDeduction(i, { name: e.target.value })}
                  />
                  <Select
                    value={row.mode}
                    onValueChange={v =>
                      setDeduction(i, { mode: v as DeductionEditRow["mode"] })
                    }
                  >
                    <SelectTrigger
                      className="w-32 min-w-0 [&>span]:truncate"
                      title={row.mode === "percent" ? "Prozent" : "Fixbetrag"}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Prozent</SelectItem>
                      <SelectItem value="absolute">Fixbetrag</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="decimal"
                    placeholder={
                      row.mode === "percent" ? formatBp(530) : amountPlaceholder
                    }
                    aria-label={`Abzug ${i + 1}: Wert`}
                    value={row.value}
                    onChange={e => setDeduction(i, { value: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Abzug entfernen"
                    onClick={() =>
                      setDeductions(rows => rows.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDeductions(rows => [
                  ...rows,
                  { name: "", mode: "percent", value: "", active: true },
                ])
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Abzug hinzufügen
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Globale Abzüge (Karte „Abzüge“) gelten zusätzlich.
          </p>
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input value={comment} onChange={e => setComment(e.target.value)} />
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
          disabled={addSalary.isPending || updateSalary.isPending}
        >
          {isEdit ? "Speichern" : "Erfassen"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Dialog: aktuelles Netto als monatliche Dauerbuchung auf ein Konto übernehmen */
function TransferDialog({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const accountsQuery = trpc.finance.listAccounts.useQuery();
  const banksQuery = trpc.finance.listBanks.useQuery();
  const categoriesQuery = trpc.finance.listCategories.useQuery();
  const [accountId, setAccountId] = useState("");
  // Sentinel „none" = keine Kategorie
  const [categoryId, setCategoryId] = useState("none");

  const transfer = trpc.pension.transferNetSalary.useMutation({
    onSuccess: data => {
      toast.success(
        `Dauerbuchung angelegt: ${formatCents(data.amount)} monatlich ab ${formatDate(data.nextDate)}.`
      );
      utils.finance.listRecurring.invalidate();
      setOpen(false);
      setAccountId("");
      setCategoryId("none");
    },
    onError: err => toast.error(err.message),
  });

  const accounts = (accountsQuery.data ?? []).filter(a => a.access === "edit");
  const incomeCategories = (categoriesQuery.data ?? []).filter(
    c => c.type === "income"
  );

  const submit = () => {
    if (!accountId) {
      toast.error("Konto wählen.");
      return;
    }
    transfer.mutate({
      accountId: Number(accountId),
      ...(categoryId !== "none" ? { categoryId: Number(categoryId) } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Als Dauerbuchung übernehmen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nettolohn als Dauerbuchung übernehmen</DialogTitle>
          <DialogDescription>
            Legt eine monatliche Einnahme in Höhe des aktuell berechneten Nettos
            an — erste Fälligkeit: der 1. des Folgemonats.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Konto</Label>
            <SearchableSelect
              value={accountId}
              onValueChange={setAccountId}
              placeholder="Konto wählen"
              options={accounts.map(a => ({
                value: String(a.id),
                label: accountLabel(a, banksQuery.data ?? []),
              }))}
            />
            {accounts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Kein Konto mit Schreibrecht vorhanden.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Kategorie (optional)</Label>
            <SearchableSelect
              value={categoryId}
              onValueChange={setCategoryId}
              options={[
                { value: "none", label: "Keine" },
                ...incomeCategories.map(c => ({
                  value: String(c.id),
                  label: c.name,
                })),
              ]}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={submit}
            disabled={transfer.isPending || accounts.length === 0}
          >
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lohn-Card: aktuelles Netto, Lohn-Tabelle, Übernahme als Dauerbuchung */
function SalarySection({
  salaries,
  globalDeductions,
  currentNet,
}: {
  salaries: SalaryRow[];
  globalDeductions: DeductionRow[];
  currentNet: number | null;
}) {
  const invalidate = useInvalidatePension();
  const deleteSalary = trpc.pension.deleteSalary.useMutation({
    onSuccess: () => {
      toast.success("Lohn gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  /**
   * Netto eines Lohneintrags clientseitig: Brutto − aktive globale und
   * eintragsbezogene Abzüge (gleiche Rundung wie computeNet im Backend:
   * Prozent-Abzüge round(brutto × bp / 10000))
   */
  const netFor = (s: SalaryRow): number => {
    let net = s.grossMonthly;
    for (const d of [...globalDeductions, ...s.deductions]) {
      if (!d.active) continue;
      net -=
        d.mode === "percent"
          ? Math.round((s.grossMonthly * d.value) / 10000)
          : d.value;
    }
    return net;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-sky-500" />
              Lohn
            </CardTitle>
            <CardDescription>
              Bruttolohn-Verlauf für die Netto-Berechnung
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Aktuelles Netto</div>
            <div className="text-lg font-bold text-emerald-600">
              {currentNet != null ? formatCents(currentNet) : "—"}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentNet === null && (
          <p className="text-sm text-muted-foreground">Kein Lohn hinterlegt.</p>
        )}
        {salaries.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gültig ab</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
                <TableHead className="text-right">Netto</TableHead>
                <TableHead>Notiz</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {salaries.map(s => (
                <TableRow key={s.id}>
                  <TableCell>{formatMonth(s.validFrom)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCents(s.grossMonthly)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-medium">{formatCents(netFor(s))}</div>
                    {s.deductions.length > 0 && (
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        eigene Abzüge
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-32 truncate text-muted-foreground">
                    {s.note || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <SalaryDialog
                        salary={s}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Lohn bearbeiten"
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        }
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Lohn löschen"
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Lohn wirklich löschen?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Der Lohneintrag ab {formatMonth(s.validFrom)} (
                              {formatCents(s.grossMonthly)}) wird unwiderruflich
                              gelöscht.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteSalary.mutate({ id: s.id })}
                            >
                              Löschen
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap gap-2">
          <SalaryDialog
            trigger={
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="mr-2 h-4 w-4" /> Lohn erfassen
              </Button>
            }
          />
          <TransferDialog disabled={currentNet === null} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Dialog zum Anlegen/Bearbeiten eines Abzugs (prozentual oder absolut) */
function DeductionDialog({
  deduction,
  trigger,
}: {
  deduction?: DeductionRow;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <DeductionDialogForm
          deduction={deduction}
          close={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function DeductionDialogForm({
  deduction,
  close,
}: {
  deduction?: DeductionRow;
  close: () => void;
}) {
  const invalidate = useInvalidatePension();
  const isEdit = !!deduction;
  const [name, setName] = useState(deduction?.name ?? "");
  const [mode, setMode] = useState<"percent" | "absolute">(
    deduction?.mode ?? "percent"
  );
  const [value, setValue] = useState(
    deduction
      ? deduction.mode === "percent"
        ? formatBp(deduction.value)
        : centsInput(deduction.value)
      : ""
  );
  const [comment, setComment] = useState("");

  const addDeduction = trpc.pension.addDeduction.useMutation({
    onSuccess: () => {
      toast.success("Abzug erfasst.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });
  const updateDeduction = trpc.pension.updateDeduction.useMutation({
    onSuccess: () => {
      toast.success("Abzug gespeichert.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Name angeben.");
      return;
    }
    const parsed =
      mode === "percent"
        ? Math.round(parsePercent(value) * 100)
        : parseEuro(value);
    if (parsed <= 0) {
      toast.error("Wert größer 0 angeben.");
      return;
    }
    if (isEdit && deduction) {
      updateDeduction.mutate({
        id: deduction.id,
        name: name.trim(),
        mode,
        value: parsed,
        comment: comment.trim() || undefined,
      });
    } else {
      addDeduction.mutate({ name: name.trim(), mode, value: parsed });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Abzug bearbeiten" : "Abzug erfassen"}
        </DialogTitle>
        <DialogDescription>
          Abzüge vom Bruttolohn (z. B. AHV/IV/EO, ALV, PK-Beitrag) — prozentual
          oder als fester Betrag.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            placeholder="z. B. AHV/IV/EO"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Modus</Label>
            <Select value={mode} onValueChange={v => setMode(v as typeof mode)}>
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                title={
                  mode === "percent" ? "Prozent vom Brutto" : "Absoluter Betrag"
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Prozent vom Brutto</SelectItem>
                <SelectItem value="absolute">Absoluter Betrag</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              {mode === "percent" ? "Wert (%)" : `Betrag (${currencySymbol()})`}
            </Label>
            <Input
              inputMode="decimal"
              placeholder={
                mode === "percent" ? formatBp(530) : amountPlaceholder
              }
              value={value}
              onChange={e => setValue(e.target.value)}
            />
          </div>
        </div>
        {isEdit && (
          <div className="space-y-2">
            <Label>Änderungskommentar (optional)</Label>
            <Input value={comment} onChange={e => setComment(e.target.value)} />
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
          disabled={addDeduction.isPending || updateDeduction.isPending}
        >
          {isEdit ? "Speichern" : "Erfassen"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Abzüge-Card: globale Abzüge mit Aktiv-Schalter, Bearbeiten/Löschen */
function DeductionsSection({ deductions }: { deductions: DeductionRow[] }) {
  const invalidate = useInvalidatePension();
  const updateDeduction = trpc.pension.updateDeduction.useMutation({
    onSuccess: () => invalidate(),
    onError: err => toast.error(err.message),
  });
  const deleteDeduction = trpc.pension.deleteDeduction.useMutation({
    onSuccess: () => {
      toast.success("Abzug gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MinusCircle className="h-5 w-5 text-rose-500" />
          Abzüge (global)
        </CardTitle>
        <CardDescription>
          Sozialabgaben und weitere Abzüge vom Bruttolohn — gelten für alle
          Löhne
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {deductions.length === 0 && (
          <p className="text-sm text-muted-foreground">Keine Abzüge erfasst.</p>
        )}
        {deductions.map(d => (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-lg border p-2.5"
          >
            <Switch
              checked={d.active}
              title={d.active ? "Abzug deaktivieren" : "Abzug aktivieren"}
              onCheckedChange={active =>
                updateDeduction.mutate({ id: d.id, active })
              }
            />
            <div className="min-w-0 flex-1">
              <div
                className={`truncate text-sm font-medium ${!d.active ? "text-muted-foreground line-through" : ""}`}
              >
                {d.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {d.mode === "percent"
                  ? `${formatBp(d.value)} % vom Brutto`
                  : `${formatCents(d.value)} pro Monat`}
              </div>
            </div>
            <DeductionDialog
              deduction={d}
              trigger={
                <Button variant="ghost" size="icon" title="Abzug bearbeiten">
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </Button>
              }
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" title="Abzug löschen">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Abzug wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{d.name}“ wird unwiderruflich gelöscht.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteDeduction.mutate({ id: d.id })}
                  >
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
        <DeductionDialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Abzug erfassen
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------- AHV (1. Säule) ---------------------------- */

/** Dialog zum Erfassen/Bearbeiten der AHV-Angaben (Upsert) */
function AhvDialog({
  ahv,
  trigger,
}: {
  ahv: AhvRow | null;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <AhvDialogForm ahv={ahv} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function AhvDialogForm({
  ahv,
  close,
}: {
  ahv: AhvRow | null;
  close: () => void;
}) {
  const invalidate = useInvalidatePension();
  const [ahvNumber, setAhvNumber] = useState(ahv?.ahvNumber ?? "");
  const [years, setYears] = useState(
    ahv?.contributionYears != null ? String(ahv.contributionYears) : ""
  );
  const [pension, setPension] = useState(
    centsInput(ahv?.expectedMonthlyPension ?? 0)
  );
  const [notes, setNotes] = useState(ahv?.notes ?? "");
  const [comment, setComment] = useState("");

  const updateAhv = trpc.pension.updateAhv.useMutation({
    onSuccess: () => {
      toast.success("AHV-Angaben gespeichert.");
      invalidate();
      close();
    },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    const contributionYears = years.trim() === "" ? null : Number(years);
    if (
      contributionYears !== null &&
      (!Number.isInteger(contributionYears) ||
        contributionYears < 0 ||
        contributionYears > 50)
    ) {
      toast.error("Beitragsjahre zwischen 0 und 50 angeben.");
      return;
    }
    updateAhv.mutate({
      ahvNumber: ahvNumber.trim() || null,
      contributionYears,
      expectedMonthlyPension: pension.trim() === "" ? null : parseEuro(pension),
      notes: notes.trim(),
      comment: comment.trim() || undefined,
    });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>AHV-Angaben</DialogTitle>
        <DialogDescription>
          Angaben zur 1. Säule. Ohne erwartete Rente schätzt die Prognose aus
          den Beitragsjahren.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>AHV-Nummer</Label>
            <Input
              placeholder="756.1234.5678.90"
              value={ahvNumber}
              onChange={e => setAhvNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Beitragsjahre</Label>
            <Input
              inputMode="numeric"
              placeholder="z. B. 44"
              value={years}
              onChange={e => setYears(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Erwartete Monatsrente ({currencySymbol()})</Label>
          <Input
            inputMode="decimal"
            placeholder={amountPlaceholder}
            value={pension}
            onChange={e => setPension(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leer lassen für eine Schätzung aus den Beitragsjahren.
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
        <div className="space-y-2">
          <Label>Änderungskommentar (optional)</Label>
          <Input value={comment} onChange={e => setComment(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Abbrechen
        </Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={updateAhv.isPending}
        >
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** AHV-Card: Anzeige der Angaben, Bearbeiten-Dialog und Anhänge */
function AhvCard({ ahv }: { ahv: AhvRow | null }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-5 w-5 text-violet-500" />
            AHV (1. Säule)
          </CardTitle>
          <CardDescription>Ausweisdaten und erwartete Rente</CardDescription>
        </div>
        <AhvDialog
          ahv={ahv}
          trigger={
            ahv ? (
              <Button
                variant="ghost"
                size="icon"
                title="AHV-Angaben bearbeiten"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
            ) : (
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" /> Angaben erfassen
              </Button>
            )
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {!ahv ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Angaben hinterlegt.
          </p>
        ) : (
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">AHV-Nummer</div>
              <div className="font-medium">{ahv.ahvNumber ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Beitragsjahre</div>
              <div className="font-medium">{ahv.contributionYears ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                Erwartete Monatsrente
              </div>
              <div className="font-medium">
                {ahv.expectedMonthlyPension != null
                  ? formatCents(ahv.expectedMonthlyPension)
                  : "—"}
              </div>
            </div>
            {ahv.notes && (
              <div className="sm:col-span-3">
                <div className="text-xs text-muted-foreground">Notizen</div>
                <div className="whitespace-pre-wrap">{ahv.notes}</div>
              </div>
            )}
          </div>
        )}
        {ahv && (
          <div className="space-y-2 border-t pt-3">
            <Label>Anhänge (z. B. Kontoauszug der AHV)</Label>
            <PensionAttachments entityType="ahv" entityId={ahv.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------- Pensionskasse (2. Säule) ---------------------- */

function FundsSection({
  funds,
  forecast,
  retirementAge,
}: {
  funds: DialogFund[];
  forecast: Forecast | undefined;
  retirementAge: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Building2 className="h-5 w-5 text-indigo-500" />
          Pensionskasse (2. Säule)
        </h2>
        <PensionFundDialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Neues Vorsorgekonto
            </Button>
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {funds.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Noch kein Vorsorgekonto erfasst.
            </CardContent>
          </Card>
        )}
        {funds.map(f => {
          // Prognose-Daten der Kasse: forecast.funds/fundSeries enthalten keinen
          // id-Schlüssel — das Mapping läuft über den Namen (stabiler Schlüssel)
          const forecastFund = forecast?.funds.find(ff => ff.name === f.name);
          const series = forecast?.fundSeries.find(fs => fs.name === f.name);
          return (
            <Card key={f.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{f.name}</CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      {f.kind === "pension_fund"
                        ? "Pensionskasse"
                        : "Freizügigkeitskonto"}
                    </Badge>
                    {f.tiers.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        Abstufungen
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <PensionFundStatement
                    fund={f}
                    forecastFund={forecastFund}
                    fundSeries={series?.points}
                    retirementDate={forecast?.retirementDate}
                    retirementAge={retirementAge}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Versicherungsausweis anzeigen"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                  <PensionFundDialog
                    fund={f}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Vorsorgekonto bearbeiten"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold">
                    {formatCents(f.currentCapital)}
                  </span>
                </div>
                {f.employer && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Arbeitgeber</span>
                    <span className="font-medium">{f.employer}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Jährliches Sparen
                  </span>
                  <span className="font-medium">
                    {formatCents(f.yearlySavings)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verzinsung</span>
                  <span className="font-medium">
                    {formatBp(f.interestRateBp)} %
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Umwandlungssatz</span>
                  <span className="font-medium">
                    {formatBp(f.conversionRateBp)} %
                  </span>
                </div>
                {f.notes && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {f.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------- Säule 3a -------------------------------- */

function Pillar3Section({ pillars }: { pillars: Pillar3Row[] }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PiggyBank className="h-5 w-5 text-emerald-600" />
          Säule 3a
        </h2>
        <PensionPillar3Dialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Neues 3a-Konto
            </Button>
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pillars.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Noch kein 3a-Konto erfasst.
            </CardContent>
          </Card>
        )}
        {pillars.map(p => {
          const linked = p.accountId !== null && p.syncedBalance != null;
          const balance = linked ? p.syncedBalance! : p.currentBalance;
          return (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-1.5">
                    {p.institution || "ohne Institution"}
                    {linked && (
                      <Badge variant="secondary" className="text-[10px]">
                        Konto verknüpft
                      </Badge>
                    )}
                  </CardDescription>
                </div>
                <PensionPillar3Dialog
                  pillar={p}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      title="3a-Konto bearbeiten"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold">
                    {formatCents(balance)}
                  </span>
                </div>
                {(p.goalCommitment ?? 0) > 0 && (
                  <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Davon {formatCents(p.goalCommitment!)} im Sparziel „
                    {p.goalNames.join("“, „")}“ verplant
                  </p>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Jährliche Einzahlung
                  </span>
                  <span className="font-medium">
                    {formatCents(p.yearlyDeposit)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verzinsung</span>
                  <span className="font-medium">
                    {formatBp(p.interestRateBp)} %
                  </span>
                </div>
                {p.notes && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {p.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------- Verlauf --------------------------------- */

function HistoryCard() {
  // Backend-Pagination: 25 Einträge pro Seite, „Mehr laden“ blättert per Cursor
  const changesQuery = trpc.pension.listChanges.useInfiniteQuery(
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
          Änderungen an deinen Vorsorge-Daten — neueste zuerst
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
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Badge variant="secondary">
                    {ENTITY_LABELS[entry.entity] ?? entry.entity}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
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

/* ---------------------------------- Seite ---------------------------------- */

export default function Pension() {
  const profileQuery = trpc.pension.getProfile.useQuery();
  const profile = profileQuery.data ?? null;
  const hasProfile = !!profile;

  const forecastQuery = trpc.pension.forecast.useQuery(undefined, {
    enabled: hasProfile,
  });
  const salariesQuery = trpc.pension.listSalaries.useQuery(undefined, {
    enabled: hasProfile,
  });
  const deductionsQuery = trpc.pension.listDeductions.useQuery(undefined, {
    enabled: hasProfile,
  });
  const ahvQuery = trpc.pension.getAhv.useQuery(undefined, {
    enabled: hasProfile,
  });
  const fundsQuery = trpc.pension.listFunds.useQuery(undefined, {
    enabled: hasProfile,
  });
  const pillar3Query = trpc.pension.listPillar3.useQuery(undefined, {
    enabled: hasProfile,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vorsorge</h1>
        <p className="text-sm text-muted-foreground">
          Deine private Altersvorsorge nach dem 3-Säulen-Prinzip
        </p>
      </div>

      {profileQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Lade Vorsorge…</p>
      ) : !hasProfile ? (
        <SetupCard />
      ) : (
        <>
          <OverviewSection
            forecast={forecastQuery.data}
            isLoading={forecastQuery.isLoading}
            profile={{
              birthDate: profile.birthDate,
              retirementAge: profile.retirementAge,
            }}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <SalarySection
              salaries={salariesQuery.data ?? []}
              globalDeductions={(deductionsQuery.data ?? []).filter(
                d => d.salaryId === null
              )}
              currentNet={forecastQuery.data?.currentNet ?? null}
            />
            <DeductionsSection
              deductions={(deductionsQuery.data ?? []).filter(
                d => d.salaryId === null
              )}
            />
          </div>
          <AhvCard ahv={ahvQuery.data ?? null} />
          <FundsSection
            funds={fundsQuery.data ?? []}
            forecast={forecastQuery.data}
            retirementAge={profile.retirementAge}
          />
          <Pillar3Section pillars={pillar3Query.data ?? []} />
          <HistoryCard />
        </>
      )}
    </div>
  );
}
