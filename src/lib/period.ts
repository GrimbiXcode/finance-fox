import { formatDate, formatMonth } from '@/lib/finance';
import type { Period } from '@contracts/period';

/** Zeitraum als Anzeigetext („September 2026“, „2026“, „01.03. – 15.03.“) */
export function periodLabel(period: Period): string {
  switch (period.kind) {
    case 'month':
      return formatMonth(period.month);
    case 'year':
      return String(period.year);
    case 'range':
      return `${formatDate(period.from)} – ${formatDate(period.to)}`;
    case 'all':
      return 'Alle Zeiträume';
  }
}
