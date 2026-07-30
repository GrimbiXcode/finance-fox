import { useState, type ReactNode } from 'react';
import {
  Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { DialogFund } from '@/components/PensionFundDialog';
import {
  currencySymbol, formatBp, formatCents, formatDate, getUserLocale, todayISO,
} from '@/lib/finance';

/** Prognose-Daten einer einzelnen Kasse, wie sie pension.forecast liefert */
type ForecastFund = inferRouterOutputs<AppRouter>['pension']['forecast']['funds'][number];
type FundSeriesPoint = { year: number; capital: number };

/** Abgestufte Farben für den Stufen-Balken */
const TIER_COLORS = ['bg-emerald-500', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500'];
/** Dezente, abwechselnde Füllfarben für die Phasen-Bänder im Projektions-Chart */
const PHASE_FILLS = ['#10b981', '#0ea5e9', '#6366f1', '#8b5cf6'];

/** Ein Kennzahlen-Kästchen im Ausweis-Grid */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

/**
 * Versicherungsausweis einer Pensionskasse: Stammdaten, Abstufungen mit
 * Stufen-Balken, Projektion (Kapitalentwicklung mit Phasen-Bändern) und
 * Risikoleistungen — im Stil eines Schweizer Vorsorgeausweises.
 */
export default function PensionFundStatement({
  fund,
  forecastFund,
  fundSeries,
  retirementDate,
  retirementAge,
  trigger,
}: {
  fund: DialogFund;
  /** Passendes Element aus forecast.funds (per Name gemappt); undefined, wenn die Prognose fehlt */
  forecastFund?: ForecastFund;
  /** Jahres-Kapital der Kasse aus forecast.fundSeries (gleiche Jahre wie series) */
  fundSeries?: FundSeriesPoint[];
  /** Pensionierungsdatum (YYYY-MM-DD) aus der Prognose */
  retirementDate?: string;
  /** Pensionierungsalter aus dem Profil — obere Kante des Stufen-Balkens */
  retirementAge: number;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const tiers = [...fund.tiers].sort((a, b) => a.ageFrom - b.ageFrom);
  const tierSpan = tiers.length > 0 ? retirementAge - tiers[0].ageFrom : 0;

  const phases = forecastFund?.phases ?? [];
  const chartData = (fundSeries ?? []).map((p) => ({
    // Numerische Achse (wie im Übersichts-Chart): die Band-Skala einer
    // Kategorien-Achse liefert für die ReferenceArea-Bänder keine Koordinaten
    year: p.year,
    Kapital: Math.round(p.capital / 100),
  }));
  const firstYear = fundSeries && fundSeries.length > 0 ? fundSeries[0].year : null;
  const lastYear = fundSeries && fundSeries.length > 0 ? fundSeries[fundSeries.length - 1].year : null;
  const showProjection = chartData.length > 1 && lastYear !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Versicherungsausweis — {fund.name}</DialogTitle>
            <Badge variant="secondary">
              {fund.kind === 'pension_fund' ? 'Pensionskasse' : 'Freizügigkeitskonto'}
            </Badge>
          </div>
          <DialogDescription>
            {fund.employer ? `${fund.employer} · ` : ''}{fund.valueDate ? `Angaben per ${formatDate(fund.valueDate)}` : `Stand: ${formatDate(todayISO())}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Altersguthaben heute" value={formatCents(fund.currentCapital)} />
            <Stat
              label="Versicherter Jahreslohn"
              value={fund.insuredSalary != null ? formatCents(fund.insuredSalary) : '—'}
            />
            <Stat
              label="Koordinationsabzug"
              value={fund.coordinationDeduction != null ? formatCents(fund.coordinationDeduction) : '—'}
            />
            <Stat
              label="Einkaufspotenzial"
              value={fund.buyInPotential != null ? formatCents(fund.buyInPotential) : '—'}
            />
          </div>

          <div className="space-y-3">
            <p className="border-t pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sparbeitrags-Abstufungen
            </p>
            {tiers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine Abstufungen hinterlegt — die Prognose rechnet mit dem pauschalen Jahresbeitrag.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ab Alter</TableHead>
                      <TableHead className="text-right">AN %</TableHead>
                      <TableHead className="text-right">AG %</TableHead>
                      <TableHead className="text-right">Total %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tiers.map((t) => (
                      <TableRow key={t.ageFrom}>
                        <TableCell>{t.ageFrom}</TableCell>
                        <TableCell className="text-right">{formatBp(t.employeeRateBp)}</TableCell>
                        <TableCell className="text-right">{formatBp(t.employerRateBp)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatBp(t.employeeRateBp + t.employerRateBp)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {tierSpan > 0 && (
                  <div
                    className="flex h-8 overflow-hidden rounded-md"
                    title={`Sparbeiträge ab ${tiers[0].ageFrom} bis ${retirementAge} Jahre`}
                  >
                    {tiers.map((t, i) => {
                      const to = tiers[i + 1]?.ageFrom ?? retirementAge;
                      const widthPct = ((to - t.ageFrom) / tierSpan) * 100;
                      const total = formatBp(t.employeeRateBp + t.employerRateBp);
                      return (
                        <div
                          key={t.ageFrom}
                          className={`flex items-center justify-center overflow-hidden text-[10px] font-medium text-white ${TIER_COLORS[i % TIER_COLORS.length]}`}
                          style={{ width: `${widthPct}%` }}
                          title={`ab ${t.ageFrom}: ${total} % (AN ${formatBp(t.employeeRateBp)} / AG ${formatBp(t.employerRateBp)})`}
                        >
                          <span className="truncate px-1">{total} %</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {showProjection && (
            <div className="space-y-3">
              <p className="border-t pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Projektion bis zur Pensionierung{retirementDate ? ` (${formatDate(retirementDate)})` : ''}
              </p>
              {forecastFund && (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Altersguthaben mit Pensionierung: </span>
                    <span className="font-semibold text-emerald-600">{formatCents(forecastFund.capital)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Monatsrente: </span>
                    <span className="font-semibold text-emerald-600">{formatCents(forecastFund.monthlyPension)}</span>
                  </div>
                </div>
              )}
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="year"
                      type="number"
                      domain={firstYear !== null && lastYear !== null ? [firstYear, lastYear] : undefined}
                      tickCount={Math.min(12, chartData.length)}
                      tickFormatter={(v: number) => String(v)}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k ${currencySymbol()}`}
                      width={80}
                    />
                    <Tooltip
                      formatter={(value: number | string) => [
                        `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`,
                        'Kapital',
                      ]}
                    />
                    {phases.map((p, i) => (
                      <ReferenceArea
                        ifOverflow="hidden"
                        key={`${p.ageFrom}-${p.fromYear}`}
                        x1={p.fromYear}
                        x2={phases[i + 1]?.fromYear ?? lastYear ?? p.fromYear}
                        fill={PHASE_FILLS[i % PHASE_FILLS.length]}
                        fillOpacity={0.08}
                        label={{
                          value: `${formatBp(p.rateBp)} %`,
                          position: 'insideTop',
                          fontSize: 10,
                          fill: '#64748b',
                        }}
                      />
                    ))}
                    <Area type="monotone" dataKey="Kapital" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="border-t pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Risikoleistungen
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="Invalidenrente pro Jahr"
                value={fund.disabilityPension != null ? formatCents(fund.disabilityPension) : '—'}
              />
              <Stat
                label="Todesfallkapital"
                value={fund.deathBenefit != null ? formatCents(fund.deathBenefit) : '—'}
              />
            </div>
          </div>

          {fund.notes && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notizen</p>
              <p className="whitespace-pre-wrap text-sm">{fund.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
