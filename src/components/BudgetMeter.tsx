import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { BudgetPace } from '@contracts/planning';

/**
 * Budget-Balken mit Zeitmarke: der Strich zeigt, wie viel vom Zeitraum schon
 * vorbei ist. Liegt die Füllung rechts davon, ist das Budget zu schnell
 * unterwegs. Geteilt von der Budget-Seite und dem Dashboard.
 */
export default function BudgetMeter({
  percent, elapsed, pace, period, className,
}: {
  /** Verbrauch in Prozent (wird auf 100 gedeckelt) */
  percent: number;
  /** Verstrichener Anteil des Zeitraums (0–1) */
  elapsed: number;
  pace: BudgetPace;
  period: 'monthly' | 'yearly';
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, percent));
  const mark = Math.round(elapsed * 100);
  return (
    <div className={cn('relative', className)}>
      <Progress
        value={pct}
        className={cn(
          '[&>div]:transition-all',
          pace === 'over' ? '[&>div]:bg-destructive' : pace === 'fast' ? '[&>div]:bg-warning' : '',
        )}
      />
      <div
        className="pointer-events-none absolute -top-1 h-4 w-0.5 rounded-full bg-foreground/70"
        style={{ left: `calc(${mark}% - 1px)` }}
        title={`Heute: ${mark} % des ${period === 'monthly' ? 'Monats' : 'Jahres'} vorbei`}
      />
    </div>
  );
}
