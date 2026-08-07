import { useState, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { trpc } from '@/providers/trpc';
import { formatBp, formatCents, formatDate } from '@/lib/finance';
import { ahvWarningText, isAhvAlert } from '@/lib/ahv';
import { cn } from '@/lib/utils';

type AhvVariant = inferRouterOutputs<AppRouter>['pension']['ahvVariants'][number];

function Stat({
  label, value, hint, strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-semibold', strong && 'text-lg')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Rentenberechnung der 1. Säule: zeigt, wie aus den erfassten Jahren die
 * Monatsrente wird — massgebendes durchschnittliches Jahreseinkommen,
 * Rentenskala, Vollrente — und stellt die Bezugsvarianten gegenüber.
 *
 * Die Aufschlüsselung ist Absicht: Eine einzelne Zahl „CHF 1'719" wäre für
 * ein Bankgespräch oder eine Pensionsplanung nicht überprüfbar.
 */
export default function AhvStatement({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <AhvStatementContent />}
    </Dialog>
  );
}

function AhvStatementContent() {
  const detail = trpc.pension.ahvDetail.useQuery();
  const variants = trpc.pension.ahvVariants.useQuery();

  if (detail.isLoading) {
    return (
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rentenberechnung</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Wird berechnet…</p>
      </DialogContent>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rentenberechnung</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {detail.error?.message ?? 'Keine Daten.'}
        </p>
      </DialogContent>
    );
  }

  const d = detail.data;
  const scaleFull = d.duration.scale >= 44;

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Rentenberechnung (1. Säule)</DialogTitle>
        <DialogDescription>
          Nach der Rentenformel der AHV (Merkblatt 3.01). Alle Zwischenschritte
          sind aufgeführt, damit die Zahl nachvollziehbar bleibt.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Monatsrente"
          value={formatCents(d.monthlyPension)}
          hint={`ab ${formatDate(d.pensionStartDate)}`}
          strong
        />
        <Stat
          label="13. Altersrente"
          value={formatCents(d.thirteenthPension)}
          hint="zusätzlich im Dezember"
        />
        <Stat
          label="Jahresrente"
          value={formatCents(d.yearlyPension)}
          hint="inkl. 13. Rente"
        />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Massgebendes Einkommen</h3>
        <dl className="space-y-1 text-sm">
          <Row label="Summe der Erwerbseinkommen" value={formatCents(d.income.rawSum)} />
          <Row
            label={`Aufgewertet (Faktor ${(d.income.revaluationFactorBp / 10000).toFixed(3)})`}
            value={formatCents(d.income.revaluedSum)}
          />
          <Row
            label={`Ø Erwerbseinkommen (÷ ${d.duration.contributionYears} Jahre)`}
            value={formatCents(d.income.averageIncome)}
          />
          <Row
            label="Ø Erziehungsgutschriften"
            value={formatCents(d.income.averageParentingCredit)}
          />
          <Row
            label="Ø Betreuungsgutschriften"
            value={formatCents(d.income.averageCareCredit)}
          />
          <Row
            label="Massgebendes durchschnittliches Jahreseinkommen"
            value={formatCents(d.income.relevantIncome)}
            strong
          />
        </dl>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Beitragsdauer und Rentenhöhe</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Rentenskala"
            value={`${d.duration.scale} / 44`}
            hint={
              scaleFull
                ? 'vollständige Beitragsdauer'
                : `${d.duration.missingYears} fehlende Jahre`
            }
          />
          <Stat label="Vollrente (Skala 44)" value={formatCents(d.fullPensionMonthly)} />
          <Stat
            label="Nach Rentenskala"
            value={formatCents(d.scaledPensionMonthly)}
          />
        </div>
        {d.withdrawalAdjustmentBp !== 0 && (
          <p className="text-sm text-muted-foreground">
            {d.withdrawalAdjustmentBp < 0 ? 'Kürzung' : 'Erhöhung'} durch den
            gewählten Rentenbezug:{' '}
            <span className="font-medium text-foreground">
              {formatBp(Math.abs(d.withdrawalAdjustmentBp))} %
            </span>{' '}
            → {formatCents(d.adjustedPensionMonthly)}
          </p>
        )}
      </section>

      {d.warnings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Hinweise</h3>
          <ul className="space-y-2">
            {d.warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border p-2 text-sm"
              >
                {isAhvAlert(w) ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">{ahvWarningText(w)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Wann beziehen?</h3>
        <p className="text-xs text-muted-foreground">
          Die kumulierte Summe zeigt, was bis zum jeweiligen Alter insgesamt
          ausbezahlt wurde — daran entscheidet sich, ob sich ein Aufschub lohnt,
          nicht an der Monatsrente allein.
        </p>
        <VariantsTable
          variants={variants.data ?? []}
          reference={d.monthlyPension}
        />
      </section>

      <p className="text-xs text-muted-foreground">
        Modellrechnung nach den Merkblättern der Informationsstelle AHV/IV
        (Stand 1. Januar 2026) — verbindlich rechnet die Ausgleichskasse. Eine
        amtliche Rentenvorausberechnung bekommst du mit dem Formular 318.282.
      </p>
    </DialogContent>
  );
}

function Row({
  label, value, strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 border-b py-1 last:border-0',
        strong && 'font-semibold',
      )}
    >
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

/** Vergleich der Bezugsvarianten inklusive kumulierter Auszahlung bis 85 */
function VariantsTable({
  variants, reference,
}: {
  variants: AhvVariant[];
  reference: number;
}) {
  if (variants.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Varianten verfügbar.</p>;
  }
  const label = (v: AhvVariant) => {
    if (v.mode === 'reference') return 'Referenzalter';
    const years = v.months / 12;
    return v.mode === 'early'
      ? `${years} Jahr${years === 1 ? '' : 'e'} früher`
      : `${years} Jahr${years === 1 ? '' : 'e'} später`;
  };
  // Kumuliert bis zum 85. Altersjahr, gerechnet ab dem jeweiligen Startdatum
  const endYear = new Date(variants[variants.length - 1].startDate).getFullYear() + 20;
  const cumulative = (v: AhvVariant) => {
    const startYear = new Date(v.startDate).getFullYear();
    return Math.max(0, endYear - startYear) * v.yearlyPension;
  };
  const best = Math.max(...variants.map(cumulative));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Variante</TableHead>
            <TableHead>Beginn</TableHead>
            <TableHead className="text-right">Anpassung</TableHead>
            <TableHead className="text-right">Monatsrente</TableHead>
            <TableHead className="text-right">Kumuliert</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((v) => (
            <TableRow key={v.key}>
              <TableCell className="whitespace-nowrap font-medium">
                {label(v)}
                {v.monthlyPension === reference && (
                  <Badge variant="secondary" className="ml-2">
                    gewählt
                  </Badge>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDate(v.startDate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {v.adjustmentBp === 0
                  ? '—'
                  : `${v.adjustmentBp < 0 ? '−' : '+'}${formatBp(Math.abs(v.adjustmentBp))} %`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCents(v.monthlyPension)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  cumulative(v) === best && 'font-semibold text-emerald-600',
                )}
              >
                {formatCents(cumulative(v))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
