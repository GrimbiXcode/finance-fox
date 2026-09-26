import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { periodLabel } from '@/lib/period';
import {
  PERIOD_PRESET_LABELS, isFuturePeriod, matchingPreset, periodRange, presetPeriod, shiftPeriod,
  type Period, type PeriodPreset,
} from '@contracts/period';

/**
 * Zeitraum-Wahl (Transaktionen, Auswertung): Pfeile schieben um die eigene
 * Länge, daneben Presets und eine freie Spanne. Die Logik liegt in
 * `contracts/period.ts`; wo der Zeitraum gespeichert wird (URL), entscheidet
 * die Seite. `allowAll` blendet „Alle Zeiträume“ aus, wo es keinen Sinn
 * ergibt (Vergleich mit dem Zeitraum davor).
 */
export default function PeriodPicker({
  period, onChange, today, allowAll = true,
}: {
  period: Period;
  onChange: (period: Period) => void;
  today: string;
  allowAll?: boolean;
}) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const selectedPreset = matchingPreset(period, today);
  const canShift = period.kind !== 'all';
  const nextDisabled = isFuturePeriod(shiftPeriod(period, 1), today);
  const presets = (Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[])
    .filter((p) => allowAll || presetPeriod(p, today).kind !== 'all');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-md border bg-card">
        <Button
          variant="ghost" size="icon" className="h-9 w-9" title="Vorheriger Zeitraum"
          disabled={!canShift} onClick={() => onChange(shiftPeriod(period, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-28 px-1 text-center text-sm font-medium tabular-nums">{periodLabel(period)}</span>
        <Button
          variant="ghost" size="icon" className="h-9 w-9" title="Nächster Zeitraum"
          disabled={!canShift || nextDisabled} onClick={() => onChange(shiftPeriod(period, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <Select
        value={selectedPreset ?? 'custom'}
        onValueChange={(v) => {
          if (v !== 'custom') onChange(presetPeriod(v as PeriodPreset, today));
        }}
      >
        <SelectTrigger className="w-44 min-w-0 [&>span]:truncate" title="Zeitraum wählen">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem key={p} value={p}>{PERIOD_PRESET_LABELS[p]}</SelectItem>
          ))}
          <SelectItem value="custom" disabled={selectedPreset !== null}>Eigener Zeitraum</SelectItem>
        </SelectContent>
      </Select>
      <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">Von – bis…</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2" align="start">
          <RangeForm
            initial={periodRange(period)}
            today={today}
            onApply={(from, to) => {
              onChange({ kind: 'range', from, to });
              setRangeOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Freie Spanne im Popover: zwei Datumsfelder, Übernehmen */
function RangeForm({
  initial, today, onApply,
}: {
  initial: { from?: string; to?: string };
  today: string;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initial.from ?? `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(initial.to ?? today);
  const valid = from !== '' && to !== '' && from <= to;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Von</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Bis</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!valid && <p className="text-xs text-destructive">„Von“ muss vor „Bis“ liegen.</p>}
      <Button size="sm" className="w-full" disabled={!valid} onClick={() => onApply(from, to)}>
        Zeitraum übernehmen
      </Button>
    </>
  );
}
