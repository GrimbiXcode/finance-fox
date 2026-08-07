import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { trpc } from '@/providers/trpc';
import { useInvalidatePension } from '@/lib/data';
import { formatCents, parseEuro } from '@/lib/finance';
import { cn } from '@/lib/utils';

/** Status eines Beitragsjahres — Werte wie im Schema */
const STATUS_LABELS = {
  employed: 'Erwerbstätig',
  non_employed: 'Nichterwerbstätig',
  gap: 'Lücke',
  youth: 'Jugendjahr',
} as const;
type YearStatus = keyof typeof STATUS_LABELS;

const CREDIT_LABELS = {
  none: '—',
  full: 'ganz',
  half: 'halb',
} as const;
type CreditShare = keyof typeof CREDIT_LABELS;

interface YearRow {
  year: number;
  income: number;
  status: YearStatus;
  parentingCredit: CreditShare;
  careCredit: CreditShare;
}

/**
 * Erfassung der AHV-Beitragsdauer als Jahres-Tabelle — das Abbild des
 * individuellen Kontos (IK), das man bei der Ausgleichskasse gratis
 * bestellen kann.
 *
 * Die Tabelle ist zugleich die Lücken-Erfassung: Ein Jahr mit Status „Lücke"
 * zählt nicht als Beitragsjahr und kostet 1/44 der Rente. Beides an einem
 * Ort, damit Einkommen und Lücken nicht auseinanderlaufen können.
 */
export default function AhvYearsDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <AhvYearsForm />}
    </Dialog>
  );
}

function AhvYearsForm() {
  const invalidate = useInvalidatePension();
  const years = trpc.pension.listAhvYears.useQuery();
  const rows = useMemo(() => (years.data ?? []) as YearRow[], [years.data]);

  const upsert = trpc.pension.upsertAhvYear.useMutation({
    onSuccess: () => {
      years.refetch();
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = trpc.pension.deleteAhvYear.useMutation({
    onSuccess: () => {
      years.refetch();
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const totals = useMemo(() => {
    const contributing = rows.filter((r) => r.status !== 'gap' && r.status !== 'youth');
    return {
      count: contributing.length,
      gaps: rows.filter((r) => r.status === 'gap').length,
      sum: contributing.reduce((s, r) => s + r.income, 0),
    };
  }, [rows]);

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Beitragsjahre (IK-Auszug)</DialogTitle>
        <DialogDescription>
          Trage pro Kalenderjahr das gemeldete Erwerbseinkommen ein. Den
          Auszug aus deinem individuellen Konto bekommst du bei deiner
          Ausgleichskasse kostenlos.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Beitragsjahre" value={String(totals.count)} />
        <Stat
          label="Lücken"
          value={String(totals.gaps)}
          tone={totals.gaps > 0 ? 'warn' : undefined}
        />
        <Stat label="Einkommenssumme" value={formatCents(totals.sum)} />
      </div>

      <BulkFill
        onFill={async (from, to, income) => {
          for (let year = from; year <= to; year++) {
            await upsert.mutateAsync({ year, income });
          }
          toast.success(`${to - from + 1} Jahre erfasst.`);
        }}
        busy={upsert.isPending}
      />

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jahr</TableHead>
              <TableHead className="text-right">Einkommen</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Erziehung</TableHead>
              <TableHead>Betreuung</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Noch keine Jahre erfasst.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow
                key={row.year}
                className={cn(row.status === 'gap' && 'bg-amber-500/10')}
              >
                <TableCell className="font-medium">{row.year}</TableCell>
                <TableCell className="text-right">
                  <InlineAmount
                    value={row.income}
                    onChange={(income) => upsert.mutate({ ...row, income })}
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    value={row.status}
                    labels={STATUS_LABELS}
                    onChange={(status) =>
                      upsert.mutate({ ...row, status: status as YearStatus })
                    }
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    value={row.parentingCredit}
                    labels={CREDIT_LABELS}
                    onChange={(v) =>
                      upsert.mutate({ ...row, parentingCredit: v as CreditShare })
                    }
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    value={row.careCredit}
                    labels={CREDIT_LABELS}
                    onChange={(v) =>
                      upsert.mutate({ ...row, careCredit: v as CreditShare })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={`Jahr ${row.year} löschen`}
                    onClick={() => remove.mutate({ year: row.year })}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Erziehungsgutschriften gibt es für Jahre mit Kindern unter 16, während
        der Ehe je zur Hälfte auf beide Eltern verteilt („halb"). Jugendjahre
        (18–20) können später entstandene Lücken auffüllen.
      </p>
    </DialogContent>
  );
}

function Stat({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-semibold',
          tone === 'warn' && 'text-amber-600 dark:text-amber-500',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Zeitraum auf einen Schlag füllen — 44 Jahre einzeln anzulegen wäre Quälerei */
function BulkFill({
  onFill, busy,
}: {
  onFill: (from: number, to: number, income: number) => Promise<void>;
  busy: boolean;
}) {
  const thisYear = new Date().getFullYear();
  const [from, setFrom] = useState(String(thisYear - 10));
  const [to, setTo] = useState(String(thisYear));
  const [income, setIncome] = useState('');

  const submit = async () => {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) {
      toast.error('Bitte einen gültigen Zeitraum angeben.');
      return;
    }
    if (b - a > 60) {
      toast.error('Höchstens 60 Jahre auf einmal.');
      return;
    }
    await onFill(a, b, parseEuro(income));
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <div className="grow-0">
        <Label className="text-xs">Von</Label>
        <Input
          className="w-24"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="grow-0">
        <Label className="text-xs">Bis</Label>
        <Input className="w-24" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="min-w-0 flex-1">
        <Label className="text-xs">Einkommen pro Jahr</Label>
        <Input
          value={income}
          onChange={(e) => setIncome(e.target.value)}
          placeholder="z. B. 80000"
        />
      </div>
      <Button variant="outline" onClick={submit} disabled={busy}>
        <Plus className="mr-2 h-4 w-4" /> Zeitraum füllen
      </Button>
    </div>
  );
}

/** Betrag direkt in der Zeile ändern (Speichern beim Verlassen des Feldes) */
function InlineAmount({
  value, onChange,
}: {
  value: number;
  onChange: (cents: number) => void;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        className="w-full text-right hover:underline"
        onClick={() => {
          setText(value === 0 ? '' : String(value / 100));
          setEditing(true);
        }}
      >
        {formatCents(value)}
      </button>
    );
  }
  return (
    <Input
      autoFocus
      className="h-8 text-right"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const cents = parseEuro(text);
        if (cents !== value) onChange(cents);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

/** Kleines Enum-Select in der Zeile (native, wie die übrigen 2–4-Optionen-Selects) */
function InlineSelect({
  value, labels, onChange,
}: {
  value: string;
  labels: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(labels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}
